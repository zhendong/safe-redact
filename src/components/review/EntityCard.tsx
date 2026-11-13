import { useState } from 'react';
import type { DetectedEntity, DetectionConfig } from '@/lib/types';
import { getEntityColor, getEntityDisplayName } from '@/utils/entity-types';
import { useLanguage } from '@/contexts/LanguageContext';
import { getConfidenceLevel } from '@/utils/confidence';

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink dark:focus-visible:outline-paper';

interface EntityCardProps {
  entity: DetectedEntity;
  isSelected: boolean;
  onClick: () => void;
  onConfirm: () => void;
  onReject: () => void;
  onConfirmAll?: () => void;
  similarCount?: number;
  compact?: boolean;
  confidenceThresholds?: DetectionConfig['confidenceThresholds'];
}

export function EntityCard({
  entity,
  isSelected,
  onClick,
  onConfirm,
  onReject,
  onConfirmAll,
  similarCount,
  compact = false,
  confidenceThresholds,
}: EntityCardProps) {
  const { language, t } = useLanguage();
  const [isExpanded, setIsExpanded] = useState(false);
  const color = getEntityColor(entity.entityType);
  const displayName = getEntityDisplayName(entity.entityType, language);
  const confidencePercent = Math.round(entity.confidence * 100);
  // Unchecked cards keep full contrast; the dashed border matches the dashed outline in the viewer
  const isChecked = entity.status === 'confirmed';
  const showConfirmAll = !!onConfirmAll && similarCount !== undefined && similarCount > 1 && entity.status === 'rejected';

  // Same levels as the confidence filters
  const getConfidenceColor = (confidence: number) => {
    const level = getConfidenceLevel(confidence, confidenceThresholds);
    if (level === 'high') return 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/30';
    if (level === 'medium') return 'text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/30';
    return 'text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/30';
  };

  const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.target.checked) {
      onConfirm();
    } else {
      onReject();
    }
  };

  const handleCardClick = () => {
    if (compact) {
      setIsExpanded(!isExpanded);
    }
    onClick();
  };

  if (compact) {
    // Compact mobile view
    return (
      <div
        className={`
          p-2 border rounded-lg cursor-pointer transition-all
          ${isSelected ? 'border-ink dark:border-gray-300 bg-gray-50 dark:bg-gray-700/40 ring-1 ring-ink dark:ring-gray-300' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 bg-white dark:bg-gray-800'}
          ${!isChecked ? 'border-dashed' : ''}
        `}
        onClick={handleCardClick}
      >
        <div className="flex items-center gap-2">
          {/* Checkbox */}
          <input
            type="checkbox"
            checked={isChecked}
            onChange={handleCheckboxChange}
            className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 cursor-pointer flex-shrink-0"
            title={isChecked ? t('entityCard.uncheckToSkip') : t('entityCard.checkToRedact')}
            aria-label={`${displayName}: ${entity.text}`}
            onClick={(e) => e.stopPropagation()}
          />

          {/* The rest of the row is a button so keyboard users can select and expand the item; clicks bubble to the card */}
          <button
            type="button"
            aria-expanded={entity.contextText ? isExpanded : undefined}
            aria-pressed={isSelected}
            className={`flex items-center gap-2 flex-1 min-w-0 text-left rounded ${FOCUS}`}
          >
            {/* Type indicator dot */}
            <span
              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: color }}
              aria-hidden="true"
            />

            {/* Entity value */}
            <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate flex-1 min-w-0">
              {entity.text}
            </span>

            {/* Compact badges; the type name means the colour isn't the only cue */}
            <span className="flex items-center gap-1.5 flex-shrink-0">
              {/* User rule packs name their rules; built-in rule names aren't translated, so they show the type */}
              <span
                className="text-xs text-gray-500 dark:text-gray-400 max-w-[6rem] truncate"
                title={entity.detectionMethod === 'custom' && entity.ruleName ? `${displayName} · ${entity.ruleName}` : undefined}
              >
                {entity.detectionMethod === 'custom' && entity.ruleName ? entity.ruleName : displayName}
              </span>
              <span
                className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${getConfidenceColor(entity.confidence)}`}
              >
                {confidencePercent}%
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {t('entityCard.pageShort', { page: entity.position.pageNumber })}
              </span>
            </span>

            {/* Expand indicator */}
            {entity.contextText && (
              <svg
                className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            )}
          </button>
        </div>

        {/* Expanded context and actions */}
        {isExpanded && (entity.contextText || showConfirmAll) && (
          <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700 space-y-2">
            {/* Context text */}
            {entity.contextText && (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {entity.contextText}
              </p>
            )}

            {/* Confirm All Button */}
            {showConfirmAll && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onConfirmAll();
                }}
                className="w-full px-3 py-1.5 text-xs border border-gray-300 dark:border-gray-600 text-ink dark:text-gray-100 hover:border-ink dark:hover:border-gray-300 rounded-full transition-colors"
              >
                {t('entityCard.checkAllSimilar', { count: similarCount })}
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  // Default desktop view
  return (
    <div
      className={`
        p-2.5 sm:p-3 border rounded-lg cursor-pointer transition-all
        ${isSelected ? 'border-ink dark:border-gray-300 bg-gray-50 dark:bg-gray-700/40 ring-1 ring-ink dark:ring-gray-300' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 bg-white dark:bg-gray-800'}
        ${!isChecked ? 'border-dashed' : ''}
      `}
      onClick={onClick}
    >
      <div className="flex items-start gap-3 mb-2">
        {/* Checkbox */}
        <input
          type="checkbox"
          checked={isChecked}
          onChange={handleCheckboxChange}
          className="w-5 h-5 mt-0.5 rounded border-gray-300 dark:border-gray-600 cursor-pointer flex-shrink-0"
          title={isChecked ? t('entityCard.uncheckToSkip') : t('entityCard.checkToRedact')}
          aria-label={`${displayName}: ${entity.text}`}
          onClick={(e) => e.stopPropagation()}
        />

        {/* Entity Info: a button so keyboard users can select the item; clicks bubble to the card */}
        <button
          type="button"
          aria-pressed={isSelected}
          className={`flex-1 min-w-0 text-left rounded ${FOCUS}`}
        >
          <span className="flex items-center gap-2 mb-1 flex-wrap">
            <span
              className="w-3 h-3 rounded-full flex-shrink-0"
              style={{ backgroundColor: color }}
              aria-hidden="true"
            />
            <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
              {displayName}
            </span>
            <span
              className={`text-xs px-2 py-0.5 rounded-full ${getConfidenceColor(entity.confidence)}`}
            >
              {confidencePercent}%
            </span>
            <span className="text-xs text-gray-500 dark:text-gray-400 ml-auto">
              {t('entityCard.page', { page: entity.position.pageNumber })}
            </span>
          </span>
          <span className="block text-sm font-medium text-gray-900 dark:text-gray-100 break-all">
            {entity.text}
          </span>
        </button>
      </div>

      {entity.contextText && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2 line-clamp-2 ml-8">
          {entity.contextText}
        </p>
      )}

      {/* Confirm All Button for similar entities */}
      {showConfirmAll && (
        <div className="ml-8">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onConfirmAll();
            }}
            className="px-3 py-1.5 text-xs border border-gray-300 dark:border-gray-600 text-ink dark:text-gray-100 hover:border-ink dark:hover:border-gray-300 rounded-full transition-colors"
          >
            {t('entityCard.checkAllSimilar', { count: similarCount })}
          </button>
        </div>
      )}
    </div>
  );
}
