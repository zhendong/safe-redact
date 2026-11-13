import type { BoundingBox, DetectedEntity, RegexPattern, TextItem } from '@/lib/types';
import { generateId } from '@/utils/validation';
import { extractContext } from '@/utils/text-utils';
import { findRuleMatches, type RuleMatch } from '@/lib/rules/matcher';
import type { ScriptValidatorHost } from '@/lib/rules/sandbox';
import type { RulePack } from '@/lib/rules/types';
import { entityFromMatch } from '@/lib/detectors/RegexDetector';

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
export async function detectImageEntities(
  ocr: OcrText,
  imageWidth: number,
  imageHeight: number,
  patterns: RegexPattern[],
  options: { host?: ScriptValidatorHost; packs?: Map<string, RulePack> } = {},
): Promise<DetectedEntity[]> {
  return imageEntitiesFromMatches(ocr, imageWidth, imageHeight, await findRuleMatches(ocr.text, patterns, options));
}

/** Place matches on the image using the OCR words they cover */
export function imageEntitiesFromMatches(ocr: OcrText, imageWidth: number, imageHeight: number, matches: RuleMatch[]): DetectedEntity[] {
  const entities: DetectedEntity[] = [];
  for (const match of matches) {
    const matchedWords = ocr.words.filter(word => word.end > match.index && word.start < match.index + match.text.length);
    if (!matchedWords.length) continue;
    const left = Math.max(0, Math.min(...matchedWords.map(word => word.left)));
    const top = Math.max(0, Math.min(...matchedWords.map(word => word.top)));
    const right = Math.min(imageWidth, Math.max(...matchedWords.map(word => word.left + word.width)));
    const bottom = Math.min(imageHeight, Math.max(...matchedWords.map(word => word.top + word.height)));
    const entity = entityFromMatch(match);
    entities.push({
      ...entity,
      id: generateId(),
      // OCR that misread the words can't be trusted more than it trusts itself
      confidence: Math.min(entity.confidence, matchedWords.reduce((sum, word) => sum + word.confidence, 0) / matchedWords.length / 100),
      position: {
        pageNumber: 1,
        boundingBox: { x: left, y: imageHeight - bottom, width: right - left, height: bottom - top },
        textIndex: ocr.words.indexOf(matchedWords[0]),
      },
      status: 'rejected',
      contextText: extractContext(ocr.text, match.index, match.text.length),
    });
  }
  return entities;
}

export function redactionRect(box: BoundingBox, imageHeight: number) {
  return { x: box.x, y: imageHeight - box.y - box.height, width: box.width, height: box.height };
}
