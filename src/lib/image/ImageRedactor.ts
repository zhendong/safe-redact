import { saveAs } from 'file-saver';
import type { DetectedEntity } from '@/lib/types';
import { removeExtension } from '@/utils/file-utils';
import { redactionRect } from './ImageOcr';

/** Re-encode pixels to PNG, leaving the source image and its metadata behind. */
export async function redactImage(image: Blob, entities: DetectedEntity[]): Promise<Blob> {
  const bitmap = await createImageBitmap(image);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Unable to create redaction canvas');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0);
    context.fillStyle = '#000000';
    for (const entity of entities) {
      const box = redactionRect(entity.position.boundingBox, canvas.height);
      const left = Math.max(0, Math.floor(box.x) - 2);
      const top = Math.max(0, Math.floor(box.y) - 2);
      const right = Math.min(canvas.width, Math.ceil(box.x + box.width) + 2);
      const bottom = Math.min(canvas.height, Math.ceil(box.y + box.height) + 2);
      context.fillRect(left, top, right - left, bottom - top);
    }
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Unable to encode redacted image')), 'image/png');
    });
  } finally {
    bitmap.close();
  }
}

export function downloadRedactedImage(blob: Blob, originalFilename: string): void {
  saveAs(blob, `${removeExtension(originalFilename)}-REDACTED.png`);
}
