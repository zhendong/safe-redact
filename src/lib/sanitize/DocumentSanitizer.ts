import PizZip from 'pizzip';
import type { ParsedDocx } from '@/lib/parsers/DocxParser';
import { PDF_METADATA_KEYS_ARRAY } from '@/utils/pdf-constants';
import { parseXmlSafely, serializeXml, removeElements, unwrapElements } from '@/utils/xml-utils';
import { DOCX_NAMESPACE } from '@/utils/docx-constants';

/**
 * DocumentSanitizer - Removes sensitive metadata and hidden content from documents
 *
 * Handles both PDF and DOCX formats to strip:
 * - Metadata (author, title, dates, etc.)
 * - Comments and annotations
 * - Hidden content
 * - Track changes
 * - Embedded files
 * - And more...
 */
export class DocumentSanitizer {

  /**
   * Sanitize PDF metadata and hidden content using MuPDF API
   */
  async sanitizePdf(pdfDocument: any, options?: { removeFormFields?: boolean }): Promise<void> {
    // 1. Clear all metadata fields
    this.clearPdfMetadata(pdfDocument);

    // 2. Remove annotations from all pages
    // This includes: Text/FreeText annotations (comments),
    // markup annotations (highlight/underline/strikeout/squiggly/ink),
    // stamps, file attachments, multimedia (sound/movie/screen/richmedia), etc.
    this.removePdfAnnotations(pdfDocument);

    // 3. Strip forms completely
    if (options?.removeFormFields) {
      this.stripPdfForms(pdfDocument);
    }
  
    // 4. Remove JavaScript actions
    this.removePdfJavaScript(pdfDocument);

    // 5. Remove direct embedded files (EmbeddedFiles name tree)
    this.removePdfEmbeddedFiles(pdfDocument);

    // 6. Remove Optional Content Groups (layers)
    this.removePdfLayers(pdfDocument);

    // Note: MuPDF's saveToBuffer with 'compress' option will already remove:
    // - Unused objects
    // - Incremental updates
    // - Comments and whitespace
  }

  /**
   * Clear all PDF metadata
   */
  private clearPdfMetadata(pdfDocument: any): void {
    PDF_METADATA_KEYS_ARRAY.forEach(key => {
      try {
        pdfDocument.setMetaData(key, '');
      } catch (e) {
        console.warn(`Failed to clear metadata ${key}:`, e);
      }
    });
  }

  /**
   * Remove annotations from all pages
   * Removes all annotation types including:
   * - Text/FreeText (comments, notes)
   * - Markup (Highlight, Underline, StrikeOut, Squiggly, Ink)
   * - Stamp (rubber stamps)
   * - FileAttachment (file attachments)
   * - Sound/Movie/Screen/RichMedia (multimedia)
   * - Link (hyperlinks)
   * - And all other annotation types defined in PDF spec
   */
  private removePdfAnnotations(pdfDocument: any): void {
    try {
      const pageCount = pdfDocument.countPages();
      let totalRemoved = 0;
      const annotTypes = new Set<string>();

      for (let i = 0; i < pageCount; i++) {
        const page = pdfDocument.loadPage(i);

        // Get all other annotations on this page
        const annots = page.getAnnotations();
        if (annots && annots.length > 0) {
          // Delete each annotation in reverse order to avoid index issues
          for (let j = annots.length - 1; j >= 0; j--) {
            try {
              const annot = annots[j];
              // Track annotation type for logging
              const annotType = annot.getType?.() || 'Unknown';

              annotTypes.add(annotType);
              page.deleteAnnotation(annot);
              totalRemoved++;
            } catch (e) {
              console.warn(`Failed to delete annotation ${j} on page ${i}:`, e);
            }
          }
        }
      }

      if (totalRemoved > 0) {
        const types = Array.from(annotTypes).join(', ');
        console.log(`Removed ${totalRemoved} annotation(s) of types: ${types}`);
      }
    } catch (e) {
      console.warn('Failed to remove annotations:', e);
    }
  }

  /**
   * Strip PDF form fields from the document
   * This removes the AcroForm entry from the catalog which contains form field definitions
   */
  private stripPdfForms(pdfDocument: any): void {
    try {
      // Get the PDF catalog (document root)
      const trailer = pdfDocument.getTrailer?.();
      if (!trailer) {
        console.warn('Could not access PDF trailer');
        return;
      }

      const catalog = trailer.get?.('Root');
      if (!catalog) {
        console.warn('Could not access PDF catalog');
        return;
      }

      // Check if AcroForm exists
      const acroForm = catalog.get?.('AcroForm');
      if (acroForm && !acroForm.isNull?.()) {
        // Delete the AcroForm entry from the catalog
        catalog.delete?.('AcroForm');
        console.log('Removed AcroForm from PDF catalog');
      }
    } catch (e) {
      console.warn('Failed to strip PDF forms:', e);
    }
  }

  /**
   * Remove JavaScript actions
   */
  private removePdfJavaScript(pdfDocument: any): void {
    try {
      // Disable JavaScript in the document
      pdfDocument.disableJS?.();

      // Note: This disables JS execution, but doesn't remove JS from structure
      // The actual removal requires manipulating the Names tree
      // When saved with 'compress', unreferenced JS objects should be removed

      console.log('Disabled JavaScript in document');
    } catch (e) {
      console.warn('Failed to remove JavaScript:', e);
    }
  }

  /**
   * Remove embedded files
   */
  private removePdfEmbeddedFiles(pdfDocument: any): void {
    try {
      // Get all embedded files (returns object with filename keys)
      const embeddedFiles = pdfDocument.getEmbeddedFiles?.();

      if (!embeddedFiles) {
        return;
      }

      const fileNames = Object.keys(embeddedFiles);

      if (fileNames.length === 0) {
        return;
      }

      // Delete each embedded file
      for (const fileName of fileNames) {
        try {
          pdfDocument.deleteEmbeddedFile?.(fileName);
        } catch (e) {
          console.warn(`Failed to delete embedded file "${fileName}":`, e);
        }
      }

      console.log(`Removed ${fileNames.length} embedded file(s)`);
    } catch (e) {
      console.warn('Failed to remove embedded files:', e);
    }
  }


  /**
   * Remove Optional Content Groups (PDF Layers)
   */
  private removePdfLayers(pdfDocument: any): void {
    try {
      // Check if document has layers
      const layerCount = pdfDocument.countLayers?.();

      if (!layerCount || layerCount === 0) {
        return; // No layers to remove
      }

      // Note: MuPDF doesn't have a direct "delete layer" method
      // We need to make all layers visible and flatten the content
      // OR remove the OCProperties from the catalog

      // Set all layers to visible so content is merged when saved
      for (let i = 0; i < layerCount; i++) {
        try {
          pdfDocument.setLayerVisible?.(i, true);
        } catch (e) {
          console.warn(`Failed to set layer ${i} visible:`, e);
        }
      }

      // When the document is saved with 'compress' option,
      // the layer structure should be flattened into the base content
      // For more aggressive removal, we'd need to manipulate the PDF catalog directly

      console.log(`Set ${layerCount} layer(s) to visible for flattening`);

    } catch (e) {
      console.warn('Failed to remove PDF layers:', e);
    }
  }

  /**
   * Sanitize DOCX metadata and hidden content
   */
  async sanitizeDocx(docx: ParsedDocx): Promise<PizZip> {
    const zip = docx.zip;

    // 1. Clear Core Properties (docProps/core.xml)
    this.clearDocxCoreProperties(zip);

    // 2. Clear App Properties (docProps/app.xml)
    this.clearDocxAppProperties(zip);

    // 3. Clear Custom Properties (docProps/custom.xml)
    this.clearDocxCustomProperties(zip);

    // 4. Remove Comments
    this.removeDocxComments(zip);

    // 5. Remove Track Changes/Revisions
    this.removeDocxTrackChanges(zip);

    // 6. Remove Bookmarks
    this.removeDocxBookmarks(zip);

    // 7. Remove Custom XML
    this.removeDocxCustomXml(zip);

    // 8. Clear Document Settings (remove rsids, proofing errors, etc.)
    this.clearDocxSettings(zip);

    // 9. Remove VBA/Macros
    this.removeDocxMacros(zip);

    return zip;
  }

  /**
   * Clear Core Properties
   */
  private clearDocxCoreProperties(zip: PizZip): void {
    const corePropsFile = zip.file('docProps/core.xml');
    if (!corePropsFile) return;

    let content = corePropsFile.asText();

    // Create minimal core.xml with cleared metadata
    const clearedCore = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
                   xmlns:dc="http://purl.org/dc/elements/1.1/"
                   xmlns:dcterms="http://purl.org/dc/terms/"
                   xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title></dc:title>
  <dc:subject></dc:subject>
  <dc:creator></dc:creator>
  <cp:keywords></cp:keywords>
  <dc:description></dc:description>
  <cp:lastModifiedBy></cp:lastModifiedBy>
  <cp:revision>1</cp:revision>
  <dcterms:created xsi:type="dcterms:W3CDTF">2000-01-01T00:00:00Z</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">2000-01-01T00:00:00Z</dcterms:modified>
  <cp:category></cp:category>
  <cp:contentStatus></cp:contentStatus>
</cp:coreProperties>`;

    zip.file('docProps/core.xml', clearedCore);
  }

  /**
   * Clear App Properties
   */
  private clearDocxAppProperties(zip: PizZip): void {
    const appPropsFile = zip.file('docProps/app.xml');
    if (!appPropsFile) return;

    let content = appPropsFile.asText();

    // Clear application metadata
    content = content.replace(/<Application>[^<]*<\/Application>/g, '<Application></Application>');
    content = content.replace(/<AppVersion>[^<]*<\/AppVersion>/g, '<AppVersion></AppVersion>');
    content = content.replace(/<Company>[^<]*<\/Company>/g, '<Company></Company>');
    content = content.replace(/<Manager>[^<]*<\/Manager>/g, '<Manager></Manager>');
    content = content.replace(/<Template>[^<]*<\/Template>/g, '<Template></Template>');
    content = content.replace(/<TotalTime>[^<]*<\/TotalTime>/g, '<TotalTime>0</TotalTime>');
    content = content.replace(/<HyperlinksChanged>[^<]*<\/HyperlinksChanged>/g, '');
    content = content.replace(/<LinksUpToDate>[^<]*<\/LinksUpToDate>/g, '');

    zip.file('docProps/app.xml', content);
  }

  /**
   * Clear Custom Properties
   */
  private clearDocxCustomProperties(zip: PizZip): void {
    const customFile = zip.file('docProps/custom.xml');
    if (customFile) {
      // Remove the entire custom properties file
      zip.remove('docProps/custom.xml');
    }
  }

  /**
   * Remove Comments
   */
  private removeDocxComments(zip: PizZip): void {
    // Remove comments.xml
    const commentsFile = zip.file('word/comments.xml');
    if (commentsFile) {
      zip.remove('word/comments.xml');
    }

    // Remove comment references from document.xml
    const docFile = zip.file('word/document.xml');
    if (docFile) {
      let content = docFile.asText();
      // Remove comment range markers
      content = content.replace(/<w:commentRangeStart[^>]*\/>/g, '');
      content = content.replace(/<w:commentRangeEnd[^>]*\/>/g, '');
      content = content.replace(/<w:commentReference[^>]*\/>/g, '');
      zip.file('word/document.xml', content);
    }
  }

  /**
   * Remove Track Changes/Revisions using proper XML parsing
   */
  private removeDocxTrackChanges(zip: PizZip): void {
    const docFile = zip.file('word/document.xml');
    if (!docFile) return;

    const content = docFile.asText();

    let xmlDoc: Document;
    try {
      xmlDoc = parseXmlSafely(content, 'Failed to parse document.xml for track changes removal');
    } catch (e) {
      console.warn('Failed to parse document.xml for track changes removal:', e);
      return;
    }

    // Remove tracked insertions (w:ins) - accept changes by unwrapping
    unwrapElements(xmlDoc, DOCX_NAMESPACE, 'ins');

    // Remove tracked deletions (w:del) - reject changes by removing completely
    removeElements(xmlDoc, DOCX_NAMESPACE, 'del');

    // Remove move from markers (w:moveFrom)
    removeElements(xmlDoc, DOCX_NAMESPACE, 'moveFrom');

    // Remove move to markers (w:moveTo) - keep content
    const moveTos = xmlDoc.getElementsByTagNameNS(DOCX_NAMESPACE, 'moveTo');
    const moveToArray = Array.from(moveTos);
    for (const moveTo of moveToArray) {
      const parent = moveTo.parentNode;
      if (parent) {
        while (moveTo.firstChild) {
          parent.insertBefore(moveTo.firstChild, moveTo);
        }
        parent.removeChild(moveTo);
      }
    }

    // Remove formatting changes (w:rPrChange)
    removeElements(xmlDoc, DOCX_NAMESPACE, 'rPrChange');

    // Remove paragraph property changes (w:pPrChange)
    removeElements(xmlDoc, DOCX_NAMESPACE, 'pPrChange');

    // Serialize back to string
    const modifiedContent = serializeXml(xmlDoc);

    zip.file('word/document.xml', modifiedContent);
  }

  /**
   * Remove Bookmarks
   * Bookmarks are marked with w:bookmarkStart and w:bookmarkEnd tags
   */
  private removeDocxBookmarks(zip: PizZip): void {
    const docFile = zip.file('word/document.xml');
    if (!docFile) return;

    const content = docFile.asText();

    let xmlDoc: Document;
    try {
      xmlDoc = parseXmlSafely(content, 'Failed to parse document.xml for bookmark removal');
    } catch (e) {
      console.warn('Failed to parse document.xml for bookmark removal:', e);
      return;
    }

    // Remove bookmark start markers (w:bookmarkStart)
    removeElements(xmlDoc, DOCX_NAMESPACE, 'bookmarkStart');

    // Remove bookmark end markers (w:bookmarkEnd)
    removeElements(xmlDoc, DOCX_NAMESPACE, 'bookmarkEnd');

    // Serialize back to string
    const modifiedContent = serializeXml(xmlDoc);

    zip.file('word/document.xml', modifiedContent);
  }

  /**
   * Remove Custom XML
   */
  private removeDocxCustomXml(zip: PizZip): void {
    // Remove all custom XML files
    const files = Object.keys(zip.files);
    files.forEach(filename => {
      if (filename.startsWith('customXml/')) {
        zip.remove(filename);
      }
    });
  }

  /**
   * Clear Document Settings
   */
  private clearDocxSettings(zip: PizZip): void {
    const settingsFile = zip.file('word/settings.xml');
    if (!settingsFile) return;

    let content = settingsFile.asText();

    // Remove rsids (revision identifiers)
    content = content.replace(/<w:rsids>.*?<\/w:rsids>/g, '');

    // Remove proof errors tracking
    content = content.replace(/<w:proofState[^>]*\/>/g, '');

    // Remove document protection
    content = content.replace(/<w:documentProtection[^>]*\/>/g, '');

    // Clear compat settings that might leak info
    content = content.replace(/<w:compat>.*?<\/w:compat>/g, '<w:compat></w:compat>');

    zip.file('word/settings.xml', content);
  }

  /**
   * Remove VBA/Macros
   */
  private removeDocxMacros(zip: PizZip): void {
    // Remove VBA binary
    const vbaFile = zip.file('word/vbaProject.bin');
    if (vbaFile) {
      zip.remove('word/vbaProject.bin');
    }

    // Remove VBA data
    const vbaDataFile = zip.file('word/vbaData.xml');
    if (vbaDataFile) {
      zip.remove('word/vbaData.xml');
    }
  }

  /**
   * Remove headers and footers (optional - user might want to keep these)
   */
  removeDocxHeadersFooters(zip: PizZip): void {
    const files = Object.keys(zip.files);
    files.forEach(filename => {
      if (filename.startsWith('word/header') || filename.startsWith('word/footer')) {
        zip.remove(filename);
      }
    });
  }

  /**
   * Remove embedded objects/files
   */
  removeDocxEmbeddings(zip: PizZip): void {
    const files = Object.keys(zip.files);
    files.forEach(filename => {
      if (filename.startsWith('word/embeddings/')) {
        zip.remove(filename);
      }
    });
  }
}
