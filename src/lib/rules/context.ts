/**
 * Context keyword matching shared by every rule
 */

/**
 * Context validation helper
 * Checks if relevant keywords appear near the match to increase confidence
 */
export function hasContextKeywords(
  text: string,
  matchIndex: number,
  matchLength: number,
  keywords: string[],
  windowSize: number
): boolean {
  const start = Math.max(0, matchIndex - windowSize);
  const end = Math.min(text.length, matchIndex + matchLength + windowSize);
  const context = text.substring(start, end).toLowerCase();

  return keywords.some(keyword => {
    const kw = keyword.toLowerCase();
    // Latin keywords must be whole words ("ip" must not match "recipient");
    // CJK keywords have no word boundaries, so match them anywhere
    if (!/^[\x20-\x7e]+$/.test(kw)) return context.includes(kw);
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`).test(context);
  });
}

/**
 * Get confidence boost based on context
 * Returns a multiplier (1.0 = no change, 1.2 = +20% confidence)
 */
export function getContextConfidenceBoost(
  text: string,
  matchIndex: number,
  matchLength: number,
  keywords: string[],
  windowSize: number,
  boostMultiplier: number
): number {
  const hasContext = hasContextKeywords(text, matchIndex, matchLength, keywords, windowSize);
  return hasContext ? boostMultiplier : 1.0;
}
