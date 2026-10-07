import assert from 'node:assert/strict';
import { parseOcrTsv, detectImageEntities, redactionRect } from '../src/lib/image/ImageOcr';
import { mapOcrToOriginal, scoreOcrOrientation } from '../src/lib/image/ImageOrientation';
import { EntityType } from '../src/lib/types';

const word = (left: number, top: number, width: number, height: number, confidence = 95, text = 'demo@example.com') =>
  `5\t1\t1\t1\t1\t1\t${left}\t${top}\t${width}\t${height}\t${confidence}\t${text}`;

// Each rotated box describes the same original pixels: x=20, y=30, w=100, h=15.
for (const [turns, tsv, width, height] of [
  [0, word(20, 30, 100, 15), 320, 200],
  [1, word(155, 20, 15, 100), 200, 320],
  [2, word(200, 155, 100, 15), 320, 200],
  [3, word(30, 200, 15, 100), 200, 320],
] as const) {
  const ocr = mapOcrToOriginal(parseOcrTsv(tsv, width, height), turns, 320, 200);
  assert.equal(ocr.text, 'demo@example.com');
  assert.deepEqual(ocr.textItems[0].transform, [1, 0, 0, 1, 20, 155]);
  assert.equal(ocr.textItems[0].width, 100);
  assert.equal(ocr.textItems[0].height, 15);
  const [entity] = detectImageEntities(ocr, 320, 200, [{
    name: 'email', entityType: EntityType.EMAIL, pattern: /demo@example\.com/g,
    confidence: 0.9, examples: [],
  }]);
  assert.deepEqual(redactionRect(entity.position.boundingBox, 200), { x: 20, y: 30, width: 100, height: 15 });
}

const readable = parseOcrTsv(word(20, 30, 100, 15), 320, 200);
const garbage = parseOcrTsv(word(20, 30, 100, 15, 25, 'gibberish '.repeat(10)), 320, 200);
const singleLetter = parseOcrTsv(word(20, 30, 10, 15, 99, 'I'), 320, 200);
assert.ok(scoreOcrOrientation(readable) > scoreOcrOrientation(garbage));
assert.ok(scoreOcrOrientation(readable) > scoreOcrOrientation(singleLetter));
assert.equal(scoreOcrOrientation(parseOcrTsv('', 320, 200)), 0);
console.log('Image OCR orientation scoring and original-pixel redaction placement passed');
