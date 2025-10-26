import type { DetectedEntity } from '@/lib/types';
import { getEntityColor } from '@/utils/entity-types';

interface EntityHighlightProps {
  entity: DetectedEntity;
  scale: number;
  isSelected: boolean;
  onClick: () => void;
  pageHeight: number;
}

export function EntityHighlight({
  entity,
  scale,
  isSelected,
  onClick,
  pageHeight,
}: EntityHighlightProps) {
  const { boundingBox } = entity.position;
  const color = getEntityColor(entity.entityType);

  // Apply scale to coordinates and convert Y from bottom-left to top-left origin
  const left = boundingBox.x * scale;
  // Convert: CSS top = pageHeight - (PDF y + height)
  const top = (pageHeight - boundingBox.y - boundingBox.height) * scale;
  const width = boundingBox.width * scale;
  const height = boundingBox.height * scale;

  return (
    <div
      className="absolute pointer-events-auto cursor-pointer transition-all duration-200"
      style={{
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`,
        backgroundColor: `${color}30`, // 30 is hex for ~19% opacity
        border: `2px solid ${color}`,
        borderWidth: isSelected ? '3px' : '2px',
        boxShadow: isSelected ? `0 0 0 2px ${color}40` : 'none',
      }}
      onClick={onClick}
      title={`${entity.entityType}: ${entity.text} (${Math.round(entity.confidence * 100)}%)`}
    />
  );
}
