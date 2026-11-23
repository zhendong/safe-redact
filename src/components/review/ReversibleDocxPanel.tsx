import { useEffect, useId, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { confirmAction, isDesktop, pickFile, saveFile } from '@/platform';
import { generateRedactedFilename } from '@/utils/file-utils';
import { validateFile } from '@/utils/validation';
import { restoreDocx, type ReplacementPlan, type RestoreResult } from '@/lib/redaction/reversible/docx';
import { deleteReplacementRecord, listReplacementRecords } from '@/lib/redaction/reversible/store';
import { ReversibleError, type ReplacementRecord, type ReversibleSelection } from '@/lib/redaction/reversible/types';
import type { Language } from '@/i18n/translations';

interface Props {
  file: File;
  savedRecord: ReplacementRecord | null;
  selection: ReversibleSelection;
  onChange: (selection: ReversibleSelection) => void;
  plan: ReplacementPlan | null;
  planError: string | null;
  onBusyChange: (busy: boolean) => void;
  detectedLanguage: Language;
}

const fieldClass = 'w-full min-w-0 min-h-12 sm:min-h-0 rounded-lg border border-gray-500 bg-white p-2 text-base sm:text-sm text-gray-900 dark:border-gray-500 dark:bg-gray-900 dark:text-gray-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink dark:focus-visible:outline-paper';

export function ReversibleDocxPanel({ file, savedRecord, selection, onChange, plan, planError, onBusyChange, detectedLanguage }: Props) {
  const { t, language } = useLanguage();
  const id = useId();
  const [records, setRecords] = useState<ReplacementRecord[]>([]);
  const [record, setRecord] = useState<ReplacementRecord | null>(savedRecord);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<RestoreResult | null>(null);

  useEffect(() => {
    let active = true;
    listReplacementRecords().then(result => { if (active) setRecords(result); })
      .catch(() => { if (active) setError('reversible.storage'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [savedRecord]);

  useEffect(() => { if (savedRecord) setRecord(savedRecord); }, [savedRecord]);
  useEffect(() => { setPreview(null); }, [record?.id, restoreFile]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    onBusyChange(true);
    setError(null);
    setStatus('');
    try { await action(); }
    catch (cause) {
      setError(cause instanceof ReversibleError ? cause.message : 'reversible.storage');
    }
    finally { setBusy(false); onBusyChange(false); }
  };

  const chooseRestoreFile = (next: File) => {
    if (!/\.docx$/i.test(next.name) || !validateFile(next).valid) {
      setPreview(null);
      setError('reversible.document');
      return;
    }
    setError(null);
    setStatus('');
    setRestoreFile(next);
  };

  const date = (timestamp: number) => new Date(timestamp).toLocaleString(language === 'zh' ? 'zh-CN' : 'en', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  // Keep the selected record visible while the list reloads after an export.
  const options = record && !records.some(item => item.id === record.id) ? [record, ...records] : records;

  return (
    <details className="surface rounded-xl">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-gray-900 dark:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink dark:focus-visible:outline-paper">
        {t('reversible.title')}
      </summary>
      <fieldset disabled={busy || loading} className="min-w-0 space-y-4 border-t border-gray-200 px-4 py-4 dark:border-gray-700">
        <legend className="sr-only">{t('reversible.title')}</legend>
        <p className="max-w-2xl text-xs text-gray-600 dark:text-gray-300">{t('reversible.privacy')}</p>

        <div className="max-w-md space-y-2">
          <label htmlFor={`${id}-language`} className="block text-sm text-gray-800 dark:text-gray-200">{t('reversible.labelLanguage')}</label>
          <select id={`${id}-language`} name="replacement-label-language" className={fieldClass} value={selection.labelLanguage ?? 'auto'}
            aria-describedby={`${id}-language-help`}
            onChange={event => onChange({ ...selection, labelLanguage: event.target.value as Language | 'auto' })}>
            <option value="auto">{t('reversible.autoLanguage', { language: detectedLanguage === 'zh' ? '中文' : 'English' })}</option>
            <option value="zh">中文</option>
            <option value="en">English</option>
          </select>
          <p id={`${id}-language-help`} className="text-xs text-gray-600 dark:text-gray-300">{t('reversible.languageHint')}</p>
        </div>

        <>
          {planError && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{t(planError)}</p>}
          {plan && <>
            <p className="text-sm text-gray-700 dark:text-gray-200">{t('reversible.planSummary', {
              count: plan.redactedCount, added: plan.mappings.length,
            })}</p>
            {plan.protectedCount > 0 && <p className="text-xs text-gray-600 dark:text-gray-300">{t('reversible.protected', { count: plan.protectedCount })}</p>}
          </>}
        </>
        {plan?.mappings.length ? (
          <details>
            <summary className="cursor-pointer text-sm text-gray-800 dark:text-gray-200">{t('reversible.viewMappings')}</summary>
            <div className="mt-2 max-h-60 overflow-auto rounded-lg border border-gray-200 dark:border-gray-700">
              <table className="w-full text-left text-sm text-gray-800 dark:text-gray-200">
                <caption className="sr-only">{t('reversible.viewMappings')}</caption>
                <thead><tr><th scope="col" className="p-2">{t('reversible.original')}</th><th scope="col" className="p-2">{t('reversible.replacement')}</th></tr></thead>
                <tbody>{plan.mappings.map(mapping => (
                  <tr key={mapping.replacement} className="border-t border-gray-200 dark:border-gray-700">
                    <td className="p-2 break-all whitespace-pre-wrap">{mapping.original}</td><td className="p-2 whitespace-nowrap">{mapping.replacement}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </details>
        ) : null}

        <div className="space-y-3 border-t border-gray-200 pt-4 dark:border-gray-700">
          <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">{t('reversible.restoreTitle')}</h3>
          <p className="max-w-3xl text-xs text-gray-600 dark:text-gray-300">{t('reversible.restoreHint')}</p>
          <div className="max-w-2xl min-w-0 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor={`${id}-record`} className="text-sm text-gray-800 dark:text-gray-200">{t('reversible.records')}</label>
              <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={() => void run(async () => {
                const latest = await listReplacementRecords();
                setRecords(latest);
                if (record) {
                  const refreshed = latest.find(item => item.id === record.id) ?? null;
                  setRecord(refreshed);
                }
              })}>{t('reversible.refresh')}</button>
            </div>
            <select id={`${id}-record`} name="replacement-record" className={fieldClass} value={record?.id ?? ''}
              onChange={event => {
                const selected = records.find(item => item.id === event.target.value) ?? null;
                setError(null);
                setStatus('');
                setRecord(selected);
              }}>
              <option value="">{t('reversible.selectRecord')}</option>
              {options.map(item => (
                <option key={item.id} value={item.id}>{item.name} — {date(item.createdAt)}</option>
              ))}
            </select>
            <div className="flex flex-wrap items-center justify-between gap-2">
              {(loading || record) && <p className="text-xs text-gray-600 dark:text-gray-300">{loading ? t('reversible.loading')
                : t('reversible.mappingCount', { count: record!.mappings.length })}</p>}
              {record && <button type="button" className="btn-ghost px-3 py-2 text-xs" onClick={() => void run(async () => {
                if (!(await confirmAction(t('reversible.deleteWarning'), {
                  title: t('reversible.deleteRecord'), okLabel: t('reversible.deleteRecord'), cancelLabel: t('common.cancel'),
                }))) return;
                await deleteReplacementRecord(record);
                setRecords(previous => previous.filter(item => item.id !== record.id));
                setRecord(null);
                setStatus('reversible.deleted');
              })}>{t('reversible.deleteRecord')}</button>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {isDesktop ? <button type="button" className="btn-ghost px-3 py-2 text-sm" onClick={() => void run(async () => {
              const next = await pickFile(t('reversible.chooseDocx'), ['docx']);
              if (next) chooseRestoreFile(next);
            })}>{t('reversible.chooseDocx')}</button> : <>
              <label htmlFor={`${id}-restore-file`} className="text-sm text-gray-800 dark:text-gray-200">{t('reversible.chooseDocx')}</label>
              <input id={`${id}-restore-file`} name="restore-docx" type="file" accept=".docx" className="max-w-full text-sm text-gray-800 dark:text-gray-200"
                onChange={event => { const next = event.target.files?.[0]; if (next) chooseRestoreFile(next); event.target.value = ''; }} />
            </>}
            <button type="button" className="btn-ghost px-3 py-2 text-sm" disabled={!record}
              onClick={() => void run(async () => {
                setPreview(null);
                setPreview(await restoreDocx(restoreFile ?? file, record!.mappings));
              })}>{t('reversible.previewRestore')}</button>
          </div>
          <p className="break-all text-xs text-gray-600 dark:text-gray-300">{t('reversible.restoreFile', { name: (restoreFile ?? file).name })}</p>
          {preview && <div className="space-y-3" role="status">
            <p className="text-sm text-gray-800 dark:text-gray-200">{t('reversible.restoreSummary', { count: preview.restoredCount, missing: preview.missing.length })}</p>
            {preview.missing.length > 0 && <details>
              <summary className="cursor-pointer text-sm text-gray-800 dark:text-gray-200">{t('reversible.missingLabels')}</summary>
              <p className="mt-2 break-words text-xs text-gray-600 dark:text-gray-300">{preview.missing.join(', ')}</p>
            </details>}
            {preview.matches.length > 0 && <ul className="max-h-48 overflow-auto space-y-1 text-sm text-gray-800 dark:text-gray-200">
              {preview.matches.map(match => <li key={match.replacement} className="break-all">{match.replacement} → {match.original} ({match.count})</li>)}
            </ul>}
            {preview.unknown.length > 0 && <p className="break-words text-sm text-amber-800 dark:text-amber-200">{t('reversible.unknown', { labels: preview.unknown.join(', ') })}</p>}
            <button type="button" className="btn-primary px-4 py-2 text-sm" disabled={preview.restoredCount === 0}
              onClick={() => void run(async () => {
                if (await saveFile(preview.blob, generateRedactedFilename((restoreFile ?? file).name, '-RESTORED'))) setStatus('reversible.restored');
              })}>{t('reversible.downloadRestored')}</button>
          </div>}
        </div>
      </fieldset>
      {error && <p role="alert" className="px-4 pb-4 text-sm text-red-700 dark:text-red-300">{t(error)}</p>}
      {status && <p role="status" className="px-4 pb-4 text-sm text-gray-700 dark:text-gray-200">{t(status)}</p>}
    </details>
  );
}
