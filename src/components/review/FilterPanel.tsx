import { EntityType } from '@/lib/types';
import { getEntityDisplayName, getEntityColor } from '@/utils/entity-types';

interface FilterPanelProps {
  enabledTypes: Set<EntityType>;
  onToggleType: (type: EntityType) => void;
  entityCounts: Record<EntityType, number>;
  showHighConfidence: boolean;
  showMediumConfidence: boolean;
  showLowConfidence: boolean;
  onToggleConfidence: (level: 'high' | 'medium' | 'low') => void;
  confidenceCounts: { high: number; medium: number; low: number };
}

export function FilterPanel({
  enabledTypes,
  onToggleType,
  entityCounts,
  showHighConfidence,
  showMediumConfidence,
  showLowConfidence,
  onToggleConfidence,
  confidenceCounts,
}: FilterPanelProps) {
  const allEntityTypes = Object.values(EntityType);

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
      {/* Entity Types - Horizontal Pills */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Types:</span>
        <div className="flex flex-wrap gap-2">
          {allEntityTypes.map((type) => {
            const count = entityCounts[type] || 0;
            const color = getEntityColor(type);
            const isEnabled = enabledTypes.has(type);

            if (count === 0) return null; // Hide types with no entities

            return (
              <button
                key={type}
                onClick={() => onToggleType(type)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs sm:text-sm transition-all ${
                  isEnabled
                    ? 'bg-opacity-20 border-2'
                    : 'bg-gray-100 dark:bg-gray-700 opacity-50 border-2 border-transparent'
                }`}
                style={{
                  backgroundColor: isEnabled ? `${color}20` : undefined,
                  borderColor: isEnabled ? color : undefined,
                  color: isEnabled ? color : undefined,
                }}
              >
                <div
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: color }}
                />
                <span className="font-medium">
                  {getEntityDisplayName(type)}
                </span>
                <span className={`text-xs opacity-75 ${!isEnabled ? 'text-gray-500 dark:text-gray-400' : ''}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Divider */}
      <div className="hidden sm:block h-6 w-px bg-gray-300 dark:bg-gray-600" />

      {/* Confidence Levels - Horizontal Pills */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Confidence:</span>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => onToggleConfidence('high')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs sm:text-sm transition-all ${
              showHighConfidence
                ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-2 border-green-500 dark:border-green-400'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 border-2 border-transparent opacity-50'
            }`}
          >
            <span className="font-medium">High</span>
            <span className="text-xs opacity-75">{confidenceCounts.high}</span>
          </button>

          <button
            onClick={() => onToggleConfidence('medium')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs sm:text-sm transition-all ${
              showMediumConfidence
                ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 border-2 border-yellow-500 dark:border-yellow-400'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 border-2 border-transparent opacity-50'
            }`}
          >
            <span className="font-medium">Medium</span>
            <span className="text-xs opacity-75">{confidenceCounts.medium}</span>
          </button>

          <button
            onClick={() => onToggleConfidence('low')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs sm:text-sm transition-all ${
              showLowConfidence
                ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 border-2 border-orange-500 dark:border-orange-400'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 border-2 border-transparent opacity-50'
            }`}
          >
            <span className="font-medium">Low</span>
            <span className="text-xs opacity-75">{confidenceCounts.low}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
