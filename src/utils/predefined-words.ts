/**
 * Predefined Words Management Utility
 * Handles CRUD operations for user-defined words to be automatically detected and redacted
 */

const PREDEFINED_WORDS_KEY = 'saferedact:predefined-words';

export interface PredefinedWord {
  id: string;
  word: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  createdAt: number;
}

/**
 * Get all predefined words from localStorage
 */
export function getPredefinedWords(): PredefinedWord[] {
  try {
    const stored = localStorage.getItem(PREDEFINED_WORDS_KEY);
    if (!stored) return [];
    return JSON.parse(stored);
  } catch (error) {
    console.error('Failed to load predefined words:', error);
    return [];
  }
}

/**
 * Save predefined words to localStorage
 */
function savePredefinedWords(words: PredefinedWord[]): void {
  try {
    localStorage.setItem(PREDEFINED_WORDS_KEY, JSON.stringify(words));
  } catch (error) {
    console.error('Failed to save predefined words:', error);
    throw new Error('Failed to save predefined words');
  }
}

/**
 * Add a new predefined word
 */
export function addPredefinedWord(
  word: string,
  caseSensitive: boolean = false,
  wholeWord: boolean = true
): PredefinedWord {
  const words = getPredefinedWords();

  // Check for duplicates
  const duplicate = words.find(
    w => w.word === word && w.caseSensitive === caseSensitive && w.wholeWord === wholeWord
  );

  if (duplicate) {
    throw new Error('This word with the same settings already exists');
  }

  const newWord: PredefinedWord = {
    id: crypto.randomUUID(),
    word,
    caseSensitive,
    wholeWord,
    createdAt: Date.now(),
  };

  words.push(newWord);
  savePredefinedWords(words);

  return newWord;
}

/**
 * Update an existing predefined word
 */
export function updatePredefinedWord(
  id: string,
  updates: Partial<Omit<PredefinedWord, 'id' | 'createdAt'>>
): PredefinedWord {
  const words = getPredefinedWords();
  const index = words.findIndex(w => w.id === id);

  if (index === -1) {
    throw new Error('Word not found');
  }

  const updatedWord = {
    ...words[index],
    ...updates,
  };

  words[index] = updatedWord;
  savePredefinedWords(words);

  return updatedWord;
}

/**
 * Delete a predefined word
 */
export function deletePredefinedWord(id: string): void {
  const words = getPredefinedWords();
  const filtered = words.filter(w => w.id !== id);

  if (filtered.length === words.length) {
    throw new Error('Word not found');
  }

  savePredefinedWords(filtered);
}

/**
 * Delete multiple predefined words
 */
export function deletePredefinedWords(ids: string[]): void {
  const words = getPredefinedWords();
  const filtered = words.filter(w => !ids.includes(w.id));
  savePredefinedWords(filtered);
}

/**
 * Clear all predefined words
 */
export function clearPredefinedWords(): void {
  savePredefinedWords([]);
}

/**
 * Script types for different writing systems
 */
enum ScriptType {
  LATIN = 'latin',           // English, European languages
  CJK = 'cjk',               // Chinese, Japanese, Korean
  ARABIC = 'arabic',         // Arabic, Persian, Urdu (RTL)
  HEBREW = 'hebrew',         // Hebrew (RTL)
  DEVANAGARI = 'devanagari', // Hindi, Sanskrit, Marathi, Nepali
  THAI = 'thai',             // Thai, Lao
  CYRILLIC = 'cyrillic',     // Russian, Ukrainian, Bulgarian, etc.
  HANGUL = 'hangul',         // Korean (separate from CJK for specific handling)
}

/**
 * Detect the primary script type of a word based on Unicode ranges
 */
function detectScriptType(word: string): ScriptType {
  // Check Unicode ranges in order of specificity

  // CJK Unified Ideographs (Chinese characters used in Chinese, Japanese, Korean)
  if (/[\u4E00-\u9FFF]/.test(word)) {
    return ScriptType.CJK;
  }

  // Japanese Hiragana and Katakana
  if (/[\u3040-\u309F\u30A0-\u30FF]/.test(word)) {
    return ScriptType.CJK;
  }

  // Korean Hangul
  if (/[\uAC00-\uD7AF\u1100-\u11FF]/.test(word)) {
    return ScriptType.HANGUL;
  }

  // Arabic and Arabic Extended
  if (/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(word)) {
    return ScriptType.ARABIC;
  }

  // Hebrew
  if (/[\u0590-\u05FF]/.test(word)) {
    return ScriptType.HEBREW;
  }

  // Devanagari (Hindi, Sanskrit, Marathi, Nepali)
  if (/[\u0900-\u097F]/.test(word)) {
    return ScriptType.DEVANAGARI;
  }

  // Thai
  if (/[\u0E00-\u0E7F]/.test(word)) {
    return ScriptType.THAI;
  }

  // Lao (similar to Thai)
  if (/[\u0E80-\u0EFF]/.test(word)) {
    return ScriptType.THAI; // Use same handling as Thai
  }

  // Cyrillic
  if (/[\u0400-\u04FF]/.test(word)) {
    return ScriptType.CYRILLIC;
  }

  // Default to Latin
  return ScriptType.LATIN;
}

/**
 * Create pattern for Latin-based scripts (English, European languages)
 * Allows optional whitespace between characters, limited to cross max 1 line break
 */
function createLatinPattern(word: PredefinedWord): RegExp {
  // Split into characters first, then escape each character individually
  // This prevents splitting escape sequences like \. or \[
  const chars = Array.from(word.word);
  const escapedChars = chars.map(char => char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

  // Allow optional whitespace between characters (spaces, tabs, and limited newlines)
  // Pattern: [ \t]* (optional spaces/tabs) followed by optional single newline, then more optional spaces/tabs
  let pattern = escapedChars.join("[ \t]*\\n?[ \t]*");

  if (word.wholeWord) {
    const startsWithWordChar = /^[a-zA-Z0-9_]/.test(word.word);
    const endsWithWordChar = /[a-zA-Z0-9_]$/.test(word.word);

    const startBoundary = startsWithWordChar ? '\\b' : '(?:^|(?<=[\\s\\p{P}]))';
    const endBoundary = endsWithWordChar ? '\\b' : '(?:$|(?=[\\s\\p{P}]))';

    pattern = `${startBoundary}${pattern}${endBoundary}`;
  }

  const flags = word.caseSensitive ? 'gu' : 'giu';
  return new RegExp(pattern, flags);
}

/**
 * Create pattern for CJK scripts (Chinese, Japanese Kanji)
 * CJK text often wraps across lines without spaces, so we allow newlines between characters
 * Limited to at most 2 lines (1 line break) to avoid matching unrelated text
 */
function createCJKPattern(word: PredefinedWord): RegExp {
  // Split into characters first, then escape each character individually
  const chars = Array.from(word.word);
  const escapedChars = chars.map(char => char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

  // Allow optional whitespace between characters including line breaks
  // CJK text can wrap mid-word, so we need to allow newlines
  // Pattern: optional spaces/tabs, optional single newline, optional spaces/tabs
  let pattern = escapedChars.join("[ \t]*\\n?[ \t]*");

  if (word.wholeWord) {
    // CJK doesn't use word boundaries like Latin scripts
    // Use whitespace or punctuation as boundaries
    pattern = `(?:^|(?<=[\\s\\p{P}]))${pattern}(?:$|(?=[\\s\\p{P}]))`;
  }

  const flags = word.caseSensitive ? 'gu' : 'giu';
  return new RegExp(pattern, flags);
}

/**
 * Create pattern for Korean Hangul
 * Similar to CJK but Hangul can use spaces between words
 */
function createHangulPattern(word: PredefinedWord): RegExp {
  // Split into characters first, then escape each character individually
  const chars = Array.from(word.word);
  const escapedChars = chars.map(char => char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

  // Allow optional whitespace between characters including line breaks
  let pattern = escapedChars.join("[ \t]*\\n?[ \t]*");

  if (word.wholeWord) {
    pattern = `(?:^|(?<=[\\s\\p{P}]))${pattern}(?:$|(?=[\\s\\p{P}]))`;
  }

  const flags = word.caseSensitive ? 'gu' : 'giu';
  return new RegExp(pattern, flags);
}

/**
 * Create pattern for Arabic script (Arabic, Persian, Urdu)
 * Handles optional diacritical marks (harakat) that may appear between characters
 * Also allows for cross-line matching
 */
function createArabicPattern(word: PredefinedWord): RegExp {
  // Split into characters first, then escape each character individually
  const chars = Array.from(word.word);
  const escapedChars = chars.map(char => char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

  // Insert optional diacritics and whitespace between characters
  // Arabic diacritics: U+064B-U+065F (common diacritics), U+0670 (superscript alef)
  // Also allow whitespace for line breaks
  let pattern = escapedChars.join("[\\u064B-\\u065F\\u0670 \\t]*\\n?[\\u064B-\\u065F\\u0670 \\t]*");

  if (word.wholeWord) {
    // Arabic word boundaries
    pattern = `(?:^|(?<=[\\s\\p{P}]))${pattern}(?:$|(?=[\\s\\p{P}]))`;
  }

  const flags = word.caseSensitive ? 'gu' : 'giu';
  return new RegExp(pattern, flags);
}

/**
 * Create pattern for Hebrew script
 * Handles optional diacritical marks (niqqud) and cross-line matching
 */
function createHebrewPattern(word: PredefinedWord): RegExp {
  // Split into characters first, then escape each character individually
  const chars = Array.from(word.word);
  const escapedChars = chars.map(char => char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

  // Insert optional diacritics and whitespace between characters
  // Hebrew diacritics (niqqud): U+0591-U+05C7
  let pattern = escapedChars.join("[\\u0591-\\u05C7 \\t]*\\n?[\\u0591-\\u05C7 \\t]*");

  if (word.wholeWord) {
    pattern = `(?:^|(?<=[\\s\\p{P}]))${pattern}(?:$|(?=[\\s\\p{P}]))`;
  }

  const flags = word.caseSensitive ? 'gu' : 'giu';
  return new RegExp(pattern, flags);
}

/**
 * Create pattern for Devanagari script (Hindi, Sanskrit, Marathi, Nepali)
 * Handles combining characters (vowel signs, virama) and cross-line matching
 */
function createDevanagariPattern(word: PredefinedWord): RegExp {
  // Split into characters first, then escape each character individually
  const chars = Array.from(word.word);
  const escapedChars = chars.map(char => char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

  // Insert optional combining characters and whitespace between characters
  // Devanagari combining marks: U+0900-U+0903 (signs), U+093A-U+094F (vowel signs),
  // U+0951-U+0957 (stress marks), U+0962-U+0963 (vowels for Sanskrit)
  let pattern = escapedChars.join("[\\u0900-\\u0903\\u093A-\\u094F\\u0951-\\u0957\\u0962-\\u0963 \\t]*\\n?[\\u0900-\\u0903\\u093A-\\u094F\\u0951-\\u0957\\u0962-\\u0963 \\t]*");

  if (word.wholeWord) {
    pattern = `(?:^|(?<=[\\s\\p{P}]))${pattern}(?:$|(?=[\\s\\p{P}]))`;
  }

  const flags = word.caseSensitive ? 'gu' : 'giu';
  return new RegExp(pattern, flags);
}

/**
 * Create pattern for Thai/Lao scripts
 * Handles tone marks and vowels that combine with consonants
 */
function createThaiPattern(word: PredefinedWord): RegExp {
  // Split into characters first, then escape each character individually
  const chars = Array.from(word.word);
  const escapedChars = chars.map(char => char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

  // Insert optional combining characters and whitespace between characters
  // Thai combining marks: U+0E31 (mai han-akat), U+0E34-U+0E3A (vowels and signs),
  // U+0E47-U+0E4E (tone marks and signs)
  let pattern = escapedChars.join("[\\u0E31\\u0E34-\\u0E3A\\u0E47-\\u0E4E \\t]*\\n?[\\u0E31\\u0E34-\\u0E3A\\u0E47-\\u0E4E \\t]*");

  if (word.wholeWord) {
    // Thai doesn't use consistent word spacing, use punctuation boundaries
    pattern = `(?:^|(?<=[\\s\\p{P}]))${pattern}(?:$|(?=[\\s\\p{P}]))`;
  }

  const flags = word.caseSensitive ? 'gu' : 'giu';
  return new RegExp(pattern, flags);
}

/**
 * Create pattern for Cyrillic script (Russian, Ukrainian, Bulgarian, etc.)
 * Similar to Latin but for Cyrillic character set
 */
function createCyrillicPattern(word: PredefinedWord): RegExp {
  // Split into characters first, then escape each character individually
  const chars = Array.from(word.word);
  const escapedChars = chars.map(char => char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

  // Allow optional whitespace between characters
  let pattern = escapedChars.join("[ \t]*\\n?[ \t]*");

  if (word.wholeWord) {
    // Cyrillic word boundaries - \b doesn't work with Cyrillic, use Unicode property classes
    // Use lookbehind/lookahead for whitespace or punctuation boundaries
    pattern = `(?:^|(?<=[\\s\\p{P}]))${pattern}(?:$|(?=[\\s\\p{P}]))`;
  }

  const flags = word.caseSensitive ? 'gu' : 'giu';
  return new RegExp(pattern, flags);
}

/**
 * Create a regex pattern from a predefined word
 * Automatically detects the script type and creates appropriate pattern
 * with language-specific handling for diacritics, combining characters, and cross-line matching
 */
export function createPatternFromWord(word: PredefinedWord): RegExp {
  const scriptType = detectScriptType(word.word);
  console.debug(`Predefined word ${word.word} detected script type: ${scriptType}`);

  switch (scriptType) {
    case ScriptType.CJK:
      return createCJKPattern(word);
    case ScriptType.HANGUL:
      return createHangulPattern(word);
    case ScriptType.ARABIC:
      return createArabicPattern(word);
    case ScriptType.HEBREW:
      return createHebrewPattern(word);
    case ScriptType.DEVANAGARI:
      return createDevanagariPattern(word);
    case ScriptType.THAI:
      return createThaiPattern(word);
    case ScriptType.CYRILLIC:
      return createCyrillicPattern(word);
    case ScriptType.LATIN:
    default:
      return createLatinPattern(word);
  }
}
