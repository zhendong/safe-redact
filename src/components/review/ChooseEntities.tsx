import { useMemo, useState } from 'react';
import type { DetectedEntity, EntityType } from '@/lib/types';
import { getEntityColor, getEntityDisplayName } from '@/utils/entity-types';
import { STRUCTURED_TYPES, VALUE_TYPES, allSelected, groupByValue, type ValueGroup } from '@/utils/entity-groups';
import { addPredefinedWord, deletePredefinedWord, getPredefinedWords } from '@/utils/predefined-words';
import { EntityType as EntityTypeEnum } from '@/lib/types';
import { useLanguage } from '@/contexts/LanguageContext';
import { createLogger } from '@/utils/logger';

const log = createLogger('ChooseEntities');

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink dark:focus-visible:outline-paper';

interface ChooseEntitiesProps {
  fileName: string;
  entities: DetectedEntity[];
  onSetStatus: (ids: string[], status: 'confirmed' | 'rejected') => void;
  onBack: () => void;
  onUndo: () => void;
  canUndo: boolean;
  onContinue: () => void;
}

/**
 * First review step: decide what to redact without the document. Structured
 * types are switched as a whole; names, places, and dates are chosen by value.
 */
export function ChooseEntities({ fileName, entities, onSetStatus, onBack, onUndo, canUndo, onContinue }: ChooseEntitiesProps) {
  const { language, t } = useLanguage();
  const [expandedTypes, setExpandedTypes] = useState<Set<EntityType>>(new Set());
  const [savedWords, setSavedWords] = useState(() => new Set(getPredefinedWords().map(w => w.word.toLowerCase())));
  const [wordMessage, setWordMessage] = useState<string | null>(null);

  const groups = useMemo(() => groupByValue(entities), [entities]);
  const groupsByType = useMemo(() => {
    const byType = new Map<EntityType, ValueGroup[]>();
    for (const group of groups) byType.set(group.type, [...(byType.get(group.type) ?? []), group]);
    return byType;
  }, [groups]);
  const entitiesOfType = (type: EntityType) => entities.filter(e => e.entityType === type);

  const structuredTypes = STRUCTURED_TYPES.filter(type => groupsByType.has(type));
  const valueTypes = VALUE_TYPES.filter(type => groupsByType.has(type));
  const selectedCount = entities.filter(e => e.status === 'confirmed').length;

  const setGroup = (ids: string[], selected: boolean) => onSetStatus(ids, selected ? 'confirmed' : 'rejected');

  const toggleExpanded = (type: EntityType) => {
    const next = new Set(expandedTypes);
    if (next.has(type)) next.delete(type);
    else next.add(type);
    setExpandedTypes(next);
  };

  // Saving a value as a predefined word also redacts it here
  const toggleSavedWord = (group: ValueGroup) => {
    const key = group.text.toLowerCase();
    try {
      if (savedWords.has(key)) {
        for (const word of getPredefinedWords().filter(w => w.word.toLowerCase() === key)) deletePredefinedWord(word.id);
        setWordMessage(t('choose.wordRemoved', { word: group.text }));
      } else {
        addPredefinedWord(group.text, false, true);
        setGroup(group.ids, true);
        setWordMessage(t('choose.wordSaved', { word: group.text }));
      }
      setSavedWords(new Set(getPredefinedWords().map(w => w.word.toLowerCase())));
    } catch (error) {
      log.error('Failed to update predefined word', error);
      setWordMessage(t('settings.failedToAddWord'));
    }
  };

  const renderChip = (group: ValueGroup) => {
    const { selected } = group;
    const isSaved = savedWords.has(group.text.toLowerCase());
    return (
      <span
        key={group.key}
        className={`inline-flex items-stretch max-w-full rounded-full border text-sm transition-colors ${
          !selected
            ? 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300'
            : 'border-ink dark:border-paper bg-ink dark:bg-paper text-paper dark:text-ink'
        }`}
      >
        <button
          type="button"
          aria-pressed={selected}
          title={group.contexts.join('\n…\n') || undefined}
          onClick={() => setGroup(group.ids, !selected)}
          className={`inline-flex items-center gap-1.5 min-h-[36px] min-w-0 pl-3 ${group.type === EntityTypeEnum.PREDEFINED ? 'pr-3' : 'pr-1.5'} rounded-full ${FOCUS}`}
        >
          <span className="truncate">{group.text}</span>
          {group.ids.length > 1 && <span className="opacity-70 flex-shrink-0">×{group.ids.length}</span>}
        </button>
        {/* Predefined words are already saved */}
        {group.type !== EntityTypeEnum.PREDEFINED && (
          <button
            type="button"
            aria-pressed={isSaved}
            aria-label={t(isSaved ? 'choose.forgetWord' : 'choose.rememberWord', { word: group.text })}
            title={t(isSaved ? 'choose.forgetWord' : 'choose.rememberWord', { word: group.text })}
            onClick={() => toggleSavedWord(group)}
            className={`px-2 rounded-full flex-shrink-0 ${isSaved ? 'text-[#c9a96e]' : 'opacity-60 hover:opacity-100'} ${FOCUS}`}
          >
            {isSaved ? '★' : '☆'}
          </button>
        )}
      </span>
    );
  };

  const typeLabel = (type: EntityType) => (
    <span className="inline-flex items-center gap-2">
      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: getEntityColor(type) }} aria-hidden="true" />
      {getEntityDisplayName(type, language)}
    </span>
  );

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 sm:gap-4 min-w-0">
          <button onClick={onBack} className="btn-ghost h-10 px-3 sm:px-4 text-sm flex-shrink-0 whitespace-nowrap">
            {t('review.backButton')}
          </button>
          <button
            onClick={onUndo}
            disabled={!canUndo}
            title={t('review.undoTitle')}
            className="btn-ghost h-10 px-3 sm:px-4 text-sm flex-shrink-0 whitespace-nowrap disabled:opacity-40"
          >
            {t('review.undo')}
          </button>
          <div className="min-w-0">
            <h2 className="font-serif text-xl sm:text-3xl font-normal tracking-tight text-gray-900 dark:text-white truncate">
              {t('choose.title')}
            </h2>
            <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-300 truncate">{fileName}</p>
          </div>
        </div>
        <button onClick={onContinue} className="btn-primary h-10 px-5 text-sm whitespace-nowrap">
          {t('choose.continue', { count: selectedCount })}
        </button>
      </div>

      {entities.length === 0 && (
        <p className="surface rounded-xl p-5 text-sm text-gray-600 dark:text-gray-300">{t('choose.nothingFound')}</p>
      )}

      {/* A: types decided as a whole */}
      {structuredTypes.length > 0 && (
        <section className="surface rounded-xl p-4 sm:p-5" aria-labelledby="choose-structured">
          <h3 id="choose-structured" className="text-sm font-medium text-gray-900 dark:text-white">{t('choose.structuredTitle')}</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 mb-3">{t('choose.structuredDesc')}</p>
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {structuredTypes.map(type => {
              const ofType = entitiesOfType(type);
              const selected = allSelected(ofType);
              const expanded = expandedTypes.has(type);
              const typeGroups = groupsByType.get(type) ?? [];
              return (
                <div key={type} className="py-2">
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer min-h-[36px]">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={e => setGroup(ofType.map(entity => entity.id), e.target.checked)}
                        className="w-4 h-4 rounded border-gray-300 dark:border-gray-600"
                      />
                      <span className="text-sm text-gray-800 dark:text-gray-200">{typeLabel(type)}</span>
                      <span className="text-xs text-gray-500 dark:text-gray-400">{ofType.length}</span>
                    </label>
                    <button
                      type="button"
                      aria-expanded={expanded}
                      onClick={() => toggleExpanded(type)}
                      className={`text-xs text-gray-600 dark:text-gray-300 hover:text-ink dark:hover:text-white px-2 py-1 rounded ${FOCUS}`}
                    >
                      {t(expanded ? 'choose.hideValues' : 'choose.showValues', { count: typeGroups.length })}
                    </button>
                  </div>
                  {expanded && <div className="flex flex-wrap gap-2 mt-2 ml-7">{typeGroups.map(renderChip)}</div>}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* B: names, places, and dates, chosen by value */}
      {valueTypes.map(type => {
        const typeGroups = groupsByType.get(type) ?? [];
        const ofType = entitiesOfType(type);
        return (
          <section key={type} className="surface rounded-xl p-4 sm:p-5" aria-labelledby={`choose-${type}`}>
            <div className="flex items-center justify-between gap-3 mb-3">
              <h3 id={`choose-${type}`} className="text-sm font-medium text-gray-900 dark:text-white">
                {typeLabel(type)} <span className="text-xs font-normal text-gray-500 dark:text-gray-400 ml-1">{typeGroups.length}</span>
              </h3>
              <div className="flex gap-1 text-xs">
                <button
                  type="button"
                  onClick={() => setGroup(ofType.map(e => e.id), true)}
                  className={`px-2 py-1 rounded text-gray-600 dark:text-gray-300 hover:text-ink dark:hover:text-white ${FOCUS}`}
                >
                  {t('choose.selectAll')}
                </button>
                <button
                  type="button"
                  onClick={() => setGroup(ofType.map(e => e.id), false)}
                  className={`px-2 py-1 rounded text-gray-600 dark:text-gray-300 hover:text-ink dark:hover:text-white ${FOCUS}`}
                >
                  {t('choose.clear')}
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">{typeGroups.map(renderChip)}</div>
          </section>
        );
      })}

      <p role="status" className="text-xs text-gray-500 dark:text-gray-400 min-h-[1rem]">{wordMessage}</p>
      <p className="text-sm text-gray-600 dark:text-gray-300">{t('choose.nextStep')}</p>
    </div>
  );
}
