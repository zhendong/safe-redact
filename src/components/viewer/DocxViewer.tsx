import { useEffect, useRef, useState } from 'react';
import type { DetectedEntity } from '@/lib/types';
import { getEntityColor, getEntityDisplayName } from '@/utils/entity-types';
import { useLanguage } from '@/contexts/LanguageContext';
import type { Language } from '@/i18n/translations';

interface DocxViewerProps {
  htmlContent: string;
  entities: DetectedEntity[];
  selectedEntityId?: string;
  onEntityClick?: (entity: DetectedEntity) => void;
  onTextSelectionRedact?: (text: string) => void;
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
  onTextSelectionRedact,
}: DocxViewerProps) {
  const { language, t } = useLanguage();
  const containerRef = useRef<HTMLDivElement>(null);
  const [highlightedHtml, setHighlightedHtml] = useState('');
  const [selection, setSelection] = useState<{ text: string; top: number; left: number } | null>(null);

  // Offer a "Redact selection" button when the user selects text in the preview
  useEffect(() => {
    if (!onTextSelectionRedact) return;

    const handleSelectionChange = () => {
      const current = window.getSelection();
      const container = containerRef.current;
      const text = current?.toString().trim() ?? '';
      if (!current || current.isCollapsed || !text || !container || !container.contains(current.anchorNode)) {
        setSelection(null);
        return;
      }
      const rect = current.getRangeAt(0).getBoundingClientRect();
      setSelection({ text, top: rect.bottom + 8, left: rect.left + rect.width / 2 });
    };

    document.addEventListener('selectionchange', handleSelectionChange);
    return () => document.removeEventListener('selectionchange', handleSelectionChange);
  }, [onTextSelectionRedact]);

  const handleRedactSelection = () => {
    if (!selection || !onTextSelectionRedact) return;
    onTextSelectionRedact(selection.text);
    window.getSelection()?.removeAllRanges();
    setSelection(null);
  };

  useEffect(() => {
    // Inject entity highlights into HTML
    const highlighted = highlightEntities(htmlContent, entities, language, selectedEntityId);
    setHighlightedHtml(highlighted);
  }, [htmlContent, entities, selectedEntityId, language]);

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
          {t('docxViewer.documentPreview')}
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400">
          {t('docxViewer.clickToReview')}
        </div>
      </div>

      {/* Document Content */}
      <div className="flex-1 overflow-auto p-8 bg-gray-100 dark:bg-gray-900" onScroll={() => setSelection(null)}>
        <div
          ref={containerRef}
          className="max-w-4xl mx-auto bg-white dark:bg-gray-800 shadow-lg p-12 docx-content dark:text-gray-200"
          dangerouslySetInnerHTML={{ __html: highlightedHtml }}
        />
      </div>

      {selection && (
        <button
          // Keep the text selection alive while clicking
          onMouseDown={(e) => e.preventDefault()}
          onClick={handleRedactSelection}
          className="btn-primary fixed z-50 -translate-x-1/2 px-4 py-2 text-sm shadow-lg"
          style={{ top: selection.top, left: selection.left }}
        >
          {t('docxViewer.redactSelection')}
        </button>
      )}
    </div>
  );
}

/**
 * Highlight entities in HTML content
 */
function highlightEntities(
  html: string,
  entities: DetectedEntity[],
  language: Language,
  selectedEntityId?: string
): string {
  let result = html;

  // Sort entities by position (longest first to avoid nested replacements)
  const sortedEntities = [...entities]
    .sort((a, b) => b.text.length - a.text.length);

  for (const entity of sortedEntities) {
    const color = getEntityColor(entity.entityType);
    const isSelected = entity.id === selectedEntityId;
    // Unchecked detections get a dashed underline and no fill so they read as "not redacted"
    const isChecked = entity.status === 'confirmed';

    // Create highlight span
    const highlightSpan = `<span
      data-entity-id="${entity.id}"
      class="entity-highlight ${isSelected ? 'selected' : ''}"
      style="
        background-color: ${isChecked ? `${color}66` : 'transparent'};
        border-bottom: 2px ${isChecked ? 'solid' : 'dashed'} ${color};
        cursor: pointer;
        padding: 2px 0;
        ${isSelected ? 'box-shadow: 0 0 0 3px ' + color + '40;' : ''}
      "
      title="${getEntityDisplayName(entity.entityType, language)} (${Math.round(entity.confidence * 100)}%)"
    >$&</span>`;

    // Escape special regex characters in entity text
    const escapedText = entity.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Replace first occurrence only (use a unique marker)
    const regex = new RegExp(`(${escapedText})`, 'i');
    result = result.replace(regex, highlightSpan);
  }

  return result;
}
