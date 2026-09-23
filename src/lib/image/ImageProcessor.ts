import type { ProcessedDocument } from '@/lib/types';
import { EntityAggregator } from '@/lib/detectors/EntityAggregator';
import { getPatternsForText } from '@/utils/regex-patterns';
import { generateId } from '@/utils/validation';
import { detectImageEntities, parseOcrTsv } from './ImageOcr';
import { imageOcrWorker } from './ImageOcrWorker';
import { inspectImageMetadata } from './ImageMetadata';

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Unable to encode image')), 'image/png');
  });
}

/** Normalize orientation and transparency so OCR, review, and export share one pixel space. */
export async function normalizeImage(file: File): Promise<{ canvas: HTMLCanvasElement; blob: Blob }> {
  const bitmap = await createImageBitmap(file);
  try {
    if (!bitmap.width || !bitmap.height) throw new Error('Image has invalid dimensions');
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Unable to create image canvas');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0);
    return { canvas, blob: await canvasToPng(canvas) };
  } finally {
    bitmap.close();
  }
}

export async function processImage(file: File, onProgress?: (progress: number) => void): Promise<ProcessedDocument> {
  const started = performance.now();
  onProgress?.(5);
  let metadata = {};
  let metadataScanFailed = false;
  try {
    metadata = await inspectImageMetadata(file);
  } catch {
    // A decodable image can contain malformed metadata; OCR and redaction must remain usable.
    metadataScanFailed = true;
  }
  const { canvas, blob } = await normalizeImage(file);
  onProgress?.(15);

  const { data } = await imageOcrWorker.recognize(canvas, progress => {
    onProgress?.(20 + Math.round(progress * 60));
  });
  if (typeof data.tsv !== 'string') throw new Error('OCR did not return word locations');
  const ocr = parseOcrTsv(data.tsv, canvas.width, canvas.height);
  const detected = detectImageEntities(ocr, canvas.width, canvas.height, getPatternsForText(ocr.text));
  const entities = new EntityAggregator().deduplicateEntities(detected);
  onProgress?.(100);
  return {
    id: generateId(),
    filename: file.name,
    fileSize: file.size,
    pageCount: 1,
    pages: [{
      pageNumber: 1,
      textContent: ocr.text,
      textItems: ocr.textItems,
      entities,
      pdfPageObject: null,
      viewport: null,
      dimensions: { width: canvas.width, height: canvas.height },
      imageBlob: blob,
      ocrWords: ocr.words,
    }],
    allEntities: entities,
    metadata,
    metadataScanFailed,
    processingTime: performance.now() - started,
    createdAt: Date.now(),
  };
}
