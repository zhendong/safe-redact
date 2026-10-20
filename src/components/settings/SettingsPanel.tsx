import { useState, useEffect, useRef, useId } from 'react';
import type { DetectionConfig } from '@/lib/types';
import { EntityType } from '@/lib/types';
import { STORAGE_KEYS, DEFAULT_CONFIDENCE_THRESHOLDS } from '@/utils/constants';
import { LLMDetector } from '@/lib/detectors/LLMDetector';
import { getEntityDisplayName } from '@/utils/entity-types';
import { useLanguage } from '@/contexts/LanguageContext';
import { confirmAction, isDesktop, pickFile, revealDesktopLogs } from '@/platform';
import { saveDiagnosticReport } from '@/utils/diagnostics';
import { createLogger } from '@/utils/logger';
import { useDialog } from '@/hooks/useDialog';
import { RulePacksSection } from './RulePacksSection';
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

const log = createLogger('Settings');

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
  const { language, t } = useLanguage();
  const dialogRef = useDialog<HTMLDivElement>(isOpen, onClose);
  const titleId = useId();
  const [modelDownloadProgress, setModelDownloadProgress] = useState<number>(0);
  const [modelDownloadMessage, setModelDownloadMessage] = useState<string>('');
  const [isDownloadingModel, setIsDownloadingModel] = useState(false);

  // Predefined words state
  const [predefinedWords, setPredefinedWords] = useState<PredefinedWord[]>([]);
  const [newWord, setNewWord] = useState('');
  const [newWordCaseSensitive, setNewWordCaseSensitive] = useState(false);
  // Off by default so a word is caught inside longer words and in any case
  const [newWordWholeWord, setNewWordWholeWord] = useState(false);
  const [wordError, setWordError] = useState<string | null>(null);

  // Import/Export state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importMessage, setImportMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [rulePacksReloadKey, setRulePacksReloadKey] = useState(0);
  const [diagnosticsMessage, setDiagnosticsMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Load predefined words when panel opens
  useEffect(() => {
    if (isOpen) {
      setPredefinedWords(getPredefinedWords());
    }
  }, [isOpen]);

  const defaultConfig = (): DetectionConfig => ({
    enabledEntityTypes: Object.values(EntityType),
    knownEntityTypes: Object.values(EntityType),
    confidenceThresholds: DEFAULT_CONFIDENCE_THRESHOLDS,
    useMLModel: false,
    useRegexPatterns: true,
    aggressiveness: 'balanced',
    sanitizeDocument: false,
  });

  // Settings apply as soon as they change, so there is no Cancel to fall back on; ask first
  const handleReset = async () => {
    if (
      !(await confirmAction(t('settings.resetConfirm'), {
        title: t('settings.resetConfirmTitle'),
        okLabel: t('settings.resetConfirmOk'),
        cancelLabel: t('settings.cancel'),
      }))
    ) {
      return;
    }
    onConfigChange(defaultConfig());
  };

  const toggleEntityType = (type: EntityType) => {
    const newTypes = config.enabledEntityTypes.includes(type)
      ? config.enabledEntityTypes.filter(t => t !== type)
      : [...config.enabledEntityTypes, type];

    onConfigChange({ ...config, enabledEntityTypes: newTypes });
  };

  const handleMLModelToggle = async (enabled: boolean) => {
    onConfigChange({ ...config, useMLModel: enabled });

    // If enabling ML model, preload it in the background
    if (enabled && !LLMDetector.isModelLoaded()) {
      setIsDownloadingModel(true);
      setModelDownloadProgress(0);
      setModelDownloadMessage(t(isDesktop ? 'settings.loadingModel' : 'settings.startingDownload'));

      try {
        await LLMDetector.preloadModel((progress, message) => {
          setModelDownloadProgress(progress);
          setModelDownloadMessage(message);
        });
      } catch (error) {
        log.error('Failed to preload model', error);
        setModelDownloadMessage(t(isDesktop ? 'settings.loadFailed' : 'settings.downloadFailed'));
      } finally {
        setIsDownloadingModel(false);
      }
    }
  };

  const handleAddWord = () => {
    setWordError(null);

    if (!newWord.trim()) {
      setWordError(t('settings.pleaseEnterWord'));
      return;
    }

    try {
      addPredefinedWord(newWord.trim(), newWordCaseSensitive, newWordWholeWord);
      setPredefinedWords(getPredefinedWords());
      setNewWord('');
      setNewWordCaseSensitive(false);
      setNewWordWholeWord(false);
    } catch (error) {
      setWordError(error instanceof Error ? error.message : t('settings.failedToAddWord'));
    }
  };

  const handleDeleteWord = (id: string) => {
    try {
      deletePredefinedWord(id);
      setPredefinedWords(getPredefinedWords());
    } catch (error) {
      log.error('Failed to delete predefined word', error);
    }
  };

  const handleExportSettings = async () => {
    try {
      if (!(await downloadSettings())) return;
      setImportMessage({ type: 'success', text: t('settings.exportSuccess') });
      setTimeout(() => setImportMessage(null), 3000);
    } catch (error) {
      log.error('Failed to export settings', error);
      setImportMessage({ type: 'error', text: t('settings.exportFailed') });
      setTimeout(() => setImportMessage(null), 3000);
    }
  };

  const handleSaveDiagnosticLog = async () => {
    try {
      if (!(await saveDiagnosticReport())) return;
      setDiagnosticsMessage({ type: 'success', text: t('settings.diagnosticLogSaved') });
    } catch (error) {
      log.error('Failed to save diagnostic log', error);
      setDiagnosticsMessage({ type: 'error', text: t('settings.diagnosticLogFailed') });
    }
    setTimeout(() => setDiagnosticsMessage(null), 3000);
  };

  const handleImportSettings = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) await importSettingsFile(file);
  };

  const handleImportClick = async () => {
    if (!isDesktop) {
      fileInputRef.current?.click();
      return;
    }
    const file = await pickFile(t('settings.settingsFileFilter'), ['json']);
    if (file) await importSettingsFile(file);
  };

  const importSettingsFile = async (file: File) => {
    try {
      const jsonStr = await readSettingsFile(file);
      const result = importSettings(jsonStr);

      if (result.success) {
        setImportMessage({
          type: 'success',
          text: t('settings.importSuccess', { items: result.imported.join(', ') }),
        });
        // Reload settings and predefined words
        const settingsStr = localStorage.getItem(STORAGE_KEYS.SETTINGS);
        if (settingsStr) {
          onConfigChange(JSON.parse(settingsStr));
        }
        setPredefinedWords(getPredefinedWords());
        setRulePacksReloadKey(key => key + 1);
      } else {
        log.warn('Settings import rejected', { errors: result.errors.length });
        setImportMessage({
          type: 'error',
          text: t('settings.importFailed', { errors: result.errors.join(', ') }),
        });
      }
    } catch (error) {
      log.error('Failed to read settings file', error);
      setImportMessage({
        type: 'error',
        text: t('settings.importReadFailed'),
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
    <div className="fixed inset-0 bg-ink/40 backdrop-blur-sm flex items-center justify-center z-50">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="surface rounded-2xl shadow-[0_24px_60px_-28px_rgba(28,27,25,0.35)] max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto focus:outline-none"
      >
        {/* Header */}
        <div className="border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex items-center justify-between">
          <h2 id={titleId} className="font-serif text-3xl font-normal tracking-tight text-gray-900 dark:text-white">{t('settings.title')}</h2>
          <button
            onClick={onClose}
            aria-label={t('common.close')}
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
            <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-3">{t('settings.entityTypes')}</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
              {t('settings.entityTypesDesc')}
            </p>
            <div className="flex flex-wrap gap-2">
              {Object.values(EntityType).map((type) => (
                <label
                  key={type}
                  className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 dark:bg-gray-700 rounded-full hover:bg-gray-100 dark:hover:bg-gray-600 cursor-pointer transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={config.enabledEntityTypes.includes(type)}
                    onChange={() => toggleEntityType(type)}
                    className="rounded border-gray-300 dark:border-gray-600"
                  />
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{getEntityDisplayName(type, language)}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Predefined Words */}
          <div>
            <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-3">{t('settings.predefinedWords')}</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
              {t('settings.predefinedWordsDesc')}
            </p>

            {/* Add New Word Form */}
            <div className="flex gap-2">
              <input
                type="text"
                value={newWord}
                onChange={(e) => setNewWord(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddWord()}
                placeholder={t('settings.enterWordPlaceholder')}
                className="flex-1 min-w-0 px-3 py-1.5 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:border-ink dark:focus:border-gray-300"
              />
              <button
                onClick={handleAddWord}
                className="btn-primary px-4 py-1.5 text-sm"
              >
                {t('settings.addWord')}
              </button>
            </div>
            {wordError && (
              <p className="text-xs text-red-600 dark:text-red-400 mt-1">{wordError}</p>
            )}
            <div className="flex items-center gap-4 mt-2">
              <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newWordCaseSensitive}
                  onChange={(e) => setNewWordCaseSensitive(e.target.checked)}
                  className="rounded border-gray-300 dark:border-gray-600"
                />
                {t('settings.caseSensitive')}
              </label>

              <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newWordWholeWord}
                  onChange={(e) => setNewWordWholeWord(e.target.checked)}
                  className="rounded border-gray-300 dark:border-gray-600"
                />
                {t('settings.wholeWordOnly')}
              </label>
            </div>

            {/* Words List */}
            {predefinedWords.length > 0 ? (
              <div className="flex flex-wrap gap-2 mt-3 max-h-40 overflow-y-auto">
                {predefinedWords.map((word) => {
                  const options = [
                    word.caseSensitive && t('settings.caseSensitive'),
                    word.wholeWord && t('settings.wholeWordOnly'),
                  ].filter(Boolean).join(' · ');
                  return (
                    <span
                      key={word.id}
                      title={options || undefined}
                      className="flex items-center gap-1 max-w-full pl-3 pr-1 py-1 bg-gray-50 dark:bg-gray-700 rounded-full text-sm text-gray-900 dark:text-white"
                    >
                      <span className="truncate">{word.word}</span>
                      {options && (
                        <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">{options}</span>
                      )}
                      <button
                        onClick={() => handleDeleteWord(word.id)}
                        className="p-1 text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                        aria-label={t('settings.deleteWord', { word: word.word })}
                        title={t('settings.deleteWord', { word: word.word })}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </span>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">
                {t('settings.noWordsYet')}
              </p>
            )}
          </div>

          {/* Detection Options */}
          <div>
            <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-3">{t('settings.detectionOptions')}</h3>
            <div className="space-y-3">
              <label className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <div>
                  <div className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('settings.regexPatterns')}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">{t('settings.regexPatternsDesc')}</div>
                </div>
                <input
                  type="checkbox"
                  checked={config.useRegexPatterns}
                  onChange={(e) =>
                    onConfigChange({ ...config, useRegexPatterns: e.target.checked })
                  }
                  className="rounded border-gray-300 dark:border-gray-600"
                />
              </label>

              <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-3">
                <label className="flex items-center justify-between cursor-pointer">
                  <div className="flex-1 mr-3">
                    <div className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('settings.localLLM')}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {t(isDesktop ? 'settings.localLLMDescDesktop' : 'settings.localLLMDesc')}
                    </div>
                    {/* The desktop app bundles the model, so there is nothing to download */}
                    {!isDesktop && !LLMDetector.isModelLoaded() && !isDownloadingModel && (
                      <div className="text-xs text-amber-600 mt-1">
                        {t('settings.modelDownloadNote')}
                      </div>
                    )}
                    {LLMDetector.isModelLoaded() && (
                      <div className="text-xs text-green-600 mt-1">
                        {t('settings.modelReady')}
                      </div>
                    )}
                  </div>
                  <input
                    type="checkbox"
                    checked={config.useMLModel}
                    onChange={(e) => handleMLModelToggle(e.target.checked)}
                    disabled={isDownloadingModel}
                    className="rounded border-gray-300 dark:border-gray-600 flex-shrink-0 disabled:opacity-50"
                  />
                </label>

                {isDownloadingModel && (
                  <div className="mt-3 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-600 dark:text-gray-400">{modelDownloadMessage}</span>
                      <span className="font-medium text-ink dark:text-gray-100">{modelDownloadProgress}%</span>
                    </div>
                    <div className="w-full bg-gray-200 dark:bg-gray-600 rounded-full h-2">
                      <div
                        className="bg-ink dark:bg-paper h-2 rounded-full transition-all duration-300"
                        style={{ width: `${modelDownloadProgress}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Document Sanitization */}
          <div>
            <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-3">{t('settings.documentSanitization')}</h3>
            <label className="flex items-start gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg cursor-pointer">
              <input
                type="checkbox"
                checked={config.sanitizeDocument ?? false}
                onChange={(e) =>
                  onConfigChange({ ...config, sanitizeDocument: e.target.checked })
                }
                className="mt-0.5 rounded border-gray-300 dark:border-gray-600"
              />
              <div>
                <div className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('settings.stripMetadata')}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {t('settings.stripMetadataDesc')}
                </div>
              </div>
            </label>
          </div>

          {/* Advanced: rule packs and confidence tuning most people never need */}
          <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
            <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-3">{t('settings.advanced')}</h3>
            <label className="flex items-start gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg cursor-pointer">
              <input
                type="checkbox"
                checked={!!config.showAdvancedOptions}
                onChange={(e) =>
                  onConfigChange({ ...config, showAdvancedOptions: e.target.checked })
                }
                className="mt-0.5 rounded border-gray-300 dark:border-gray-600"
              />
              <div>
                <div className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('settings.showAdvancedOptions')}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {t('settings.showAdvancedOptionsDesc')}
                </div>
              </div>
            </label>
            {config.showAdvancedOptions && (
              <div className="mt-6 space-y-6">
                <RulePacksSection reloadKey={rulePacksReloadKey} />

                {/* Aggressiveness */}
                <div>
                  <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-3">{t('settings.detectionAggressiveness')}</h3>
                  <div className="space-y-2">
                    {(['conservative', 'balanced', 'aggressive'] as const).map((level) => (
                      <label
                        key={level}
                        className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-600 cursor-pointer transition-colors"
                      >
                        <input
                          type="radio"
                          name="aggressiveness"
                          checked={config.aggressiveness === level}
                          onChange={() => onConfigChange({ ...config, aggressiveness: level })}
                          className="border-gray-300 dark:border-gray-600"
                        />
                        <div>
                          <div className="text-sm font-medium text-gray-700 dark:text-gray-300 capitalize">{t(`settings.${level}`)}</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            {level === 'conservative' && t('settings.conservativeDesc')}
                            {level === 'balanced' && t('settings.balancedDesc')}
                            {level === 'aggressive' && t('settings.aggressiveDesc')}
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Confidence Thresholds */}
                <div>
                  <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-3">{t('settings.confidenceThresholds')}</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                    {t('settings.confidenceThresholdsDesc')}
                  </p>
                  <div className="space-y-4">
                    <div>
                      <label className="flex items-center justify-between mb-2">
                        <span className="text-sm text-gray-700 dark:text-gray-300">{t('settings.highConfidence')}</span>
                        <span className="text-sm font-medium text-gray-900 dark:text-white">
                          {Math.round(config.confidenceThresholds.high * 100)}%
                        </span>
                      </label>
                      <input
                        type="range"
                        min={Math.max(0.8, config.confidenceThresholds.medium)}
                        max="1.0"
                        step="0.05"
                        value={config.confidenceThresholds.high}
                        onChange={(e) =>
                          onConfigChange({
                            ...config,
                            confidenceThresholds: {
                              ...config.confidenceThresholds,
                              high: parseFloat(e.target.value),
                            },
                          })
                        }
                        className="w-full"
                      />
                    </div>

                    <div>
                      <label className="flex items-center justify-between mb-2">
                        <span className="text-sm text-gray-700 dark:text-gray-300">{t('settings.mediumConfidence')}</span>
                        <span className="text-sm font-medium text-gray-900 dark:text-white">
                          {Math.round(config.confidenceThresholds.medium * 100)}%
                        </span>
                      </label>
                      <input
                        type="range"
                        min={Math.max(0.6, config.confidenceThresholds.low)}
                        max={Math.min(0.9, config.confidenceThresholds.high)}
                        step="0.05"
                        value={config.confidenceThresholds.medium}
                        onChange={(e) =>
                          onConfigChange({
                            ...config,
                            confidenceThresholds: {
                              ...config.confidenceThresholds,
                              medium: parseFloat(e.target.value),
                            },
                          })
                        }
                        className="w-full"
                      />
                    </div>

                    <div>
                      <label className="flex items-center justify-between mb-2">
                        <span className="text-sm text-gray-700 dark:text-gray-300">{t('settings.lowConfidence')}</span>
                        <span className="text-sm font-medium text-gray-900 dark:text-white">
                          {Math.round(config.confidenceThresholds.low * 100)}%
                        </span>
                      </label>
                      <input
                        type="range"
                        min="0.4"
                        max={Math.min(0.7, config.confidenceThresholds.medium)}
                        step="0.05"
                        value={config.confidenceThresholds.low}
                        onChange={(e) =>
                          onConfigChange({
                            ...config,
                            confidenceThresholds: {
                              ...config.confidenceThresholds,
                              low: parseFloat(e.target.value),
                            },
                          })
                        }
                        className="w-full"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Privacy Settings */}
          <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
            <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-3">{t('settings.privacyDataManagement')}</h3>

            {/* Import/Export Section */}
            <div className="space-y-3 mb-4">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {t('settings.backupRestoreDesc')}
              </p>

              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={handleExportSettings}
                  className="btn-primary px-4 py-2 text-sm gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  {t('settings.exportSettings')}
                </button>

                <button
                  onClick={() => void handleImportClick()}
                  className="btn-ghost px-4 py-2 text-sm gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  {t('settings.importSettings')}
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

            {/* Diagnostics */}
            <div className="pt-4 mb-4 border-t border-gray-200 dark:border-gray-700 space-y-3">
              <h3 className="text-sm font-medium text-gray-900 dark:text-white">{t('settings.diagnostics')}</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">{t('settings.diagnosticsDesc')}</p>
              <div className={`grid gap-3 ${isDesktop ? 'grid-cols-2' : 'grid-cols-1'}`}>
                <button
                  onClick={() => void handleSaveDiagnosticLog()}
                  className="btn-ghost px-4 py-2 text-sm"
                >
                  {t('settings.saveDiagnosticLog')}
                </button>
                {isDesktop && (
                  <button
                    onClick={() => void revealDesktopLogs().catch(error => log.error('Failed to show log files', error))}
                    className="btn-ghost px-4 py-2 text-sm"
                  >
                    {t('settings.showLogFiles')}
                  </button>
                )}
              </div>
              {diagnosticsMessage && (
                <div
                  className={`p-3 rounded-lg text-sm ${
                    diagnosticsMessage.type === 'success'
                      ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-200'
                      : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200'
                  }`}
                >
                  {diagnosticsMessage.text}
                </div>
              )}
            </div>

          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 dark:border-gray-700 px-6 py-4 flex items-center justify-between">
          <button
            onClick={() => void handleReset()}
            className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors"
          >
            {t('settings.resetToDefaults')}
          </button>
          <button
            onClick={onClose}
            className="btn-primary px-4 py-2 text-sm"
          >
            {t('settings.done')}
          </button>
        </div>
      </div>
    </div>
  );
}
