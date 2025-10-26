import type { DetectedEntity, DetectionConfig, EntityType } from '@/lib/types';
import { EntityList } from './EntityList';
import { BottomSheet } from './BottomSheet';

interface MobileEntitySheetProps {
  isOpen: boolean;
  onClose: () => void;
  entities: DetectedEntity[];
  selectedEntityId?: string;
  onEntitySelect: (entity: DetectedEntity) => void;
  onEntityConfirm: (entityId: string | string[]) => void;
  onEntityReject: (entityId: string | string[]) => void;
  detectionConfig?: DetectionConfig;
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
}

export function MobileEntitySheet({
  isOpen,
  onClose,
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
}: MobileEntitySheetProps) {
  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title="Entities">
      <div className="h-full">
        <EntityList
          entities={entities}
          selectedEntityId={selectedEntityId}
          onEntitySelect={(entity) => {
            onEntitySelect(entity);
            // Don't close the sheet when selecting an entity
          }}
          onEntityConfirm={onEntityConfirm}
          onEntityReject={onEntityReject}
          detectionConfig={detectionConfig}
          enabledTypes={enabledTypes}
          setEnabledTypes={setEnabledTypes}
          showHighConfidence={showHighConfidence}
          setShowHighConfidence={setShowHighConfidence}
          showMediumConfidence={showMediumConfidence}
          setShowMediumConfidence={setShowMediumConfidence}
          showLowConfidence={showLowConfidence}
          setShowLowConfidence={setShowLowConfidence}
          entityCounts={entityCounts}
          confidenceCounts={confidenceCounts}
          filteredCount={filteredCount}
          confirmedCount={confirmedCount}
          pendingCount={pendingCount}
          compactCards={true}
        />
      </div>
    </BottomSheet>
  );
}
