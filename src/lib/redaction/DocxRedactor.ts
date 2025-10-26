import { saveAs } from 'file-saver';
import type { DetectedEntity, RedactionResult } from '@/lib/types';
import type { ParsedDocx } from '@/lib/parsers/DocxParser';
import { DocumentSanitizer } from '@/lib/sanitize/DocumentSanitizer';
import { generateRedactedFilename } from '@/utils/file-utils';
import { parseXmlSafely, serializeXml } from '@/utils/xml-utils';
import { DOCX_NAMESPACE } from '@/utils/docx-constants';

/**
 * DOCX Redactor
 * Removes sensitive text from DOCX files by modifying the XML
 */
export class DocxRedactor {
  /**
   * Apply redactions to DOCX file
   * Completely removes confirmed entities from the document
   */
  async applyRedactions(
    file: File,
    document: ParsedDocx,
    entities: DetectedEntity[],
    progressCallback?: (progress: number, message: string) => void,
    sanitize: boolean = false
  ): Promise<RedactionResult> {
    const startTime = Date.now();

    try {
      progressCallback?.(10, 'Preparing redactions...');

      // Filter only confirmed entities
      const confirmedEntities = entities.filter(e => e.status === 'confirmed');

      if (confirmedEntities.length === 0) {
        return {
          success: false,
          error: 'No entities confirmed for redaction',
          redactedCount: 0,
          processingTime: Date.now() - startTime,
        };
      }

      progressCallback?.(30, 'Removing sensitive text...');

      // Remove entities from document.xml
      const modifiedXml = this.removeEntitiesFromXml(
        document.documentXml,
        confirmedEntities
      );

      progressCallback?.(60, 'Creating modified DOCX...');

      // Update the ZIP with modified XML
      let zip = document.zip;
      zip.file('word/document.xml', modifiedXml);

      // Apply sanitization if requested
      if (sanitize) {
        progressCallback?.(70, 'Sanitizing document metadata...');
        const sanitizer = new DocumentSanitizer();
        zip = await sanitizer.sanitizeDocx(document);
      }

      progressCallback?.(80, 'Generating file...');

      // Generate new DOCX blob
      const blob = zip.generate({
        type: 'blob',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });

      progressCallback?.(100, 'Complete');

      return {
        success: true,
        pdfBlob: blob, // Reusing the field name for consistency
        redactedCount: confirmedEntities.length,
        processingTime: Date.now() - startTime,
      };
    } catch (error) {
      console.error('DOCX redaction error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Redaction failed',
        redactedCount: 0,
        processingTime: Date.now() - startTime,
      };
    }
  }

  /**
   * Remove entities from XML by replacing their text content with [REDACTED]
   * Preserves document structure, spacing, and line breaks
   */
  private removeEntitiesFromXml(
    documentXml: string,
    entities: DetectedEntity[]
  ): string {
    const xmlDoc = parseXmlSafely(documentXml, 'Failed to parse document.xml');

    // Get all text content first to build position map
    const textNodes = xmlDoc.getElementsByTagNameNS(DOCX_NAMESPACE, 't');
    let fullText = '';
    const nodeMap: Array<{ node: Element; start: number; end: number; text: string }> = [];

    for (let i = 0; i < textNodes.length; i++) {
      const node = textNodes[i];
      const text = node.textContent || '';
      const start = fullText.length;
      const end = start + text.length;
      nodeMap.push({ node, start, end, text });
      fullText += text;
      // Add space between text nodes to match parser's join(' ')
      if (i < textNodes.length - 1) {
        fullText += ' ';
      }
    }

    // Sort entities by position (reverse order to avoid offset issues)
    const sortedEntities = [...entities].sort((a, b) =>
      b.position.textIndex - a.position.textIndex
    );

    for (const entity of sortedEntities) {
      const entityStart = entity.position.textIndex;
      const entityEnd = entityStart + entity.text.length;

      // Skip if entity text is empty or invalid
      if (!entity.text || entity.text.length === 0) {
        console.warn('Skipping entity with empty text:', entity);
        continue;
      }

      // Find all nodes that contain this entity
      const affectedNodes: Array<{ nodeInfo: typeof nodeMap[0]; relativeStart: number; relativeEnd: number }> = [];

      for (const nodeInfo of nodeMap) {
        // Check if this node overlaps with the entity
        if (nodeInfo.start < entityEnd && nodeInfo.end > entityStart) {
          const relativeStart = Math.max(0, entityStart - nodeInfo.start);
          const relativeEnd = Math.min(nodeInfo.text.length, entityEnd - nodeInfo.start);

          if (relativeStart < nodeInfo.text.length && relativeEnd > 0 && relativeEnd > relativeStart) {
            affectedNodes.push({ nodeInfo, relativeStart, relativeEnd });
          }
        }
      }

      // Apply redaction: only add [REDACTED] in the first affected node
      for (let i = 0; i < affectedNodes.length; i++) {
        const { nodeInfo, relativeStart, relativeEnd } = affectedNodes[i];
        const nodeText = nodeInfo.text;

        if (i === 0) {
          // First node: keep before text, add redaction label, remove after if entity continues
          const before = nodeText.substring(0, relativeStart);
          const after = relativeEnd < nodeText.length ? nodeText.substring(relativeEnd) : '';
          const redactionLabel = `[${entity.entityType}]`;
          const redactedText = before + redactionLabel + after;
          nodeInfo.node.textContent = redactedText;
          nodeInfo.text = redactedText;
        } else {
          // Subsequent nodes: remove the entity portion without adding label
          const before = nodeText.substring(0, relativeStart);
          const after = relativeEnd < nodeText.length ? nodeText.substring(relativeEnd) : '';
          const redactedText = before + after;
          nodeInfo.node.textContent = redactedText;
          nodeInfo.text = redactedText;
        }
      }
    }

    // Serialize back to string
    return serializeXml(xmlDoc);
  }

  /**
   * Download redacted DOCX file
   */
  downloadRedactedDocx(blob: Blob, filename: string): void {
    const redactedFilename = generateRedactedFilename(filename);
    saveAs(blob, redactedFilename);
  }
}
