/**
 * Sandbox for the JavaScript validators a rule pack ships.
 *
 * Pack code sees document text, so it must not be able to send it anywhere.
 * Each pack gets its own worker built from a blob. Before the pack's code
 * loads, the worker removes every global except plain JavaScript built-ins
 * (no fetch, XMLHttpRequest, WebSocket, importScripts, storage, timers, eval
 * or the Function constructor), then checks that they are gone. Code can't be
 * built from strings, so rejecting the `import` keyword in the source also
 * rules out dynamic import(). Validators only receive the match and the text
 * around it, never the whole document.
 *
 * Workers built from a blob also work under the desktop CSP, which allows
 * blob: workers but not eval.
 */

import { createLogger } from '@/utils/logger';
import type { RulePack } from './types';

const log = createLogger('RuleSandbox');

export interface ScriptCall {
  validator: string;
  match: string;
  groups: Array<string | undefined>;
  before: string;
  after: string;
}

/** true/false keeps or drops the match; a number sets its confidence; null means the validator failed */
export type ScriptResult = boolean | number | null;

export interface ScriptValidatorHost {
  validate(pack: RulePack, calls: ScriptCall[]): Promise<ScriptResult[]>;
  dispose(): void;
}

const START_TIMEOUT_MS = 5000;
const BATCH_TIMEOUT_MS = 5000;

/** Problems with a validator's source that are caught before it runs */
export function checkValidatorSource(name: string, source: string): string | null {
  if (/\bimport\b/.test(source)) return `Validator "${name}" may not use "import"`;
  return null;
}

// Plain JavaScript built-ins; everything else on the worker's global object is removed
const ALLOWED_GLOBALS = [
  'Object', 'Array', 'String', 'Number', 'Boolean', 'Symbol', 'BigInt', 'Math', 'JSON', 'RegExp', 'Date',
  'Map', 'Set', 'WeakMap', 'WeakSet', 'WeakRef', 'FinalizationRegistry', 'Promise', 'Proxy', 'Reflect', 'Intl', 'Iterator',
  'Error', 'AggregateError', 'EvalError', 'RangeError', 'ReferenceError', 'SyntaxError', 'TypeError', 'URIError',
  'ArrayBuffer', 'DataView', 'Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array',
  'Int32Array', 'Uint32Array', 'Float16Array', 'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURI', 'encodeURIComponent', 'decodeURI', 'decodeURIComponent',
  'undefined', 'NaN', 'Infinity', 'globalThis', 'self', 'TextEncoder', 'TextDecoder', 'console',
];

// Runs first in the worker. Plain JavaScript in a string so the bundler can't rewrite it.
const PRELUDE = `'use strict';
const __send = self.postMessage.bind(self);
const __listen = self.addEventListener.bind(self);
(() => {
  const allowed = new Set(${JSON.stringify(ALLOWED_GLOBALS)});
  for (let o = self; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
    for (const key of Object.getOwnPropertyNames(o)) {
      if (allowed.has(key)) continue;
      try {
        Object.defineProperty(o, key, { value: undefined, writable: false, configurable: false });
      } catch {
        try { delete o[key]; } catch {}
      }
    }
  }
  for (const fn of [function () {}, async function () {}, function* () {}, async function* () {}]) {
    Object.defineProperty(Object.getPrototypeOf(fn), 'constructor', { value: undefined, writable: false, configurable: false });
  }
  const leaks = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'Worker', 'indexedDB',
    'caches', 'BroadcastChannel', 'FontFace', 'setTimeout', 'setInterval', 'eval', 'Function', 'navigator', 'postMessage']
    .filter(name => self[name] !== undefined);
  if (leaks.length || (function () {}).constructor !== undefined) {
    throw new Error('Sandbox lockdown failed: ' + leaks.join(', '));
  }
})();
const __validators = Object.create(null);
`;

const EPILOGUE = `
__listen('message', event => {
  const { id, calls } = event.data;
  const results = calls.map(call => {
    const fn = __validators[call.validator];
    if (typeof fn !== 'function') return null;
    try {
      const result = fn(call.match, { groups: call.groups, before: call.before, after: call.after });
      if (typeof result === 'number') return Number.isFinite(result) ? Math.min(1, Math.max(0, result)) : null;
      return Boolean(result);
    } catch {
      return null;
    }
  });
  __send({ type: 'results', id, results });
});
__send({ type: 'ready' });
`;

export function buildSandboxSource(validators: Record<string, string>): string {
  const definitions = Object.entries(validators)
    .map(([name, source]) => `__validators[${JSON.stringify(name)}] = (\n${source}\n);`)
    .join('\n');
  return PRELUDE + definitions + EPILOGUE;
}

interface PendingBatch {
  resolve: (results: ScriptResult[]) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

class PackWorker {
  private worker: Worker;
  private ready: Promise<void>;
  private pending = new Map<number, PendingBatch>();
  private nextId = 0;

  constructor(pack: RulePack, private onDead: () => void) {
    const url = URL.createObjectURL(new Blob([buildSandboxSource(pack.validators ?? {})], { type: 'text/javascript' }));
    this.worker = new Worker(url, { name: `rule-pack:${pack.id}` });
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => fail(new Error('Validator sandbox did not start')), START_TIMEOUT_MS);
      const fail = (error: Error) => {
        clearTimeout(timer);
        URL.revokeObjectURL(url);
        this.terminate(error);
        reject(error);
      };
      this.worker.onerror = event => {
        event.preventDefault();
        fail(new Error(event.message || 'Validator code failed to load'));
      };
      this.worker.onmessage = event => {
        if (event.data?.type !== 'ready') return;
        clearTimeout(timer);
        URL.revokeObjectURL(url);
        this.worker.onmessage = message => this.handleResults(message.data);
        this.worker.onerror = message => {
          message.preventDefault();
          this.terminate(new Error(message.message || 'Validator crashed'));
        };
        resolve();
      };
    });
  }

  async validate(calls: ScriptCall[]): Promise<ScriptResult[]> {
    await this.ready;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      // A validator stuck in a loop blocks its worker, so give up and stop it
      const timer = setTimeout(() => this.terminate(new Error('Validators timed out')), BATCH_TIMEOUT_MS + calls.length);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ id, calls });
    });
  }

  private handleResults(data: unknown) {
    const message = data as { type?: string; id?: number; results?: unknown };
    if (message?.type !== 'results' || typeof message.id !== 'number') return;
    const batch = this.pending.get(message.id);
    if (!batch) return;
    this.pending.delete(message.id);
    clearTimeout(batch.timer);
    const results = Array.isArray(message.results) ? message.results : [];
    batch.resolve(results.map(r => (typeof r === 'boolean' || typeof r === 'number' ? r : null)));
  }

  terminate(error = new Error('Validator sandbox closed')) {
    this.worker.terminate();
    for (const batch of this.pending.values()) {
      clearTimeout(batch.timer);
      batch.reject(error);
    }
    this.pending.clear();
    this.onDead();
  }
}

/** Runs validators in one worker per pack, for the length of a detection run */
export class WorkerScriptHost implements ScriptValidatorHost {
  private workers = new Map<string, PackWorker>();

  async validate(pack: RulePack, calls: ScriptCall[]): Promise<ScriptResult[]> {
    for (const [name, source] of Object.entries(pack.validators ?? {})) {
      const problem = checkValidatorSource(name, source);
      if (problem) throw new Error(problem);
    }
    let worker = this.workers.get(pack.id);
    if (!worker) {
      worker = new PackWorker(pack, () => {
        if (this.workers.get(pack.id) === worker) this.workers.delete(pack.id);
      });
      this.workers.set(pack.id, worker);
    }
    return worker.validate(calls);
  }

  dispose() {
    for (const worker of [...this.workers.values()]) worker.terminate();
    this.workers.clear();
    log.debug('Validator sandboxes closed');
  }
}
