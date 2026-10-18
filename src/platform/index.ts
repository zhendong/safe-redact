/**
 * Platform abstraction for the browser and the Tauri desktop build.
 * The desktop build is selected at compile time with `vite --mode desktop`.
 */

import { formatLogMessage, setLogSink } from '@/utils/logger';

// import.meta.env is undefined when tests run modules outside Vite
export const isDesktop = import.meta.env?.MODE === 'desktop';

/**
 * Save a file to disk.
 * Browser: triggers a download. Desktop: shows the native Save dialog.
 * Resolves false only when the user cancels the desktop Save dialog.
 */
export async function saveFile(blob: Blob, suggestedName: string): Promise<boolean> {
  if (!isDesktop) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = suggestedName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Revoke later so the browser has time to start the download
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  }

  const [{ save }, { writeFile }] = await Promise.all([
    import('@tauri-apps/plugin-dialog'),
    import('@tauri-apps/plugin-fs'),
  ]);
  const extension = suggestedName.includes('.') ? suggestedName.split('.').pop()! : '';
  const path = await save({
    defaultPath: suggestedName,
    filters: extension ? [{ name: extension.toUpperCase(), extensions: [extension] }] : undefined,
  });
  if (!path) return false;
  await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
  return true;
}

/** Open an external URL in the default browser. */
export async function openExternal(url: string): Promise<void> {
  if (!isDesktop) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  const { openUrl } = await import('@tauri-apps/plugin-opener');
  await openUrl(url);
}

/**
 * In the desktop app, route clicks on external http(s) links to the default
 * browser instead of letting the webview navigate away from the app.
 */
export function installExternalLinkHandler(): void {
  if (!isDesktop) return;
  document.addEventListener('click', event => {
    const anchor = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!anchor || anchor.hasAttribute('download')) return;
    if (!/^https?:/i.test(anchor.href) || anchor.origin === window.location.origin) return;
    event.preventDefault();
    void openExternal(anchor.href);
  });
}

const MIME_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

interface OpenedFile {
  path: string;
  name: string;
}

async function readOpenedFile(opened: OpenedFile): Promise<File> {
  const { invoke } = await import('@tauri-apps/api/core');
  const bytes = await invoke<ArrayBuffer>('read_opened_file', { path: opened.path });
  const extension = opened.name.split('.').pop()?.toLowerCase() ?? '';
  return new File([bytes], opened.name, { type: MIME_TYPES[extension] ?? '' });
}

/**
 * Desktop only: native Open dialog limited to the given extensions, because
 * WebKit's file input ignores `accept`. Resolves null if the user cancels.
 */
export async function pickFile(filterName: string, extensions: string[]): Promise<File | null> {
  const { invoke } = await import('@tauri-apps/api/core');
  const opened = await invoke<OpenedFile | null>('pick_file', { filterName, extensions });
  return opened ? readOpenedFile(opened) : null;
}

/**
 * Desktop only: subscribe to files opened from the File menu, the Dock icon,
 * or Finder's "Open With". Returns an unsubscribe function.
 */
export function onDesktopFileOpened(handler: (file: File) => void): () => void {
  if (!isDesktop) return () => {};
  let disposed = false;
  let unlisten: (() => void) | undefined;

  void (async () => {
    const [{ invoke }, { listen }] = await Promise.all([
      import('@tauri-apps/api/core'),
      import('@tauri-apps/api/event'),
    ]);
    const deliver = async (opened: OpenedFile) => {
      const file = await readOpenedFile(opened);
      if (!disposed) handler(file);
    };
    const stop = await listen<OpenedFile>('open-file', event => void deliver(event.payload));
    if (disposed) return stop();
    unlisten = stop;
    // A file may have been opened before the page loaded (e.g. launched via "Open With")
    const pending = await invoke<OpenedFile | null>('take_pending_file');
    if (pending) await deliver(pending);
  })();

  return () => {
    disposed = true;
    unlisten?.();
  };
}

/** Desktop only: subscribe to File > Save Redacted File… (⌘S). */
export function onDesktopExportRequested(handler: () => void): () => void {
  if (!isDesktop) return () => {};
  let disposed = false;
  let unlisten: (() => void) | undefined;
  void import('@tauri-apps/api/event')
    .then(({ listen }) => listen('menu-export', handler))
    .then(stop => (disposed ? stop() : (unlisten = stop)));
  return () => {
    disposed = true;
    unlisten?.();
  };
}

/** Desktop only: enable File > Save Redacted File… while a review can be exported. */
export function setDesktopExportEnabled(enabled: boolean): void {
  if (!isDesktop) return;
  void import('@tauri-apps/api/core').then(({ invoke }) => invoke('set_export_enabled', { enabled }));
}

/** Desktop only: localize the native menu bar to the app language. */
export function setDesktopLanguage(language: 'en' | 'zh'): void {
  if (!isDesktop) return;
  void import('@tauri-apps/api/core').then(({ invoke }) => invoke('set_language', { language }));
}

/** Ask the user to confirm. Uses the native dialog in the desktop app. */
export async function confirmAction(
  message: string,
  options: { title: string; okLabel: string; cancelLabel: string },
): Promise<boolean> {
  if (!isDesktop) return window.confirm(message);
  const { ask } = await import('@tauri-apps/plugin-dialog');
  return ask(message, { ...options, kind: 'warning' });
}

/** Desktop only: also write log entries to the rotating log file (src-tauri/src/logging.rs). */
export function installDesktopLogging(): void {
  if (!isDesktop) return;
  // Chaining on one promise keeps entries in order while the module loads
  const core = import('@tauri-apps/api/core');
  setLogSink(entry => {
    void core
      .then(({ invoke }) =>
        invoke('log_frontend', { level: entry.level, scope: entry.scope, message: formatLogMessage(entry) }),
      )
      .catch(() => {});
  });
}

/** Desktop only: the contents of the log files, oldest first. */
export async function readDesktopLogs(): Promise<string> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string>('read_logs');
}

/** Desktop only: show the log files in Finder. */
export async function revealDesktopLogs(): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('reveal_logs');
}
