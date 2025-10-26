/**
 * Language and Script Detection Utility
 * Detects the primary script/language of text to optimize pattern matching
 */

export enum DocumentScript {
  LATIN = 'latin',           // English, European languages
  CJK = 'cjk',               // Chinese, Japanese (mixed)
  CHINESE = 'chinese',       // Primarily Chinese
  JAPANESE = 'japanese',     // Primarily Japanese
  KOREAN = 'korean',         // Korean
  ARABIC = 'arabic',         // Arabic, Persian, Urdu
  HEBREW = 'hebrew',         // Hebrew
  DEVANAGARI = 'devanagari', // Hindi, Sanskrit, Marathi, Nepali
  THAI = 'thai',             // Thai, Lao
  CYRILLIC = 'cyrillic',     // Russian, Ukrainian, Bulgarian
  UNKNOWN = 'unknown',       // Unable to detect
}

interface ScriptStats {
  latin: number;
  cjk: number;
  chinese: number;
  japanese: number;
  korean: number;
  arabic: number;
  hebrew: number;
  devanagari: number;
  thai: number;
  cyrillic: number;
  other: number;
  total: number;
}

/**
 * Analyze a single character and categorize its script
 */
function categorizeChar(char: string): keyof ScriptStats | null {
  const code = char.charCodeAt(0);

  // CJK Unified Ideographs (Chinese characters)
  if ((code >= 0x4E00 && code <= 0x9FFF) ||
      (code >= 0x3400 && code <= 0x4DBF)) {
    return 'cjk';
  }

  // Japanese Hiragana
  if (code >= 0x3040 && code <= 0x309F) {
    return 'japanese';
  }

  // Japanese Katakana
  if (code >= 0x30A0 && code <= 0x30FF) {
    return 'japanese';
  }

  // Korean Hangul
  if ((code >= 0xAC00 && code <= 0xD7AF) ||
      (code >= 0x1100 && code <= 0x11FF)) {
    return 'korean';
  }

  // Arabic
  if ((code >= 0x0600 && code <= 0x06FF) ||
      (code >= 0x0750 && code <= 0x077F) ||
      (code >= 0x08A0 && code <= 0x08FF) ||
      (code >= 0xFB50 && code <= 0xFDFF) ||
      (code >= 0xFE70 && code <= 0xFEFF)) {
    return 'arabic';
  }

  // Hebrew
  if (code >= 0x0590 && code <= 0x05FF) {
    return 'hebrew';
  }

  // Devanagari
  if (code >= 0x0900 && code <= 0x097F) {
    return 'devanagari';
  }

  // Thai
  if (code >= 0x0E00 && code <= 0x0E7F) {
    return 'thai';
  }

  // Lao (treat as Thai)
  if (code >= 0x0E80 && code <= 0x0EFF) {
    return 'thai';
  }

  // Cyrillic
  if (code >= 0x0400 && code <= 0x04FF) {
    return 'cyrillic';
  }

  // Latin (including extended Latin)
  if ((code >= 0x0041 && code <= 0x005A) || // A-Z
      (code >= 0x0061 && code <= 0x007A) || // a-z
      (code >= 0x00C0 && code <= 0x00FF) || // Latin-1 Supplement
      (code >= 0x0100 && code <= 0x017F) || // Latin Extended-A
      (code >= 0x0180 && code <= 0x024F)) { // Latin Extended-B
    return 'latin';
  }

  // Numbers, punctuation, whitespace - don't count
  if (/[\d\s\p{P}]/u.test(char)) {
    return null;
  }

  return 'other';
}

/**
 * Analyze text and return script statistics
 */
function analyzeText(text: string): ScriptStats {
  const stats: ScriptStats = {
    latin: 0,
    cjk: 0,
    chinese: 0,
    japanese: 0,
    korean: 0,
    arabic: 0,
    hebrew: 0,
    devanagari: 0,
    thai: 0,
    cyrillic: 0,
    other: 0,
    total: 0,
  };

  // Sample the text if it's very long (first 10000 chars should be representative)
  const sampleText = text.length > 10000 ? text.substring(0, 10000) : text;

  for (const char of sampleText) {
    const category = categorizeChar(char);
    if (category) {
      stats[category]++;
      stats.total++;

      // If CJK, also count as Chinese (most CJK chars are Chinese)
      if (category === 'cjk') {
        stats.chinese++;
      }
    }
  }

  return stats;
}

/**
 * Detect document scripts (returns array for multi-script documents)
 * Returns scripts in order of prevalence (most common first)
 */
export function detectDocumentScript(text: string): DocumentScript[] {
  const stats = analyzeText(text);

  // If no meaningful characters found
  if (stats.total < 10) {
    return [DocumentScript.UNKNOWN];
  }

  // Calculate percentages
  const percentages: Record<string, number> = {};
  for (const [key, value] of Object.entries(stats)) {
    if (key !== 'total' && key !== 'chinese') {
      percentages[key] = (value / stats.total) * 100;
    }
  }

  // Sort scripts by percentage (highest first)
  const sorted = Object.entries(percentages).sort((a, b) => b[1] - a[1]);

  const detectedScripts: DocumentScript[] = [];

  // Japanese detection: if we have hiragana/katakana, it's Japanese
  // This takes priority as these are unique to Japanese
  if (percentages.japanese > 5) {
    detectedScripts.push(DocumentScript.JAPANESE);
  }

  // Korean detection
  if (percentages.korean > 30) {
    detectedScripts.push(DocumentScript.KOREAN);
  }

  // CJK (Chinese) detection
  if (percentages.cjk > 30) {
    detectedScripts.push(DocumentScript.CHINESE);
  }

  // Arabic detection
  if (percentages.arabic > 30) {
    detectedScripts.push(DocumentScript.ARABIC);
  }

  // Hebrew detection
  if (percentages.hebrew > 30) {
    detectedScripts.push(DocumentScript.HEBREW);
  }

  // Devanagari detection
  if (percentages.devanagari > 30) {
    detectedScripts.push(DocumentScript.DEVANAGARI);
  }

  // Thai detection
  if (percentages.thai > 30) {
    detectedScripts.push(DocumentScript.THAI);
  }

  // Cyrillic detection
  if (percentages.cyrillic > 30) {
    detectedScripts.push(DocumentScript.CYRILLIC);
  }

  // Latin detection - use lower threshold for Latin as it's often mixed with other scripts
  if (percentages.latin > 20) {
    detectedScripts.push(DocumentScript.LATIN);
  }

  // Add CJK if we have significant CJK+Latin mix but no Japanese markers
  if (percentages.cjk > 20 && percentages.latin > 20 && !detectedScripts.includes(DocumentScript.JAPANESE)) {
    if (!detectedScripts.includes(DocumentScript.CHINESE)) {
      detectedScripts.push(DocumentScript.CJK);
    }
  }

  // If nothing detected but we have a dominant script, use it
  if (detectedScripts.length === 0 && sorted.length > 0 && sorted[0][1] > 10) {
    const dominantScriptKey = sorted[0][0];
    if (dominantScriptKey !== 'other') {
      detectedScripts.push(dominantScriptKey as DocumentScript);
    }
  }

  // Return detected scripts or UNKNOWN
  return detectedScripts.length > 0 ? detectedScripts : [DocumentScript.UNKNOWN];
}

/**
 * Get script statistics for debugging/analysis
 */
export function getScriptStatistics(text: string): {
  stats: ScriptStats;
  percentages: Record<string, number>;
  detectedScripts: DocumentScript[];
} {
  const stats = analyzeText(text);
  const percentages: Record<string, number> = {};

  for (const [key, value] of Object.entries(stats)) {
    if (key !== 'total') {
      percentages[key] = stats.total > 0 ? (value / stats.total) * 100 : 0;
    }
  }

  return {
    stats,
    percentages,
    detectedScripts: detectDocumentScript(text),
  };
}
