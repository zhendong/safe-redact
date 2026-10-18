/**
 * Application logging for bug reports.
 *
 * SafeRedact runs offline, so users attach a diagnostic log when they report a
 * bug. Those logs are shared publicly, so they must never contain document
 * content: log counts, sizes, timings, page numbers, and error messages only —
 * never extracted text, entity text, search strings, or file names. Fields only
 * accept primitives so whole entities or pages can't be dumped by accident.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogFields = Record<string, string | number | boolean | null | undefined>;

export interface LogEntry {
  time: number;
  level: LogLevel;
  scope: string;
  message: string;
  fields?: LogFields;
  error?: string;
}

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields | unknown): void;
  /** Pass the caught error (and optionally fields) to record its message and stack. */
  error(message: string, error?: unknown, fields?: LogFields): void;
}

/** Receives every entry, e.g. to persist it in the desktop app's log file. */
export type LogSink = (entry: LogEntry) => void;

const MAX_ENTRIES = 2000;
const MAX_STACK_LINES = 12;
const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
/** Set to "true" in localStorage to record debug entries in production builds. */
export const VERBOSE_LOGGING_KEY = 'safe-redact-verbose-logging';

function initialMinLevel(): LogLevel {
  try {
    if (import.meta.env?.DEV || localStorage.getItem(VERBOSE_LOGGING_KEY) === 'true') return 'debug';
  } catch {
    // No localStorage outside the browser (tests)
  }
  return 'info';
}

const minLevel = initialMinLevel();
const entries: LogEntry[] = [];
let sink: LogSink | undefined;

export function setLogSink(next: LogSink | undefined): void {
  sink = next;
}

/** Entries logged during this session, oldest first. */
export function getLogEntries(): readonly LogEntry[] {
  return entries;
}

/** Describes a thrown value with its name, message, and the top of its stack. */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    const stack = error.stack?.split('\n').slice(0, MAX_STACK_LINES).join('\n');
    // V8 stacks start with "Name: message"; WebKit stacks are frames only
    const head = `${error.name}: ${error.message}`;
    const description = stack && !stack.startsWith(head) ? `${head}\n${stack}` : stack ?? head;
    return error.cause ? `${description}\nCaused by: ${describeError(error.cause)}` : description;
  }
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

function formatFields(fields: LogFields): string {
  return Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${typeof value === 'string' && /\s/.test(value) ? JSON.stringify(value) : value}`)
    .join(' ');
}

/** The message and fields, followed by the error's stack on indented lines. */
export function formatLogMessage(entry: LogEntry): string {
  const line = entry.fields ? `${entry.message} ${formatFields(entry.fields)}` : entry.message;
  return entry.error ? `${line}\n    ${entry.error.replace(/\n/g, '\n    ')}` : line;
}

export function formatLogEntry(entry: LogEntry): string {
  const time = new Date(entry.time).toISOString();
  return `${time} ${entry.level.toUpperCase().padEnd(5)} [${entry.scope}] ${formatLogMessage(entry)}`;
}

function isFields(value: unknown): value is LogFields {
  return (
    typeof value === 'object' &&
    value !== null &&
    !(value instanceof Error) &&
    Object.values(value).every(v => v === null || ['string', 'number', 'boolean', 'undefined'].includes(typeof v))
  );
}

function write(level: LogLevel, scope: string, message: string, fields?: LogFields, error?: unknown): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;
  const entry: LogEntry = { time: Date.now(), level, scope, message };
  if (fields && Object.keys(fields).length > 0) entry.fields = fields;
  if (error !== undefined) entry.error = describeError(error);

  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);

  // The console gets the live error object so DevTools can expand it
  const consoleLine = `[${scope}] ${formatLogMessage({ ...entry, error: undefined })}`;
  if (error !== undefined) console[level](consoleLine, error);
  else console[level](consoleLine);

  try {
    sink?.(entry);
  } catch {
    // Never let logging break the app
  }
}

export function createLogger(scope: string): Logger {
  return {
    debug: (message, fields) => write('debug', scope, message, fields),
    info: (message, fields) => write('info', scope, message, fields),
    warn: (message, detail) =>
      isFields(detail) ? write('warn', scope, message, detail) : write('warn', scope, message, undefined, detail),
    error: (message, error, fields) => write('error', scope, message, fields, error),
  };
}

/** Logs how long `task` took, then returns its result. Failures are logged and rethrown. */
export async function timed<T>(
  log: Logger,
  label: string,
  task: () => Promise<T>,
  fields?: LogFields,
): Promise<T> {
  const start = performance.now();
  log.info(`${label} started`, fields);
  try {
    const result = await task();
    log.info(`${label} finished`, { ...fields, ms: Math.round(performance.now() - start) });
    return result;
  } catch (error) {
    log.error(`${label} failed`, error, { ...fields, ms: Math.round(performance.now() - start) });
    throw error;
  }
}

/** File details that are safe to log: never the name, which may identify a person. */
export function describeFile(file: File): LogFields {
  return {
    extension: file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : '',
    mime: file.type || 'unknown',
    bytes: file.size,
  };
}
