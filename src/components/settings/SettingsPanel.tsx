import { useState, useEffect, useRef } from 'react';
import type { DetectionConfig } from '@/lib/types';
import { EntityType } from '@/lib/types';
import { STORAGE_KEYS, DEFAULT_CONFIDENCE_THRESHOLDS } from '@/utils/constants';
import { LLMDetector } from '@/lib/detectors/LLMDetector';
import {
  getPredefinedWords,
  addPredefinedWord,
  deletePredefinedWord,
  type PredefinedWord,
} from '@/utils/predefined-words';
import {
  downloadSettings,
  importSettings,
  readSettingsFile,
} from '@/utils/settings-import-export';

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  config: DetectionConfig;
  onConfigChange: (config: DetectionConfig) => void;
}

export function SettingsPanel({
  isOpen,
  onClose,
  config,
  onConfigChange,
}: SettingsPanelProps) {
  const [localConfig, setLocalConfig] = useState<DetectionConfig>(config);
  const [modelDownloadProgress, setModelDownloadProgress] = useState<number>(0);
  const [modelDownloadMessage, setModelDownloadMessage] = useState<string>('');
  const [isDownloadingModel, setIsDownloadingModel] = useState(false);

  // Predefined words state
  const [predefinedWords, setPredefinedWords] = useState<PredefinedWord[]>([]);
  const [newWord, setNewWord] = useState('');
  const [newWordCaseSensitive, setNewWordCaseSensitive] = useState(false);
  const [newWordWholeWord, setNewWordWholeWord] = useState(true);
  const [wordError, setWordError] = useState<string | null>(null);

  // Import/Export state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importMessage, setImportMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Update local config when prop changes
  useEffect(() => {
    // Ensure all boolean fields have default values to avoid controlled/uncontrolled warnings
    setLocalConfig({
      ...config,
      sanitizeDocument: config.sanitizeDocument ?? false,
    });
  }, [config]);

  // Load predefined words when panel opens
  useEffect(() => {
    if (isOpen) {
      setPredefinedWords(getPredefinedWords());
    }
  }, [isOpen]);

  const handleSave = () => {
    onConfigChange(localConfig);
    onClose();
  };

  const handleReset = () => {
    const defaultConfig: DetectionConfig = {
      enabledEntityTypes: Object.values(EntityType),
      confidenceThresholds: DEFAULT_CONFIDENCE_THRESHOLDS,
      useMLModel: false,
      useRegexPatterns: true,
      useCustomPatterns: false,
      aggressiveness: 'balanced',
      sanitizeDocument: false,
    };
    setLocalConfig(defaultConfig);
  };

  const toggleEntityType = (type: EntityType) => {
    const newTypes = localConfig.enabledEntityTypes.includes(type)
      ? localConfig.enabledEntityTypes.filter(t => t !== type)
      : [...localConfig.enabledEntityTypes, type];

    setLocalConfig({ ...localConfig, enabledEntityTypes: newTypes });
  };

  const handleMLModelToggle = async (enabled: boolean) => {
    setLocalConfig({ ...localConfig, useMLModel: enabled });

    // If enabling ML model, preload it in the background
    if (enabled && !LLMDetector.isModelLoaded()) {
      setIsDownloadingModel(true);
      setModelDownloadProgress(0);
      setModelDownloadMessage('Starting download...');

      try {
        await LLMDetector.preloadModel('Xenova/bert-base-NER', (progress, message) => {
          setModelDownloadProgress(progress);
          setModelDownloadMessage(message);
        });
      } catch (error) {
        console.error('Failed to preload model:', error);
        setModelDownloadMessage('Download failed. Will retry when processing.');
      } finally {
        setIsDownloadingModel(false);
      }
    }
  };

  const handleAddWord = () => {
    setWordError(null);

    if (!newWord.trim()) {
      setWordError('Please enter a word');
      return;
    }

    try {
      addPredefinedWord(newWord.trim(), newWordCaseSensitive, newWordWholeWord);
      setPredefinedWords(getPredefinedWords());
      setNewWord('');
      setNewWordCaseSensitive(false);
      setNewWordWholeWord(true);
    } catch (error) {
      setWordError(error instanceof Error ? error.message : 'Failed to add word');
    }
  };

  const handleDeleteWord = (id: string) => {
    try {
      deletePredefinedWord(id);
      setPredefinedWords(getPredefinedWords());
    } catch (error) {
      console.error('Failed to delete word:', error);
    }
  };

  const handleExportSettings = () => {
    try {
      downloadSettings();
      setImportMessage({ type: 'success', text: 'Settings exported successfully!' });
      setTimeout(() => setImportMessage(null), 3000);
    } catch (error) {
      setImportMessage({ type: 'error', text: 'Failed to export settings' });
      setTimeout(() => setImportMessage(null), 3000);
    }
  };

  const handleImportSettings = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const jsonStr = await readSettingsFile(file);
      const result = importSettings(jsonStr);

      if (result.success) {
        setImportMessage({
          type: 'success',
          text: `Successfully imported: ${result.imported.join(', ')}`,
        });
        // Reload settings and predefined words
        const settingsStr = localStorage.getItem(STORAGE_KEYS.SETTINGS);
        if (settingsStr) {
          const newConfig = JSON.parse(settingsStr);
          setLocalConfig(newConfig);
        }
        setPredefinedWords(getPredefinedWords());
      } else {
        setImportMessage({
          type: 'error',
          text: `Import failed: ${result.errors.join(', ')}`,
        });
      }
    } catch (error) {
      setImportMessage({
        type: 'error',
        text: 'Failed to read settings file',
      });
    }

    // Clear the file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }

    // Clear message after 5 seconds
    setTimeout(() => setImportMessage(null), 5000);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Settings</h2>
          <button
            onClick={onClose}
            className="text-gray-400 dark:text-gray-500 hover:text-gray-500 dark:hover:text-gray-300 transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-4 space-y-6">
          {/* Entity Type Toggles */}
          <div>
            <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-3">Entity Types</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Select which types of entities to detect
            </p>
            <div className="grid grid-cols-2 gap-3">
              {Object.values(EntityType).map((type) => (
                <label
                  key={type}
                  className="flex items-center gap-2 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-600 cursor-pointer transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={localConfig.enabledEntityTypes.includes(type)}
                    onChange={() => toggleEntityType(type)}
                    className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{type}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Predefined Words */}
          <div>
            <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-3">Predefined Words</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Add words or phrases to automatically detect and redact across all documents
            </p>

            {/* Add New Word Form */}
            <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4 mb-4">
              <div className="space-y-3">
                <div>
                  <input
                    type="text"
                    value={newWord}
                    onChange={(e) => setNewWord(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleAddWord()}
                    placeholder="Enter word or phrase..."
                    className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  {wordError && (
                    <p className="text-xs text-red-600 dark:text-red-400 mt-1">{wordError}</p>
                  )}
                </div>

                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newWordCaseSensitive}
                      onChange={(e) => setNewWordCaseSensitive(e.target.checked)}
                      className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                    />
                    Case sensitive
                  </label>

                  <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newWordWholeWord}
                      onChange={(e) => setNewWordWholeWord(e.target.checked)}
                      className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                    />
                    Whole word only
                  </label>
                </div>

                <button
                  onClick={handleAddWord}
                  className="w-full px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors text-sm"
                >
                  Add Word
                </button>
              </div>
            </div>

            {/* Words List */}
            {predefinedWords.length > 0 ? (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {predefinedWords.map((word) => (
                  <div
                    key={word.id}
                    className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg group"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900 dark:text-white truncate">
                        {word.word}
                      </div>
                      <div className="flex gap-2 mt-1">
                        {word.caseSensitive && (
                          <span className="text-xs px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded">
                            Case sensitive
                          </span>
                        )}
                        {word.wholeWord && (
                          <span className="text-xs px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded">
                            Whole word
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => handleDeleteWord(word.id)}
                      className="ml-3 p-2 text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                      aria-label="Delete word"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-sm text-gray-500 dark:text-gray-400">
                No predefined words yet. Add words above to get started.
              </div>
            )}
          </div>

          {/* Confidence Thresholds */}
          <div>
            <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-3">Confidence Thresholds</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Adjust the confidence levels for entity detection
            </p>
            <div className="space-y-4">
              <div>
                <label className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-700 dark:text-gray-300">High Confidence</span>
                  <span className="text-sm font-medium text-gray-900 dark:text-white">
                    {Math.round(localConfig.confidenceThresholds.high * 100)}%
                  </span>
                </label>
                <input
                  type="range"
                  min="0.8"
                  max="1.0"
                  step="0.05"
                  value={localConfig.confidenceThresholds.high}
                  onChange={(e) =>
                    setLocalConfig({
                      ...localConfig,
                      confidenceThresholds: {
                        ...localConfig.confidenceThresholds,
                        high: parseFloat(e.target.value),
                      },
                    })
                  }
                  className="w-full"
                />
              </div>

              <div>
                <label className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-700 dark:text-gray-300">Medium Confidence</span>
                  <span className="text-sm font-medium text-gray-900 dark:text-white">
                    {Math.round(localConfig.confidenceThresholds.medium * 100)}%
                  </span>
                </label>
                <input
                  type="range"
                  min="0.6"
                  max="0.9"
                  step="0.05"
                  value={localConfig.confidenceThresholds.medium}
                  onChange={(e) =>
                    setLocalConfig({
                      ...localConfig,
                      confidenceThresholds: {
                        ...localConfig.confidenceThresholds,
                        medium: parseFloat(e.target.value),
                      },
                    })
                  }
                  className="w-full"
                />
              </div>

              <div>
                <label className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-700 dark:text-gray-300">Low Confidence</span>
                  <span className="text-sm font-medium text-gray-900 dark:text-white">
                    {Math.round(localConfig.confidenceThresholds.low * 100)}%
                  </span>
                </label>
                <input
                  type="range"
                  min="0.4"
                  max="0.7"
                  step="0.05"
                  value={localConfig.confidenceThresholds.low}
                  onChange={(e) =>
                    setLocalConfig({
                      ...localConfig,
                      confidenceThresholds: {
                        ...localConfig.confidenceThresholds,
                        low: parseFloat(e.target.value),
                      },
                    })
                  }
                  className="w-full"
                />
              </div>
            </div>
          </div>

          {/* Detection Options */}
          <div>
            <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-3">Detection Options</h3>
            <div className="space-y-3">
              <label className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <div>
                  <div className="text-sm font-medium text-gray-700 dark:text-gray-300">Regex Patterns</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Use pattern matching for structured data</div>
                </div>
                <input
                  type="checkbox"
                  checked={localConfig.useRegexPatterns}
                  onChange={(e) =>
                    setLocalConfig({ ...localConfig, useRegexPatterns: e.target.checked })
                  }
                  className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                />
              </label>

              <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-3">
                <label className="flex items-center justify-between cursor-pointer">
                  <div className="flex-1 mr-3">
                    <div className="text-sm font-medium text-gray-700 dark:text-gray-300">Local LLM (Transformers.js)</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      Use AI for advanced entity detection (runs in browser)
                    </div>
                    {!LLMDetector.isModelLoaded() && !isDownloadingModel && (
                      <div className="text-xs text-amber-600 mt-1">
                        Note: First use will download ~110MB model
                      </div>
                    )}
                    {LLMDetector.isModelLoaded() && (
                      <div className="text-xs text-green-600 mt-1">
                        ✓ Model ready
                      </div>
                    )}
                  </div>
                  <input
                    type="checkbox"
                    checked={localConfig.useMLModel}
                    onChange={(e) => handleMLModelToggle(e.target.checked)}
                    disabled={isDownloadingModel}
                    className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500 flex-shrink-0 disabled:opacity-50"
                  />
                </label>

                {isDownloadingModel && (
                  <div className="mt-3 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-600 dark:text-gray-400">{modelDownloadMessage}</span>
                      <span className="font-medium text-blue-600">{modelDownloadProgress}%</span>
                    </div>
                    <div className="w-full bg-gray-200 dark:bg-gray-600 rounded-full h-2">
                      <div
                        className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${modelDownloadProgress}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Aggressiveness */}
          <div>
            <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-3">Detection Aggressiveness</h3>
            <div className="space-y-2">
              {(['conservative', 'balanced', 'aggressive'] as const).map((level) => (
                <label
                  key={level}
                  className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-600 cursor-pointer transition-colors"
                >
                  <input
                    type="radio"
                    name="aggressiveness"
                    checked={localConfig.aggressiveness === level}
                    onChange={() => setLocalConfig({ ...localConfig, aggressiveness: level })}
                    className="border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                  />
                  <div>
                    <div className="text-sm font-medium text-gray-700 dark:text-gray-300 capitalize">{level}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {level === 'conservative' && 'Only high-confidence detections'}
                      {level === 'balanced' && 'Include medium confidence (recommended)'}
                      {level === 'aggressive' && 'Include low confidence, more false positives'}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Document Sanitization */}
          <div>
            <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-3">Document Sanitization</h3>
            <label className="flex items-start gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg cursor-pointer">
              <input
                type="checkbox"
                checked={localConfig.sanitizeDocument}
                onChange={(e) =>
                  setLocalConfig({ ...localConfig, sanitizeDocument: e.target.checked })
                }
                className="mt-0.5 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
              />
              <div>
                <div className="text-sm font-medium text-gray-700 dark:text-gray-300">Strip Metadata & Hidden Content</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Remove all metadata (author, dates, etc.), comments, track changes, and hidden content from the redacted document
                </div>
              </div>
            </label>
          </div>

          {/* Privacy Settings */}
          <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
            <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-3">Privacy & Data Management</h3>

            {/* Import/Export Section */}
            <div className="space-y-3 mb-4">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Backup and restore your settings, predefined words, and custom patterns
              </p>

              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={handleExportSettings}
                  className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Export Settings
                </button>

                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="px-4 py-2 text-sm text-white bg-green-600 hover:bg-green-700 rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  Import Settings
                </button>
              </div>

              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleImportSettings}
                className="hidden"
              />

              {/* Import/Export message */}
              {importMessage && (
                <div
                  className={`p-3 rounded-lg text-sm ${
                    importMessage.type === 'success'
                      ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-200'
                      : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200'
                  }`}
                >
                  {importMessage.text}
                </div>
              )}
            </div>

            {/* Clear All Settings */}
            <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={() => {
                  localStorage.removeItem(STORAGE_KEYS.SETTINGS);
                  handleReset();
                }}
                className="w-full px-4 py-2 text-sm text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
              >
                Clear All Settings
              </button>
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                This will remove all saved preferences and reset to defaults
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 dark:border-gray-700 px-6 py-4 flex items-center justify-between">
          <button
            onClick={handleReset}
            className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors"
          >
            Reset to Defaults
          </button>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
