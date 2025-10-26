import { useState, useRef, useEffect } from 'react';
import type { EntityType, BoundingBox, FormFieldData } from '@/lib/types';
import { EntityType as EntityTypeEnum } from '@/lib/types';

interface ManualSelectorProps {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  scale: number;
  pageHeight: number;
  onEntityCreate: (boundingBox: BoundingBox, entityType: EntityType, selectedText?: string, searchOccurrences?: boolean, formFieldName?: string) => void;
  isActive: boolean;
  onActivate: () => void;
  onDeactivate: () => void;
  pageTextItems?: any[];
  formFields?: FormFieldData[];
}

export function ManualSelector({
  canvasRef,
  scale,
  pageHeight,
  onEntityCreate,
  isActive,
  onActivate,
  onDeactivate,
  pageTextItems = [],
  formFields = [],
}: ManualSelectorProps) {
  const [isSelecting, setIsSelecting] = useState(false);
  const [startPos, setStartPos] = useState<{ x: number; y: number } | null>(null);
  const [currentBox, setCurrentBox] = useState<BoundingBox | null>(null);
  const [showTypeSelector, setShowTypeSelector] = useState(false);
  const [pendingBox, setPendingBox] = useState<BoundingBox | null>(null);
  const [selectedText, setSelectedText] = useState<string>('');
  const [selectedFormFieldName, setSelectedFormFieldName] = useState<string>('');
  const [searchOccurrences, setSearchOccurrences] = useState(true);

  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isActive || !canvasRef.current || !overlayRef.current) return;

    const overlay = overlayRef.current;
    const canvas = canvasRef.current;

    // Helper to get coordinates from mouse or touch event
    const getCoordinates = (e: MouseEvent | TouchEvent): { clientX: number; clientY: number } => {
      if ('touches' in e && e.touches.length > 0) {
        return { clientX: e.touches[0].clientX, clientY: e.touches[0].clientY };
      }
      return { clientX: (e as MouseEvent).clientX, clientY: (e as MouseEvent).clientY };
    };

    const handleStart = (e: MouseEvent | TouchEvent) => {
      if (!isActive) return;

      // Prevent default to avoid text selection on touch
      if ('touches' in e) {
        e.preventDefault();
      }

      const coords = getCoordinates(e);
      const rect = canvas.getBoundingClientRect();
      const x = (coords.clientX - rect.left) / scale;
      const y = (coords.clientY - rect.top) / scale;

      setStartPos({ x, y });
      setIsSelecting(true);
      setCurrentBox(null);
    };

    const handleMove = (e: MouseEvent | TouchEvent) => {
      if (!isSelecting || !startPos) return;

      // Prevent default to avoid scrolling during selection
      if ('touches' in e) {
        e.preventDefault();
      }

      const coords = getCoordinates(e);
      const rect = canvas.getBoundingClientRect();
      const currentX = (coords.clientX - rect.left) / scale;
      const currentY = (coords.clientY - rect.top) / scale;

      const box: BoundingBox = {
        x: Math.min(startPos.x, currentX),
        y: Math.min(startPos.y, currentY),
        width: Math.abs(currentX - startPos.x),
        height: Math.abs(currentY - startPos.y),
      };

      setCurrentBox(box);
    };

    const handleEnd = () => {
      if (!isSelecting || !currentBox) {
        setIsSelecting(false);
        setStartPos(null);
        return;
      }

      // Check if selection is too small (accidental click/tap)
      if (currentBox.width < 5 || currentBox.height < 5) {
        setIsSelecting(false);
        setStartPos(null);
        setCurrentBox(null);
        return;
      }

      // Extract text from the selection and check for form fields
      const { text: extractedText, formFieldName } = extractTextFromBoundingBox(currentBox);
      setSelectedText(extractedText);
      setSelectedFormFieldName(formFieldName || '');

      // Show type selector
      setPendingBox(currentBox);
      setShowTypeSelector(true);
      setIsSelecting(false);
      setStartPos(null);
      setCurrentBox(null);
    };

    // Mouse events
    overlay.addEventListener('mousedown', handleStart);
    overlay.addEventListener('mousemove', handleMove);
    overlay.addEventListener('mouseup', handleEnd);

    // Touch events
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
  }, [isActive, isSelecting, startPos, currentBox, scale, canvasRef]);

  // Function to extract text from a bounding box
  const extractTextFromBoundingBox = (box: BoundingBox): { text: string; formFieldName?: string } => {
    const extractedTexts: string[] = [];
    let formFieldName: string | undefined;

    // Convert CSS coordinates to PDF coordinates for comparison
    const pdfBox = {
      x: box.x,
      y: pageHeight - box.y - box.height,
      width: box.width,
      height: box.height,
    };

    // Check form fields first
    if (formFields && formFields.length > 0) {
      for (const field of formFields) {
        // Check if form field intersects with selection box
        const intersects = !(
          field.bounds.x + field.bounds.width < pdfBox.x ||
          field.bounds.x > pdfBox.x + pdfBox.width ||
          field.bounds.y + field.bounds.height < pdfBox.y ||
          field.bounds.y > pdfBox.y + pdfBox.height
        );

        if (intersects) {
          // Store the form field name (only the first one if multiple)
          if (!formFieldName) {
            formFieldName = field.name;
            console.log(`Manual selection detected form field: ${field.name}`);
          }

          // Add form field value, label, or name
          const formText = [field.value, field.label, field.name]
            .filter(Boolean)
            .join(' ');
          if (formText) {
            extractedTexts.push(formText);
          }
        }
      }
    }

    // Then check text items
    if (pageTextItems && pageTextItems.length > 0) {
      for (const item of pageTextItems) {
        if (!item.transform || !item.str) continue;

        // Transform array: [a, b, c, d, e, f]
        // e and f are the x and y coordinates
        const itemX = item.transform[4];
        const itemY = item.transform[5];
        const itemWidth = item.width || 0;
        const itemHeight = item.height || 10; // Default height if not available

        // Check if text item intersects with selection box
        const intersects = !(
          itemX + itemWidth < pdfBox.x ||
          itemX > pdfBox.x + pdfBox.width ||
          itemY + itemHeight < pdfBox.y ||
          itemY > pdfBox.y + pdfBox.height
        );

        if (intersects) {
          extractedTexts.push(item.str);
        }
      }
    }

    return {
      text: extractedTexts.join(' ').trim(),
      formFieldName,
    };
  };

  const handleTypeSelect = (entityType: EntityType) => {
    if (pendingBox) {
      // Convert from CSS coordinates (top-left origin) to PDF coordinates (bottom-left origin)
      const pdfBox: BoundingBox = {
        x: pendingBox.x,
        y: pageHeight - pendingBox.y - pendingBox.height,
        width: pendingBox.width,
        height: pendingBox.height,
      };
      onEntityCreate(pdfBox, entityType, selectedText, searchOccurrences, selectedFormFieldName);
    }
    setShowTypeSelector(false);
    setPendingBox(null);
    setSelectedText('');
    setSelectedFormFieldName('');
    setSearchOccurrences(true); // Reset to default
    onDeactivate();
  };

  const handleCancel = () => {
    setShowTypeSelector(false);
    setPendingBox(null);
    setIsSelecting(false);
    setStartPos(null);
    setCurrentBox(null);
    setSelectedText('');
    setSearchOccurrences(true); // Reset to default
  };

  return (
    <>
      {/* Selection Overlay */}
      {isActive && canvasRef.current && (
        <div
          ref={overlayRef}
          className="absolute top-0 left-0 cursor-crosshair"
          style={{
            width: canvasRef.current.width,
            height: canvasRef.current.height,
            pointerEvents: 'auto',
          }}
        >
          {/* Current selection box */}
          {currentBox && (
            <div
              className="absolute border-2 border-blue-500 bg-blue-500 bg-opacity-20"
              style={{
                left: `${currentBox.x * scale}px`,
                top: `${currentBox.y * scale}px`,
                width: `${currentBox.width * scale}px`,
                height: `${currentBox.height * scale}px`,
              }}
            />
          )}
        </div>
      )}

      {/* Type Selector Modal */}
      {showTypeSelector && pendingBox && (
        <div className="fixed inset-0 bg-black/70 dark:bg-black/80 flex items-center justify-center z-[100]" onClick={handleCancel}>
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Select Entity Type
            </h3>
            {selectedText && (
              <div className="mb-4 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Selected text:</p>
                <p className="text-sm text-gray-900 dark:text-gray-100 font-mono break-words">{selectedText}</p>
              </div>
            )}
            {selectedText && (
              <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 rounded-lg">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={searchOccurrences}
                    onChange={(e) => setSearchOccurrences(e.target.checked)}
                    className="mt-0.5 h-4 w-4 text-blue-600 dark:text-blue-400 rounded focus:ring-blue-500 dark:focus:ring-blue-400"
                  />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      Search for all occurrences
                    </p>
                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                      Automatically find and mark all instances of "{selectedText}" throughout the document
                    </p>
                  </div>
                </label>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 mb-4">
              {Object.values(EntityTypeEnum).map((type) => (
                <button
                  key={type}
                  onClick={() => handleTypeSelect(type)}
                  className="min-h-[44px] px-4 py-3 text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 rounded-lg transition-colors text-left active:scale-95"
                >
                  {type}
                </button>
              ))}
            </div>
            <button
              onClick={handleCancel}
              className="w-full min-h-[44px] px-4 py-2 text-sm bg-gray-300 dark:bg-gray-600 hover:bg-gray-400 dark:hover:bg-gray-500 text-gray-900 dark:text-gray-100 rounded-lg transition-colors active:scale-95"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}
