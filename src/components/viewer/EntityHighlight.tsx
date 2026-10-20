import type { DetectedEntity } from '@/lib/types';
import { getEntityColor, getEntityDisplayName } from '@/utils/entity-types';
import { useLanguage } from '@/contexts/LanguageContext';

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
  const { language, t } = useLanguage();
  const { boundingBox } = entity.position;
  const color = getEntityColor(entity.entityType);
  const displayName = getEntityDisplayName(entity.entityType, language);

  // Apply scale to coordinates and convert Y from bottom-left to top-left origin
  const left = boundingBox.x * scale;
  // Convert: CSS top = pageHeight - (PDF y + height)
  const top = (pageHeight - boundingBox.y - boundingBox.height) * scale;
  const width = boundingBox.width * scale;
  const height = boundingBox.height * scale;
  // Unchecked detections get a dashed outline so they stay visible but read as "not redacted"
  const isChecked = entity.status === 'confirmed';

  const label = `${displayName}: ${entity.text} (${Math.round(entity.confidence * 100)}%)${isChecked ? '' : ` · ${t('entityCard.checkToRedact')}`}`;

  return (
    <button
      type="button"
      className="group absolute p-0 pointer-events-auto cursor-pointer transition-all duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink dark:focus-visible:outline-paper"
      style={{
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`,
        backgroundColor: isChecked ? `${color}30` : 'transparent', // 30 is hex for ~19% opacity
        border: `2px ${isChecked ? 'solid' : 'dashed'} ${color}`,
        borderWidth: isSelected ? '3px' : '2px',
        boxShadow: isSelected ? `0 0 0 2px ${color}40` : 'none',
      }}
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={isSelected}
    >
      {/* Names the type in text, so colour isn't the only way to tell types apart */}
      <span
        aria-hidden="true"
        className={`${isSelected ? 'block' : 'hidden group-hover:block group-focus-visible:block'} absolute bottom-full left-0 mb-0.5 px-1 rounded border bg-white text-[10px] leading-4 font-medium text-gray-900 whitespace-nowrap pointer-events-none z-10`}
        style={{ borderColor: color }}
      >
        {displayName}
      </span>
    </button>
  );
}
