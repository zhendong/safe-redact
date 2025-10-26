import { useState } from 'react';
import type { EntityType, DetectionConfig } from '@/lib/types';
import { FilterPanel } from './FilterPanel';

interface FilterBarProps {
  entities: any[];
  enabledTypes: Set<EntityType>;
  setEnabledTypes: (types: Set<EntityType>) => void;
  showHighConfidence: boolean;
  setShowHighConfidence: (show: boolean) => void;
  showMediumConfidence: boolean;
  setShowMediumConfidence: (show: boolean) => void;
  showLowConfidence: boolean;
  setShowLowConfidence: (show: boolean) => void;
  detectionConfig?: DetectionConfig;
  entityCounts: Record<EntityType, number>;
  confidenceCounts: { high: number; medium: number; low: number };
  filteredCount: number;
  confirmedCount: number;
  pendingCount: number;
}

export function FilterBar({
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
}: FilterBarProps) {
  const [isFilterExpanded, setIsFilterExpanded] = useState(false);

  const handleToggleType = (type: EntityType) => {
    const next = new Set(enabledTypes);
    if (next.has(type)) {
      next.delete(type);
    } else {
      next.add(type);
    }
    setEnabledTypes(next);
  };

  const handleToggleConfidence = (level: 'high' | 'medium' | 'low') => {
    if (level === 'high') setShowHighConfidence(!showHighConfidence);
    if (level === 'medium') setShowMediumConfidence(!showMediumConfidence);
    if (level === 'low') setShowLowConfidence(!showLowConfidence);
  };

  return (
    <div>
      {/* Mobile: Compact summary with toggle */}
      <div className="lg:hidden">
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="flex items-center gap-3 text-xs">
            <div className="flex items-center gap-1">
              <span className="text-gray-600 dark:text-gray-400">Total:</span>
              <span className="font-semibold text-gray-900 dark:text-gray-100">{filteredCount}</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-green-600 dark:text-green-400">Selected:</span>
              <span className="font-semibold text-green-700 dark:text-green-300">{confirmedCount + pendingCount}</span>
            </div>
          </div>
          <button
            onClick={() => setIsFilterExpanded(!isFilterExpanded)}
            className="px-3 py-1.5 text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors flex items-center gap-1.5"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
            Filters
            <svg className={`w-3 h-3 transition-transform ${isFilterExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>

        {/* Expandable filter panel on mobile */}
        {isFilterExpanded && (
          <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
            <FilterPanel
              enabledTypes={enabledTypes}
              onToggleType={handleToggleType}
              entityCounts={entityCounts}
              showHighConfidence={showHighConfidence}
              showMediumConfidence={showMediumConfidence}
              showLowConfidence={showLowConfidence}
              onToggleConfidence={handleToggleConfidence}
              confidenceCounts={confidenceCounts}
            />
          </div>
        )}
      </div>

      {/* Desktop: Full view always visible */}
      <div className="hidden lg:flex items-center justify-between gap-4">
        <FilterPanel
          enabledTypes={enabledTypes}
          onToggleType={handleToggleType}
          entityCounts={entityCounts}
          showHighConfidence={showHighConfidence}
          showMediumConfidence={showMediumConfidence}
          showLowConfidence={showLowConfidence}
          onToggleConfidence={handleToggleConfidence}
          confidenceCounts={confidenceCounts}
        />
        <div className="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-400 flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-700 dark:text-gray-300">Total:</span>
            <span className="font-semibold text-gray-900 dark:text-gray-100">{filteredCount}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-medium text-green-700 dark:text-green-400">Selected:</span>
            <span className="font-semibold text-green-900 dark:text-green-300">{confirmedCount + pendingCount}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
