import assert from 'node:assert/strict';
import { ImageOcrWorkerManager } from '../src/lib/image/ImageOcrWorker';

let online = true;
let creations = 0;
let recognitions = 0;
const manager = new ImageOcrWorkerManager(async () => {
  if (!online) throw new Error('network unavailable');
  creations++;
  return {
    recognize: async () => {
      recognitions++;
      return { data: { tsv: 'ready' } };
    },
  };
});

await Promise.all([manager.preload(), manager.preload()]);
assert.equal(creations, 1, 'startup should initialize only one worker');

online = false;
const result = await manager.recognize({} as HTMLCanvasElement);
assert.equal(result.data.tsv, 'ready');
assert.equal(creations, 1, 'recognition after disconnect must use the loaded worker');
assert.equal(recognitions, 1);

let attempts = 0;
const retryable = new ImageOcrWorkerManager(async () => {
  attempts++;
  if (attempts === 1) throw new Error('temporary failure');
  return { recognize: async () => ({ data: { tsv: 'recovered' } }) };
});
await assert.rejects(retryable.preload(), /temporary failure/);
await retryable.preload();
assert.equal(attempts, 2);

console.log('Image OCR worker preload and offline reuse passed');
