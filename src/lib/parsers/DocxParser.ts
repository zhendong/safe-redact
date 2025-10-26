import PizZip from 'pizzip';
import mammoth from 'mammoth';
import type { DetectedEntity, DocumentMetadata, ExtractedImage } from '@/lib/types';
import { generateId } from '@/utils/validation';
import { parseDocxDateToIso } from '@/utils/date-parsing';
import { parseXmlSafely } from '@/utils/xml-utils';
import { DOCX_NAMESPACE } from '@/utils/docx-constants';

/**
 * Parsed DOCX document structure
 */
export interface ParsedDocx {
  id: string;
  filename: string;
  fileSize: number;
  fullText: string;
  htmlContent: string; // HTML preview from mammoth
  zip: PizZip; // Keep ZIP for later modification
  documentXml: string; // Original document.xml content
  allEntities: DetectedEntity[];
  hiddenContentReport?: DocxHiddenContentReport;
  metadata?: DocumentMetadata;
}

export interface DocxParseProgress {
  stage: 'loading' | 'parsing' | 'converting' | 'complete';
  progress: number; // 0-100
  message: string;
}

export interface DocxHiddenContentWarning {
  type: DocxHiddenContentType;
  severity: 'high' | 'medium' | 'low';
  description: string;
  locations?: string[];
  count?: number;
  details?: string;
}

export type DocxHiddenContentType =
  | 'hidden_text'
  | 'comments'
  | 'track_changes'
  | 'custom_xml'
  | 'macros'
  | 'field_codes'
  | 'embedded_objects'
  | 'smart_tags'
  | 'alt_text'
  | 'headers_footers'
  | 'bookmarks';

export interface DocxHiddenContentReport {
  hasHiddenContent: boolean;
  warnings: DocxHiddenContentWarning[];
  summary: string;
}

/**
 * Parser for DOCX files
 * - Extracts text for entity detection
 * - Converts to HTML for preview
 * - Maintains ZIP structure for redaction
 */
export class DocxParser {
  private progressCallback?: (progress: DocxParseProgress) => void;

  constructor(progressCallback?: (progress: DocxParseProgress) => void) {
    this.progressCallback = progressCallback;
  }

  /**
   * Parse a DOCX file
   */
  async parseDocx(file: File): Promise<ParsedDocx> {
    this.reportProgress('loading', 10, 'Loading DOCX file...');

    // Read file as ArrayBuffer
    const arrayBuffer = await file.arrayBuffer();

    this.reportProgress('parsing', 30, 'Parsing document structure...');

    // Load with PizZip for later modification
    const zip = new PizZip(arrayBuffer);

    // Extract document.xml
    const documentXml = zip.file('word/document.xml')?.asText();
    if (!documentXml) {
      throw new Error('Invalid DOCX file: word/document.xml not found');
    }

    // Extract full text using PizZip
    const fullText = this.extractText(documentXml);

    this.reportProgress('converting', 60, 'Converting to HTML preview...');

    // Convert to HTML for preview using mammoth
    const htmlContent = await this.convertToHtml(arrayBuffer);

    this.reportProgress('complete', 90, 'Analyzing document structure...');

    const parsedDocx: ParsedDocx = {
      id: generateId('docx'),
      filename: file.name,
      fileSize: file.size,
      fullText,
      htmlContent,
      zip,
      documentXml,
      allEntities: [], // Will be populated by detector
    };

    // Extract images from document
    const images = this.extractImages(zip);

    // Extract metadata and detect hidden content
    const { metadata, hiddenContentReport } = await this.extractMetadata(parsedDocx, images);

    this.reportProgress('complete', 100, 'Document loaded');

    return {
      ...parsedDocx,
      hiddenContentReport,
      metadata,
    };
  }

  /**
   * Extract plain text from document.xml
   */
  private extractText(documentXml: string): string {
    const xmlDoc = parseXmlSafely(documentXml, 'Failed to parse document.xml');

    // Extract all text nodes (w:t elements)
    const textNodes = xmlDoc.getElementsByTagNameNS(DOCX_NAMESPACE, 't');

    const textParts: string[] = [];
    for (let i = 0; i < textNodes.length; i++) {
      const text = textNodes[i].textContent;
      if (text) {
        textParts.push(text);
      }
    }

    return textParts.join(' ');
  }

  /**
   * Convert DOCX to HTML using mammoth
   */
  private async convertToHtml(arrayBuffer: ArrayBuffer): Promise<string> {
    try {
      const result = await mammoth.convertToHtml(
        { arrayBuffer },
        {
          styleMap: [
            // Preserve some basic styling
            "p[style-name='Heading 1'] => h1:fresh",
            "p[style-name='Heading 2'] => h2:fresh",
            "p[style-name='Heading 3'] => h3:fresh",
            "p[style-name='Title'] => h1.title:fresh",
            "p[style-name='List Paragraph'] => p:fresh",
            "b => strong",
            "i => em",
          ],
          ignoreEmptyParagraphs: false,
        }
      );

      // Filter out warnings about unrecognized styles (they don't affect functionality)
      const errors = result.messages.filter(m => m.type === 'error');
      if (errors.length > 0) {
        console.error('Mammoth conversion errors:', errors);
      }

      return result.value;
    } catch (error) {
      console.error('Failed to convert DOCX to HTML:', error);
      throw new Error('Failed to generate document preview');
    }
  }

  /**
   * Extract images from DOCX file
   */
  private extractImages(zip: PizZip): ExtractedImage[] {
    const images: ExtractedImage[] = [];

    try {
      const files = Object.keys(zip.files);

      // Find all media files in word/media/ directory
      const mediaFiles = files.filter(f => f.startsWith('word/media/'));

      for (const mediaPath of mediaFiles) {
        try {
          const file = zip.file(mediaPath);
          if (!file) continue;

          // Get the file data as Uint8Array
          const fileData = file.asUint8Array();

          // Determine MIME type from file extension
          const ext = mediaPath.split('.').pop()?.toLowerCase();
          let mimeType = 'application/octet-stream';

          switch (ext) {
            case 'png':
              mimeType = 'image/png';
              break;
            case 'jpg':
            case 'jpeg':
              mimeType = 'image/jpeg';
              break;
            case 'gif':
              mimeType = 'image/gif';
              break;
            case 'bmp':
              mimeType = 'image/bmp';
              break;
            case 'svg':
              mimeType = 'image/svg+xml';
              break;
            case 'webp':
              mimeType = 'image/webp';
              break;
            case 'tif':
            case 'tiff':
              mimeType = 'image/tiff';
              break;
            default:
              // Skip non-image files
              continue;
          }

          // Convert to Blob
          const blob = new Blob([fileData], { type: mimeType });

          // Extract filename from path
          const filename = mediaPath.split('/').pop() || `image-${images.length + 1}.${ext}`;

          images.push({
            id: `docx-img-${images.length + 1}`,
            filename,
            mimeType,
            data: blob,
            location: mediaPath,
          });

        } catch (error) {
          console.warn(`Failed to extract image ${mediaPath}:`, error);
        }
      }

      console.log(`Extracted ${images.length} image(s) from DOCX`);
      return images;

    } catch (error) {
      console.warn('Failed to extract images from DOCX:', error);
      return images;
    }
  }

  /**
   * Extract metadata and detect hidden content in a single pass
   */
  private async extractMetadata(
    parsedDocx: ParsedDocx,
    images: ExtractedImage[]
  ): Promise<{ metadata: DocumentMetadata; hiddenContentReport: DocxHiddenContentReport }> {
    const metadata: DocumentMetadata = {
      images: images.length > 0 ? images : undefined,
    };
    const { zip } = parsedDocx;

    try {
      // Extract core properties (docProps/core.xml)
      const corePropsFile = zip.file('docProps/core.xml');
      if (corePropsFile) {
        const coreXml = corePropsFile.asText();
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(coreXml, 'text/xml');

        // Extract common metadata fields
        const titleEl = xmlDoc.querySelector('title');
        if (titleEl?.textContent) metadata.title = titleEl.textContent.trim();

        const creatorEl = xmlDoc.querySelector('creator');
        if (creatorEl?.textContent) metadata.author = creatorEl.textContent.trim();

        const subjectEl = xmlDoc.querySelector('subject');
        if (subjectEl?.textContent) metadata.subject = subjectEl.textContent.trim();

        const keywordsEl = xmlDoc.querySelector('keywords');
        if (keywordsEl?.textContent) metadata.keywords = keywordsEl.textContent.trim();

        const lastModifiedByEl = xmlDoc.querySelector('lastModifiedBy');
        if (lastModifiedByEl?.textContent) metadata.modifiedBy = lastModifiedByEl.textContent.trim();

        // Parse date fields to ISO format
        const createdEl = xmlDoc.querySelector('created');
        if (createdEl?.textContent) {
          const isoDate = parseDocxDateToIso(createdEl.textContent);
          if (isoDate) metadata.creationDate = isoDate;
        }

        const modifiedEl = xmlDoc.querySelector('modified');
        if (modifiedEl?.textContent) {
          const isoDate = parseDocxDateToIso(modifiedEl.textContent);
          if (isoDate) metadata.modificationDate = isoDate;
        }
      }

      // Extract app properties (docProps/app.xml)
      const appPropsFile = zip.file('docProps/app.xml');
      if (appPropsFile) {
        const appXml = appPropsFile.asText();
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(appXml, 'text/xml');

        const appEl = xmlDoc.querySelector('Application');
        if (appEl?.textContent) metadata.creator = appEl.textContent.trim();

        const companyEl = xmlDoc.querySelector('Company');
        if (companyEl?.textContent) metadata.company = companyEl.textContent.trim();
      }
    } catch (error) {
      console.warn('Failed to extract DOCX metadata:', error);
    }

    // Detect hidden content
    const warnings: DocxHiddenContentWarning[] = [];

    // 1. Check for hidden text
    const hiddenTextWarning = this.detectHiddenText(zip);
    if (hiddenTextWarning) warnings.push(hiddenTextWarning);

    // 2. Check for comments
    const commentsWarning = this.detectComments(zip);
    if (commentsWarning) warnings.push(commentsWarning);

    // 3. Check for track changes
    const trackChangesWarning = this.detectTrackChanges(zip);
    if (trackChangesWarning) warnings.push(trackChangesWarning);

    // 4. Check for custom XML
    const customXmlWarning = this.detectCustomXml(zip);
    if (customXmlWarning) warnings.push(customXmlWarning);

    // 5. Check for macros
    const macrosWarning = this.detectMacros(zip);
    if (macrosWarning) warnings.push(macrosWarning);

    // 7. Check for field codes
    const fieldCodesWarning = this.detectFieldCodes(zip);
    if (fieldCodesWarning) warnings.push(fieldCodesWarning);

    // 8. Check for embedded objects
    const embeddedWarning = this.detectEmbeddedObjects(zip);
    if (embeddedWarning) warnings.push(embeddedWarning);

    // 9. Check for smart tags
    const smartTagsWarning = this.detectSmartTags(zip);
    if (smartTagsWarning) warnings.push(smartTagsWarning);

    // 10. Check for alternative text
    const altTextWarning = this.detectAltText(zip);
    if (altTextWarning) warnings.push(altTextWarning);

    // 11. Check for headers/footers
    const headersFootersWarning = this.detectHeadersFooters(zip);
    if (headersFootersWarning) warnings.push(headersFootersWarning);

    // 12. Check for bookmarks
    const bookmarksWarning = this.detectBookmarks(zip);
    if (bookmarksWarning) warnings.push(bookmarksWarning);

    const hasHiddenContent = warnings.length > 0;
    const summary = this.generateSummary(warnings);
    const hiddenContentReport: DocxHiddenContentReport = {
      hasHiddenContent,
      warnings,
      summary,
    };
    return { metadata, hiddenContentReport };
  }

    /**
     * Detect hidden text (w:vanish property)
     */
    private detectHiddenText(zip: PizZip): DocxHiddenContentWarning | null {
      try {
        const docFile = zip.file('word/document.xml');
        if (!docFile) return null;
  
        const content = docFile.asText();
  
        // Look for <w:vanish/> or <w:vanish w:val="1"/> or <w:vanish w:val="true"/>
        const vanishMatches = content.match(/<w:vanish(\s+w:val="(1|true)")?\/>/g);
  
        if (vanishMatches && vanishMatches.length > 0) {
          return {
            type: 'hidden_text',
            severity: 'high',
            description: `Found ${vanishMatches.length} instance(s) of hidden text`,
            count: vanishMatches.length,
            details: 'Hidden text is marked with the vanish property and is not visible when viewing the document',
          };
        }
  
        return null;
      } catch (e) {
        console.warn('Failed to detect hidden text:', e);
        return null;
      }
    }
  
    /**
     * Detect comments
     */
    private detectComments(zip: PizZip): DocxHiddenContentWarning | null {
      try {
        const commentsFile = zip.file('word/comments.xml');
        if (!commentsFile) return null;
  
        const content = commentsFile.asText();
  
        // Count comment elements
        const commentMatches = content.match(/<w:comment /g);
        const count = commentMatches ? commentMatches.length : 0;
  
        if (count > 0) {
          return {
            type: 'comments',
            severity: 'medium',
            description: `Found ${count} comment(s) that may contain sensitive information`,
            count,
            details: 'Comments may contain author names, timestamps, and discussion content',
          };
        }
  
        return null;
      } catch (e) {
        console.warn('Failed to detect comments:', e);
        return null;
      }
    }
  
    /**
     * Detect track changes/revisions
     */
    private detectTrackChanges(zip: PizZip): DocxHiddenContentWarning | null {
      try {
        const docFile = zip.file('word/document.xml');
        if (!docFile) return null;
  
        const content = docFile.asText();
  
        // Look for tracked changes elements
        const insertions = content.match(/<w:ins /g);
        const deletions = content.match(/<w:del /g);
        const moves = content.match(/<w:move(From|To) /g);
        const formatChanges = content.match(/<w:(rPr|pPr)Change /g);
  
        const totalChanges =
          (insertions?.length || 0) +
          (deletions?.length || 0) +
          (moves?.length || 0) +
          (formatChanges?.length || 0);
  
        if (totalChanges > 0) {
          const details: string[] = [];
          if (insertions) details.push(`${insertions.length} insertion(s)`);
          if (deletions) details.push(`${deletions.length} deletion(s)`);
          if (moves) details.push(`${moves.length} move(s)`);
          if (formatChanges) details.push(`${formatChanges.length} format change(s)`);
  
          return {
            type: 'track_changes',
            severity: 'high',
            description: `Found ${totalChanges} tracked change(s) that may reveal editing history`,
            count: totalChanges,
            details: details.join(', '),
          };
        }
  
        return null;
      } catch (e) {
        console.warn('Failed to detect track changes:', e);
        return null;
      }
    }
  
    /**
     * Detect custom XML data
     */
    private detectCustomXml(zip: PizZip): DocxHiddenContentWarning | null {
      try {
        const files = Object.keys(zip.files);
        const customXmlFiles = files.filter(f => f.startsWith('customXml/'));
  
        if (customXmlFiles.length > 0) {
          return {
            type: 'custom_xml',
            severity: 'medium',
            description: `Found ${customXmlFiles.length} custom XML file(s) that may contain hidden data`,
            count: customXmlFiles.length,
            locations: customXmlFiles,
            details: 'Custom XML can store application-specific data that is not visible in the document',
          };
        }
  
        return null;
      } catch (e) {
        console.warn('Failed to detect custom XML:', e);
        return null;
      }
    }
  
    /**
     * Detect VBA/Macros
     */
    private detectMacros(zip: PizZip): DocxHiddenContentWarning | null {
      try {
        const vbaFile = zip.file('word/vbaProject.bin');
        const vbaDataFile = zip.file('word/vbaData.xml');
  
        if (vbaFile || vbaDataFile) {
          return {
            type: 'macros',
            severity: 'high',
            description: 'Document contains VBA macros that may execute hidden code',
            details: 'Macros can contain sensitive logic or potentially malicious code',
          };
        }
  
        return null;
      } catch (e) {
        console.warn('Failed to detect macros:', e);
        return null;
      }
    }
  
  
    /**
     * Detect field codes
     */
    private detectFieldCodes(zip: PizZip): DocxHiddenContentWarning | null {
      try {
        const docFile = zip.file('word/document.xml');
        if (!docFile) return null;
  
        const content = docFile.asText();
  
        // Look for field codes (w:fldChar, w:instrText)
        const fieldMatches = content.match(/<w:fldChar w:fldCharType="begin"\/>/g);
        const count = fieldMatches ? fieldMatches.length : 0;
  
        if (count > 0) {
          return {
            type: 'field_codes',
            severity: 'low',
            description: `Found ${count} field code(s) that may contain hidden data`,
            count,
            details: 'Field codes can contain formulas, links, or other dynamic content',
          };
        }
  
        return null;
      } catch (e) {
        console.warn('Failed to detect field codes:', e);
        return null;
      }
    }
  
    /**
     * Detect embedded objects/files
     */
    private detectEmbeddedObjects(zip: PizZip): DocxHiddenContentWarning | null {
      try {
        const files = Object.keys(zip.files);
        const embeddedFiles = files.filter(f => f.startsWith('word/embeddings/'));
  
        if (embeddedFiles.length > 0) {
          return {
            type: 'embedded_objects',
            severity: 'high',
            description: `Found ${embeddedFiles.length} embedded object(s) that may contain sensitive data`,
            count: embeddedFiles.length,
            locations: embeddedFiles,
            details: 'Embedded objects can be OLE objects, Excel sheets, PDFs, or other files',
          };
        }
  
        return null;
      } catch (e) {
        console.warn('Failed to detect embedded objects:', e);
        return null;
      }
    }
  
    /**
     * Detect smart tags
     */
    private detectSmartTags(zip: PizZip): DocxHiddenContentWarning | null {
      try {
        const docFile = zip.file('word/document.xml');
        if (!docFile) return null;
  
        const content = docFile.asText();
  
        // Look for smart tags (w:smartTag)
        const smartTagMatches = content.match(/<w:smartTag /g);
        const count = smartTagMatches ? smartTagMatches.length : 0;
  
        if (count > 0) {
          return {
            type: 'smart_tags',
            severity: 'low',
            description: `Found ${count} smart tag(s) that may contain metadata`,
            count,
            details: 'Smart tags can store additional semantic information about content',
          };
        }
  
        return null;
      } catch (e) {
        console.warn('Failed to detect smart tags:', e);
        return null;
      }
    }
  
    /**
     * Detect alternative text in images/shapes
     */
    private detectAltText(zip: PizZip): DocxHiddenContentWarning | null {
      try {
        const docFile = zip.file('word/document.xml');
        if (!docFile) return null;
  
        const content = docFile.asText();
  
        // Look for alternative text descriptions (wp:docPr with descr attribute)
        const altTextMatches = content.match(/descr="[^"]+"/g);
        const count = altTextMatches ? altTextMatches.length : 0;
  
        if (count > 0) {
          return {
            type: 'alt_text',
            severity: 'low',
            description: `Found ${count} image(s)/shape(s) with alternative text`,
            count,
            details: 'Alternative text descriptions may contain sensitive information',
          };
        }
  
        return null;
      } catch (e) {
        console.warn('Failed to detect alt text:', e);
        return null;
      }
    }
  
    /**
     * Detect headers and footers
     */
    private detectHeadersFooters(zip: PizZip): DocxHiddenContentWarning | null {
      try {
        const files = Object.keys(zip.files);
        const headerFooterFiles = files.filter(
          f => f.startsWith('word/header') || f.startsWith('word/footer')
        );
  
        if (headerFooterFiles.length > 0) {
          return {
            type: 'headers_footers',
            severity: 'low',
            description: `Found ${headerFooterFiles.length} header(s)/footer(s)`,
            count: headerFooterFiles.length,
            locations: headerFooterFiles,
            details: 'Headers and footers may contain sensitive information like author names or file paths',
          };
        }
  
        return null;
      } catch (e) {
        console.warn('Failed to detect headers/footers:', e);
        return null;
      }
    }
  
    /**
     * Detect bookmarks
     */
    private detectBookmarks(zip: PizZip): DocxHiddenContentWarning | null {
      try {
        const docFile = zip.file('word/document.xml');
        if (!docFile) return null;
  
        const content = docFile.asText();
  
        // Look for bookmark start elements
        const bookmarkMatches = content.match(/<w:bookmarkStart /g);
        const count = bookmarkMatches ? bookmarkMatches.length : 0;
  
        if (count > 0) {
          return {
            type: 'bookmarks',
            severity: 'low',
            description: `Found ${count} bookmark(s)`,
            count,
            details: 'Bookmarks may reveal document structure or navigation hints',
          };
        }
  
        return null;
      } catch (e) {
        console.warn('Failed to detect bookmarks:', e);
        return null;
      }
    }

      /**
       * Generate a human-readable summary
       */
      private generateSummary(warnings: DocxHiddenContentWarning[]): string {
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
      static hasWarningType(
        report: DocxHiddenContentReport,
        type: DocxHiddenContentType
      ): boolean {
        return report.warnings.some(w => w.type === type);
      }
    
      /**
       * Get all warnings of a specific severity
       */
      static getWarningsBySeverity(
        report: DocxHiddenContentReport,
        severity: 'high' | 'medium' | 'low'
      ): DocxHiddenContentWarning[] {
        return report.warnings.filter(w => w.severity === severity);
      }

  /**
   * Report progress to callback
   */
  private reportProgress(stage: DocxParseProgress['stage'], progress: number, message: string) {
    if (this.progressCallback) {
      this.progressCallback({ stage, progress, message });
    }
  }
}
