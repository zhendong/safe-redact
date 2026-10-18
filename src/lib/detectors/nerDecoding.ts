/**
 * Turns per-token NER predictions into character spans of the original text.
 *
 * transformers.js tokenizers don't return character offsets, so tokens are
 * aligned to the text here. Spans are then sliced from the original text,
 * which keeps CJK entities intact ("张三", not "张 三") and lets a word's
 * subword pieces share its first piece's label, so entities are whole words.
 */

export type Offset = [start: number, end: number] | null;

export interface TokenPrediction {
  /** BIO/BIOES label such as "B-PER", "I-address", or "O" */
  label: string;
  score: number;
}

export interface NerSpan {
  /** Entity type without the B-/I-/E-/S- prefix */
  type: string;
  start: number;
  end: number;
  score: number;
}

/** Tokenizers drop whitespace and control characters, so skipped text is short */
const MAX_ALIGNMENT_GAP = 16;

const CJK = /[㐀-䶿一-鿿豈-﫿]/;

const containsCjk = (text: string) => CJK.test(text);

/** Lowercase and strip accents, like uncased BERT tokenizers do */
function normalizeChar(char: string): string {
  return char.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/**
 * Finds the character range of each token in `text`. Unknown tokens and tokens
 * that can't be matched get the gap between their aligned neighbours, or null.
 */
export function alignTokens(text: string, tokens: string[], unkToken = '[UNK]'): Offset[] {
  // Normalized text, with each character's range in the original text
  let normalized = '';
  const starts: number[] = [];
  const ends: number[] = [];
  for (let i = 0; i < text.length; ) {
    const char = String.fromCodePoint(text.codePointAt(i)!);
    for (const c of normalizeChar(char)) {
      normalized += c;
      for (let k = 0; k < c.length; k++) {
        starts.push(i);
        ends.push(i + char.length);
      }
    }
    i += char.length;
  }

  const offsets: Offset[] = [];
  let cursor = 0;
  for (const token of tokens) {
    const piece = token === unkToken ? '' : normalizeChar(token.replace(/^##/, ''));
    const index = piece ? normalized.indexOf(piece, cursor) : -1;
    if (index === -1 || index - cursor > MAX_ALIGNMENT_GAP) {
      offsets.push(null);
      continue;
    }
    const last = index + piece.length - 1;
    offsets.push([starts[index], ends[last]]);
    cursor = last + 1;
  }

  // Give unmatched tokens the text between their neighbours, e.g. rare characters the vocabulary lacks
  for (let i = 0; i < offsets.length; i++) {
    if (offsets[i]) continue;
    let next = i;
    while (next < offsets.length && !offsets[next]) next++;
    let start = i > 0 ? offsets[i - 1]![1] : 0;
    let end = next < offsets.length ? offsets[next]![0] : text.length;
    while (start < end && /\s/.test(text[start])) start++;
    while (end > start && /\s/.test(text[end - 1])) end--;
    // Only fill short gaps; a long one means alignment was lost
    const gap: Offset = start < end && end - start <= MAX_ALIGNMENT_GAP ? [start, end] : null;
    for (let k = i; k < next; k++) offsets[k] = gap;
    i = next;
  }
  return offsets;
}

/**
 * Splits `length` tokens into overlapping windows of at most `size` tokens.
 * Each token is assigned to exactly one window (`keepStart`..`keepEnd`), the
 * one where it has the most context on both sides.
 */
export function tokenWindows(length: number, size: number, overlap: number) {
  const windows: Array<{ start: number; end: number; keepStart: number; keepEnd: number }> = [];
  const stride = size - overlap;
  for (let start = 0; ; start += stride) {
    const end = Math.min(start + size, length);
    const last = end === length;
    windows.push({
      start,
      end,
      keepStart: start === 0 ? 0 : start + Math.floor(overlap / 2),
      keepEnd: last ? end : start + stride + Math.floor(overlap / 2),
    });
    if (last) break;
  }
  return windows;
}

function parseLabel(label: string): [prefix: string, type: string | null] {
  const match = /^([BIES])-(.+)$/.exec(label);
  if (match) return [match[1], match[2]];
  return label === 'O' ? ['O', null] : ['I', label];
}

/** Decodes BIO/BIOES token labels into spans, treating a word's subword pieces like its first piece */
export function decodeSpans(tokens: string[], offsets: Offset[], predictions: TokenPrediction[]): NerSpan[] {
  const spans: NerSpan[] = [];
  let current: { type: string; start: number; end: number; scores: number[] } | null = null;
  let wordType: string | null = null;

  const close = () => {
    if (current && current.end > current.start) {
      const score = current.scores.reduce((a, b) => a + b, 0) / current.scores.length;
      spans.push({ type: current.type, start: current.start, end: current.end, score });
    }
    current = null;
  };

  for (let i = 0; i < tokens.length; i++) {
    const offset = offsets[i];
    const isSubword = i > 0 && tokens[i].startsWith('##') && offset !== null && offsets[i - 1]?.[1] === offset[0];
    const { score } = predictions[i];

    if (isSubword) {
      if (current && wordType === current.type) {
        current.end = Math.max(current.end, offset![1]);
        current.scores.push(score);
      }
      continue;
    }

    const [prefix, type] = parseLabel(predictions[i].label);
    wordType = type;
    if (!type) {
      close();
      continue;
    }
    if (!current || current.type !== type || prefix === 'B' || prefix === 'S') {
      close();
      current = { type, start: offset?.[0] ?? Infinity, end: offset?.[1] ?? -Infinity, scores: [] };
    }
    if (offset) {
      current.start = Math.min(current.start, offset[0]);
      current.end = Math.max(current.end, offset[1]);
    }
    current.scores.push(score);
    // E- and S- end a span, but the rest of this word still belongs to it; it's closed by the next word
  }
  close();
  return spans;
}

/** Merges spans of the same type that touch, e.g. "上海" + "浦东新区" + "张江路88号" */
export function mergeTouchingSpans(spans: NerSpan[]): NerSpan[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const merged: NerSpan[] = [];
  for (const span of sorted) {
    const last = merged[merged.length - 1];
    if (last && last.type === span.type && span.start <= last.end) {
      last.end = Math.max(last.end, span.end);
      last.score = Math.min(last.score, span.score);
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

/** House, building, and room numbers that follow a Chinese street name, e.g. "88号", "3栋502室" */
const CHINESE_ADDRESS_NUMBER = /^\s*(?:[0-9０-９一二三四五六七八九十百千零〇]+[-－]?)+(?:号院|号楼|号|弄|栋|幢|座|楼|层|单元|室)/;

/** Extends Chinese location spans over the house numbers models tend to leave out */
export function extendChineseAddresses(text: string, spans: NerSpan[], locationType: string): NerSpan[] {
  return spans.map(span => {
    if (span.type !== locationType || !containsCjk(text.slice(span.start, span.end))) return span;
    let end = span.end;
    for (let match; (match = CHINESE_ADDRESS_NUMBER.exec(text.slice(end))); ) end += match[0].length;
    return end === span.end ? span : { ...span, end };
  });
}
