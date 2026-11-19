/**
 * Settings Import/Export Utility
 * Handles backup and restore of user settings, predefined words, and rule packs
 */

import { STORAGE_KEYS } from './constants';
import { getPredefinedWords, type PredefinedWord } from './predefined-words';
import type { DetectionConfig } from '@/lib/types';
import type { RulePackStore } from '@/lib/rules/types';
import { getRulePackStore, saveRulePackStore } from '@/lib/rules/store';
import { parseRulePack } from '@/lib/rules/parse';
import { saveFile } from '@/platform';
import packageJson from '../../package.json';
import { createLogger } from './logger';

const log = createLogger('Settings');

interface ExportData {
  version: string;
  exportDate: string;
  settings?: DetectionConfig;
  predefinedWords?: PredefinedWord[];
  rulePacks?: RulePackStore;
}

const EXPORT_VERSION = packageJson.version;

/**
 * Export all user settings to a JSON file
 */
export function exportSettings(): string {
  const exportData: ExportData = {
    version: EXPORT_VERSION,
    exportDate: new Date().toISOString(),
  };

  // Export detection config
  try {
    const settingsStr = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    if (settingsStr) {
      exportData.settings = JSON.parse(settingsStr);
    }
  } catch (error) {
    log.error('Failed to export settings', error);
  }

  // Export predefined words
  try {
    const words = getPredefinedWords();
    if (words.length > 0) {
      exportData.predefinedWords = words;
    }
  } catch (error) {
    log.error('Failed to export predefined words', error);
  }

  // Export rule packs and which rules are switched off
  try {
    const rulePacks = getRulePackStore();
    if (rulePacks.packs.length > 0 || rulePacks.builtinDisabledRules.length > 0) {
      exportData.rulePacks = rulePacks;
    }
  } catch (error) {
    log.error('Failed to export rule packs', error);
  }

  return JSON.stringify(exportData, null, 2);
}

/**
 * Download settings as a JSON file
 */
export function downloadSettings(): Promise<boolean> {
  const json = exportSettings();
  const blob = new Blob([json], { type: 'application/json' });
  return saveFile(blob, `safe-redact-settings-${new Date().toISOString().split('T')[0]}.json`);
}

/**
 * Import settings from a JSON string
 * Returns an object indicating what was imported and any errors
 */
export function importSettings(jsonStr: string): {
  success: boolean;
  imported: string[];
  errors: string[];
} {
  const imported: string[] = [];
  const errors: string[] = [];

  try {
    const data: ExportData = JSON.parse(jsonStr);

    // Validate version (for now, just check if it exists)
    if (!data.version) {
      errors.push('Invalid settings file: missing version');
      return { success: false, imported, errors };
    }

    // Import detection config
    if (data.settings) {
      try {
        localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(data.settings));
        imported.push('Detection settings');
      } catch (error) {
        errors.push('Failed to import detection settings');
      }
    }

    // Import predefined words
    if (data.predefinedWords && Array.isArray(data.predefinedWords)) {
      try {
        // Store directly to localStorage to avoid duplicate checking in addPredefinedWord
        const PREDEFINED_WORDS_KEY = 'saferedact:predefined-words';
        localStorage.setItem(PREDEFINED_WORDS_KEY, JSON.stringify(data.predefinedWords));
        imported.push(`${data.predefinedWords.length} predefined word(s)`);
      } catch (error) {
        errors.push('Failed to import predefined words');
      }
    }

    // Import rule packs, checking each one as if it were installed
    if (data.rulePacks && Array.isArray(data.rulePacks.packs)) {
      try {
        const packs = data.rulePacks.packs.filter(installed => {
          try {
            parseRulePack(installed.pack);
            return true;
          } catch (error) {
            errors.push(`Skipped invalid rule pack "${installed.pack?.name ?? installed.pack?.id}"`);
            log.warn('Skipped invalid rule pack on import', { error: String(error) });
            return false;
          }
        });
        saveRulePackStore({
          packs,
          builtinDisabledRules: Array.isArray(data.rulePacks.builtinDisabledRules) ? data.rulePacks.builtinDisabledRules : [],
        });
        imported.push(`${packs.length} rule pack(s)`);
      } catch (error) {
        errors.push('Failed to import rule packs');
      }
    }

    if (imported.length === 0 && errors.length === 0) {
      errors.push('No data found in settings file');
    }

    return {
      success: imported.length > 0,
      imported,
      errors,
    };
  } catch (error) {
    errors.push('Invalid JSON format');
    return { success: false, imported, errors };
  }
}

/**
 * Read settings from an uploaded file
 */
export async function readSettingsFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result;
      if (typeof result === 'string') {
        resolve(result);
      } else {
        reject(new Error('Failed to read file'));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}
