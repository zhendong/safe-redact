import assert from 'node:assert/strict';
import { EntityType } from '../src/lib/types';
import { parseOcrTsv, detectImageEntities, redactionRect } from '../src/lib/image/ImageOcr';

const tsv = [
  'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext',
  '5\t1\t1\t1\t1\t1\t10\t20\t100\t16\t95\tamy@example.com',
  '5\t1\t1\t1\t2\t1\t12\t70\t100\t16\t90\tamy@example.com',
  '5\t1\t1\t1\t3\t1\t10\t120\t70\t16\t94\t4111',
  '5\t1\t1\t1\t3\t2\t82\t120\t70\t16\t93\t1111',
  '5\t1\t1\t1\t3\t3\t154\t120\t70\t16\t92\t1111',
  '5\t1\t1\t1\t3\t4\t226\t120\t70\t16\t91\t1111',
].join('\n');

const parsed = parseOcrTsv(tsv, 320, 200);
assert.equal(parsed.text, 'amy@example.com\namy@example.com\n4111 1111 1111 1111');
assert.equal(parseOcrTsv(tsv.split('\n').slice(1).join('\n'), 320, 200).text, parsed.text);

const entities = detectImageEntities(parsed, 320, 200, [
  { name: 'email', entityType: EntityType.EMAIL, pattern: /amy@example\.com/g, confidence: 0.9, examples: [] },
  { name: 'card', entityType: EntityType.CREDIT_CARD, pattern: /4111 1111 1111 1111/g, confidence: 0.9, examples: [] },
]);
assert.equal(entities.length, 3);
assert.deepEqual(entities.map(entity => entity.position.boundingBox), [
  { x: 10, y: 164, width: 100, height: 16 },
  { x: 12, y: 114, width: 100, height: 16 },
  { x: 10, y: 64, width: 286, height: 16 },
]);
assert.deepEqual(redactionRect(entities[1].position.boundingBox, 200), { x: 12, y: 70, width: 100, height: 16 });
console.log('Image OCR positioning passed');
