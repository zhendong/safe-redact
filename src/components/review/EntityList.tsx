import { useState } from 'react';
import type { DetectedEntity, DetectionConfig, EntityType } from '@/lib/types';
import { EntityCard } from './EntityCard';
import { DEFAULT_CONFIDENCE_THRESHOLDS } from '@/utils/constants';
import { FilterPanel } from './FilterPanel';

interface EntityListProps {
  entities: DetectedEntity[];
  selectedEntityId?: string;
  onEntitySelect: (entity: DetectedEntity) => void;
  onEntityConfirm: (entityId: string | string[]) => void;
  onEntityReject: (entityId: string | string[]) => void;
  detectionConfig?: DetectionConfig;
  // Filter props
  enabledTypes?: Set<EntityType>;
  setEnabledTypes?: (types: Set<EntityType>) => void;
  showHighConfidence?: boolean;
  setShowHighConfidence?: (show: boolean) => void;
  showMediumConfidence?: boolean;
  setShowMediumConfidence?: (show: boolean) => void;
  showLowConfidence?: boolean;
  setShowLowConfidence?: (show: boolean) => void;
  entityCounts?: Record<EntityType, number>;
  confidenceCounts?: { high: number; medium: number; low: number };
  filteredCount?: number;
  confirmedCount?: number;
  pendingCount?: number;
  compactCards?: boolean;
}

export function EntityList({
  entities,
  selectedEntityId,
  onEntitySelect,
  onEntityConfirm,
  onEntityReject,
  detectionConfig,
  enabledTypes,
  setEnabledTypes,
  showHighConfidence,
  setShowHighConfidence,
  showMediumConfidence,
  setShowMediumConfidence,
  showLowConfidence,
  setShowLowConfidence,
  entityCounts,
  confidenceCounts,
  filteredCount,
  confirmedCount,
  pendingCount,
  compactCards = false,
}: EntityListProps) {
  const [isFilterExpanded, setIsFilterExpanded] = useState(false);
  // Helper function to find entities with the same text and type
  const getSimilarEntities = (entity: DetectedEntity) => {
    return entities.filter(
      (e) =>
        e.text === entity.text &&
        e.entityType === entity.entityType &&
        e.status === 'pending'
    );
  };

  const handleConfirmAll = (entity: DetectedEntity) => {
    const similarEntities = getSimilarEntities(entity);
    const idsToConfirm = similarEntities.map((e) => e.id);
    if (idsToConfirm.length > 0) {
      onEntityConfirm(idsToConfirm);
    }
  };

  const handleToggleType = (type: EntityType) => {
    if (!setEnabledTypes || !enabledTypes) return;
    const next = new Set(enabledTypes);
    if (next.has(type)) {
      next.delete(type);
    } else {
      next.add(type);
    }
    setEnabledTypes(next);
  };

  const handleToggleConfidence = (level: 'high' | 'medium' | 'low') => {
    if (level === 'high' && setShowHighConfidence) setShowHighConfidence(!showHighConfidence);
    if (level === 'medium' && setShowMediumConfidence) setShowMediumConfidence(!showMediumConfidence);
    if (level === 'low' && setShowLowConfidence) setShowLowConfidence(!showLowConfidence);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header with integrated filters on mobile */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 p-2.5 sm:p-3 lg:p-4 flex-shrink-0">
        {/* Mobile: Compact header with stats and filter toggle */}
        <div className="lg:hidden">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">
              Entities ({entities.length})
            </h2>
            {enabledTypes && setEnabledTypes && (
              <button
                onClick={() => setIsFilterExpanded(!isFilterExpanded)}
                className="px-2.5 py-1.5 text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors flex items-center gap-1.5"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                </svg>
                Filters
                <svg className={`w-3 h-3 transition-transform ${isFilterExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            )}
          </div>

          {/* Stats row on mobile */}
          {filteredCount !== undefined && (
            <div className="flex items-center gap-3 text-xs mb-2">
              <div className="flex items-center gap-1">
                <span className="text-gray-600 dark:text-gray-400">Total:</span>
                <span className="font-semibold text-gray-900 dark:text-gray-100">{filteredCount}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-green-600 dark:text-green-400">Selected:</span>
                <span className="font-semibold text-green-700 dark:text-green-300">{confirmedCount ?? 0}</span>
              </div>
            </div>
          )}

          {/* Expandable filter panel */}
          {isFilterExpanded && enabledTypes && entityCounts && confidenceCounts && (
            <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
              <FilterPanel
                enabledTypes={enabledTypes}
                onToggleType={handleToggleType}
                entityCounts={entityCounts}
                showHighConfidence={showHighConfidence || false}
                showMediumConfidence={showMediumConfidence || false}
                showLowConfidence={showLowConfidence || false}
                onToggleConfidence={handleToggleConfidence}
                confidenceCounts={confidenceCounts}
              />
            </div>
          )}
        </div>

        {/* Desktop: Header with inline bulk actions */}
        <div className="hidden lg:flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Entities ({entities.length})
          </h2>

          {/* Bulk Actions */}
          <div className="flex gap-1.5">
            {/* Select All High Confidence */}
            <button
              onClick={() => {
                const highThreshold = detectionConfig?.confidenceThresholds.high ?? DEFAULT_CONFIDENCE_THRESHOLDS.high;
                const idsToConfirm = entities
                  .filter((e) => e.status !== 'confirmed' && e.confidence >= highThreshold)
                  .map((e) => e.id);

                if (idsToConfirm.length > 0) {
                  onEntityConfirm(idsToConfirm);
                }
              }}
              className="px-2.5 py-1 text-xs bg-blue-600 dark:bg-blue-500 text-white hover:bg-blue-700 dark:hover:bg-blue-600 rounded transition-colors"
            >
              ✓ High Confidence
            </button>

            {/* Context-aware Select/Unselect All */}
            {(() => {
              const allSelected = entities.every((e) => e.status === 'confirmed');

              if (allSelected) {
                return (
                  <button
                    onClick={() => {
                      const idsToReject = entities.map((e) => e.id);
                      if (idsToReject.length > 0) {
                        onEntityReject(idsToReject);
                      }
                    }}
                    className="px-2.5 py-1 text-xs bg-gray-600 dark:bg-gray-500 text-white hover:bg-gray-700 dark:hover:bg-gray-600 rounded transition-colors"
                  >
                    ✗ Unselect All
                  </button>
                );
              } else {
                return (
                  <button
                    onClick={() => {
                      const idsToConfirm = entities
                        .filter((e) => e.status !== 'confirmed')
                        .map((e) => e.id);

                      if (idsToConfirm.length > 0) {
                        onEntityConfirm(idsToConfirm);
                      }
                    }}
                    className="px-2.5 py-1 text-xs bg-green-600 dark:bg-green-500 text-white hover:bg-green-700 dark:hover:bg-green-600 rounded transition-colors"
                  >
                    ✓ Select All
                  </button>
                );
              }
            })()}
          </div>
        </div>
      </div>

      {/* Mobile: Bulk Actions below header */}
      <div className="lg:hidden bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 p-2.5 sm:p-3 flex-shrink-0">
        <div className="flex gap-2">
          {/* Select All High Confidence */}
          <button
            onClick={() => {
              const highThreshold = detectionConfig?.confidenceThresholds.high ?? DEFAULT_CONFIDENCE_THRESHOLDS.high;
              const idsToConfirm = entities
                .filter((e) => e.status !== 'confirmed' && e.confidence >= highThreshold)
                .map((e) => e.id);

              if (idsToConfirm.length > 0) {
                onEntityConfirm(idsToConfirm);
              }
            }}
            className="flex-1 px-3 py-2 text-xs bg-blue-600 dark:bg-blue-500 text-white hover:bg-blue-700 dark:hover:bg-blue-600 rounded-lg transition-colors"
          >
            <span className="hidden sm:inline">✓ High Confidence</span>
            <span className="sm:hidden">✓ High</span>
          </button>

          {/* Context-aware Select/Unselect All */}
          {(() => {
            const allSelected = entities.every((e) => e.status !== 'rejected');

            if (allSelected) {
              return (
                <button
                  onClick={() => {
                    const idsToReject = entities.map((e) => e.id);
                    if (idsToReject.length > 0) {
                      onEntityReject(idsToReject);
                    }
                  }}
                  className="flex-1 px-3 py-2 text-xs bg-gray-600 dark:bg-gray-500 text-white hover:bg-gray-700 dark:hover:bg-gray-600 rounded-lg transition-colors"
                >
                  <span className="hidden sm:inline">✗ Unselect All</span>
                  <span className="sm:hidden">✗ All</span>
                </button>
              );
            } else {
              return (
                <button
                  onClick={() => {
                    const idsToConfirm = entities
                      .filter((e) => e.status === 'rejected')
                      .map((e) => e.id);

                    if (idsToConfirm.length > 0) {
                      onEntityConfirm(idsToConfirm);
                    }
                  }}
                  className="flex-1 px-3 py-2 text-xs bg-green-600 dark:bg-green-500 text-white hover:bg-green-700 dark:hover:bg-green-600 rounded-lg transition-colors"
                >
                  <span className="hidden sm:inline">✓ Select All</span>
                  <span className="sm:hidden">✓ All</span>
                </button>
              );
            }
          })()}
        </div>
      </div>

      {/* Entity List */}
      <div className="flex-1 overflow-y-auto p-3 sm:p-4 min-h-0 bg-gray-50 dark:bg-gray-900">
        {entities.length === 0 ? (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">
            <p>No entities match the current filters</p>
          </div>
        ) : (
          <div className="space-y-2">
            {entities.map((entity) => {
              const similarEntities = getSimilarEntities(entity);
              return (
                <EntityCard
                  key={entity.id}
                  entity={entity}
                  isSelected={entity.id === selectedEntityId}
                  onClick={() => onEntitySelect(entity)}
                  onConfirm={() => onEntityConfirm(entity.id)}
                  onReject={() => onEntityReject(entity.id)}
                  onConfirmAll={() => handleConfirmAll(entity)}
                  similarCount={similarEntities.length}
                  compact={compactCards}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
