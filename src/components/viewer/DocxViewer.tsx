import { useEffect, useMemo, useRef, useState } from 'react';
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
  const [selection, setSelection] = useState<SelectionPopover | null>(null);
  // Touch selections are drawn by the app: native selection on touch screens opens the
  // system Copy/Translate bar, which a page can't suppress
  const [touchRects, setTouchRects] = useState<DOMRect[]>([]);
  const [isTouchInput, setIsTouchInput] = useState(() => window.matchMedia('(pointer: coarse)').matches);
  const touchSelectionActiveRef = useRef(false);

  // React 19 rewrites innerHTML whenever this object changes identity, which wipes the
  // user's text selection, so only build a new one when the highlights change
  const highlightedHtml = useMemo(
    () => ({ __html: highlightEntities(htmlContent, fullText, entities, language, selectedEntityId) }),
    [htmlContent, fullText, entities, selectedEntityId, language]
  );

  const clearSelection = () => {
    setSelection(null);
    setTouchRects([]);
    touchSelectionActiveRef.current = false;
  };

  // Offer to redact text the user selects in the preview. The popover appears once the
  // selection is finished, so it never sits under the pointer while dragging.
  useEffect(() => {
    const container = containerRef.current;
    if (!onTextSelectionRedact || !container) return;

    const describeRange = (range: Range): SelectionPopover | null => {
      const text = range.toString().trim();
      if (!text) return null;
      // Anchor below the end of the selection, kept inside the window
      const rects = range.getClientRects();
      const last = rects[rects.length - 1] ?? range.getBoundingClientRect();
      const pattern = buildWhitespaceTolerantPattern(text);
      return {
        text,
        occurrences: pattern ? Array.from(fullText.matchAll(pattern)).length : 0,
        top: last.bottom + 8,
        left: Math.min(Math.max(last.right, 170), window.innerWidth - 170),
      };
    };

    // Mouse and keyboard use the browser's own selection
    const getNativeSelection = () => {
      const current = window.getSelection();
      if (!current || current.isCollapsed || current.rangeCount === 0 || !container.contains(current.anchorNode)) return null;
      return current.getRangeAt(0);
    };
    const showNativePopover = () => {
      const range = getNativeSelection();
      setSelection(range ? describeRange(range) : null);
    };
    const handleSelectionChange = () => {
      if (!touchSelectionActiveRef.current && !getNativeSelection()) setSelection(null);
    };
    const handlePointerDown = (e: PointerEvent) => {
      if ((e.target as Element).closest?.('[data-selection-popover]')) return;
      setSelection(null);
      setTouchRects([]);
      touchSelectionActiveRef.current = false;
    };
    const handlePointerUp = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') showNativePopover();
    };
    // Keyboard selection (Shift + arrows) finishes on key release
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.shiftKey || e.key === 'Shift') showNativePopover();
    };

    // Touch: long-press a word to start, drag to extend, release to show the popover
    let pressTimer: number | undefined;
    let pressPoint: { x: number; y: number } | null = null;
    let anchorWord: Range | null = null;
    let touchRange: Range | null = null;
    const cancelPress = () => {
      window.clearTimeout(pressTimer);
      pressTimer = undefined;
    };
    const handleTouchStart = (e: TouchEvent) => {
      cancelPress();
      anchorWord = null;
      if (e.touches.length !== 1) return;
      pressPoint = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      pressTimer = window.setTimeout(() => {
        pressTimer = undefined;
        const word = pressPoint && wordRangeAt(pressPoint.x, pressPoint.y, container);
        if (!word) return;
        anchorWord = touchRange = word;
        touchSelectionActiveRef.current = true;
        setSelection(null);
        setTouchRects(visibleRects(word));
        navigator.vibrate?.(10);
      }, LONG_PRESS_MS);
    };
    const handleTouchMove = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (!anchorWord) {
        // Moving before the long press fires is a scroll
        if (pressPoint && Math.hypot(touch.clientX - pressPoint.x, touch.clientY - pressPoint.y) > 10) cancelPress();
        return;
      }
      // Extending a selection: stop the page from scrolling
      e.preventDefault();
      const word = wordRangeAt(touch.clientX, touch.clientY, container);
      if (!word) return;
      touchRange = spanRanges(anchorWord, word);
      setTouchRects(visibleRects(touchRange));
    };
    const handleTouchEnd = (e: TouchEvent) => {
      cancelPress();
      if (!anchorWord || !touchRange) return;
      // Don't let the long press also count as a tap on a highlight
      e.preventDefault();
      anchorWord = null;
      setSelection(describeRange(touchRange));
    };
    const handleTouchCancel = () => {
      cancelPress();
      anchorWord = null;
    };
    // Android opens a context menu on long press
    const handleContextMenu = (e: Event) => {
      if (touchSelectionActiveRef.current) e.preventDefault();
    };

    document.addEventListener('selectionchange', handleSelectionChange);
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('pointerup', handlePointerUp);
    document.addEventListener('keyup', handleKeyUp);
    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd);
    container.addEventListener('touchcancel', handleTouchCancel);
    container.addEventListener('contextmenu', handleContextMenu);
    return () => {
      cancelPress();
      document.removeEventListener('selectionchange', handleSelectionChange);
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('pointerup', handlePointerUp);
      document.removeEventListener('keyup', handleKeyUp);
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
      container.removeEventListener('touchcancel', handleTouchCancel);
      container.removeEventListener('contextmenu', handleContextMenu);
    };
  }, [onTextSelectionRedact, fullText]);

  const handleRedactSelection = () => {
    if (!selection || !onTextSelectionRedact) return;
    onTextSelectionRedact(selection.text);
    window.getSelection()?.removeAllRanges();
    clearSelection();
  };

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
    const container = containerRef.current;
    if (!container || !onEntityClick) return;

    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const entitySpan = target.closest('[data-entity-id]');
      // A drag that ends on a highlight is a text selection, not a click on the entity
      if (!window.getSelection()?.isCollapsed) return;

      if (entitySpan) {
        const entityId = entitySpan.getAttribute('data-entity-id');
        const entity = entities.find(e => e.id === entityId);
        if (entity) {
          onEntityClick(entity);
        }
      }
    };

    // Highlights are focusable spans, so Enter and Space act like a click
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const entityId = (e.target as HTMLElement).closest('[data-entity-id]')?.getAttribute('data-entity-id');
      const entity = entities.find(e => e.id === entityId);
      if (!entity) return;
      e.preventDefault();
      onEntityClick(entity);
    };

    container.addEventListener('click', handleClick);
    container.addEventListener('keydown', handleKeyDown);
    return () => {
      container.removeEventListener('click', handleClick);
      container.removeEventListener('keydown', handleKeyDown);
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
          {t(isTouchInput ? 'docxViewer.clickToReviewTouch' : 'docxViewer.clickToReview')}
        </div>
      </div>

      {/* Document Content */}
      <div className="flex-1 overflow-auto p-8 bg-gray-100 dark:bg-gray-900" onScroll={clearSelection}>
        <div
          ref={containerRef}
          // Switch to the app's own selection as soon as a finger touches the preview
          onPointerDown={(e) => setIsTouchInput(e.pointerType === 'touch')}
          className={`max-w-4xl mx-auto bg-white dark:bg-gray-800 shadow-lg p-12 docx-content dark:text-gray-200 cursor-text selection:bg-[#c9a96e]/60 dark:selection:bg-[#c9a96e]/45 ${
            isTouchInput ? 'select-none [-webkit-touch-callout:none]' : ''
          }`}
          dangerouslySetInnerHTML={highlightedHtml}
        />
      </div>

      {touchRects.map((rect, i) => (
        <div
          key={i}
          className="fixed z-40 pointer-events-none rounded-sm bg-[#c9a96e]/60 dark:bg-[#c9a96e]/45"
          style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
        />
      ))}

      {selection && (
        <div
          data-selection-popover
          role="dialog"
          aria-label={t('docxViewer.redactSelection')}
          className="surface fixed z-50 -translate-x-1/2 w-[300px] rounded-xl p-3 shadow-[0_18px_40px_-20px_rgba(28,27,25,0.35)]"
          style={{ top: selection.top, left: selection.left }}
        >
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100 break-words line-clamp-2">
            “{selection.text}”
          </p>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {selection.occurrences === 0
              ? t('docxViewer.selectionNotFound')
              : selection.occurrences === 1
                ? t('docxViewer.selectionFoundOnce')
                : t('docxViewer.selectionFound', { count: selection.occurrences })}
          </p>
          {selection.occurrences > 0 && (
            <button
              // Keep the text selection alive while clicking
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleRedactSelection}
              className="btn-primary mt-2.5 w-full px-4 py-2 text-sm"
            >
              {selection.occurrences === 1
                ? t('docxViewer.redactSelection')
                : t('docxViewer.redactAllOccurrences', { count: selection.occurrences })}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

interface SelectionPopover {
  text: string;
  occurrences: number;
  top: number;
  left: number;
}

const LONG_PRESS_MS = 400;

/**
 * Range covering the word under a screen point, or null outside the preview's text.
 * Uses Intl.Segmenter so Chinese text splits into words too.
 */
function wordRangeAt(x: number, y: number, container: HTMLElement): Range | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  let node: Node | undefined;
  let offset = 0;
  if (doc.caretPositionFromPoint) {
    const position = doc.caretPositionFromPoint(x, y);
    node = position?.offsetNode;
    offset = position?.offset ?? 0;
  } else if (doc.caretRangeFromPoint) {
    const range = doc.caretRangeFromPoint(x, y);
    node = range?.startContainer;
    offset = range?.startOffset ?? 0;
  }
  if (!(node instanceof Text) || !container.contains(node) || node.data.length === 0) return null;

  const index = Math.min(offset, node.data.length - 1);
  for (const segment of new Intl.Segmenter(undefined, { granularity: 'word' }).segment(node.data)) {
    if (index < segment.index || index >= segment.index + segment.segment.length) continue;
    if (!segment.segment.trim()) return null;
    const range = document.createRange();
    range.setStart(node, segment.index);
    range.setEnd(node, segment.index + segment.segment.length);
    return range;
  }
  return null;
}

/** Range from the start of whichever word comes first to the end of the other */
function spanRanges(a: Range, b: Range): Range {
  const [first, last] = a.compareBoundaryPoints(Range.START_TO_START, b) <= 0 ? [a, b] : [b, a];
  const range = document.createRange();
  range.setStart(first.startContainer, first.startOffset);
  range.setEnd(last.endContainer, last.endOffset);
  return range;
}

function visibleRects(range: Range): DOMRect[] {
  return Array.from(range.getClientRects()).filter(rect => rect.width > 0 && rect.height > 0);
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

  // Links in the document (mailto:, tel:, web pages) must not navigate away from the review
  for (const link of body.querySelectorAll('a[href]')) link.removeAttribute('href');

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
      const displayName = getEntityDisplayName(entity.entityType, language);
      span.title = `${displayName} (${Math.round(entity.confidence * 100)}%)`;
      // Shown by CSS on hover, focus, and selection, so colour isn't the only cue
      span.dataset.type = displayName;
      // Only the first piece of an entity is a tab stop, so a split entity is reached once
      if (nodeStart <= start) {
        span.tabIndex = 0;
        span.setAttribute('role', 'button');
        span.setAttribute('aria-pressed', String(isSelected));
        span.setAttribute('aria-label', `${displayName}: ${entity.text} (${Math.round(entity.confidence * 100)}%)`);
      }
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
