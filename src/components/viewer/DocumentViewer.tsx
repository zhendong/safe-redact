import { useEffect, useRef, useState } from 'react';
import * as mupdf from 'mupdf';
import type { ProcessedDocument, DetectedEntity, BoundingBox, EntityType } from '@/lib/types';
import { EntityHighlight } from './EntityHighlight';
import { ManualSelector } from '../controls/ManualSelector';

interface DocumentViewerProps {
  document: ProcessedDocument;
  currentPage: number;
  selectedEntityId?: string;
  onEntityClick?: (entity: DetectedEntity) => void;
  onManualEntityCreate?: (boundingBox: BoundingBox, entityType: EntityType, pageNumber: number, selectedText?: string, searchOccurrences?: boolean, formFieldName?: string) => void;
}

export function DocumentViewer({
  document,
  currentPage,
  selectedEntityId,
  onEntityClick,
  onManualEntityCreate,
}: DocumentViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1.0);
  const [isLoading, setIsLoading] = useState(true);
  const [isManualSelectionActive, setIsManualSelectionActive] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [showManualGuide, setShowManualGuide] = useState(false);

  const currentPageData = document.pages[currentPage - 1];

  const handleManualEntityCreate = (boundingBox: BoundingBox, entityType: EntityType, selectedText?: string, searchOccurrences?: boolean, formFieldName?: string) => {
    if (onManualEntityCreate) {
      onManualEntityCreate(boundingBox, entityType, currentPage, selectedText, searchOccurrences, formFieldName);
    }
  };

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
          console.log('PNG buffer type:', pngBuffer);
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
          console.error('Error loading rendered page image');
          URL.revokeObjectURL(url);
          setIsLoading(false);
        };
        img.src = url;
      } catch (error) {
        console.error('Error rendering page:', error);
        setIsLoading(false);
      }
    };

    renderPage();
  }, [currentPage, scale, currentPageData]);

  const handleZoomIn = () => {
    setScale((prev) => Math.min(prev + 0.25, 2.0));
  };

  const handleZoomOut = () => {
    setScale((prev) => Math.max(prev - 0.25, 0.5));
  };

  const handleFitWidth = () => {
    if (containerRef.current && currentPageData) {
      const containerWidth = containerRef.current.clientWidth - 48; // padding
      const bounds = currentPageData.pdfPageObject.getBounds();
      const pageWidth = bounds[2] - bounds[0];
      setScale(containerWidth / pageWidth);
    }
  };

  // Initialize with fit width on mount and page change
  useEffect(() => {
    if (containerRef.current && currentPageData && !isInitialized) {
      // Wait a brief moment for container to be rendered
      setTimeout(() => {
        handleFitWidth();
        setIsInitialized(true);
      }, 100);
    }
  }, [currentPageData, isInitialized]);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 p-3 sm:p-3 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 sm:gap-0">
        <div className="flex items-center justify-between sm:justify-start gap-3">
          <span className="text-sm sm:text-sm text-gray-700 dark:text-gray-300 font-medium">
            Page {currentPage} of {document.pageCount}
          </span>

          {/* Zoom controls on mobile - improved touch targets */}
          <div className="flex sm:hidden items-center gap-2">
            <button
              onClick={handleZoomOut}
              disabled={scale <= 0.5}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center text-lg font-bold bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors active:scale-95"
              aria-label="Zoom out"
            >
              −
            </button>
            <span className="text-sm text-gray-700 dark:text-gray-300 min-w-[50px] text-center font-medium">
              {Math.round(scale * 100)}%
            </span>
            <button
              onClick={handleZoomIn}
              disabled={scale >= 2.0}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center text-lg font-bold bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors active:scale-95"
              aria-label="Zoom in"
            >
              +
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 justify-between sm:justify-end">
          {/* Desktop zoom controls */}
          <div className="hidden sm:flex items-center gap-2">
            <button
              onClick={handleZoomOut}
              disabled={scale <= 0.5}
              className="px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed rounded transition-colors"
              aria-label="Zoom out"
            >
              −
            </button>
            <span className="text-sm text-gray-700 dark:text-gray-300 min-w-[60px] text-center">
              {Math.round(scale * 100)}%
            </span>
            <button
              onClick={handleZoomIn}
              disabled={scale >= 2.0}
              className="px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed rounded transition-colors"
              aria-label="Zoom in"
            >
              +
            </button>
            <button
              onClick={handleFitWidth}
              className="px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
            >
              Fit Width
            </button>
            <div className="border-l border-gray-300 dark:border-gray-600 mx-2 h-6" />
          </div>

          {/* Manual Selection Button - Improved for mobile */}
          <div className="relative flex-1 sm:flex-initial">
            <button
              onClick={() => {
                const newState = !isManualSelectionActive;
                setIsManualSelectionActive(newState);
                if (newState) {
                  setShowManualGuide(true);
                  setTimeout(() => setShowManualGuide(false), 4000);
                }
              }}
              className={`w-full sm:w-auto min-h-[44px] px-4 sm:px-4 py-2.5 sm:py-1.5 text-sm sm:text-sm font-medium rounded-lg transition-all active:scale-95 flex items-center justify-center gap-2 ${
                isManualSelectionActive
                  ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-md'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span className="hidden sm:inline">{isManualSelectionActive ? 'Manual Selection Active' : 'Add Manual Selection'}</span>
              <span className="sm:hidden">{isManualSelectionActive ? 'Manual Active' : 'Add Selection'}</span>
            </button>

            {/* Tooltip guide - shows on first activation */}
            {showManualGuide && isManualSelectionActive && (
              <div className="absolute top-full mt-2 right-0 z-50 bg-blue-600 text-white text-xs rounded-lg px-3 py-2 shadow-lg max-w-[280px] sm:max-w-none">
                <div className="flex items-start gap-2">
                  <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div>
                    <span className="sm:hidden">Tap and drag on the document to select an area</span>
                    <span className="hidden sm:inline">Click and drag on the document to select an area</span>
                  </div>
                </div>
                <div className="absolute top-0 right-4 transform -translate-y-1/2 rotate-45 w-2 h-2 bg-blue-600" />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Canvas Container */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto bg-gray-100 p-6"
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
                .filter((entity) => entity.status !== 'rejected')
                .map((entity) => (
                  <EntityHighlight
                    key={entity.id}
                    entity={entity}
                    scale={scale}
                    isSelected={entity.id === selectedEntityId}
                    onClick={() => onEntityClick?.(entity)}
                    pageHeight={currentPageData.dimensions.height}
                  />
                ))}
            </div>
          )}

          {/* Manual Selection Overlay - Using simplified component without its own button */}
          {!isLoading && isManualSelectionActive && canvasRef.current && currentPageData && (
            <ManualSelector
              canvasRef={canvasRef as React.RefObject<HTMLCanvasElement>}
              scale={scale}
              pageHeight={currentPageData.dimensions.height}
              onEntityCreate={handleManualEntityCreate}
              isActive={isManualSelectionActive}
              onActivate={() => {}}
              onDeactivate={() => setIsManualSelectionActive(false)}
              pageTextItems={currentPageData.textItems}
              formFields={currentPageData.formFields}
            />
          )}

          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-white bg-opacity-75">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
