import { useState } from 'react';
import type { DetectedEntity } from '@/lib/types';
import { getEntityColor, getEntityDisplayName } from '@/utils/entity-types';

interface EntityCardProps {
  entity: DetectedEntity;
  isSelected: boolean;
  onClick: () => void;
  onConfirm: () => void;
  onReject: () => void;
  onConfirmAll?: () => void;
  similarCount?: number;
  compact?: boolean;
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
}: EntityCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const color = getEntityColor(entity.entityType);
  const displayName = getEntityDisplayName(entity.entityType);
  const confidencePercent = Math.round(entity.confidence * 100);
  const isChecked = entity.status === 'confirmed';

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.9) return 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/30';
    if (confidence >= 0.7) return 'text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/30';
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
          ${isSelected ? 'border-blue-500 dark:border-blue-400 bg-blue-50 dark:bg-blue-900/20' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 bg-white dark:bg-gray-800'}
          ${!isChecked ? 'opacity-60' : ''}
        `}
        onClick={handleCardClick}
      >
        <div className="flex items-center gap-2">
          {/* Checkbox */}
          <input
            type="checkbox"
            checked={isChecked}
            onChange={handleCheckboxChange}
            className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-green-600 focus:ring-green-500 focus:ring-1 cursor-pointer flex-shrink-0"
            title={isChecked ? "Uncheck to skip redaction" : "Check to redact"}
            onClick={(e) => e.stopPropagation()}
          />

          {/* Type indicator dot */}
          <div
            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
            style={{ backgroundColor: color }}
          />

          {/* Entity value */}
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate flex-1 min-w-0">
            {entity.text}
          </p>

          {/* Compact badges */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span
              className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${getConfidenceColor(entity.confidence)}`}
            >
              {confidencePercent}%
            </span>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              P{entity.position.pageNumber}
            </span>
          </div>

          {/* Expand indicator */}
          {entity.contextText && (
            <svg
              className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          )}
        </div>

        {/* Expanded context and actions */}
        {isExpanded && (
          <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700 space-y-2">
            {/* Type name */}
            <div className="text-xs font-medium text-gray-600 dark:text-gray-400">
              {displayName}
            </div>

            {/* Context text */}
            {entity.contextText && (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {entity.contextText}
              </p>
            )}

            {/* Confirm All Button */}
            {onConfirmAll && similarCount !== undefined && similarCount > 1 && entity.status === 'rejected' && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onConfirmAll();
                }}
                className="w-full px-3 py-1.5 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-900/50 rounded transition-colors"
              >
                ✓ Check All Similar ({similarCount})
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
        ${isSelected ? 'border-blue-500 dark:border-blue-400 bg-blue-50 dark:bg-blue-900/20' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 bg-white dark:bg-gray-800'}
        ${!isChecked ? 'opacity-60' : ''}
      `}
      onClick={onClick}
    >
      <div className="flex items-start gap-3 mb-2">
        {/* Checkbox */}
        <input
          type="checkbox"
          checked={isChecked}
          onChange={handleCheckboxChange}
          className="w-5 h-5 mt-0.5 rounded border-gray-300 dark:border-gray-600 text-green-600 focus:ring-green-500 focus:ring-2 cursor-pointer flex-shrink-0"
          title={isChecked ? "Uncheck to skip redaction" : "Check to redact"}
          onClick={(e) => e.stopPropagation()}
        />

        {/* Entity Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <div
              className="w-3 h-3 rounded-full flex-shrink-0"
              style={{ backgroundColor: color }}
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
              Page {entity.position.pageNumber}
            </span>
          </div>
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100 break-all">
            {entity.text}
          </p>
        </div>
      </div>

      {entity.contextText && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2 line-clamp-2 ml-8">
          {entity.contextText}
        </p>
      )}

      {/* Confirm All Button for similar entities */}
      {onConfirmAll && similarCount !== undefined && similarCount > 1 && entity.status === 'rejected' && (
        <div className="ml-8">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onConfirmAll();
            }}
            className="px-3 py-1.5 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-900/50 rounded transition-colors"
          >
            ✓ Check All Similar ({similarCount})
          </button>
        </div>
      )}
    </div>
  );
}
