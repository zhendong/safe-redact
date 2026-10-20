/**
 * Text extraction and manipulation utilities
 */

import { DISPLAY_CONTEXT_WINDOW, LLM_CHUNKING } from './constants';

/**
 * Extract context around matched text with ellipsis
 * #TODO: consider word boundaries
 */
export function extractContext(
  text: string,
  matchIndex: number,
  matchLength: number,
  windowSize: number = DISPLAY_CONTEXT_WINDOW
): string {
  const start = Math.max(0, matchIndex - windowSize);
  const end = Math.min(text.length, matchIndex + matchLength + windowSize);

  let context = text.substring(start, end);

  if (start > 0) context = '...' + context;
  if (end < text.length) context = context + '...';

  return context;
}

/**
 * Split text into overlapping chunks
 */
export function splitTextWithOverlap(
  text: string,
  chunkSize: number = LLM_CHUNKING.CHUNK_SIZE,
  overlap: number = LLM_CHUNKING.CHUNK_OVERLAP
): Array<{ text: string; offset: number }> {
  const chunks: Array<{ text: string; offset: number }> = [];

  if (text.length <= chunkSize) {
    return [{ text, offset: 0 }];
  }

  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push({
      text: text.substring(start, end),
      offset: start,
    });

    start += chunkSize - overlap;

    if (start + overlap >= text.length) {
      break;
    }
  }

  return chunks;
}

/**
 * Build a case-insensitive pattern that matches text regardless of whitespace.
 * DOCX fullText joins XML text runs with spaces, while the HTML preview and a
 * user's selection don't, so the same words can differ only in spacing.
 * Returns null for text with no non-whitespace characters.
 */
export function buildWhitespaceTolerantPattern(text: string): RegExp | null {
  const chars = Array.from(text.replace(/\s+/g, ''));
  if (chars.length === 0) return null;
  return new RegExp(chars.map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*'), 'gi');
}
