import { EntityType } from '@/lib/types';
import type { RegexPattern } from '@/lib/types';
import { getPredefinedWords, createPatternFromWord } from './predefined-words';
import { DocumentScript, detectDocumentScript } from './language-detection';
import { createLogger } from './logger';
import { BUILTIN_PACK } from '@/lib/rules/builtin-pack';
import { compilePack } from '@/lib/rules/compile';
import { getEnabledRulePatterns } from '@/lib/rules/store';

export { getContextConfidenceBoost } from '@/lib/rules/context';

const log = createLogger('RegexPatterns');

/** Every built-in rule, compiled; rules the user turned off are still included */
export const REGEX_PATTERNS: RegexPattern[] = compilePack(BUILTIN_PACK);

/**
 * Get all patterns for a specific entity type
 */
export function getPatternsByEntityType(entityType: EntityType): RegexPattern[] {
  return REGEX_PATTERNS.filter(pattern => pattern.entityType === entityType);
}

/**
 * Get pattern by name
 */
export function getPatternByName(name: string): RegexPattern | undefined {
  return REGEX_PATTERNS.find(pattern => pattern.name === name);
}

// Cache for patterns to avoid recreating them on every call
let cachedPatternsTimestamp = 0;
let cachedPatterns: RegexPattern[] | null = null;
const CACHE_DURATION = 100; // Cache for 100ms to avoid recreating during same detection cycle

/**
 * Get every enabled pattern: built-in rules, rule packs, and predefined words
 */
export function getAllPatterns(): RegexPattern[] {
  const now = Date.now();

  // Return cached patterns if still valid
  if (cachedPatterns && (now - cachedPatternsTimestamp) < CACHE_DURATION) {
    return cachedPatterns;
  }

  const predefinedWords = getPredefinedWords();

  // Convert predefined words to regex patterns
  const predefinedPatterns: RegexPattern[] = predefinedWords.map((word) => ({
    name: `Predefined: ${word.word}`,
    entityType: EntityType.PREDEFINED,
    pattern: createPatternFromWord(word),
    confidence: 1.0,
    examples: [word.word],
  }));

  cachedPatterns = [...getEnabledRulePatterns(), ...predefinedPatterns];
  cachedPatternsTimestamp = now;

  return cachedPatterns;
}

/**
 * Filter patterns based on detected document scripts
 * Returns patterns that are either universal (no scripts specified) or match any of the detected scripts
 * When the script is unknown (e.g. a short form like "电话：13800138000"), keep every pattern
 */
export function filterPatternsByScript(
  patterns: RegexPattern[],
  detectedScripts: DocumentScript[]
): RegexPattern[] {
  if (detectedScripts.includes(DocumentScript.UNKNOWN)) {
    return patterns;
  }

  return patterns.filter(pattern => {
    // If no scripts specified, pattern is universal (applies to all languages)
    if (!pattern.scripts || pattern.scripts.length === 0) {
      return true;
    }

    // Check if any detected script matches any of the pattern's applicable scripts
    return detectedScripts.some(detectedScript =>
      pattern.scripts!.includes(detectedScript.toString())
    );
  });
}

/**
 * Get patterns filtered by document language/script
 * Analyzes the text to detect language and returns only relevant patterns
 */
export function getPatternsForText(text: string): RegexPattern[] {
  const allPatterns = getAllPatterns();
  const detectedScripts = detectDocumentScript(text);
  const filteredPatterns = filterPatternsByScript(allPatterns, detectedScripts);

  log.debug('Selected patterns for text', { scripts: detectedScripts.join(','), patterns: filteredPatterns.length });

  return filteredPatterns;
}
