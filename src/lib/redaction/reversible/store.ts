import { ReversibleError, type ReplacementMapping, type ReplacementRecord } from './types';
import { validateMappings } from './mappings';

const DATABASE = 'saferedact-replacements';
const STORE = 'records';
let database: Promise<IDBDatabase> | undefined;

function openDatabase(): Promise<IDBDatabase> {
  if (!database) {
    database = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE, 2);
      request.onupgradeneeded = () => {
        const store = request.result.objectStoreNames.contains(STORE)
          ? request.transaction!.objectStore(STORE)
          : request.result.createObjectStore(STORE, { keyPath: 'id' });
        if (!store.indexNames.contains('updatedAt')) store.createIndex('updatedAt', 'updatedAt');
      };
      request.onerror = () => reject(new ReversibleError('storage'));
      request.onblocked = () => reject(new ReversibleError('storage'));
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); database = undefined; };
        resolve(db);
      };
    }).catch(() => {
      database = undefined;
      throw new ReversibleError('storage');
    });
  }
  return database;
}

export async function listReplacementRecords(): Promise<ReplacementRecord[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readonly');
    const request = transaction.objectStore(STORE).getAll();
    transaction.oncomplete = () => resolve((request.result as ReplacementRecord[])
      .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id)));
    transaction.onabort = transaction.onerror = () => reject(new ReversibleError('storage'));
  });
}

/** Create an immutable record before exporting its document. */
export async function saveReplacementRecord(
  name: string,
  mappings: ReplacementMapping[],
  reservedLabels: string[] = [],
): Promise<ReplacementRecord> {
  const trimmedName = name.trim();
  if (!trimmedName || trimmedName.length > 200) throw new ReversibleError('name');
  // Callers may edit their arrays while database operations await. Persist only
  // the snapshot that passed the one-to-one check.
  mappings = mappings.map(mapping => ({ ...mapping }));
  reservedLabels = [...reservedLabels];
  validateMappings(mappings);
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    let saved: ReplacementRecord;
    // Keep creation ordering stable for simultaneous exports or clock changes.
    const newest = store.index('updatedAt').openCursor(null, 'prev');
    newest.onsuccess = () => {
      const now = Math.max(Date.now(), (newest.result?.value.updatedAt ?? 0) + 1);
      saved = {
        id: crypto.randomUUID(),
        name: trimmedName,
        createdAt: now,
        updatedAt: now,
        revision: 1,
        mappings,
        reservedLabels,
      };
      store.add(saved);
    };
    transaction.oncomplete = () => resolve(saved);
    transaction.onabort = transaction.onerror = () => reject(new ReversibleError('storage'));
  });
}

export async function deleteReplacementRecord(record: ReplacementRecord): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    let failure = new ReversibleError('storage');
    const request = store.get(record.id);
    request.onsuccess = () => {
      if (request.result?.revision !== record.revision) {
        failure = new ReversibleError('conflict');
        transaction.abort();
      } else store.delete(record.id);
    };
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () => reject(failure);
  });
}
