import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { confirmAction, isDesktop, pickFile } from '@/platform';
import { getEntityDisplayName } from '@/utils/entity-types';
import { createLogger } from '@/utils/logger';
import { BUILTIN_PACK } from '@/lib/rules/builtin-pack';
import { parseRulePack, RulePackError, testRulePack } from '@/lib/rules/parse';
import { WorkerScriptHost } from '@/lib/rules/sandbox';
import {
  getRulePackStore,
  installRulePack,
  removeRulePack,
  setRuleEnabled,
  setRulePackEnabled,
} from '@/lib/rules/store';
import type { RulePack, RulePackStore } from '@/lib/rules/types';
import { EntityType } from '@/lib/types';

const log = createLogger('Settings');

interface Message {
  type: 'success' | 'error';
  text: string;
  details?: string[];
}

interface RulePacksSectionProps {
  /** Changes when settings are imported, so the list reloads */
  reloadKey: number;
}

export function RulePacksSection({ reloadKey }: RulePacksSectionProps) {
  const { language, t } = useLanguage();
  const [store, setStore] = useState<RulePackStore>(getRulePackStore);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [installing, setInstalling] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setStore(getRulePackStore());
  }, [reloadKey]);

  const handleInstallClick = async () => {
    if (!isDesktop) {
      fileInputRef.current?.click();
      return;
    }
    const file = await pickFile(t('settings.rulePackFileFilter'), ['json']);
    if (file) await installFile(file);
  };

  const installFile = async (file: File) => {
    setMessage(null);
    setInstalling(true);
    try {
      let text: string;
      try {
        text = await file.text();
      } catch (error) {
        log.error('Failed to read rule pack', error);
        setMessage({ type: 'error', text: t('settings.rulePackReadFailed') });
        return;
      }

      let pack: RulePack;
      try {
        pack = parseRulePack(text);
      } catch (error) {
        const details = error instanceof RulePackError ? error.problems : [String(error)];
        setMessage({ type: 'error', text: t('settings.rulePackInvalid'), details });
        return;
      }

      if (pack.validators && Object.keys(pack.validators).length > 0) {
        const confirmed = await confirmAction(t('settings.rulePackCodeConfirm', { name: pack.name }), {
          title: t('settings.rulePackCodeConfirmTitle'),
          okLabel: t('settings.rulePackCodeConfirmOk'),
          cancelLabel: t('settings.cancel'),
        });
        if (!confirmed) return;
      }

      // Run the pack's own examples so a broken pack is caught before it touches a document
      const host = new WorkerScriptHost();
      let failures: string[];
      try {
        failures = await testRulePack(pack, host);
      } catch (error) {
        failures = [error instanceof Error ? error.message : String(error)];
      } finally {
        host.dispose();
      }
      if (failures.length > 0) {
        setMessage({ type: 'error', text: t('settings.rulePackSelfTestFailed'), details: failures });
        return;
      }

      const updating = store.packs.some(installed => installed.pack.id === pack.id);
      setStore(installRulePack(pack));
      log.info('Rule pack installed', { rules: pack.rules.length, code: Boolean(pack.validators), updated: updating });
      setMessage({
        type: 'success',
        text: t(updating ? 'settings.rulePackUpdated' : 'settings.rulePackInstalled', { name: pack.name, count: pack.rules.length }),
      });
    } finally {
      setInstalling(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const packs = [
    { pack: BUILTIN_PACK, enabled: true, disabledRules: store.builtinDisabledRules, builtin: true },
    ...store.packs.map(installed => ({ ...installed, builtin: false })),
  ];

  return (
    <div>
      <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-3">{t('settings.rulePacks')}</h3>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">{t('settings.rulePacksDesc')}</p>

      <div className="space-y-2 mb-3">
        {packs.map(({ pack, enabled, disabledRules, builtin }) => {
          const isExpanded = expanded === pack.id;
          const enabledCount = pack.rules.filter(rule => !disabledRules.includes(rule.id)).length;
          return (
            <div key={pack.id} className="bg-gray-50 dark:bg-gray-700 rounded-lg p-3">
              <div className="flex items-center gap-3">
                {!builtin && (
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={e => setStore(setRulePackEnabled(pack.id, e.target.checked))}
                    aria-label={t('settings.useRulePack', { name: pack.name })}
                    className="rounded border-gray-300 dark:border-gray-600"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900 dark:text-white truncate">
                      {builtin ? t('settings.builtinRules') : pack.name}
                    </span>
                    {pack.version && <span className="text-xs text-gray-500 dark:text-gray-400">{pack.version}</span>}
                    {pack.validators && Object.keys(pack.validators).length > 0 && (
                      <span className="text-xs px-2 py-0.5 border border-amber-300 dark:border-amber-600 text-amber-700 dark:text-amber-400 rounded-full">
                        {t('settings.rulePackHasCode')}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {!builtin && pack.description ? `${pack.description} · ` : ''}
                    {t('settings.ruleCount', { enabled: enabledCount, total: pack.rules.length })}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setExpanded(isExpanded ? null : pack.id)}
                  aria-expanded={isExpanded}
                  className="text-xs text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
                >
                  {t(isExpanded ? 'settings.hideRules' : 'settings.showRules')}
                </button>
                {!builtin && (
                  <button
                    type="button"
                    onClick={() => setStore(removeRulePack(pack.id))}
                    className="p-1 text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                    aria-label={t('settings.removeRulePack', { name: pack.name })}
                    title={t('settings.removeRulePack', { name: pack.name })}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>

              {isExpanded && (
                <ul className="mt-3 space-y-1 max-h-60 overflow-y-auto">
                  {pack.rules.map(rule => (
                    <li key={rule.id}>
                      <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={!disabledRules.includes(rule.id)}
                          disabled={!enabled}
                          onChange={e => setStore(setRuleEnabled(pack.id, rule.id, e.target.checked))}
                          className="rounded border-gray-300 dark:border-gray-600"
                        />
                        <span className="flex-1 min-w-0 truncate">{rule.name}</span>
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {getEntityDisplayName(rule.entityType ?? EntityType.CUSTOM, language)}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
        {store.packs.length === 0 && (
          <p className="text-xs text-gray-500 dark:text-gray-400 px-1">{t('settings.noRulePacks')}</p>
        )}
      </div>

      <button
        onClick={() => void handleInstallClick()}
        disabled={installing}
        className="btn-ghost w-full px-4 py-2 text-sm gap-2"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
        </svg>
        {t('settings.installRulePack')}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={e => {
          const file = e.target.files?.[0];
          if (file) void installFile(file);
        }}
        className="hidden"
      />

      {message && (
        <div
          role="status"
          className={`mt-3 p-3 rounded-lg text-sm ${
            message.type === 'success'
              ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-300'
              : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-300'
          }`}
        >
          {message.text}
          {message.details && (
            <ul className="mt-1 list-disc list-inside text-xs space-y-0.5">
              {message.details.map(detail => <li key={detail}>{detail}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
