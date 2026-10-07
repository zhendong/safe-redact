import { parseOcrTsv, type OcrText } from './ImageOcr';

type QuarterTurns = 0 | 1 | 2 | 3;
type Recognize = (
  canvas: HTMLCanvasElement,
  onProgress?: (progress: number) => void
) => Promise<{ data: { tsv?: string } }>;

/** Prefer substantial, confident text over many low-confidence marks or a lone letter. */
export function scoreOcrOrientation(ocr: OcrText): number {
  return ocr.words.reduce((score, word) => {
    const characters = ocr.text.slice(word.start, word.end).replace(/\s/g, '').length;
    const confidence = Math.max(0, Math.min(100, word.confidence) - 50) / 50;
    return score + characters * confidence * confidence;
  }, 0);
}

/** Undo a clockwise rotation; review, text selection, and export keep the original pixels. */
export function mapOcrToOriginal(ocr: OcrText, turns: QuarterTurns, width: number, height: number): OcrText {
  const words = ocr.words.map(word => {
    const { left, top, width: w, height: h } = word;
    switch (turns) {
      case 1: return { ...word, left: top, top: height - left - w, width: h, height: w };
      case 2: return { ...word, left: width - left - w, top: height - top - h };
      case 3: return { ...word, left: width - top - h, top: left, width: h, height: w };
      default: return { ...word };
    }
  });
  return {
    text: ocr.text,
    words,
    textItems: words.map(word => ({
      str: ocr.text.slice(word.start, word.end),
      transform: [1, 0, 0, 1, word.left, height - word.top - word.height],
      width: word.width,
      height: word.height,
      fontName: 'OCR',
    })),
  };
}

/** EXIF normalization cannot fix text photographed sideways without orientation metadata. */
export async function recognizeImageOcr(
  original: HTMLCanvasElement,
  recognize: Recognize,
  onProgress?: (progress: number) => void
): Promise<OcrText> {
  let best: OcrText | undefined;
  let bestScore = -1;
  let reportedProgress = 0;
  const report = (progress: number) => {
    reportedProgress = Math.max(reportedProgress, Math.min(1, progress));
    onProgress?.(reportedProgress);
  };
  // Try every orientation: even sideways gibberish can contain confident individual words.
  // Reuse the loaded worker and hold only one temporary full-resolution canvas at a time.
  for (const turns of [0, 1, 2, 3] as const) {
    const canvas = turns === 0 ? original : document.createElement('canvas');
    try {
      if (turns !== 0) {
        canvas.width = turns % 2 ? original.height : original.width;
        canvas.height = turns % 2 ? original.width : original.height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Unable to create image canvas');
        context.translate(canvas.width / 2, canvas.height / 2);
        context.rotate(turns * Math.PI / 2);
        context.drawImage(original, -original.width / 2, -original.height / 2);
      }
      const { data } = await recognize(canvas, progress => report((turns + progress) / 4));
      if (typeof data.tsv !== 'string') throw new Error('OCR did not return word locations');
      const ocr = parseOcrTsv(data.tsv, canvas.width, canvas.height);
      const score = scoreOcrOrientation(ocr);
      if (score > bestScore) {
        best = mapOcrToOriginal(ocr, turns, original.width, original.height);
        bestScore = score;
      }
      report((turns + 1) / 4);
    } finally {
      if (canvas !== original) {
        canvas.width = 0;
        canvas.height = 0;
      }
    }
  }
  return best!;
}
