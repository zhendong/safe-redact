/**
 * Settings Import/Export Utility
 * Handles backup and restore of user settings, predefined words, and custom patterns
 */

import { STORAGE_KEYS } from './constants';
import { getPredefinedWords, type PredefinedWord } from './predefined-words';
import type { DetectionConfig } from '@/lib/types';
import packageJson from '../../package.json';

interface ExportData {
  version: string;
  exportDate: string;
  settings?: DetectionConfig;
  predefinedWords?: PredefinedWord[];
  customPatterns?: any; // TODO: Type this if custom patterns are implemented
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
    console.error('Failed to export settings:', error);
  }

  // Export predefined words
  try {
    const words = getPredefinedWords();
    if (words.length > 0) {
      exportData.predefinedWords = words;
    }
  } catch (error) {
    console.error('Failed to export predefined words:', error);
  }

  // Export custom patterns
  try {
    const patternsStr = localStorage.getItem(STORAGE_KEYS.CUSTOM_PATTERNS);
    if (patternsStr) {
      exportData.customPatterns = JSON.parse(patternsStr);
    }
  } catch (error) {
    console.error('Failed to export custom patterns:', error);
  }

  return JSON.stringify(exportData, null, 2);
}

/**
 * Download settings as a JSON file
 */
export function downloadSettings(): void {
  const json = exportSettings();
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `safe-redact-settings-${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
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

    // Import custom patterns
    if (data.customPatterns) {
      try {
        localStorage.setItem(STORAGE_KEYS.CUSTOM_PATTERNS, JSON.stringify(data.customPatterns));
        imported.push('Custom patterns');
      } catch (error) {
        errors.push('Failed to import custom patterns');
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
