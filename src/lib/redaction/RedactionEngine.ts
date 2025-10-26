import type { ProcessedDocument, DetectedEntity, RedactionResult } from '@/lib/types';
import { DocumentSanitizer } from '@/lib/sanitize/DocumentSanitizer';
import { boundingBoxToMuPdfRect } from '@/utils/coordinate-utils';
import { PDF_REDACTION, COORDINATE_TOLERANCE } from '@/utils/constants';

export class RedactionEngine {
  private pdfDocument: any = null;

  /**
   * Apply redactions to a PDF document
   */
  async applyRedactions(
    file: File,
    document: ProcessedDocument,
    entities: DetectedEntity[],
    onProgress?: (progress: number, message: string) => void,
    sanitize: boolean = false
  ): Promise<RedactionResult> {
    const startTime = performance.now();

    try {
      onProgress?.(0, 'Loading PDF document...');

      // Use the PDF document from the parser (it's stored in pdfPageObject)
      // We need to get it from the document
      if (document.pages.length > 0 && document.pages[0].pdfPageObject) {
        // The page object has a reference to the document
        // We'll need to reload the document for redaction
        const arrayBuffer = await file.arrayBuffer();
        const mupdf = await import('mupdf');
        this.pdfDocument = mupdf.PDFDocument.openDocument(
          new Uint8Array(arrayBuffer),
          'application/pdf'
        );
      } else {
        throw new Error('PDF document not available');
      }

      console.log(`Entities to redact: ${JSON.stringify(entities)}`);
      // Group entities by page
      const entitiesByPage = new Map<number, DetectedEntity[]>();
      for (const entity of entities) {
        const pageNum = entity.position.pageNumber;
        if (!entitiesByPage.has(pageNum)) {
          entitiesByPage.set(pageNum, []);
        }
        entitiesByPage.get(pageNum)!.push(entity);
      }

      const totalPages = entitiesByPage.size;
      let processedPages = 0;

      // Apply redactions page by page
      for (const [pageNumber, pageEntities] of entitiesByPage.entries()) {
        onProgress?.(
          (processedPages / totalPages) * 90 + 10,
          `Redacting page ${pageNumber}...`
        );

        await this.redactPage(document, pageNumber, pageEntities);
        processedPages++;
      }

      onProgress?.(95, 'Finalizing document...');

      // Apply sanitization if requested
      if (sanitize) {
        onProgress?.(96, 'Sanitizing document metadata...');
        const sanitizer = new DocumentSanitizer();
        await sanitizer.sanitizePdf(this.pdfDocument);
      }

      // Use full save (not incremental) to ensure redacted content is completely removed
      const pdfBuffer = this.pdfDocument.saveToBuffer('compress');
      const pdfBytes = pdfBuffer.asUint8Array();

      const blob = new Blob([pdfBytes], { type: 'application/pdf' });

      const processingTime = performance.now() - startTime;

      onProgress?.(100, 'Redaction complete!');

      return {
        success: true,
        pdfBlob: blob,
        redactedCount: entities.length,
        processingTime,
      };
    } catch (error) {
      console.error('Redaction error:', error);

      const processingTime = performance.now() - startTime;

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        redactedCount: 0,
        processingTime,
      };
    }
  }

  /**
   * Apply redactions to a single page
   */
  private async redactPage(
    document: ProcessedDocument,
    pageNumber: number,
    entities: DetectedEntity[]
  ): Promise<void> {
    // MuPDF uses 0-based indexing
    const page = this.pdfDocument.loadPage(pageNumber - 1);
    const pageData = document.pages.find(p => p.pageNumber === pageNumber);

    if (!pageData) {
      console.warn(`Page ${pageNumber} not found in processed document`);
      return;
    }

    // Get page dimensions
    const bounds = page.getBounds();
    const pageHeight = bounds[3] - bounds[1];

    // Separate entities into form field entities and text entities
    const formFieldEntities: DetectedEntity[] = [];
    const textEntities: DetectedEntity[] = [];

    for (const entity of entities) {
      // Check if entity is from a form field by checking if it has a formFieldName
      // This is more reliable than relying on textIndex
      if (entity.position.formFieldName) {
        console.log(`Form field entity: ${entity.text}, formFieldName: ${entity.position.formFieldName}`);
        formFieldEntities.push(entity);
      } else {
        textEntities.push(entity);
      }
    }

    console.log(`Found ${formFieldEntities.length} form field entities and ${textEntities.length} text entities`);

    // Delete form field widgets that contain sensitive data
    // Use form field name if available, otherwise fall back to bounding box matching
    for (const entity of formFieldEntities) {
      const { boundingBox, formFieldName } = entity.position;

      // Get fresh list of widgets for each entity
      const widgets = page.getWidgets?.() || [];
      console.log(`Looking for widget. formFieldName: ${formFieldName}, available widgets:`, widgets.map((w: any) => w.getName?.()).filter(Boolean));
      let foundWidget = false;

      // Find the widget by name (preferred method) or by bounding box
      for (const widget of widgets) {
        try {
          // First try to match by name if available
          if (formFieldName) {
            const widgetName = widget.getName?.();
            if (widgetName === formFieldName) {
              page.deleteAnnotation(widget);
              console.log(`Deleted form field widget by name: ${formFieldName} on page ${pageNumber}`);
              foundWidget = true;
              break;
            }
          } else {
            // Fall back to bounding box matching
            const widgetRect = widget.getRect?.();
            if (!widgetRect) continue;

            // Convert widget rect to our coordinate system for comparison
            const widgetBounds = {
              x: widgetRect[0],
              y: pageHeight - widgetRect[3],
              width: widgetRect[2] - widgetRect[0],
              height: widgetRect[3] - widgetRect[1],
            };

            // Check if this widget matches the entity's bounding box
            // Use a tolerance for floating point comparison
            if (
              Math.abs(widgetBounds.x - boundingBox.x) < COORDINATE_TOLERANCE.STRICT &&
              Math.abs(widgetBounds.y - boundingBox.y) < COORDINATE_TOLERANCE.STRICT &&
              Math.abs(widgetBounds.width - boundingBox.width) < COORDINATE_TOLERANCE.STRICT &&
              Math.abs(widgetBounds.height - boundingBox.height) < COORDINATE_TOLERANCE.STRICT
            ) {
              // Delete this widget
              const widgetName = widget.getName?.() || 'unknown';
              page.deleteAnnotation(widget);
              console.log(`Deleted form field widget by bounds: ${widgetName} on page ${pageNumber}`);
              foundWidget = true;
              break;
            }
          }
        } catch (e) {
          // Widget may have been deleted in a previous iteration, skip it
          console.warn(`Failed to check widget on page ${pageNumber}:`, e);
          continue;
        }
      }

      if (!foundWidget) {
        console.warn(`Could not find form field widget for entity on page ${pageNumber}:`, entity.text, formFieldName || 'no name');
      }
    }

    // Create and apply redaction annotations for text entities
    for (const entity of textEntities) {
      const { boundingBox } = entity.position;

      // Convert from our coordinate system (bottom-left origin) to MuPDF (top-left origin)
      const rect = boundingBoxToMuPdfRect(boundingBox, pageHeight, PDF_REDACTION.MARGIN);

      // Create redaction annotation with MuPDF rect format [x0, y0, x1, y1]
      const annotation = page.createAnnotation('Redact');
      annotation.setRect(rect);

      // Apply the redaction (true = black out the area)
      annotation.applyRedaction(true);
    }
  }


  /**
   * Download redacted PDF
   */
  downloadRedactedPdf(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
