import { useEffect, useRef, useState } from 'react';
import * as mupdf from 'mupdf';
import type { ProcessedDocument, DetectedEntity, BoundingBox, EntityType } from '@/lib/types';
import { EntityHighlight } from './EntityHighlight';
import { ManualSelector } from '../controls/ManualSelector';
import { useLanguage } from '@/contexts/LanguageContext';
import { createLogger } from '@/utils/logger';

const log = createLogger('DocumentViewer');

interface DocumentViewerProps {
  document: ProcessedDocument;
  currentPage: number;
  selectedEntityId?: string;
  onEntityClick?: (entity: DetectedEntity) => void;
  onManualEntityCreate?: (boundingBox: BoundingBox, entityType: EntityType, pageNumber: number, selectedText?: string, searchOccurrences?: boolean, formFieldName?: string) => void;
  onCountOccurrences?: (text: string, pageNumber: number, boundingBox: BoundingBox) => number;
  onEntityDelete?: (entityId: string) => void;
  onPageChange?: (page: number) => void;
}

export function DocumentViewer({
  document,
  currentPage,
  selectedEntityId,
  onEntityClick,
  onManualEntityCreate,
  onCountOccurrences,
  onEntityDelete,
  onPageChange,
}: DocumentViewerProps) {
  const { t } = useLanguage();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1.0);
  const [isLoading, setIsLoading] = useState(true);
  const [isManualSelectionActive, setIsManualSelectionActive] = useState(false);
  // Fit-width mode refits whenever the viewer resizes; zooming by hand leaves it
  const [isFitWidth, setIsFitWidth] = useState(true);
  const scrolledEntityIdRef = useRef<string | undefined>(undefined);

  const currentPageData = document.pages[currentPage - 1];

  const selectedEntity = currentPageData?.entities.find((e) => e.id === selectedEntityId);
  const canDeleteSelected = !!onEntityDelete && selectedEntity?.detectionMethod === 'manual';

  // Delete or Backspace removes a selected manual box, unless the user is typing
  useEffect(() => {
    if (!canDeleteSelected || !selectedEntityId) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      e.preventDefault();
      onEntityDelete?.(selectedEntityId);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canDeleteSelected, selectedEntityId, onEntityDelete]);

  useEffect(() => {
    if (!currentPageData || !canvasRef.current) {
      return;
    }

    setIsLoading(true);

    const renderPage = async () => {
      try {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const context = canvas.getContext('2d');
        if (!context) return;

        if (currentPageData.imageBlob) {
          const bitmap = await createImageBitmap(currentPageData.imageBlob);
          try {
            canvas.width = bitmap.width * scale;
            canvas.height = bitmap.height * scale;
            context.clearRect(0, 0, canvas.width, canvas.height);
            context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
            setIsLoading(false);
          } finally {
            bitmap.close();
          }
          return;
        }

        const page = currentPageData.pdfPageObject;

        // Get page bounds
        const bounds = page.getBounds();
        const pageWidth = bounds[2] - bounds[0];
        const pageHeight = bounds[3] - bounds[1];

        // Set canvas size based on scale
        const scaledWidth = pageWidth * scale;
        const scaledHeight = pageHeight * scale;
        canvas.width = scaledWidth;
        canvas.height = scaledHeight;

        // Create a matrix for scaling
        const matrix = mupdf.Matrix.scale(scale, scale);

        // Render page to pixmap
        const pixmap = page.toPixmap(
          matrix,
          mupdf.ColorSpace.DeviceRGB,
          false, // alpha (transparency)
          true   // show annotations
        );

        // Convert pixmap to PNG buffer
        const pngBuffer = pixmap.asPNG();

        // The pngBuffer is a mupdf Buffer object
        // We need to get the actual bytes from it
        let pngBytes: Uint8Array;
        if (pngBuffer instanceof Uint8Array) {
          pngBytes = pngBuffer;
        } else if (typeof pngBuffer.asUint8Array === 'function') {
          pngBytes = pngBuffer.asUint8Array();
        } else {
          // Fallback: try to access the buffer data directly
          throw new Error('Unable to extract PNG data from buffer');
        }

        const blob = new Blob([pngBytes], { type: 'image/png' });
        const url = URL.createObjectURL(blob);

        // Load image and draw to canvas
        const img = new Image();
        img.onload = () => {
          context.clearRect(0, 0, canvas.width, canvas.height);
          context.drawImage(img, 0, 0);
          URL.revokeObjectURL(url);
          setIsLoading(false);
        };
        img.onerror = () => {
          log.error('Error loading rendered page image');
          URL.revokeObjectURL(url);
          setIsLoading(false);
        };
        img.src = url;
      } catch (error) {
        log.error('Error rendering page', error);
        setIsLoading(false);
      }
    };

    renderPage();
  }, [currentPage, scale, currentPageData]);

  const handleZoomIn = () => {
    setIsFitWidth(false);
    setScale((prev) => Math.min(prev + 0.25, 2.0));
  };

  const handleZoomOut = () => {
    setIsFitWidth(false);
    setScale((prev) => Math.max(prev - 0.25, 0.5));
  };

  // Refit on mount, page change, and whenever the viewer resizes (window resize, rotation, layout changes)
  useEffect(() => {
    const container = containerRef.current;
    if (!isFitWidth || !container || !currentPageData) return;

    const fit = () => {
      const containerWidth = container.clientWidth - 48; // padding
      if (containerWidth <= 0) return; // hidden, e.g. the mobile list view is showing
      const bounds = currentPageData.imageBlob ? null : currentPageData.pdfPageObject.getBounds();
      const pageWidth = bounds ? bounds[2] - bounds[0] : currentPageData.dimensions.width;
      const next = containerWidth / pageWidth;
      // Skip sub-pixel changes so a resize doesn't re-render the page for nothing
      setScale((prev) => (Math.abs(prev - next) < 0.005 ? prev : next));
    };

    fit();
    // Re-rendering a page is expensive, so wait for the resize to settle
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(fit, 150);
    });
    observer.observe(container);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [isFitWidth, currentPageData]);

  // Bring the selected item's highlight into view once its page has rendered
  useEffect(() => {
    if (isLoading || !selectedEntityId || selectedEntityId === scrolledEntityIdRef.current) return;
    const container = containerRef.current;
    const highlight = container?.querySelector<HTMLElement>(`[data-entity-id="${CSS.escape(selectedEntityId)}"]`);
    if (!container || !highlight) return;
    scrolledEntityIdRef.current = selectedEntityId;
    const containerRect = container.getBoundingClientRect();
    const highlightRect = highlight.getBoundingClientRect();
    // Leave the view alone when the highlight is already fully visible, e.g. a box just drawn
    if (
      highlightRect.top >= containerRect.top && highlightRect.bottom <= containerRect.bottom &&
      highlightRect.left >= containerRect.left && highlightRect.right <= containerRect.right
    ) return;
    // Scroll only the viewer, not the page around it
    container.scrollTo({
      top: container.scrollTop + highlightRect.top - containerRect.top - (container.clientHeight - highlightRect.height) / 2,
      left: container.scrollLeft + highlightRect.left - containerRect.left - (container.clientWidth - highlightRect.width) / 2,
      behavior: 'smooth',
    });
  }, [selectedEntityId, isLoading, currentPage]);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 p-3 sm:p-3 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 sm:gap-0">
        <div className="flex flex-wrap items-center justify-between sm:justify-start gap-x-2 gap-y-2 sm:gap-3">
          <div className="flex items-center gap-1 sm:gap-1.5">
            {onPageChange && (
              <button
                onClick={() => onPageChange(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
                className="btn-ghost w-10 h-10 sm:w-8 sm:h-8 text-sm active:scale-95"
                aria-label={t('documentViewer.previousPage')}
                title={t('documentViewer.previousPage')}
              >
                ←
              </button>
            )}
            <span className="text-sm text-gray-700 dark:text-gray-300 font-medium whitespace-nowrap tabular-nums px-1">
              <span className="hidden sm:inline">{t('documentViewer.pageOf', { current: currentPage, total: document.pageCount })}</span>
              <span className="sm:hidden" aria-label={t('documentViewer.pageOf', { current: currentPage, total: document.pageCount })}>
                {currentPage} / {document.pageCount}
              </span>
            </span>
            {onPageChange && (
              <button
                onClick={() => onPageChange(Math.min(document.pageCount, currentPage + 1))}
                disabled={currentPage === document.pageCount}
                className="btn-ghost w-10 h-10 sm:w-8 sm:h-8 text-sm active:scale-95"
                aria-label={t('documentViewer.nextPage')}
                title={t('documentViewer.nextPage')}
              >
                →
              </button>
            )}
          </div>

          {/* Zoom controls on mobile - improved touch targets */}
          <div className="flex sm:hidden items-center gap-1">
            <button
              onClick={handleZoomOut}
              disabled={scale <= 0.5}
              className="btn-ghost w-10 h-10 text-lg font-bold active:scale-95"
              aria-label={t('documentViewer.zoomOut')}
            >
              −
            </button>
            <span className="text-sm text-gray-700 dark:text-gray-300 min-w-[44px] text-center font-medium tabular-nums">
              {Math.round(scale * 100)}%
            </span>
            <button
              onClick={handleZoomIn}
              disabled={scale >= 2.0}
              className="btn-ghost w-10 h-10 text-lg font-bold active:scale-95"
              aria-label={t('documentViewer.zoomIn')}
            >
              +
            </button>
            <button
              onClick={() => setIsFitWidth(true)}
              aria-pressed={isFitWidth}
              className="btn-ghost w-10 h-10 active:scale-95"
              aria-label={t('documentViewer.fitWidth')}
              title={t('documentViewer.fitWidth')}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7l-4 5 4 5M16 7l4 5-4 5M4 12h16" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 justify-between sm:justify-end">
          {/* Desktop zoom controls */}
          <div className="hidden sm:flex items-center gap-2">
            <button
              onClick={handleZoomOut}
              disabled={scale <= 0.5}
              className="btn-ghost px-3 py-1.5 text-sm"
              aria-label={t('documentViewer.zoomOut')}
            >
              −
            </button>
            <span className="text-sm text-gray-700 dark:text-gray-300 min-w-[60px] text-center">
              {Math.round(scale * 100)}%
            </span>
            <button
              onClick={handleZoomIn}
              disabled={scale >= 2.0}
              className="btn-ghost px-3 py-1.5 text-sm"
              aria-label={t('documentViewer.zoomIn')}
            >
              +
            </button>
            <button
              onClick={() => setIsFitWidth(true)}
              aria-pressed={isFitWidth}
              className="btn-ghost px-3 py-1.5 text-sm"
            >
              {t('documentViewer.fitWidth')}
            </button>
            <div className="border-l border-gray-300 dark:border-gray-600 mx-2 h-6" />
          </div>

          {/* Manual Selection Button - Improved for mobile */}
          <div className="relative flex-1 sm:flex-initial">
            <button
              onClick={() => setIsManualSelectionActive(!isManualSelectionActive)}
              aria-pressed={isManualSelectionActive}
              className={`w-full sm:w-auto min-h-[44px] px-4 sm:px-4 py-2.5 sm:py-1.5 text-sm sm:text-sm rounded-full transition-all active:scale-95 flex items-center justify-center gap-2 ${
                isManualSelectionActive
                  ? 'btn-primary'
                  : 'btn-ghost'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span className="hidden sm:inline">{isManualSelectionActive ? t('documentViewer.manualSelectionActive') : t('documentViewer.addManualSelection')}</span>
              <span className="sm:hidden">{isManualSelectionActive ? t('documentViewer.manualActive') : t('documentViewer.addSelection')}</span>
            </button>

          </div>
        </div>
      </div>

      <div className="relative flex-1 min-h-0 flex flex-col">
        {/* Stays up while the tool is on; floats over the page so turning the tool on doesn't move it */}
        {isManualSelectionActive && (
          <div
            role="status"
            className="absolute top-3 left-1/2 -translate-x-1/2 z-30 max-w-[calc(100%-1.5rem)] flex items-center gap-2 px-3 py-2 rounded-full bg-ink/90 text-paper text-xs shadow-lg pointer-events-none"
          >
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="sm:hidden">{t('documentViewer.dragGuideMobile')}</span>
            <span className="hidden sm:inline">{t('documentViewer.dragGuideDesktop')}</span>
          </div>
        )}

        {/* Canvas Container */}
        <div
          ref={containerRef}
          className="flex-1 overflow-auto bg-gray-100 p-6"
          // Reserve the scrollbar's space so fitting can't toggle it and trigger another refit
          style={{ scrollbarGutter: 'stable' }}
        >
          <div className="relative inline-block bg-white shadow-lg">
            <canvas ref={canvasRef} className="block" style={{ pointerEvents: isManualSelectionActive ? 'none' : 'auto' }} />

            {/* Entity Highlights Overlay */}
            {!isLoading && currentPageData && (
              <div
                className="absolute top-0 left-0"
                style={{
                  width: currentPageData.dimensions.width * scale,
                  height: currentPageData.dimensions.height * scale,
                  pointerEvents: isManualSelectionActive ? 'none' : 'auto',
                }}
              >
                {currentPageData.entities
                  .map((entity) => (
                    <EntityHighlight
                      key={entity.id}
                      entity={entity}
                      scale={scale}
                      isSelected={entity.id === selectedEntityId}
                      onClick={() => onEntityClick?.(entity)}
                      onDelete={onEntityDelete && entity.detectionMethod === 'manual' ? () => onEntityDelete(entity.id) : undefined}
                      pageHeight={currentPageData.dimensions.height}
                    />
                  ))}
              </div>
            )}

            {/* Manual Selection Overlay */}
            {!isLoading && isManualSelectionActive && canvasRef.current && currentPageData && onManualEntityCreate && (
              <ManualSelector
                key={currentPage}
                canvasRef={canvasRef as React.RefObject<HTMLCanvasElement>}
                scale={scale}
                pageNumber={currentPage}
                pageHeight={currentPageData.dimensions.height}
                pdfPage={currentPageData.imageBlob ? undefined : currentPageData.pdfPageObject}
                onEntityCreate={onManualEntityCreate}
                onCountOccurrences={onCountOccurrences}
                onDeactivate={() => setIsManualSelectionActive(false)}
                pageTextItems={currentPageData.textItems}
                formFields={currentPageData.formFields}
              />
            )}

            {isLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-white/75 dark:bg-gray-900/75">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-ink dark:border-paper" />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
