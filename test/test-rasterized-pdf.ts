import { strict as assert } from 'node:assert';
import * as mupdf from 'mupdf';
import { RedactionEngine } from '../src/lib/redaction/RedactionEngine';
import { EntityType, type DetectedEntity, type ProcessedDocument } from '../src/lib/types';

function makeSourcePdf(): Uint8Array {
  const pdf = new mupdf.PDFDocument();
  const font = pdf.addSimpleFont(new mupdf.Font('Helvetica'));

  for (const [index, label] of ['SECRET PUBLIC', 'SECOND PAGE'].entries()) {
    const resources = { Font: { F1: font } };
    const contents = `BT /F1 18 Tf 36 150 Td (${label}) Tj ET`;
    pdf.insertPage(-1, pdf.addPage([0, 0, 300, 200], index === 0 ? 0 : 90, resources, contents));
  }

  pdf.setMetaData('info:Author', 'Sensitive Author');
  return pdf.saveToBuffer('compress').asUint8Array();
}

function makeProcessedDocument(source: mupdf.PDFDocument, fileSize: number): ProcessedDocument {
  return {
    id: 'source',
    filename: 'source.pdf',
    fileSize,
    pageCount: 2,
    pages: [0, 1].map(index => {
      const page = source.loadPage(index);
      const [x0, y0, x1, y1] = page.getBounds();
      const dimensions = { width: x1 - x0, height: y1 - y0 };
      return {
        pageNumber: index + 1,
        pdfPageObject: page,
        textContent: '',
        textItems: [],
        entities: [],
        viewport: dimensions,
        dimensions,
      };
    }),
    allEntities: [],
    processingTime: 0,
    createdAt: Date.now(),
  };
}

const entity: DetectedEntity = {
  id: 'secret',
  text: 'SECRET',
  entityType: EntityType.CUSTOM,
  confidence: 1,
  position: {
    pageNumber: 1,
    boundingBox: { x: 35, y: 145, width: 75, height: 22 },
    textIndex: 0,
  },
  detectionMethod: 'manual',
  status: 'confirmed',
};

const sourceBytes = makeSourcePdf();
const source = mupdf.PDFDocument.openDocument(sourceBytes, 'application/pdf') as mupdf.PDFDocument;
const processed = makeProcessedDocument(source, sourceBytes.length);
const file = new File([sourceBytes], 'source.pdf', { type: 'application/pdf' });

const sanitizedResult = await new RedactionEngine().applyRedactions(file, processed, [entity], undefined, true);
assert.equal(sanitizedResult.success, true, sanitizedResult.error);
assert.ok(sanitizedResult.pdfBlob);
const sanitizedBytes = new Uint8Array(await sanitizedResult.pdfBlob.arrayBuffer());
const sanitized = mupdf.PDFDocument.openDocument(sanitizedBytes, 'application/pdf') as mupdf.PDFDocument;
assert.equal(sanitized.countPages(), 2);
assert.equal(sanitized.getMetaData('info:Author'), undefined);

function countDarkPixels(page: mupdf.PDFPage, left: number, top: number, right: number, bottom: number): number {
  const pixmap = page.toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false);
  const pixels = pixmap.getPixels();
  const stride = pixmap.getStride();
  let count = 0;
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const offset = y * stride + x * 3;
      if (pixels[offset] < 80 && pixels[offset + 1] < 80 && pixels[offset + 2] < 80) count++;
    }
  }
  pixmap.destroy();
  return count;
}

for (let index = 0; index < sanitized.countPages(); index++) {
  const page = sanitized.loadPage(index);
  assert.deepEqual(page.getBounds(), index === 0 ? [0, 0, 300, 200] : [0, 0, 200, 300]);
  assert.equal(page.toStructuredText().asText().trim(), '', `page ${index + 1} contains selectable text`);
  const resources = page.getObject().get('Resources');
  assert.equal(resources.get('Font').isNull(), true, `page ${index + 1} contains font resources`);
  const image = resources.get('XObject').get('Im0');
  assert.equal(image.get('Subtype').asName(), 'Image');
  const [x0, y0, x1, y1] = page.getBounds();
  assert.ok(image.get('Width').asNumber() >= Math.floor((x1 - x0) * 300 / 72), `page ${index + 1} image resolution is too low`);
  assert.ok(image.get('Height').asNumber() >= Math.floor((y1 - y0) * 300 / 72), `page ${index + 1} image resolution is too low`);
  assert.doesNotMatch(image.get('Filter').toString(), /DCTDecode/, `page ${index + 1} uses lossy JPEG`);
  assert.equal(page.getAnnotations().length, 0);
  assert.equal(page.getWidgets().length, 0);
}
assert.ok(countDarkPixels(sanitized.loadPage(0), 50, 38, 90, 48) > 300, 'redaction box is visible');
assert.ok(countDarkPixels(sanitized.loadPage(0), 115, 35, 220, 65) > 20, 'unredacted text is visible');
assert.ok(countDarkPixels(sanitized.loadPage(1), 0, 0, 200, 300) > 20, 'rotated second page is visible');

const regularResult = await new RedactionEngine().applyRedactions(file, processed, [entity], undefined, false);
assert.equal(regularResult.success, true, regularResult.error);
assert.ok(regularResult.pdfBlob);
const regular = mupdf.PDFDocument.openDocument(
  new Uint8Array(await regularResult.pdfBlob.arrayBuffer()),
  'application/pdf'
) as mupdf.PDFDocument;
assert.match(regular.loadPage(1).toStructuredText().asText(), /SECOND PAGE/);
assert.doesNotMatch(regular.loadPage(0).toStructuredText().asText(), /SECRET/);

console.log('Rasterized PDF export tests passed');
