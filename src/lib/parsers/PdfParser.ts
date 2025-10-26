import * as mupdf from 'mupdf';
import type { ProcessedDocument, ProcessedPage, TextItem, FormFieldData, DocumentMetadata, ExtractedImage } from '@/lib/types';
import { generateId } from '@/utils/validation';
import { parsePdfDateToIso } from '@/utils/date-parsing';

export interface ParseProgress {
  stage: 'loading' | 'parsing' | 'complete';
  progress: number;
  currentPage?: number;
  totalPages?: number;
  message: string;
}

export interface HiddenContentWarning {
  type: HiddenContentType;
  severity: 'high' | 'medium' | 'low';
  description: string;
  pageNumbers?: number[];
  count?: number;
  details?: string;
}

export type HiddenContentType =
  | 'ocg_layers'
  | 'hidden_annotations'
  | 'form_fields'
  | 'embedded_files'
  | 'javascript'
  | 'transparent_objects'
  | 'offpage_content';

export interface HiddenContentReport {
  hasHiddenContent: boolean;
  warnings: HiddenContentWarning[];
  summary: string;
}

interface StructuredTextBlock {
  type: string;
  bbox?: {
    x: number;
    y: number;
    w: number;
    h: number;
  };
  lines?: StructuredTextLine[];
}

interface StructuredTextLine {
  bbox?: {
    x: number;
    y: number;
    w: number;
    h: number;
  };
  text: string;
  x: number;
  y: number;
  wmode?: number;
  font?: {
    name: string;
    family: string;
    weight: string;
    style: string;
    size: number;
  };
}

export class PdfParser {
  private onProgress?: (progress: ParseProgress) => void;
  private pdfDocument: any = null;

  constructor(onProgress?: (progress: ParseProgress) => void) {
    this.onProgress = onProgress;
  }

  /**
   * Parse a PDF file and extract text with coordinates
   */
  async parsePdf(file: File): Promise<ProcessedDocument> {
    const startTime = Date.now();

    this.reportProgress({
      stage: 'loading',
      progress: 0,
      message: 'Loading PDF...',
    });

    try {
      // Load the PDF document
      const arrayBuffer = await file.arrayBuffer();

      // Note: MuPDF may log warnings about repairing malformed PDFs
      // This is normal behavior - the library automatically fixes structural issues
      this.pdfDocument = mupdf.PDFDocument.openDocument(
        new Uint8Array(arrayBuffer),
        'application/pdf'
      );

      // Check if document was repaired
      const wasRepaired = this.pdfDocument.wasRepaired?.();
      if (wasRepaired) {
        console.log('PDF was automatically repaired (had structural issues)');
      }

      const pageCount = this.pdfDocument.countPages();

      // IMPORTANT: Enable all layers to ensure complete text extraction
      // Hidden layers might contain sensitive content that needs redaction
      const layerCount = this.pdfDocument.countLayers?.();
      if (layerCount && layerCount > 0) {
        for (let i = 0; i < layerCount; i++) {
          try {
            this.pdfDocument.setLayerVisible?.(i, true);
          } catch (e) {
            console.warn(`Failed to enable layer ${i}:`, e);
          }
        }
        console.log(`Enabled ${layerCount} layer(s) for complete text extraction`);
      }

      this.reportProgress({
        stage: 'loading',
        progress: 10,
        totalPages: pageCount,
        message: 'PDF loaded successfully',
      });

      // Parse all pages and collect hidden content stats
      const pages: ProcessedPage[] = [];
      const pageStats = {
        annotationPages: [] as number[],
        totalAnnotations: 0,
        formFieldPages: [] as number[],
        totalFormFields: 0,
      };

      for (let i = 0; i < pageCount; i++) {
        const page = this.pdfDocument.loadPage(i);

        // Collect hidden content stats during parsing
        const annots = page.getAnnotations();
        if (annots && annots.length > 0) {
          pageStats.annotationPages.push(i + 1);
          pageStats.totalAnnotations += annots.length;
        }

        const widgets = page.getWidgets?.();
        if (widgets && widgets.length > 0) {
          pageStats.formFieldPages.push(i + 1);
          pageStats.totalFormFields += widgets.length;
        }

        const processedPage = await this.parsePageFromObject(page, i, i + 1);
        pages.push(processedPage);

        const progress = 10 + ((i + 1) / pageCount * 80);
        this.reportProgress({
          stage: 'parsing',
          progress,
          currentPage: i + 1,
          totalPages: pageCount,
          message: `Parsing page ${i + 1} of ${pageCount}...`,
        });
      }

      this.reportProgress({
        stage: 'complete',
        progress: 90,
        message: 'Analyzing document structure...',
      });

      // Extract metadata and detect hidden content
      const { metadata, hiddenContentReport } = await this.extractMetadata(pageStats);

        // Append image metadata if images were found
        const allImages: ExtractedImage[] = pages.flatMap(page => page.images ?? []);
        if (allImages.length > 0) {
          metadata.images = allImages.map(img => ({
            id: img.id,
            filename: img.filename,
            mimeType: img.mimeType,
            data: img.data,
            width: img.width,
            height: img.height,
            pageNumber: img.pageNumber,
          }));
          console.log(`Successfully extracted ${allImages.length} image(s) from PDF`);
        } else {
          console.debug('No images found in PDF');
        }

      this.reportProgress({
        stage: 'complete',
        progress: 100,
        message: 'PDF parsing complete',
      });

      const processingTime = Date.now() - startTime;

      return {
        id: generateId(),
        filename: file.name,
        fileSize: file.size,
        pageCount,
        pages,
        allEntities: [],
        processingTime,
        createdAt: Date.now(),
        hiddenContentReport,
        metadata,
      };
    } catch (error) {
      console.error('PDF parsing error:', error);
      throw new Error(`Failed to parse PDF: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Parse a single page from a page object
   */
  private async parsePageFromObject(
    page: any,
    pageIndex: number,
    pageNumber: number
  ): Promise<ProcessedPage> {
    const bounds = page.getBounds();

    // Get page dimensions (bounds is [x0, y0, x1, y1])
    const width = bounds[2] - bounds[0];
    const height = bounds[3] - bounds[1];

    // Extract structured text with coordinates
    const structuredText = page.toStructuredText('preserve-whitespace,accurate-bboxes,preserve-images');
    const jsonString = structuredText.asJSON();
    const parsedJSON = JSON.parse(jsonString);

    // The JSON structure has a blocks array
    const blocks = parsedJSON.blocks || [];

    // Extract text items
    const textItems = this.extractTextItems(blocks, height);

    // Extract images
    const images = this.extractImages(structuredText, pageNumber);

    // Combine text items into continuous text
    const combinedText = this.combineTextItems(textItems);
    console.debug('Extracted text %s for page %d', combinedText, pageNumber);
    // Extract form fields if available
    const formFields = this.extractFormFields(page, height);
    console.debug('Extracted %d form fields for page %d', formFields.length, pageNumber);

    return {
      pageNumber,
      textContent: combinedText,
      textItems,
      entities: [],
      pdfPageObject: page,
      viewport: { width, height },
      dimensions: {
        width,
        height,
      },
      formFields,
      images
    };
  }

  private extractImages(structuredText: mupdf.StructuredText, pageNumber: number): ExtractedImage[] {
    console.debug('Starting image extraction from PDF pages');
    const images: ExtractedImage[] = [];
    let imageIndex = 0;

    structuredText.walk({
      onImageBlock: function (bbox: mupdf.Rect, _transform: mupdf.Matrix, image: mupdf.Image) {
        try {
          console.log("Found image in Page", pageNumber);

          // Get image dimensions
          const width = image.getWidth();
          const height = image.getHeight();

          // Convert Image to Pixmap to PNG
          const pixmap = image.toPixmap();
          const pngData = pixmap.asPNG();

          // Convert Uint8Array to Blob
          const blob = new Blob([pngData], { type: 'image/png' });

          // Convert bbox (Rect) to BoundingBox format
          // mupdf.Rect is [x0, y0, x1, y1]
          const boundingBox = {
            x: bbox[0],
            y: bbox[1],
            width: bbox[2] - bbox[0],
            height: bbox[3] - bbox[1],
          };

          imageIndex++;
          images.push({
            id: generateId(),
            filename: `image-page${pageNumber}-${imageIndex}.png`,
            mimeType: 'image/png',
            data: blob,
            width,
            height,
            pageNumber,
            bbox: boundingBox,
          });

          console.log(`Successfully extracted image ${imageIndex} from page ${pageNumber} (${width}x${height})`);
        } catch (error) {
          console.error(`Failed to extract image from page ${pageNumber}:`, error);
        }
      }
    });

    return images;
  }

  /**
   * Extract text items from MuPDF structured text
   */
  private extractTextItems(blocks: StructuredTextBlock[], pageHeight: number): TextItem[] {
    const items: TextItem[] = [];

    for (const block of blocks) {
      if (block.type === 'text' && block.lines) {
        for (const line of block.lines) {
          if (line.text && line.bbox) {
            // Split the line text into words
            const words = line.text.trim().split(/\s+/);
            const lineWidth = line.bbox.w;
            const avgWordWidth = lineWidth / (words.length || 1);

            words.forEach((word, index) => {
              if (word) {
                // Estimate word position within the line
                const wordX = line.bbox!.x + (index * avgWordWidth);
                const wordWidth = (word.length / line.text.length) * lineWidth;

                items.push(this.createTextItem(
                  word,
                  wordX,
                  line.bbox!.y,
                  wordWidth,
                  line.bbox!.h,
                  pageHeight,
                  line.font?.name || ''
                ));
              }
            });
          }
        }
      }
    }

    return items;
  }

  /**
   * Create a TextItem from line data
   */
  private createTextItem(
    text: string,
    x: number,
    y: number,
    width: number,
    height: number,
    pageHeight: number,
    fontName: string
  ): TextItem {
    // Convert MuPDF coordinates (top-left origin) to PDF.js-style (bottom-left origin)
    const transformY = pageHeight - y - height;

    // Transform matrix: [a, b, c, d, e, f]
    // For simple text: [scaleX, skewY, skewX, scaleY, translateX, translateY]
    const transform = [1, 0, 0, 1, x, transformY];

    return {
      str: text,
      transform,
      width,
      height,
      fontName,
    };
  }

  /**
   * Combine text items into continuous text
   */
  private combineTextItems(items: TextItem[]): string {
    let text = '';
    let lastY = 0;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const currentY = item.transform[5];

      // Add newline if we're on a different line
      if (i > 0 && Math.abs(currentY - lastY) > 5) {
        text += '\n';
      }
      // Add space if we're on the same line
      else if (i > 0 && text.length > 0 && !text.endsWith(' ')) {
        text += ' ';
      }

      text += item.str;
      lastY = currentY;
    }

    return text;
  }

  /**
   * Extract form fields from a PDF page
   */
  private extractFormFields(page: any, pageHeight: number): FormFieldData[] {
    const formFields: FormFieldData[] = [];

    try {
      // Get widgets (form fields) from the page
      const widgets = page.getWidgets?.();

      if (!widgets || widgets.length === 0) {
        return formFields;
      }

      for (const widget of widgets) {
        try {
          const name = widget.getName?.() || '';
          const label = widget.getLabel?.() || '';
          const value = widget.getValue?.() || '';
          const fieldType = widget.getFieldType?.() || '';
          const flags = widget.getFieldFlags?.() || 0;

          // Get widget bounds (in PDF coordinates)
          const rect = widget.getRect?.();
          const bounds = rect ? {
            x: rect[0],
            y: pageHeight - rect[3], // Convert to bottom-left origin
            width: rect[2] - rect[0],
            height: rect[3] - rect[1],
          } : { x: 0, y: 0, width: 0, height: 0 };

          // Check field type
          const isButton = widget.isButton?.() || false;
          const isText = widget.isText?.() || false;
          const isChoice = widget.isChoice?.() || false;
          const isReadOnly = widget.isReadOnly?.() || false;

          // Get options for choice fields
          let options: string[] | undefined;
          if (isChoice) {
            try {
              options = widget.getOptions?.() || [];
            } catch (e) {
              console.warn('Failed to get options for choice field:', e);
            }
          }

          // Get max length for text fields
          let maxLength: number | undefined;
          if (isText) {
            try {
              maxLength = widget.getMaxLen?.() || undefined;
            } catch (e) {
              console.warn('Failed to get max length for text field:', e);
            }
          }

          // Check if required (bit 1 of flags)
          const isRequired = (flags & 2) !== 0;

          formFields.push({
            name,
            label,
            value,
            fieldType,
            flags,
            isReadOnly,
            isRequired,
            isButton,
            isText,
            isChoice,
            options,
            maxLength,
            bounds,
          });
        } catch (error) {
          console.warn('Failed to extract form field data:', error);
        }
      }
    } catch (error) {
      console.warn('Failed to get widgets from page:', error);
    }

    return formFields;
  }


  /**
   * Extract metadata and detect hidden content in a single pass
   */
  private async extractMetadata(
    pageStats: {
      annotationPages: number[];
      totalAnnotations: number;
      formFieldPages: number[];
      totalFormFields: number;
    }
    ): Promise<{
    metadata: DocumentMetadata;
    hiddenContentReport: any;
  }> {
    const metadata: DocumentMetadata = {};

    if (!this.pdfDocument) {
      return { metadata, hiddenContentReport: undefined };
    }

    try {
      const metadataKeys = [
        { key: 'info:Title', prop: 'title', isDate: false },
        { key: 'info:Author', prop: 'author', isDate: false },
        { key: 'info:Subject', prop: 'subject', isDate: false },
        { key: 'info:Keywords', prop: 'keywords', isDate: false },
        { key: 'info:Creator', prop: 'creator', isDate: false },
        { key: 'info:Producer', prop: 'producer', isDate: false },
        { key: 'info:CreationDate', prop: 'creationDate', isDate: true },
        { key: 'info:ModDate', prop: 'modificationDate', isDate: true },
      ];

      for (const { key, prop, isDate } of metadataKeys) {
        try {
          const value = this.pdfDocument.getMetaData?.(key);
          if (value && value.trim() !== '') {
            // Parse PDF dates to ISO format for consistent storage
            if (isDate) {
              const isoDate = parsePdfDateToIso(value);
              if (isoDate) {
                metadata[prop] = isoDate;
              }
            } else {
              metadata[prop] = value.trim();
            }
          }
        } catch (e) {
          // Silently ignore errors for individual metadata fields
        }
      }
    } catch (error) {
      console.warn('Failed to extract PDF metadata:', error);
    }

    // Detect hidden content (pass pageStats to avoid re-scanning)
    // const detector = new HiddenContentDetector();
    const warnings: HiddenContentWarning[] = [];

    // 1. Check for Optional Content Groups (Layers)
    const ocgWarning = this.detectOptionalContentGroups(this.pdfDocument);
    if (ocgWarning) warnings.push(ocgWarning);

    // 2. Check for annotations (use pre-collected stats if available)
    const annotWarning = pageStats
      ? this.createAnnotationWarningFromStats(pageStats)
      : this.detectAnnotations(this.pdfDocument);
    if (annotWarning) warnings.push(annotWarning);

    // 3. Check for form fields (use pre-collected stats if available)
    const formWarning = pageStats
      ? this.createFormFieldWarningFromStats(pageStats)
      : this.detectFormFields(this.pdfDocument);
    if (formWarning) warnings.push(formWarning);

    // 4. Check for embedded files
    const embedWarning = this.detectEmbeddedFiles(this.pdfDocument);
    if (embedWarning) warnings.push(embedWarning);

    // 5. Check for JavaScript
    const jsWarning = this.detectJavaScript(this.pdfDocument);
    if (jsWarning) warnings.push(jsWarning);

    // 6. Check for transparent/invisible objects
    const transparentWarning = this.detectTransparentObjects(this.pdfDocument);
    if (transparentWarning) warnings.push(transparentWarning);

    // 7. Check for off-page content
    const offpageWarning = this.detectOffPageContent(this.pdfDocument);
    if (offpageWarning) warnings.push(offpageWarning);

    const hasHiddenContent = warnings.length > 0;
    const summary = this.generateSummary(warnings);

    const hiddenContentReport: HiddenContentReport = {
      hasHiddenContent,
      warnings,
      summary,
    };

    return { metadata, hiddenContentReport };
  }

    /**
     * Detect Optional Content Groups (PDF Layers)
     */
    private detectOptionalContentGroups(pdfDocument: any): HiddenContentWarning | null {
      try {
        // MuPDF provides countLayers() method to detect OCG layers
        const layerCount = pdfDocument.countLayers?.();
  
        if (layerCount === undefined || layerCount === null) {
          // Method not available or not a PDFDocument
          return null;
        }
  
        if (layerCount === 0) {
          // No layers present
          return null;
        }
  
        // Get information about each layer
        const layerInfo: string[] = [];
        const hiddenLayers: string[] = [];
  
        for (let i = 0; i < layerCount; i++) {
          try {
            const layerName = pdfDocument.getLayerName?.(i) || `Layer ${i}`;
            const isVisible = pdfDocument.isLayerVisible?.(i);
  
            layerInfo.push(layerName);
  
            if (isVisible === false) {
              hiddenLayers.push(layerName);
            }
          } catch (e) {
            console.warn(`Failed to get info for layer ${i}:`, e);
          }
        }
  
        return {
          type: 'ocg_layers',
          severity: 'high',
          description: `Document contains ${layerCount} Optional Content Group(s) (layers) that can hide/show content`,
          count: layerCount,
          details: hiddenLayers.length > 0
            ? `Found ${hiddenLayers.length} hidden layer(s): ${hiddenLayers.join(', ')}. Enable "Sanitize Document" to remove all layers when exporting.`
            : `All ${layerCount} layers are currently visible. Enable "Sanitize Document" to remove all layers when exporting.`,
        };
  
      } catch (e) {
        console.warn('Failed to detect OCG layers:', e);
        return null;
      }
    }
  
    /**
     * Create annotation warning from pre-collected stats
     */
    private createAnnotationWarningFromStats(pageStats: {
      annotationPages: number[];
      totalAnnotations: number;
    }): HiddenContentWarning | null {
      if (pageStats.totalAnnotations === 0) {
        return null;
      }
  
      return {
        type: 'hidden_annotations',
        severity: 'medium',
        description: `Found ${pageStats.totalAnnotations} annotation(s) that may contain hidden information`,
        pageNumbers: pageStats.annotationPages,
        count: pageStats.totalAnnotations,
        details: 'Annotations like comments, highlights, and markup may contain sensitive data',
      };
    }
  
    /**
     * Detect annotations (comments, markup, etc.)
     */
    private detectAnnotations(pdfDocument: any): HiddenContentWarning | null {
      try {
        const pageCount = pdfDocument.countPages();
        let totalAnnotations = 0;
        const pagesWithAnnotations: number[] = [];
  
        for (let i = 0; i < pageCount; i++) {
          const page = pdfDocument.loadPage(i);
          const annots = page.getAnnotations();
  
          if (annots && annots.length > 0) {
            totalAnnotations += annots.length;
            pagesWithAnnotations.push(i + 1);
          }
        }
  
        if (totalAnnotations > 0) {
          return {
            type: 'hidden_annotations',
            severity: 'medium',
            description: `Found ${totalAnnotations} annotation(s) that may contain hidden information`,
            pageNumbers: pagesWithAnnotations,
            count: totalAnnotations,
            details: 'Annotations like comments, highlights, and markup may contain sensitive data',
          };
        }
  
        return null;
      } catch (e) {
        console.warn('Failed to detect annotations:', e);
        return null;
      }
    }
  
    /**
     * Create form field warning from pre-collected stats
     */
    private createFormFieldWarningFromStats(pageStats: {
      formFieldPages: number[];
      totalFormFields: number;
    }): HiddenContentWarning | null {
      if (pageStats.totalFormFields === 0) {
        return null;
      }
  
      return {
        type: 'form_fields',
        severity: 'medium',
        description: `Found ${pageStats.totalFormFields} form field(s) that may contain hidden or user-entered data`,
        pageNumbers: pageStats.formFieldPages,
        count: pageStats.totalFormFields,
        details: 'Form fields can contain sensitive user input that is not visible when viewing the document',
      };
    }
  
    /**
     * Detect form fields
     */
    private detectFormFields(pdfDocument: any): HiddenContentWarning | null {
      try {
        const pageCount = pdfDocument.countPages();
        let totalWidgets = 0;
        const pagesWithWidgets: number[] = [];
  
        for (let i = 0; i < pageCount; i++) {
          const page = pdfDocument.loadPage(i);
          const widgets = page.getWidgets?.();
  
          if (widgets && widgets.length > 0) {
            totalWidgets += widgets.length;
            pagesWithWidgets.push(i + 1);
          }
        }
  
        if (totalWidgets > 0) {
          return {
            type: 'form_fields',
            severity: 'medium',
            description: `Found ${totalWidgets} form field(s) that may contain hidden or user-entered data`,
            pageNumbers: pagesWithWidgets,
            count: totalWidgets,
            details: 'Form fields can contain sensitive user input that is not visible when viewing the document',
          };
        }
  
        return null;
      } catch (e) {
        console.warn('Failed to detect form fields:', e);
        return null;
      }
    }
  
    /**
     * Detect embedded files
     */
    private detectEmbeddedFiles(pdfDocument: any): HiddenContentWarning | null {
      try {
        // MuPDF provides getEmbeddedFiles() which returns an object (dictionary)
        // Keys are file names, values are file spec objects
        const embeddedFiles = pdfDocument.getEmbeddedFiles?.();
  
        if (!embeddedFiles) {
          return null;
        }
  
        // Get file names from object keys
        const fileNames = Object.keys(embeddedFiles);
  
        if (fileNames.length === 0) {
          return null;
        }
  
        return {
          type: 'embedded_files',
          severity: 'high',
          description: `Found ${fileNames.length} embedded file(s) that may contain sensitive information`,
          count: fileNames.length,
          details: `Embedded files: ${fileNames.slice(0, 5).join(', ')}${fileNames.length > 5 ? ` and ${fileNames.length - 5} more...` : ''}`,
        };
      } catch (e) {
        console.warn('Failed to detect embedded files:', e);
        return null;
      }
    }
  
    /**
     * Detect JavaScript actions
     */
    private detectJavaScript(pdfDocument: any): HiddenContentWarning | null {
      try {
        // Check if document has JavaScript support enabled
        const hasJS = pdfDocument.isJSSupported?.();
  
        if (!hasJS) {
          // No JS support means no JS in document
          return null;
        }
  
        // MuPDF doesn't provide a direct way to enumerate all JS
        // We need to check the Names tree for JavaScript entries
        // This is a heuristic check - look for /JavaScript in catalog
  
        try {
          const trailer = pdfDocument.getTrailer();
          const catalog = trailer?.get('Root');
  
          if (catalog) {
            const names = catalog.get('Names');
            if (names) {
              const js = names.get('JavaScript');
              if (js) {
                return {
                  type: 'javascript',
                  severity: 'high',
                  description: 'Document contains JavaScript that may manipulate content visibility or behavior',
                  details: 'JavaScript can be used to hide/show content dynamically or collect data. Enable "Sanitize Document" to remove JavaScript.',
                };
              }
            }
          }
        } catch (e) {
          // If we can't check, be cautious if JS is supported
          console.warn('Could not check for JavaScript:', e);
        }
  
        return null;
      } catch (e) {
        console.warn('Failed to detect JavaScript:', e);
        return null;
      }
    }
  
    /**
     * Detect transparent or invisible objects
     */
    private detectTransparentObjects(pdfDocument: any): HiddenContentWarning | null {
      try {
        // Detecting transparent/invisible text requires parsing content streams
        // This is complex as we need to:
        // 1. Parse page content streams
        // 2. Look for text rendering mode 3 (invisible)
        // 3. Check for transparency groups with alpha=0
        // 4. Check for white text on white background
  
        // MuPDF doesn't provide a high-level API for this
        // We would need to parse the content stream manually
        // For now, we'll skip this detection as it requires deep PDF parsing
  
        // Note: This is a limitation - transparent objects won't be detected
        // Users should be warned in documentation
  
        return null;
      } catch (e) {
        console.warn('Failed to detect transparent objects:', e);
        return null;
      }
    }
  
    /**
     * Detect content outside page boundaries
     */
    private detectOffPageContent(pdfDocument: any): HiddenContentWarning | null {
      try {
        // Detecting off-page content requires:
        // 1. Getting page bounds (media box, crop box)
        // 2. Parsing all text items and graphics
        // 3. Checking if coordinates fall outside bounds
  
        // This is also complex and would require parsing content streams
        // MuPDF's toStructuredText() gives us visible text only
        // Hidden off-page content won't be in structured text
  
        // For now, we'll skip this as it requires content stream parsing
        // Note: This is another limitation
  
        return null;
      } catch (e) {
        console.warn('Failed to detect off-page content:', e);
        return null;
      }
    }
  
    /**
     * Generate a human-readable summary
     */
    private generateSummary(warnings: HiddenContentWarning[]): string {
      if (warnings.length === 0) {
        return 'No hidden content detected.';
      }
  
      const highSeverity = warnings.filter(w => w.severity === 'high').length;
      const mediumSeverity = warnings.filter(w => w.severity === 'medium').length;
      const lowSeverity = warnings.filter(w => w.severity === 'low').length;
  
      let summary = `Found ${warnings.length} potential hidden content issue(s): `;
  
      const parts: string[] = [];
      if (highSeverity > 0) parts.push(`${highSeverity} high severity`);
      if (mediumSeverity > 0) parts.push(`${mediumSeverity} medium severity`);
      if (lowSeverity > 0) parts.push(`${lowSeverity} low severity`);
  
      summary += parts.join(', ');
      summary += '. Enable "Sanitize Document" to remove hidden content.';
  
      return summary;
    }
  
    /**
     * Check if a specific warning type exists in the report
     */
    static hasWarningType(report: HiddenContentReport, type: HiddenContentType): boolean {
      return report.warnings.some(w => w.type === type);
    }
  
    /**
     * Get all warnings of a specific severity
     */
    static getWarningsBySeverity(
      report: HiddenContentReport,
      severity: 'high' | 'medium' | 'low'
    ): HiddenContentWarning[] {
      return report.warnings.filter(w => w.severity === severity);
    }

  /**
   * Report progress to callback
   */
  private reportProgress(progress: ParseProgress): void {
    if (this.onProgress) {
      this.onProgress(progress);
    }
  }

  /**
   * Get the PDF document instance (for rendering)
   */
  getPdfDocument(): any {
    return this.pdfDocument;
  }
}
