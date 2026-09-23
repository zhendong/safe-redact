import ExifReader from 'exifreader';
import type { DocumentMetadata } from '@/lib/types';

const STRUCTURAL_PNG_TAGS = new Set([
  'Image Width', 'Image Height', 'Bit Depth', 'Color Type',
  'Compression', 'Filter', 'Interlace',
]);

/** JPEG COM segments are not returned by ExifReader, but can contain private notes. */
export function readJpegComments(bytes: Uint8Array): string[] {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return [];
  const comments: string[] = [];
  let offset = 2;
  while (offset + 4 <= bytes.length && bytes[offset] === 0xff) {
    let marker = bytes[++offset];
    while (marker === 0xff && offset + 1 < bytes.length) marker = bytes[++offset];
    offset++;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) break;
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) break;
    if (marker === 0xfe) {
      const comment = new TextDecoder('latin1').decode(bytes.subarray(offset + 2, offset + length)).trim();
      if (comment) comments.push(comment.slice(0, 1000));
    }
    offset += length;
  }
  return comments;
}

/** Inspect the original bytes, before canvas normalization discards embedded metadata. */
export async function inspectImageMetadata(file: Blob): Promise<DocumentMetadata> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const tags = await ExifReader.load(bytes.buffer, {
    expanded: true,
    async: true,
    excludeTags: { mpf: true },
  });
  const metadata: DocumentMetadata = {};

  for (const [groupName, group] of [
    ['EXIF', tags.exif],
    ['IPTC', tags.iptc],
    ['XMP', tags.xmp],
    ['PNG', tags.png],
    ['ICC', tags.icc],
    ['Photoshop', tags.photoshop],
    ['Maker note', tags.makerNotes],
  ] as const) {
    if (!group) continue;
    for (const [name, tag] of Object.entries(group)) {
      if (name === '_raw' || (groupName === 'PNG' && STRUCTURAL_PNG_TAGS.has(name))) continue;
      if (name === 'MakerNote') {
        metadata['EXIF MakerNote'] = 'Embedded camera-specific data present';
        continue;
      }
      const description = typeof tag === 'object' && tag !== null && 'description' in tag
        ? tag.description : tag;
      if (typeof description === 'string' || typeof description === 'number') {
        const value = String(description).trim();
        if (value) metadata[`${groupName} ${name}`] = value.slice(0, 1000);
      }
    }
  }

  if (tags.gps?.Latitude !== undefined && tags.gps?.Longitude !== undefined) {
    metadata['GPS coordinates'] = `${tags.gps.Latitude}, ${tags.gps.Longitude}`;
  }
  if (tags.Thumbnail) metadata['Embedded thumbnail'] = 'Present in source image';
  readJpegComments(bytes).forEach((comment, index) => {
    metadata[index ? `JPEG Comment ${index + 1}` : 'JPEG Comment'] = comment;
  });
  return metadata;
}
