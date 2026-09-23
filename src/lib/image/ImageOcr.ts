import type { BoundingBox, DetectedEntity, RegexPattern, TextItem } from '@/lib/types';
import { generateId } from '@/utils/validation';
import { extractContext } from '@/utils/text-utils';
import { getContextConfidenceBoost } from '@/utils/regex-patterns';
import { DEFAULT_CONFIDENCE_BOOST, DEFAULT_SEARCH_CONTEXT_WINDOW } from '@/utils/constants';

interface OcrWord {
  start: number;
  end: number;
  left: number;
  top: number;
  width: number;
  height: number;
  confidence: number;
}

export interface OcrText {
  text: string;
  textItems: TextItem[];
  words: OcrWord[];
}

/** Convert Tesseract TSV word boxes into text with exact character offsets. */
export function parseOcrTsv(tsv: string, imageWidth: number, imageHeight: number): OcrText {
  const lines = tsv.trim().split(/\r?\n/);
  const firstRow = lines[0]?.split('\t') ?? [];
  const columns = firstRow[0] === 'level'
    ? (lines.shift()?.split('\t') ?? [])
    : ['level', 'page_num', 'block_num', 'par_num', 'line_num', 'word_num', 'left', 'top', 'width', 'height', 'conf', 'text'];
  const index = (name: string) => columns.indexOf(name);
  const required = ['level', 'page_num', 'block_num', 'par_num', 'line_num', 'left', 'top', 'width', 'height', 'conf', 'text'];
  if (required.some(name => index(name) < 0)) throw new Error('OCR returned an invalid TSV result');

  let text = '';
  let previousLine = '';
  let previousWord = '';
  const words: OcrWord[] = [];
  const textItems: TextItem[] = [];

  for (const line of lines) {
    const fields = line.split('\t');
    if (fields[index('level')] !== '5') continue;
    const value = fields.slice(index('text')).join('\t').trim();
    const left = Number(fields[index('left')]);
    const top = Number(fields[index('top')]);
    const width = Number(fields[index('width')]);
    const height = Number(fields[index('height')]);
    const confidence = Number(fields[index('conf')]);
    if (!value || ![left, top, width, height, confidence].every(Number.isFinite) || width <= 0 || height <= 0) continue;
    if (left < 0 || top < 0 || left + width > imageWidth || top + height > imageHeight) continue;

    const lineKey = ['page_num', 'block_num', 'par_num', 'line_num'].map(name => fields[index(name)]).join(':');
    if (text) {
      const adjacentHan = /[\p{Script=Han}]$/u.test(previousWord) && /^[\p{Script=Han}]/u.test(value);
      text += lineKey === previousLine ? (adjacentHan ? '' : ' ') : '\n';
    }
    const start = text.length;
    text += value;
    words.push({ start, end: text.length, left, top, width, height, confidence });
    textItems.push({
      str: value,
      transform: [1, 0, 0, 1, left, imageHeight - top - height],
      width,
      height,
      fontName: 'OCR',
    });
    previousLine = lineKey;
    previousWord = value;
  }
  return { text, textItems, words };
}

/** Match existing sensitive-data patterns against OCR text and locate each match in image pixels. */
export function detectImageEntities(ocr: OcrText, imageWidth: number, imageHeight: number, patterns: RegexPattern[]): DetectedEntity[] {
  const entities: DetectedEntity[] = [];
  for (const pattern of patterns) {
    const flags = pattern.pattern.flags.includes('g') ? pattern.pattern.flags : `${pattern.pattern.flags}g`;
    const regex = new RegExp(pattern.pattern.source, flags);
    for (const match of ocr.text.matchAll(regex)) {
      if (!match[0] || match.index === undefined || (pattern.validator && !pattern.validator(match[0]))) continue;
      const matchedWords = ocr.words.filter(word => word.end > match.index && word.start < match.index + match[0].length);
      if (!matchedWords.length) continue;
      const left = Math.max(0, Math.min(...matchedWords.map(word => word.left)));
      const top = Math.max(0, Math.min(...matchedWords.map(word => word.top)));
      const right = Math.min(imageWidth, Math.max(...matchedWords.map(word => word.left + word.width)));
      const bottom = Math.min(imageHeight, Math.max(...matchedWords.map(word => word.top + word.height)));
      let confidence = pattern.confidence;
      if (pattern.contextKeywords?.length) {
        confidence *= getContextConfidenceBoost(
          ocr.text, match.index, match[0].length, pattern.contextKeywords,
          pattern.contextWindowSize ?? DEFAULT_SEARCH_CONTEXT_WINDOW,
          pattern.confidenceBoost ?? DEFAULT_CONFIDENCE_BOOST
        );
      }
      confidence = Math.min(1, confidence, matchedWords.reduce((sum, word) => sum + word.confidence, 0) / matchedWords.length / 100);
      entities.push({
        id: generateId(),
        text: match[0],
        entityType: pattern.entityType,
        confidence,
        position: {
          pageNumber: 1,
          boundingBox: { x: left, y: imageHeight - bottom, width: right - left, height: bottom - top },
          textIndex: ocr.words.indexOf(matchedWords[0]),
        },
        detectionMethod: 'regex',
        status: 'rejected',
        contextText: extractContext(ocr.text, match.index, match[0].length),
      });
    }
  }
  return entities;
}

export function redactionRect(box: BoundingBox, imageHeight: number) {
  return { x: box.x, y: imageHeight - box.y - box.height, width: box.width, height: box.height };
}
