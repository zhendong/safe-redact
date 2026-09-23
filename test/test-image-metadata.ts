import assert from 'node:assert/strict';
import { inspectImageMetadata, readJpegComments } from '../src/lib/image/ImageMetadata';

// A valid 1x1 PNG with a private tEXt chunk inserted before IEND.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=', 'base64');
const iendOffset = png.indexOf('IEND') - 4;
assert.ok(iendOffset > 0);
const data = Buffer.from('Comment\0private note', 'latin1');
const chunk = Buffer.alloc(data.length + 12);
chunk.writeUInt32BE(data.length, 0);
chunk.write('tEXt', 4, 'ascii');
data.copy(chunk, 8);
let crc = 0xffffffff;
for (const byte of chunk.subarray(4, 8 + data.length)) {
  crc ^= byte;
  for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
}
chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 8 + data.length);
const tagged = Buffer.concat([png.subarray(0, iendOffset), chunk, png.subarray(iendOffset)]);

const metadata = await inspectImageMetadata(new Blob([tagged]));
assert.equal(metadata['PNG Comment'], 'private note');
assert.equal(metadata['PNG Image Width'], undefined, 'pixel dimensions are not embedded private metadata');
assert.deepEqual(await inspectImageMetadata(new Blob([png])), {});
const jpegComment = Buffer.from('private jpeg comment', 'latin1');
const jpeg = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xfe, 0x00, jpegComment.length + 2]),
  jpegComment,
  Buffer.from([0xff, 0xd9]),
]);
assert.deepEqual(readJpegComments(jpeg), ['private jpeg comment']);
assert.deepEqual(readJpegComments(png), []);
console.log('Image metadata inspection passed');
