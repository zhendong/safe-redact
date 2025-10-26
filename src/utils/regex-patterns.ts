import { EntityType } from '@/lib/types';
import type { RegexPattern } from '@/lib/types';
import { getPredefinedWords, createPatternFromWord } from './predefined-words';
import { DocumentScript, detectDocumentScript } from './language-detection';

/**
 * Context validation helper
 * Checks if relevant keywords appear near the match to increase confidence
 */
function hasContextKeywords(
  text: string,
  matchIndex: number,
  matchLength: number,
  keywords: string[],
  windowSize: number
): boolean {
  const start = Math.max(0, matchIndex - windowSize);
  const end = Math.min(text.length, matchIndex + matchLength + windowSize);
  const context = text.substring(start, end).toLowerCase();

  return keywords.some(keyword => context.includes(keyword.toLowerCase()));
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

/**
 * Luhn algorithm for credit card validation
 */
function validateLuhn(cardNumber: string): boolean {
  const digits = cardNumber.replace(/\D/g, '');

  if (digits.length < 13 || digits.length > 19) {
    return false;
  }

  let sum = 0;
  let isEven = false;

  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = parseInt(digits[i], 10);

    if (isEven) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }

    sum += digit;
    isEven = !isEven;
  }

  return sum % 10 === 0;
}

/**
 * Validate SSN format (US Social Security Number)
 * Post-2011 randomization rules: allows 900-999 area numbers
 */
function validateSSN(ssn: string): boolean {
  const digits = ssn.replace(/\D/g, '');

  if (digits.length !== 9) {
    return false;
  }

  const area = parseInt(digits.substring(0, 3));
  const group = parseInt(digits.substring(3, 5));
  const serial = parseInt(digits.substring(5, 9));

  // Post-2011 rules (SSN randomization)
  // Area cannot be 000 or 666
  if (area === 0 || area === 666) {
    return false;
  }

  // Group cannot be 00
  if (group === 0) {
    return false;
  }

  // Serial cannot be 0000
  if (serial === 0) {
    return false;
  }

  return true;
}

/**
 * Validate Chinese National ID (18-digit format)
 * Validates check digit using ISO 7064:1983.MOD 11-2
 */
function validateChineseID(idNumber: string): boolean {
  const id = idNumber.trim().toUpperCase();

  if (id.length !== 18) {
    return false;
  }

  // Validate date portion (positions 6-13: YYYYMMDD)
  const year = parseInt(id.substring(6, 10));
  const month = parseInt(id.substring(10, 12));
  const day = parseInt(id.substring(12, 14));

  if (year < 1900 || year > 2100) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;

  // Validate check digit (position 17, last character)
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const checkCodes = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];

  let sum = 0;
  for (let i = 0; i < 17; i++) {
    sum += parseInt(id[i]) * weights[i];
  }

  const expectedCheck = checkCodes[sum % 11];
  const actualCheck = id[17];

  return expectedCheck === actualCheck;
}

/**
 * Validate US Phone Number
 * Excludes invalid area codes and exchanges
 */
function validateUSPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, '');

  // Extract area code and exchange (remove country code if present)
  const offset = digits.length === 11 ? 1 : 0;
  const areaCode = parseInt(digits.substring(offset, offset + 3));
  const exchange = parseInt(digits.substring(offset + 3, offset + 6));

  // Invalid area codes
  if (areaCode === 0 || areaCode === 1) return false;

  // 555-01XX is reserved for fictional use
  if (areaCode === 555 && exchange >= 100 && exchange <= 199) return false;

  // Valid format check
  if (digits.length !== 10 && digits.length !== 11) return false;

  return true;
}

/**
 * Validate International Phone Number
 * Ensures minimum digit count
 */
function validateInternationalPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, '');

  // Must have between 8 and 15 digits (excluding country code +)
  return digits.length >= 8 && digits.length <= 15;
}

/**
 * Validate China Mobile Number
 * Checks valid mobile prefixes
 */
function validateChinaMobile(phone: string): boolean {
  const digits = phone.replace(/\D/g, '');

  if (digits.length !== 11) return false;

  // Valid mobile prefixes (as of 2024)
  const validPrefixes = /^1(3\d|4[5-9]|5[0-35-9]|6[2567]|7[0-8]|8\d|9[0-35-9])/;
  return validPrefixes.test(digits);
}

/**
 * Predefined regex patterns for entity detection
 *
 * Script filtering: Each pattern can specify applicable scripts to reduce false positives.
 * If no scripts are specified, the pattern is considered universal (applies to all languages).
 * Common script values: 'latin', 'chinese', 'japanese', 'korean', 'arabic', 'hebrew',
 * 'devanagari', 'thai', 'cyrillic', 'cjk', 'mixed'
 */
export const REGEX_PATTERNS: RegexPattern[] = [
  // Social Security Number (US)
  // Pattern rejects invalid area (000, 666), group (00), and serial (0000) numbers
  {
    name: 'SSN (US)',
    entityType: EntityType.SSN,
    pattern: /\b(?!000|666)\d{3}[-\s]?(?!00)\d{2}[-\s]?(?!0000)\d{4}\b/g,
    confidence: 0.85,
    validator: validateSSN,
    examples: ['123-45-6789', '123 45 6789', '123456789'],
    scripts: ['latin'], // US-specific, primarily Latin script documents
    contextKeywords: ['ssn', 'social security', 'social security number', 'ss#', 'ss #'],
    contextWindowSize: 30, // Look within 30 chars for "SSN" label
    confidenceBoost: 1.15, // +15% confidence boost when keyword found
  },

  // Email Address (RFC 5322 simplified)
  {
    name: 'Email',
    entityType: EntityType.EMAIL,
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    confidence: 0.95,
    examples: ['user@example.com', 'name.surname+tag@domain.co.uk'],
  },

  // Phone Number (US and International formats)
  {
    name: 'Phone (US)',
    entityType: EntityType.PHONE,
    pattern: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    confidence: 0.90,
    validator: validateUSPhone,
    examples: [
      '(555) 123-4567',
      '555-123-4567',
      '555.123.4567',
      '+1-555-123-4567',
    ],
    scripts: ['latin'], // US-specific
    contextKeywords: ['phone', 'tel', 'telephone', 'mobile', 'cell', 'contact', 'call'],
    contextWindowSize: 40, // Look within 40 chars for phone-related keywords
    confidenceBoost: 1.1, // +10% confidence boost when keyword found
  },

  // Phone Number (International)
  {
    name: 'Phone (International)',
    entityType: EntityType.PHONE,
    pattern: /\b\+\d{1,3}[-.\s]?\d{1,4}[-.\s]?\d{1,4}[-.\s]?\d{1,9}\b/g,
    confidence: 0.85,
    validator: validateInternationalPhone,
    examples: ['+44 20 7123 4567', '+33 1 42 86 82 00', '+86 138 0013 8000'],
    contextKeywords: ['phone', 'tel', 'telephone', 'mobile', 'cell', 'contact', 'call'],
    contextWindowSize: 40, // Look within 40 chars for phone-related keywords
    confidenceBoost: 1.1, // +10% confidence boost when keyword found
  },

  // Phone Number (China Mobile - 11 digits starting with 1)
  {
    name: 'Phone (China Mobile)',
    entityType: EntityType.PHONE,
    pattern: /\b1[3-9]\d[-\s]?\d{4}[-\s]?\d{4}\b/g,
    confidence: 0.90,
    validator: validateChinaMobile,
    examples: [
      '138-0013-8000',
      '13800138000',
      '158 0013 8000',
      '186-1234-5678',
    ],
    scripts: ['chinese', 'cjk'], // China-specific
    contextKeywords: ['电话', '手机', '联系', 'phone', 'mobile', 'tel', 'contact'],
    contextWindowSize: 20, // Smaller window for Chinese (characters are denser)
    confidenceBoost: 1.15, // +15% confidence boost when keyword found
  },

  // Phone Number (China Landline)
  {
    name: 'Phone (China Landline)',
    entityType: EntityType.PHONE,
    pattern: /\b0\d{2,3}[-\s]?\d{7,8}\b/g,
    confidence: 0.65,
    examples: [
      '010-12345678', // Beijing
      '021-12345678', // Shanghai
      '0755-1234567', // Shenzhen
      '0571-12345678', // Hangzhou
    ],
    scripts: ['chinese', 'cjk'], // China-specific
    contextKeywords: ['电话', '座机', '固话', 'phone', 'tel', 'landline'],
    contextWindowSize: 20, // Smaller window for Chinese (characters are denser)
    confidenceBoost: 1.2, // +20% confidence boost when keyword found (higher due to lower base confidence)
  },

  // Credit Card Numbers (13-19 digits, all major card types)
  // Supports Visa, Mastercard, Amex, Discover, UnionPay, etc.
  {
    name: 'Credit Card (Generic)',
    entityType: EntityType.CREDIT_CARD,
    pattern: /\b(?:\d[-\s]?){12,18}\d\b/g,
    confidence: 0.4,
    validator: validateLuhn,
    examples: [
      '4532-1234-5678-9010', // Visa 16
      '4532 1234 5678 9010', // Visa 16 with spaces
      '4532123456789010', // Visa 16 no separators
      '4532-1234-5678-901', // Visa 13
      '3782-822463-10005', // Amex 15
      '6212-3456-7890-1234-567', // UnionPay 19
    ],
    contextKeywords: ['card', 'credit', 'debit', 'visa', 'mastercard', 'amex', 'payment', 'cc', 'card number', '信用卡', '银行卡'],
    contextWindowSize: 50, // Larger window for credit card context
    confidenceBoost: 2, // +30% confidence boost (critical for low base confidence patterns)
  },

  // Visa Credit Cards (13 or 16 digits starting with 4)
  {
    name: 'Credit Card (Visa)',
    entityType: EntityType.CREDIT_CARD,
    pattern: /\b4\d{3}[-\s]?\d{4}[-\s]?\d{4}[-\s]?(?:\d{4}|\d{1})\b/g,
    confidence: 0.6,
    validator: validateLuhn,
    examples: ['4532-1234-5678-9010', '4532-123-456-789'],
  },

  // Mastercard (16 digits, starts with 51-55 or 2221-2720)
  {
    name: 'Credit Card (Mastercard)',
    entityType: EntityType.CREDIT_CARD,
    pattern: /\b(?:5[1-5]\d{2}|222[1-9]|22[3-9]\d|2[3-6]\d{2}|27[01]\d|2720)[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,
    confidence: 0.6,
    validator: validateLuhn,
    examples: ['5500-0000-0000-0004', '2221-0000-0000-0009'],
  },

  // American Express (15 digits, starts with 34 or 37)
  {
    name: 'Credit Card (Amex)',
    entityType: EntityType.CREDIT_CARD,
    pattern: /\b3[47]\d{2}[-\s]?\d{6}[-\s]?\d{5}\b/g,
    confidence: 0.6,
    validator: validateLuhn,
    examples: ['3782-822463-10005', '371449635398431'],
  },

  // Discover (16 digits, starts with 6011 or 65)
  {
    name: 'Credit Card (Discover)',
    entityType: EntityType.CREDIT_CARD,
    pattern: /\b6(?:011|5\d{2})[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,
    confidence: 0.6,
    validator: validateLuhn,
    examples: ['6011-0000-0000-0004', '6500-0000-0000-0002'],
  },

  // China UnionPay (16-19 digits, starts with 62)
  {
    name: 'Credit Card (UnionPay)',
    entityType: EntityType.CREDIT_CARD,
    pattern: /\b62\d{14,17}\b/g,
    confidence: 0.6,
    validator: validateLuhn,
    examples: ['6212345678901234', '6212345678901234567'],
  },

  // Date patterns (various formats)
  {
    name: 'Date (MM/DD/YYYY)',
    entityType: EntityType.DATE,
    pattern: /\b(?:0?[1-9]|1[0-2])\/(?:0?[1-9]|[12][0-9]|3[01])\/(?:19|20)\d{2}\b/g,
    confidence: 0.85,
    examples: ['01/15/2024', '12/31/2023', '1/1/2024'],
  },

  {
    name: 'Date (YYYY-MM-DD)',
    entityType: EntityType.DATE,
    pattern: /\b(?:19|20)\d{2}-(?:0?[1-9]|1[0-2])-(?:0?[1-9]|[12][0-9]|3[01])\b/g,
    confidence: 0.85,
    examples: ['2024-01-15', '2023-12-31'],
  },

  {
    name: 'Date (Month DD, YYYY)',
    entityType: EntityType.DATE,
    pattern: /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b/gi,
    confidence: 0.80,
    examples: ['January 15, 2024', 'December 31, 2023'],
  },

  // Chinese Date Format (YYYY年MM月DD日)
  {
    name: 'Date (Chinese)',
    entityType: EntityType.DATE,
    pattern: /(?:19|20)\d{2}年(?:0?[1-9]|1[0-2])月(?:0?[1-9]|[12]\d|3[01])日/g,
    confidence: 0.90,
    examples: ['2024年1月15日', '2024年01月15日', '2023年12月31日'],
    scripts: ['chinese', 'japanese', 'cjk'], // Chinese/Japanese date format
  },

  // DD/MM/YYYY (International format)
  {
    name: 'Date (DD/MM/YYYY)',
    entityType: EntityType.DATE,
    pattern: /\b(?:0?[1-9]|[12][0-9]|3[01])\/(?:0?[1-9]|1[0-2])\/(?:19|20)\d{2}\b/g,
    confidence: 0.75,
    examples: ['15/01/2024', '31/12/2023', '1/1/2024'],
  },

  // ============================================================================
  // ADDITIONAL PATTERNS (Using CUSTOM entity type)
  // These patterns can be enabled by users who need them
  // ============================================================================

  // Chinese National ID Card (18 digits with check digit)
  // Format: RRRRRRYYYYMMDDSSSC (Region + Date + Sequential + Check)
  {
    name: 'Chinese National ID',
    entityType: EntityType.CUSTOM,
    pattern: /\b[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]\b/g,
    confidence: 0.7,
    validator: validateChineseID,
    examples: ['110101199001011234', '44030119950615123X'],
    scripts: ['chinese', 'cjk'], // China-specific
    contextKeywords: ['身份证', '身份证号', 'id', 'id card', 'identity', 'national id', '证件'],
    contextWindowSize: 25, // Moderate window for ID context
    confidenceBoost: 1.2, // +20% confidence boost when keyword found
  },

  // Chinese Passport (Current format: E + Letter + 7 digits)
  // Excludes I, O, P, Q to avoid confusion
  {
    name: 'Chinese Passport (Current)',
    entityType: EntityType.CUSTOM,
    pattern: /\bE[A-HJ-NR-Z]\d{7}\b/g,
    confidence: 0.95,
    examples: ['EA1234567', 'EB9876543'],
    scripts: ['chinese', 'cjk'], // China-specific
    contextKeywords: ['护照', '护照号', 'passport', 'passport number', 'passport no'],
    contextWindowSize: 25, // Moderate window for passport context
    confidenceBoost: 1.05, // +5% confidence boost (already high confidence)
  },

  // Chinese Passport (Legacy format: E + 8 digits)
  {
    name: 'Chinese Passport (Legacy)',
    entityType: EntityType.CUSTOM,
    pattern: /\bE\d{8}\b/g,
    confidence: 0.90,
    examples: ['E12345678'],
    scripts: ['chinese', 'cjk'], // China-specific
    contextKeywords: ['护照', '护照号', 'passport', 'passport number', 'passport no'],
    contextWindowSize: 25, // Moderate window for passport context
    confidenceBoost: 1.1, // +10% confidence boost
  },

  // US Passport (Current format: Letter + 8 digits)
  {
    name: 'US Passport',
    entityType: EntityType.CUSTOM,
    pattern: /\b[A-Z]\d{8}\b/g,
    confidence: 0.40,
    examples: ['C12345678', 'A98765432'],
    scripts: ['latin'], // US-specific
    contextKeywords: ['passport', 'passport number', 'passport no', 'passport #', 'us passport'],
    contextWindowSize: 30, // Moderate window for passport context
    confidenceBoost: 2, // confidence boost (higher due to lower base confidence)
  },

  // IPv4 Address
  {
    name: 'IP Address (IPv4)',
    entityType: EntityType.CUSTOM,
    pattern: /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g,
    confidence: 0.95,
    examples: ['192.168.1.1', '10.0.0.1', '172.16.0.1'],
  },

  // IPv6 Address (simplified pattern)
  {
    name: 'IP Address (IPv6)',
    entityType: EntityType.CUSTOM,
    pattern: /\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b/g,
    confidence: 0.90,
    examples: ['2001:0db8:85a3:0000:0000:8a2e:0370:7334'],
  },

  // URL with protocol (HTTP/HTTPS) - high confidence
  {
    name: 'URL (with protocol)',
    entityType: EntityType.CUSTOM,
    pattern: /\bhttps?:\/\/[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z]{2,6}\b(?:[-a-zA-Z0-9()@:%_\+.~#?&\/=]*)/g,
    confidence: 0.95,
    examples: [
      'https://example.com',
      'http://subdomain.example.com/path',
      'https://example.com/path?query=value',
    ],
  },

  // URL without protocol - lower confidence to reduce false positives
  {
    name: 'URL (without protocol)',
    entityType: EntityType.CUSTOM,
    pattern: /\b(?:www\.)[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z]{2,6}\b(?:[-a-zA-Z0-9()@:%_\+.~#?&\/=]*)/g,
    confidence: 0.70,
    examples: [
      'www.example.com',
      'www.subdomain.example.com/path',
    ],
  },

  // Bitcoin Address
  {
    name: 'Crypto (Bitcoin)',
    entityType: EntityType.CUSTOM,
    pattern: /\b(?:[13][a-km-zA-HJ-NP-Z1-9]{25,34}|bc1[a-z0-9]{39,59})\b/g,
    confidence: 0.85,
    examples: [
      '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
      'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
    ],
  },
];

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

/**
 * Test if a string matches any pattern
 */
export function testPatterns(text: string): boolean {
  return REGEX_PATTERNS.some(pattern => pattern.pattern.test(text));
}

// Cache for patterns to avoid recreating them on every call
let cachedPatternsTimestamp = 0;
let cachedPatterns: RegexPattern[] | null = null;
const CACHE_DURATION = 100; // Cache for 100ms to avoid recreating during same detection cycle

/**
 * Get all patterns including predefined words
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
    entityType: EntityType.CUSTOM,
    pattern: createPatternFromWord(word),
    confidence: 1.0,
    examples: [word.word],
  }));

  cachedPatterns = [...REGEX_PATTERNS, ...predefinedPatterns];
  cachedPatternsTimestamp = now;

  return cachedPatterns;
}

/**
 * Filter patterns based on detected document scripts
 * Returns patterns that are either universal (no scripts specified) or match any of the detected scripts
 */
export function filterPatternsByScript(
  patterns: RegexPattern[],
  detectedScripts: DocumentScript[]
): RegexPattern[] {
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

  console.debug(`Detected scripts: [${detectedScripts.join(', ')}], using patterns: ${filteredPatterns.map(p => p.name).join(', ')} `);

  return filteredPatterns;
}
