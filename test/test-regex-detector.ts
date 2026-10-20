import { strict as assert } from 'node:assert';
import * as mupdf from 'mupdf';
import { RegexDetector } from '../src/lib/detectors/RegexDetector';
import type { ProcessedPage } from '../src/lib/types';

// Node has no localStorage; predefined words are stored there
const store: Record<string, string> = {
  'saferedact:predefined-words': JSON.stringify([
    { id: '1', word: 'secret', caseSensitive: false, wholeWord: false, createdAt: 0 },
  ]),
};
(globalThis as unknown as { localStorage: Pick<Storage, 'getItem' | 'setItem'> }).localStorage = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => { store[key] = value; },
};

function makePage(lines: string[]): ProcessedPage {
  const pdf = new mupdf.PDFDocument();
  const font = pdf.addSimpleFont(new mupdf.Font('Helvetica'));
  const contents = 'BT /F1 14 Tf ' + lines.map((line, i) => `1 0 0 1 36 ${360 - i * 40} Tm (${line}) Tj`).join(' ') + ' ET';
  pdf.insertPage(-1, pdf.addPage([0, 0, 400, 400], 0, { Font: { F1: font } }, contents));
  const page = pdf.loadPage(0);
  const [x0, y0, x1, y1] = page.getBounds();
  const dimensions = { width: x1 - x0, height: y1 - y0 };
  return {
    pageNumber: 1,
    pdfPageObject: page,
    textContent: page.toStructuredText('preserve-whitespace').asText(),
    textItems: [],
    entities: [],
    viewport: dimensions,
    dimensions,
  };
}

// Same word in different case on separate lines: each needs its own box.
// MuPDF search ignores case, so occurrence counting must too.
const page = makePage(['secret', 'SECRET', 'Secret']);
const entities = (await new RegexDetector().detectEntities([page]))
  .filter(e => e.text.toLowerCase() === 'secret');
assert.equal(entities.length, 3, 'one entity per occurrence');
const ys = entities.map(e => Math.round(e.position.boundingBox.y));
assert.equal(new Set(ys).size, 3, `each occurrence gets its own box, got y=${ys.join(',')}`);
console.log('Case-insensitive matches each get their own box');
