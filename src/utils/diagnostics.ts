/**
 * Diagnostic report that users attach to bug reports.
 *
 * It holds the environment, a summary of the settings (counts only — never
 * predefined words or rule packs, which are sensitive), and the logs.
 * The desktop app reads its log files, which span earlier sessions; the web
 * version keeps the previous session's log in localStorage.
 */

import packageJson from '../../package.json';
import { isDesktop, readDesktopLogs, saveFile } from '@/platform';
import { STORAGE_KEYS } from './constants';
import { createLogger, formatLogEntry, getLogEntries } from './logger';
import { getPredefinedWords } from './predefined-words';
import { getRulePackStore } from '@/lib/rules/store';
import { LANGUAGE_STORAGE_KEY } from '@/i18n/translations';

const log = createLogger('App');

const PREVIOUS_SESSION_KEY = 'safe-redact-previous-log';
const PERSISTED_ENTRIES = 500;

// Read before this session overwrites it on page hide
let previousSessionLog: string | null = null;

/** Logs uncaught errors and, in the browser, keeps this session's log for the next one. */
export function installDiagnostics(): void {
  window.addEventListener('error', event => {
    log.error('Uncaught error', event.error ?? event.message, {
      source: event.filename ? event.filename.split('/').pop() : undefined,
      line: event.lineno,
      column: event.colno,
    });
  });
  window.addEventListener('unhandledrejection', event => {
    log.error('Unhandled promise rejection', event.reason);
  });

  if (!isDesktop) {
    try {
      previousSessionLog = localStorage.getItem(PREVIOUS_SESSION_KEY);
    } catch {
      // Storage may be unavailable (e.g. disabled cookies)
    }
    window.addEventListener('pagehide', () => {
      try {
        const lines = getLogEntries().slice(-PERSISTED_ENTRIES).map(entry => formatLogEntry(entry));
        localStorage.setItem(PREVIOUS_SESSION_KEY, lines.join('\n'));
      } catch {
        // Quota exceeded or storage unavailable; the current session is still exportable
      }
    });
  }

  log.info('Session started', {
    version: packageJson.version,
    platform: isDesktop ? 'desktop' : 'web',
    mode: import.meta.env.MODE,
  });
}

function settingsSummary(): string[] {
  const lines: string[] = [];
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    if (saved) {
      const config = JSON.parse(saved);
      lines.push(
        `  enabledEntityTypes: ${(config.enabledEntityTypes ?? []).join(', ')}`,
        `  confidenceThresholds: ${JSON.stringify(config.confidenceThresholds)}`,
        `  useRegexPatterns: ${config.useRegexPatterns}`,
        `  useMLModel: ${config.useMLModel}`,
        `  aggressiveness: ${config.aggressiveness}`,
        `  sanitizeDocument: ${config.sanitizeDocument}`,
      );
    } else {
      lines.push('  (defaults)');
    }
    lines.push(`  predefinedWords: ${getPredefinedWords().length}`);
    const { packs, builtinDisabledRules } = getRulePackStore();
    lines.push(`  rulePacks: ${packs.length} installed, ${packs.filter(p => p.enabled).length} enabled, ${packs.filter(p => p.pack.validators).length} with code`);
    lines.push(`  builtinRulesDisabled: ${builtinDisabledRules.length}`);
    lines.push(`  language: ${localStorage.getItem(LANGUAGE_STORAGE_KEY) ?? 'default'}`);
  } catch (error) {
    lines.push(`  (could not read settings: ${error instanceof Error ? error.message : String(error)})`);
  }
  return lines;
}

function environmentSummary(): string[] {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return [
    `  app: SafeRedact ${packageJson.version} (${isDesktop ? 'desktop' : 'web'}, ${import.meta.env.MODE})`,
    `  userAgent: ${nav.userAgent}`,
    `  platform: ${nav.platform}`,
    `  languages: ${nav.languages?.join(', ')}`,
    `  cpuCores: ${nav.hardwareConcurrency ?? 'unknown'}`,
    `  deviceMemoryGB: ${nav.deviceMemory ?? 'unknown'}`,
    `  screen: ${screen.width}x${screen.height} @${window.devicePixelRatio}x`,
    `  viewport: ${window.innerWidth}x${window.innerHeight}`,
    // Multithreaded WebAssembly (OCR, NER) needs cross-origin isolation
    `  crossOriginIsolated: ${window.crossOriginIsolated}`,
    `  sharedArrayBuffer: ${typeof SharedArrayBuffer !== 'undefined'}`,
    `  webGPU: ${'gpu' in navigator}`,
    `  timeZoneOffsetMinutes: ${new Date().getTimezoneOffset()}`,
  ];
}

export async function buildDiagnosticReport(): Promise<string> {
  const sections = [
    'SafeRedact diagnostic report',
    `Generated: ${new Date().toISOString()}`,
    'This report contains no document content, file names, or predefined words.',
    '',
    'Environment:',
    ...environmentSummary(),
    '',
    'Settings:',
    ...settingsSummary(),
    '',
  ];

  if (isDesktop) {
    let fileLogs: string;
    try {
      fileLogs = await readDesktopLogs();
    } catch (error) {
      log.error('Failed to read log files', error);
      fileLogs = `(could not read log files: ${String(error)})\n` +
        getLogEntries().map(entry => formatLogEntry(entry)).join('\n');
    }
    sections.push('Log:', fileLogs);
  } else {
    if (previousSessionLog) {
      sections.push('Previous session log:', previousSessionLog, '');
    }
    sections.push('Current session log:', ...getLogEntries().map(entry => formatLogEntry(entry)));
  }
  return sections.join('\n') + '\n';
}

/** Saves the report as a .log file. Resolves false if the user cancels the Save dialog. */
export async function saveDiagnosticReport(): Promise<boolean> {
  log.info('Saving diagnostic report');
  const report = await buildDiagnosticReport();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return saveFile(new Blob([report], { type: 'text/plain' }), `saferedact-diagnostics-${stamp}.log`);
}
