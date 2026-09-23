import assert from 'node:assert/strict';
import { validateFile } from '../src/utils/validation';

for (const [name, type] of [
  ['photo.png', 'image/png'],
  ['photo.jpg', 'image/jpeg'],
  ['photo.webp', 'image/webp'],
] as const) {
  const file = new File(['pixels'], name, { type });
  assert.equal(validateFile(file).valid, true, `${name} should be accepted`);
}

assert.equal(validateFile(new File(['pixels'], 'photo.gif', { type: 'image/gif' })).valid, false);
console.log('Image upload validation passed');
