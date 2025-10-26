import { useEffect, useRef, useState } from 'react';
import type { DetectedEntity } from '@/lib/types';
import { getEntityColor } from '@/utils/entity-types';

interface DocxViewerProps {
  htmlContent: string;
  entities: DetectedEntity[];
  selectedEntityId?: string;
  onEntityClick?: (entity: DetectedEntity) => void;
}

/**
 * DOCX Viewer component
 * Displays HTML preview from mammoth.js with entity highlights
 */
export function DocxViewer({
  htmlContent,
  entities,
  selectedEntityId,
  onEntityClick,
}: DocxViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [highlightedHtml, setHighlightedHtml] = useState('');

  useEffect(() => {
    // Inject entity highlights into HTML
    const highlighted = highlightEntities(htmlContent, entities, selectedEntityId);
    setHighlightedHtml(highlighted);
  }, [htmlContent, entities, selectedEntityId]);

  // Handle clicks on highlighted entities
  useEffect(() => {
    if (!containerRef.current || !onEntityClick) return;

    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const entitySpan = target.closest('[data-entity-id]');

      if (entitySpan) {
        const entityId = entitySpan.getAttribute('data-entity-id');
        const entity = entities.find(e => e.id === entityId);
        if (entity) {
          onEntityClick(entity);
        }
      }
    };

    containerRef.current.addEventListener('click', handleClick);
    return () => {
      containerRef.current?.removeEventListener('click', handleClick);
    };
  }, [entities, onEntityClick]);

  return (
    <div className="h-full flex flex-col bg-white dark:bg-gray-800">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
        <div className="text-sm text-gray-600 dark:text-gray-300">
          Document Preview
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400">
          Click on highlighted text to review
        </div>
      </div>

      {/* Document Content */}
      <div className="flex-1 overflow-auto p-8 bg-gray-100 dark:bg-gray-900">
        <div
          ref={containerRef}
          className="max-w-4xl mx-auto bg-white dark:bg-gray-800 shadow-lg p-12 docx-content dark:text-gray-200"
          dangerouslySetInnerHTML={{ __html: highlightedHtml }}
        />
      </div>
    </div>
  );
}

/**
 * Highlight entities in HTML content
 */
function highlightEntities(
  html: string,
  entities: DetectedEntity[],
  selectedEntityId?: string
): string {
  let result = html;

  // Sort entities by position (longest first to avoid nested replacements)
  // Filter out rejected entities - they should not show highlights
  const sortedEntities = [...entities]
    .filter((entity) => entity.status !== 'rejected')
    .sort((a, b) => b.text.length - a.text.length);

  for (const entity of sortedEntities) {
    const color = getEntityColor(entity.entityType);
    const isSelected = entity.id === selectedEntityId;
    const opacity = entity.status === 'confirmed' ? '0.4' : '0.3';

    // Create highlight span
    const highlightSpan = `<span
      data-entity-id="${entity.id}"
      class="entity-highlight ${isSelected ? 'selected' : ''}"
      style="
        background-color: ${color}${Math.round(parseFloat(opacity) * 255).toString(16).padStart(2, '0')};
        border-bottom: 2px solid ${color};
        cursor: pointer;
        padding: 2px 0;
        ${isSelected ? 'box-shadow: 0 0 0 3px ' + color + '40;' : ''}
      "
      title="${entity.entityType} (${Math.round(entity.confidence * 100)}%)"
    >$&</span>`;

    // Escape special regex characters in entity text
    const escapedText = entity.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Replace first occurrence only (use a unique marker)
    const regex = new RegExp(`(${escapedText})`, 'i');
    result = result.replace(regex, highlightSpan);
  }

  return result;
}
