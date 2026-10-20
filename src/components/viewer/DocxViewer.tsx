import { useEffect, useRef, useState } from 'react';
import type { DetectedEntity } from '@/lib/types';
import { getEntityColor, getEntityDisplayName } from '@/utils/entity-types';
import { useLanguage } from '@/contexts/LanguageContext';
import type { Language } from '@/i18n/translations';
import { buildWhitespaceTolerantPattern } from '@/utils/text-utils';

interface DocxViewerProps {
  htmlContent: string;
  fullText: string;
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
  fullText,
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
    const highlighted = highlightEntities(htmlContent, fullText, entities, language, selectedEntityId);
    setHighlightedHtml(highlighted);
  }, [htmlContent, fullText, entities, selectedEntityId, language]);

  // Bring the selected entity into view when it changes, e.g. after clicking it in the list
  const scrolledEntityIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!selectedEntityId || selectedEntityId === scrolledEntityIdRef.current) return;
    const span = containerRef.current?.querySelector(`[data-entity-id="${CSS.escape(selectedEntityId)}"]`);
    if (span) {
      span.scrollIntoView({ block: 'center', behavior: 'smooth' });
      scrolledEntityIdRef.current = selectedEntityId;
    }
  }, [selectedEntityId, highlightedHtml]);

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

interface HighlightRange {
  entity: DetectedEntity;
  start: number;
  end: number;
}

/**
 * Find where each entity appears in the preview's text.
 * An entity at fullText offset N is the k-th match of its text in fullText,
 * so it is highlighted at the k-th match in the preview. That puts repeated
 * text on the right occurrence instead of always the first.
 */
function locateEntities(previewText: string, fullText: string, entities: DetectedEntity[]): HighlightRange[] {
  const matchCache = new Map<string, { full: number[]; preview: Array<[number, number]> }>();
  const ranges: HighlightRange[] = [];

  for (const entity of entities) {
    const pattern = buildWhitespaceTolerantPattern(entity.text);
    if (!pattern) continue;

    let matches = matchCache.get(pattern.source);
    if (!matches) {
      matches = {
        full: Array.from(fullText.matchAll(pattern), m => m.index),
        preview: Array.from(previewText.matchAll(pattern), m => [m.index, m.index + m[0].length] as [number, number]),
      };
      matchCache.set(pattern.source, matches);
    }

    // Fall back to the first match if the offset doesn't line up with a match
    const occurrence = Math.max(0, matches.full.findIndex(index => index >= entity.position.textIndex));
    const match = matches.preview[occurrence];
    if (match) ranges.push({ entity, start: match[0], end: match[1] });
  }

  // Drop ranges that overlap one already claimed, preferring longer ones
  ranges.sort((a, b) => (b.end - b.start) - (a.end - a.start));
  const kept: HighlightRange[] = [];
  for (const range of ranges) {
    if (!kept.some(other => range.start < other.end && other.start < range.end)) kept.push(range);
  }
  return kept;
}

/**
 * Highlight entities in HTML content by wrapping text nodes, so matches can
 * never land inside tags or attributes
 */
function highlightEntities(
  html: string,
  fullText: string,
  entities: DetectedEntity[],
  language: Language,
  selectedEntityId?: string
): string {
  const body = new DOMParser().parseFromString(html, 'text/html').body;

  // Map every text node to its offset in the preview's text
  const textNodes: Array<{ node: Text; start: number }> = [];
  let previewText = '';
  const walker = body.ownerDocument.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    textNodes.push({ node: node as Text, start: previewText.length });
    previewText += (node as Text).data;
  }

  // Wrap from the end so splitting a node never moves an earlier range
  const ranges = locateEntities(previewText, fullText, entities).sort((a, b) => b.start - a.start);
  for (const { entity, start, end } of ranges) {
    const color = getEntityColor(entity.entityType);
    const isSelected = entity.id === selectedEntityId;
    // Unchecked detections get a dashed underline and no fill so they read as "not redacted"
    const isChecked = entity.status === 'confirmed';

    for (let i = textNodes.length - 1; i >= 0; i--) {
      const { node, start: nodeStart } = textNodes[i];
      const nodeEnd = nodeStart + node.data.length;
      if (nodeEnd <= start || nodeStart >= end) continue;

      // Split off the part of this node inside the range
      let target = node;
      if (start > nodeStart) target = target.splitText(start - nodeStart);
      if (end < nodeEnd) target.splitText(end - Math.max(start, nodeStart));
      if (!target.data) continue;

      const span = body.ownerDocument.createElement('span');
      span.dataset.entityId = entity.id;
      span.className = `entity-highlight${isSelected ? ' selected' : ''}`;
      span.title = `${getEntityDisplayName(entity.entityType, language)} (${Math.round(entity.confidence * 100)}%)`;
      span.style.backgroundColor = isChecked ? `${color}66` : 'transparent';
      span.style.borderBottom = `2px ${isChecked ? 'solid' : 'dashed'} ${color}`;
      span.style.cursor = 'pointer';
      span.style.padding = '2px 0';
      if (isSelected) span.style.boxShadow = `0 0 0 3px ${color}40`;
      target.replaceWith(span);
      span.appendChild(target);
    }
  }

  return body.innerHTML;
}
