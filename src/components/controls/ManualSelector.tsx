import { useState, useRef, useEffect } from 'react';
import type * as mupdf from 'mupdf';
import type { EntityType, BoundingBox, FormFieldData, TextItem } from '@/lib/types';
import { EntityType as EntityTypeEnum } from '@/lib/types';
import { getEntityDisplayName } from '@/utils/entity-types';
import { REGEX_PATTERNS } from '@/utils/regex-patterns';
import { useLanguage } from '@/contexts/LanguageContext';
import { createLogger } from '@/utils/logger';

const log = createLogger('ManualSelector');

const REDACTION_COLOR = '#1c1b19';
const POPOVER_WIDTH = 288;
const MANUAL_TYPES = Object.values(EntityTypeEnum).filter((type) => type !== EntityTypeEnum.PREDEFINED);

interface ManualSelectorProps {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  scale: number;
  pageNumber: number;
  pageHeight: number;
  /** MuPDF page, for character-accurate text; absent for image pages */
  pdfPage?: mupdf.Page;
  onEntityCreate: (boundingBox: BoundingBox, entityType: EntityType, pageNumber: number, selectedText?: string, searchOccurrences?: boolean, formFieldName?: string) => void;
  onCountOccurrences?: (text: string, pageNumber: number, boundingBox: BoundingBox) => number;
  onDeactivate: () => void;
  pageTextItems?: TextItem[];
  formFields?: FormFieldData[];
}

/** A drawn box waiting for the user to confirm its type and whether to redact matches */
interface PendingBox {
  cssBox: BoundingBox;  // page units, top-left origin, for drawing
  pdfBox: BoundingBox;  // page units, bottom-left origin, as stored on entities
  pageNumber: number;
  text: string;
  entityType: EntityType;
  formFieldName?: string;
}

interface PageChar {
  c: string;
  cx: number;
  cy: number;
  lineId: number;
}

// Punctuation that a loose box picks up next to a value; "." is kept so "Inc." and "J." survive
const EDGE_PUNCTUATION = /^[\s,;:]+|[\s,;:]+$/g;

const cleanText = (text: string) => text.replace(/\s+/g, ' ').replace(EDGE_PUNCTUATION, '');

/** A type when the whole text is a structured value such as an email address; otherwise undefined */
function guessEntityType(text: string): EntityType | undefined {
  if (!text) return undefined;
  for (const pattern of REGEX_PATTERNS) {
    const flags = pattern.pattern.flags.replace('g', '');
    const whole = new RegExp(`^(?:${pattern.pattern.source})$`, flags);
    if (whole.test(text) && (!pattern.validator || pattern.validator(text))) return pattern.entityType;
  }
  return undefined;
}

export function ManualSelector({
  canvasRef,
  scale,
  pageNumber,
  pageHeight,
  pdfPage,
  onEntityCreate,
  onCountOccurrences,
  onDeactivate,
  pageTextItems = [],
  formFields = [],
}: ManualSelectorProps) {
  const { language, t } = useLanguage();
  const [startPos, setStartPos] = useState<{ x: number; y: number } | null>(null);
  const [currentBox, setCurrentBox] = useState<BoundingBox | null>(null);
  const [pending, setPending] = useState<PendingBox | null>(null);
  const [matchCount, setMatchCount] = useState<number | null>(null);

  const overlayRef = useRef<HTMLDivElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const pageCharsRef = useRef<PageChar[] | null>(null);
  // The type the user last picked by hand, used when the text doesn't reveal one
  const lastTypeRef = useRef<EntityType>(EntityTypeEnum.CUSTOM);

  const commit = (box: PendingBox, searchOccurrences: boolean) => {
    onEntityCreate(box.pdfBox, box.entityType, box.pageNumber, box.text || undefined, searchOccurrences, box.formFieldName);
  };

  // Resolving a box clears it before creating the entity, so it can't be created twice
  const resolvePending = (searchOccurrences: boolean) => {
    if (!pending) return;
    setPending(null);
    setMatchCount(null);
    commit(pending, searchOccurrences);
  };

  // Leaving the tool, changing page, or zooming keeps a pending box, with its matches (the default)
  const latestRef = useRef({ pending, commit });
  latestRef.current = { pending, commit };
  useEffect(() => () => {
    const { pending: box, commit: commitBox } = latestRef.current;
    if (box) commitBox(box, true);
  }, []);

  /** Characters on the page with their centres, in page units with a top-left origin */
  const getPageChars = (): PageChar[] => {
    if (pageCharsRef.current) return pageCharsRef.current;
    const chars: PageChar[] = [];
    try {
      let lineId = 0;
      if (!pdfPage) return chars;
      const structuredText = pdfPage.toStructuredText('preserve-whitespace');
      structuredText.walk({
        beginLine: () => { lineId++; },
        onChar: (c, _origin, _font, _size, quad) => {
          const xs = [quad[0], quad[2], quad[4], quad[6]];
          const ys = [quad[1], quad[3], quad[5], quad[7]];
          chars.push({
            c,
            cx: (Math.min(...xs) + Math.max(...xs)) / 2,
            cy: (Math.min(...ys) + Math.max(...ys)) / 2,
            lineId,
          });
        },
      });
    } catch (error) {
      log.warn('Could not read page characters', { error: String(error) });
    }
    pageCharsRef.current = chars;
    return chars;
  };

  /** Text under a box: only what sits inside it, so "Tom Smith," gives "Tom Smith" when the comma is outside */
  const extractText = (box: BoundingBox): { text: string; formFieldName?: string } => {
    const parts: string[] = [];
    let formFieldName: string | undefined;
    const pdfBox = { x: box.x, y: pageHeight - box.y - box.height, width: box.width, height: box.height };

    for (const field of formFields) {
      const intersects = !(
        field.bounds.x + field.bounds.width < pdfBox.x ||
        field.bounds.x > pdfBox.x + pdfBox.width ||
        field.bounds.y + field.bounds.height < pdfBox.y ||
        field.bounds.y > pdfBox.y + pdfBox.height
      );
      if (!intersects) continue;
      if (!formFieldName) {
        formFieldName = field.name;
        log.debug('Manual selection is over a form field');
      }
      const formText = [field.value, field.label, field.name].filter(Boolean).join(' ');
      if (formText) parts.push(formText);
    }

    const inside = (x: number, y: number) => x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;

    if (pdfPage) {
      // Character positions are exact, so keep the characters whose centre is inside the box
      let text = '';
      let lastLine = -1;
      for (const ch of getPageChars()) {
        if (!inside(ch.cx, ch.cy)) continue;
        if (lastLine !== -1 && ch.lineId !== lastLine) text += ' ';
        text += ch.c;
        lastLine = ch.lineId;
      }
      parts.push(text);
    } else {
      // Image pages have OCR word boxes; keep the words whose centre is inside the box
      for (const item of pageTextItems) {
        if (!item.transform || !item.str) continue;
        const height = item.height || 10;
        const cx = item.transform[4] + (item.width || 0) / 2;
        const cy = pageHeight - item.transform[5] - height / 2;
        if (inside(cx, cy)) parts.push(item.str);
      }
    }

    return { text: cleanText(parts.join(' ')), formFieldName };
  };

  useEffect(() => {
    if (!canvasRef.current || !overlayRef.current) return;

    const overlay = overlayRef.current;
    const canvas = canvasRef.current;

    const getCoordinates = (e: MouseEvent | TouchEvent): { clientX: number; clientY: number } => {
      if ('touches' in e && e.touches.length > 0) {
        return { clientX: e.touches[0].clientX, clientY: e.touches[0].clientY };
      }
      return { clientX: (e as MouseEvent).clientX, clientY: (e as MouseEvent).clientY };
    };

    const toPage = (e: MouseEvent | TouchEvent) => {
      const coords = getCoordinates(e);
      const rect = canvas.getBoundingClientRect();
      return { x: (coords.clientX - rect.left) / scale, y: (coords.clientY - rect.top) / scale };
    };

    const handleStart = (e: MouseEvent | TouchEvent) => {
      // Prevent default to avoid text selection on touch
      if ('touches' in e) e.preventDefault();
      // Starting another box accepts the pending one, matches included
      resolvePending(true);
      setStartPos(toPage(e));
      setCurrentBox(null);
    };

    const handleMove = (e: MouseEvent | TouchEvent) => {
      if (!startPos) return;
      // Prevent default to avoid scrolling during selection
      if ('touches' in e) e.preventDefault();
      const { x, y } = toPage(e);
      setCurrentBox({
        x: Math.min(startPos.x, x),
        y: Math.min(startPos.y, y),
        width: Math.abs(x - startPos.x),
        height: Math.abs(y - startPos.y),
      });
    };

    const handleEnd = (e: MouseEvent | TouchEvent) => {
      const box = currentBox;
      setStartPos(null);
      setCurrentBox(null);
      // Ignore tiny boxes from accidental clicks and taps
      if (!box || box.width < 5 || box.height < 5) return;

      const { text, formFieldName } = extractText(box);
      setPending({
        cssBox: box,
        pdfBox: { x: box.x, y: pageHeight - box.y - box.height, width: box.width, height: box.height },
        pageNumber,
        text,
        entityType: guessEntityType(text) ?? lastTypeRef.current,
        formFieldName,
      });
      // Focus the popover so Enter accepts it; not on touch, where focus rings only get in the way
      if (!('touches' in e) && !('changedTouches' in e)) {
        requestAnimationFrame(() => submitRef.current?.focus());
      }
    };

    overlay.addEventListener('mousedown', handleStart);
    overlay.addEventListener('mousemove', handleMove);
    overlay.addEventListener('mouseup', handleEnd);
    overlay.addEventListener('touchstart', handleStart, { passive: false });
    overlay.addEventListener('touchmove', handleMove, { passive: false });
    overlay.addEventListener('touchend', handleEnd);

    return () => {
      overlay.removeEventListener('mousedown', handleStart);
      overlay.removeEventListener('mousemove', handleMove);
      overlay.removeEventListener('mouseup', handleEnd);
      overlay.removeEventListener('touchstart', handleStart);
      overlay.removeEventListener('touchmove', handleMove);
      overlay.removeEventListener('touchend', handleEnd);
    };
  });

  // Esc keeps just the pending box; with nothing pending it leaves the tool
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      if (pending) resolvePending(false);
      else onDeactivate();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  // Count matches once per box; the search blocks, so let the box and popover paint first
  useEffect(() => {
    if (!pending || !onCountOccurrences) return;
    setMatchCount(null);
    const timer = setTimeout(() => setMatchCount(onCountOccurrences(pending.text, pending.pageNumber, pending.pdfBox)));
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending?.pdfBox]);

  const canvas = canvasRef.current;
  const canvasWidth = canvas?.width ?? 0;
  const canvasHeight = canvas?.height ?? 0;

  const renderBox = (box: BoundingBox, className: string, style: React.CSSProperties = {}) => (
    <div
      className={`absolute ${className}`}
      style={{
        left: `${box.x * scale}px`,
        top: `${box.y * scale}px`,
        width: `${box.width * scale}px`,
        height: `${box.height * scale}px`,
        ...style,
      }}
    />
  );

  const renderPopover = (box: PendingBox) => {
    const boxBottom = (box.cssBox.y + box.cssBox.height) * scale;
    // Below the box, or above it when there's no room underneath
    const placeAbove = boxBottom + 200 > canvasHeight && box.cssBox.y * scale > 200;
    const left = Math.max(0, Math.min(box.cssBox.x * scale, canvasWidth - POPOVER_WIDTH));
    const hasMatches = matchCount !== null && matchCount > 0;

    return (
      <form
        role="dialog"
        aria-label={t('manualSelector.title')}
        className="absolute z-20 surface rounded-xl shadow-[0_16px_40px_-20px_rgba(28,27,25,0.45)] p-3 space-y-2.5 text-left"
        style={{
          left: `${left}px`,
          width: `${POPOVER_WIDTH}px`,
          maxWidth: '100%',
          ...(placeAbove ? { bottom: `${canvasHeight - box.cssBox.y * scale + 8}px` } : { top: `${boxBottom + 8}px` }),
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          resolvePending(true);
        }}
      >
        <div>
          <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">{t('manualSelector.selectedText')}</p>
          {box.text ? (
            <p className="text-sm font-mono text-gray-900 dark:text-gray-100 break-words">{box.text}</p>
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400">{t('manualSelector.noText')}</p>
          )}
        </div>
        <label className="flex items-center gap-2">
          <span className="text-xs text-gray-600 dark:text-gray-400">{t('manualSelector.type')}</span>
          <select
            value={box.entityType}
            onChange={(e) => {
              const entityType = e.target.value as EntityType;
              lastTypeRef.current = entityType;
              setPending({ ...box, entityType });
            }}
            className="flex-1 min-w-0 px-2 py-1 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
          >
            {MANUAL_TYPES.map((type) => (
              <option key={type} value={type}>{getEntityDisplayName(type, language)}</option>
            ))}
          </select>
        </label>
        {box.text && (
          <p className="text-xs text-gray-600 dark:text-gray-400" aria-live="polite">
            {matchCount === null
              ? t('manualSelector.searching')
              : hasMatches
                ? t('manualSelector.otherMatches', { count: matchCount })
                : t('manualSelector.noOtherMatches')}
          </p>
        )}
        <div className="flex items-center gap-2 pt-0.5">
          <button ref={submitRef} type="submit" className="btn-primary flex-1 min-h-[36px] px-3 text-xs">
            {hasMatches ? t('manualSelector.redactAllMatches', { count: (matchCount ?? 0) + 1 }) : t('manualSelector.done')}
          </button>
          {hasMatches && (
            <button type="button" onClick={() => resolvePending(false)} className="btn-ghost min-h-[36px] px-3 text-xs" title={t('manualSelector.onlyThisBoxHint')}>
              {t('manualSelector.onlyThisBox')}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setPending(null);
              setMatchCount(null);
            }}
            className="btn-ghost w-9 h-9 text-sm"
            aria-label={t('manualSelector.discard')}
            title={t('manualSelector.discard')}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </form>
    );
  };

  if (!canvas) return null;

  return (
    <>
      <div
        ref={overlayRef}
        className="absolute top-0 left-0 cursor-crosshair"
        style={{ width: canvasWidth, height: canvasHeight, pointerEvents: 'auto' }}
      >
        {currentBox && renderBox(currentBox, 'border-2 border-ink bg-accent/25 dark:border-paper')}
        {/* A pending box already looks as it will after export */}
        {pending && renderBox(pending.cssBox, '', { backgroundColor: REDACTION_COLOR, boxShadow: '0 0 0 2px #fff, 0 0 0 4px #1c1b19' })}
      </div>
      {pending && renderPopover(pending)}
    </>
  );
}
