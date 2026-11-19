import { EntityType } from '@/lib/types';
import type { RulePack } from './types';

export const BUILTIN_PACK_ID = 'builtin';

/** Regex source and flags without "g"; matching is always global */
function rx(regex: RegExp): { pattern: string; flags: string } {
  return { pattern: regex.source, flags: regex.flags.replace('g', '') };
}

/** English month names and abbreviations, with or without a period */
const MONTH = String.raw`Jan(?:uary|\.)?|Feb(?:ruary|\.)?|Mar(?:ch|\.)?|Apr(?:il|\.)?|May|Jun(?:e|\.)?|Jul(?:y|\.)?|Aug(?:ust|\.)?|Sep(?:t(?:ember)?)?\.?|Oct(?:ober|\.)?|Nov(?:ember|\.)?|Dec(?:ember|\.)?`;

/** Day of the month, with an optional ordinal suffix (3rd) */
const DAY = String.raw`(?:0?[1-9]|[12]\d|3[01])(?:st|nd|rd|th)?`;

/** Labels that make an ambiguous number a date */
const DATE_KEYWORDS = ['date', 'dated', 'dob', 'd.o.b', 'birth', 'born', 'birthday', 'issued', 'expiry', 'expires', 'valid until', '日期', '出生', '生日', '签发', '有效期'];

/**
 * Built-in rules, in the same format as user rule packs
 *
 * Script filtering: Each pattern can specify applicable scripts to reduce false positives.
 * If no scripts are specified, the pattern is considered universal (applies to all languages).
 * Common script values: 'latin', 'chinese', 'japanese', 'korean', 'arabic', 'hebrew',
 * 'devanagari', 'thai', 'cyrillic', 'cjk', 'mixed'
 */
export const BUILTIN_PACK: RulePack = {
  id: BUILTIN_PACK_ID,
  name: 'Built-in rules',
  rules: [
    // Social Security Number (US)
    // Pattern rejects invalid area (000, 666), group (00), and serial (0000) numbers
    {
      id: 'ssn-us',
      name: 'SSN (US)',
      entityType: EntityType.ID_NUMBER,
      // Same separator in both places: 123-45-6789 or 123 45 6789
      ...rx(/\b(?!000|666)\d{3}([- ])(?!00)\d{2}\1(?!0000)\d{4}\b/g),
      confidence: 0.85,
      validator: 'us-ssn',
      examples: ['123-45-6789', '123 45 6789'],
      scripts: ['latin'], // US-specific, primarily Latin script documents
      contextKeywords: ['ssn', 'social security', 'social security number', 'ss#', 'ss #'],
      contextWindow: 30, // Look within 30 chars for "SSN" label
      confidenceBoost: 1.15, // +15% confidence boost when keyword found
    },

    // Bare 9-digit SSN: indistinguishable from invoice/order numbers on its own,
    // so it stays below the default threshold unless an SSN label is nearby
    {
      id: 'ssn-us-no-separators',
      name: 'SSN (US, no separators)',
      entityType: EntityType.ID_NUMBER,
      ...rx(/\b(?!000|666)\d{3}(?!00)\d{2}(?!0000)\d{4}\b/g),
      confidence: 0.5,
      validator: 'us-ssn',
      examples: ['123456789'],
      scripts: ['latin'],
      contextKeywords: ['ssn', 'social security', 'social security number', 'ss#', 'ss #'],
      contextWindow: 30,
      confidenceBoost: 1.8, // 0.5 → 0.9 with an SSN label
    },

    // Chinese National ID Card (18 digits with check digit)
    // Format: RRRRRRYYYYMMDDSSSC (Region + Date + Sequential + Check)
    // Also accepts the common 6-8-4 grouping with a space or hyphen.
    // No script filter: the checksum keeps false positives low, and IDs appear in
    // short forms (too few letters for script detection) and English documents.
    {
      id: 'chinese-national-id',
      name: 'Chinese National ID',
      entityType: EntityType.ID_NUMBER,
      ...rx(/\b[1-9]\d{5}[ -]?(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])[ -]?\d{3}[\dXx]\b/g),
      confidence: 0.7,
      validator: 'cn-id',
      examples: ['11010519491231002X', '110105 19491231 002X'],
      contextKeywords: ['身份证', '身份证号', '身份号码', 'id', 'id card', 'identity', 'national id', '证件'],
      contextWindow: 25, // Moderate window for ID context
      confidenceBoost: 1.2, // +20% confidence boost when keyword found
    },

    // Chinese Passport (Current format: E + Letter + 7 digits)
    // Excludes I, O, P, Q to avoid confusion
    {
      id: 'chinese-passport-current',
      name: 'Chinese Passport (Current)',
      entityType: EntityType.ID_NUMBER,
      ...rx(/\bE[A-HJ-NR-Z]\d{7}\b/g),
      confidence: 0.95,
      examples: ['EA1234567', 'EB9876543'],
      scripts: ['chinese', 'cjk'], // China-specific
      contextKeywords: ['护照', '护照号', 'passport', 'passport number', 'passport no'],
      contextWindow: 25, // Moderate window for passport context
      confidenceBoost: 1.05, // +5% confidence boost (already high confidence)
    },

    // Chinese Passport (Legacy format: E + 8 digits)
    {
      id: 'chinese-passport-legacy',
      name: 'Chinese Passport (Legacy)',
      entityType: EntityType.ID_NUMBER,
      ...rx(/\bE\d{8}\b/g),
      confidence: 0.90,
      examples: ['E12345678'],
      scripts: ['chinese', 'cjk'], // China-specific
      contextKeywords: ['护照', '护照号', 'passport', 'passport number', 'passport no'],
      contextWindow: 25, // Moderate window for passport context
      confidenceBoost: 1.1, // +10% confidence boost
    },

    // US Passport (Current format: Letter + 8 digits)
    {
      id: 'us-passport',
      name: 'US Passport',
      entityType: EntityType.ID_NUMBER,
      ...rx(/\b[A-Z]\d{8}\b/g),
      confidence: 0.40,
      examples: ['C12345678', 'A98765432'],
      scripts: ['latin'], // US-specific
      contextKeywords: ['passport', 'passport number', 'passport no', 'passport #', 'us passport'],
      contextWindow: 30, // Moderate window for passport context
      confidenceBoost: 2, // confidence boost (higher due to lower base confidence)
    },

    // Email Address (RFC 5322 simplified)
    {
      id: 'email',
      name: 'Email',
      entityType: EntityType.EMAIL,
      ...rx(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g),
      confidence: 0.95,
      examples: ['user@example.com', 'name.surname+tag@domain.co.uk'],
    },

    // Phone Number (US and International formats)
    {
      id: 'phone-us',
      name: 'Phone (US)',
      entityType: EntityType.PHONE,
      // Lookbehind instead of \b so a leading "(" or "+" is part of the match.
      // Requires parentheses or separators; bare digit runs are handled below.
      ...rx(/(?<![\w+(])(?:\+?1[-.\s]?)?(?:\(\d{3}\)[-.\s]?|\d{3}[-.\s])\d{3}[-.\s]\d{4}\b/g),
      confidence: 0.90,
      validator: 'us-phone',
      examples: [
        '(212) 456-7890',
        '212-456-7890',
        '212.456.7890',
        '+1-212-456-7890',
      ],
      scripts: ['latin'], // US-specific
      contextKeywords: ['phone', 'tel', 'telephone', 'mobile', 'cell', 'contact', 'call'],
      contextWindow: 40, // Look within 40 chars for phone-related keywords
      confidenceBoost: 1.1, // +10% confidence boost when keyword found
    },

    // Bare 10/11-digit US number: easily an order or account number,
    // so it stays below the default threshold unless a phone label is nearby
    {
      id: 'phone-us-no-separators',
      name: 'Phone (US, no separators)',
      entityType: EntityType.PHONE,
      ...rx(/(?<![\w+])(?:\+?1)?\d{10}\b/g),
      confidence: 0.5,
      validator: 'us-phone',
      examples: ['2124567890', '+12124567890'],
      scripts: ['latin'],
      contextKeywords: ['phone', 'tel', 'telephone', 'mobile', 'cell', 'contact', 'call'],
      contextWindow: 40,
      confidenceBoost: 1.8, // 0.5 → 0.9 with a phone label
    },

    // Phone Number (International)
    {
      id: 'phone-international',
      name: 'Phone (International)',
      entityType: EntityType.PHONE,
      // \b can't precede "+" (it needs a word character before it), so use a lookbehind
      ...rx(/(?<![\w+])\+\d{1,3}[-.\s]?\d{1,4}[-.\s]?\d{1,4}[-.\s]?\d{1,9}\b/g),
      confidence: 0.85,
      validator: 'intl-phone',
      examples: ['+44 20 7123 4567', '+86 138 0013 8000'],
      contextKeywords: ['phone', 'tel', 'telephone', 'mobile', 'cell', 'contact', 'call'],
      contextWindow: 40, // Look within 40 chars for phone-related keywords
      confidenceBoost: 1.1, // +10% confidence boost when keyword found
    },

    // Phone Number (China Mobile - 11 digits starting with 1)
    {
      id: 'phone-china-mobile',
      name: 'Phone (China Mobile)',
      entityType: EntityType.PHONE,
      ...rx(/\b1[3-9]\d[-\s]?\d{4}[-\s]?\d{4}\b/g),
      confidence: 0.90,
      validator: 'cn-mobile',
      examples: [
        '138-0013-8000',
        '13800138000',
        '158 0013 8000',
        '186-1234-5678',
      ],
      scripts: ['chinese', 'cjk'], // China-specific
      contextKeywords: ['电话', '手机', '联系', 'phone', 'mobile', 'tel', 'contact'],
      contextWindow: 20, // Smaller window for Chinese (characters are denser)
      confidenceBoost: 1.15, // +15% confidence boost when keyword found
    },

    // Phone Number (China Landline)
    {
      id: 'phone-china-landline',
      name: 'Phone (China Landline)',
      entityType: EntityType.PHONE,
      ...rx(/\b0\d{2,3}[-\s]?\d{7,8}\b/g),
      confidence: 0.65,
      examples: [
        '010-12345678', // Beijing
        '021-12345678', // Shanghai
        '0755-1234567', // Shenzhen
        '0571-12345678', // Hangzhou
      ],
      scripts: ['chinese', 'cjk'], // China-specific
      contextKeywords: ['电话', '座机', '固话', 'phone', 'tel', 'landline'],
      contextWindow: 20, // Smaller window for Chinese (characters are denser)
      confidenceBoost: 1.2, // +20% confidence boost when keyword found (higher due to lower base confidence)
    },

    // Credit Card Numbers (13-19 digits, all major card types)
    // Supports Visa, Mastercard, Amex, Discover, UnionPay, etc.
    {
      id: 'credit-card-generic',
      name: 'Credit Card (Generic)',
      entityType: EntityType.CREDIT_CARD,
      // Contiguous digits, or the standard groupings (4-4-4-4[-3], Amex 4-6-5, 4-4-4-1..3).
      // Free-form "digit, optional separator" runs swallowed whatever number came next
      // (e.g. "…0000 50"), failed Luhn, and lost the card.
      ...rx(/\b(?:\d{13,19}|\d{4}(?:[- ]\d{4}){3}(?:[- ]\d{3})?|\d{4}[- ]\d{6}[- ]\d{4,5}|\d{4}(?:[- ]\d{4}){2}[- ]\d{1,3})\b/g),
      confidence: 0.4,
      validator: 'credit-card',
      examples: [
        '4532-1234-5678-9014', // Visa 16
        '4532 1234 5678 9014', // Visa 16 with spaces
        '4532123456789014', // Visa 16 no separators
        '4222-2222-2222-2', // Visa 13
        '3782-822463-10005', // Amex 15
        '6212-3456-7890-1234-569', // UnionPay 19
      ],
      contextKeywords: ['card', 'credit', 'debit', 'visa', 'mastercard', 'amex', 'payment', 'cc', 'card number', '信用卡', '银行卡'],
      contextWindow: 50, // Larger window for credit card context
      confidenceBoost: 2, // Doubles confidence (critical for low base confidence patterns)
    },

    // Visa Credit Cards (13 or 16 digits starting with 4)
    {
      id: 'credit-card-visa',
      name: 'Credit Card (Visa)',
      entityType: EntityType.CREDIT_CARD,
      ...rx(/\b4\d{3}[-\s]?\d{4}[-\s]?\d{4}[-\s]?(?:\d{4}|\d{1})\b/g),
      confidence: 0.6,
      validator: 'luhn',
      examples: ['4532-1234-5678-9014', '4222222222222'],
    },

    // Mastercard (16 digits, starts with 51-55 or 2221-2720)
    {
      id: 'credit-card-mastercard',
      name: 'Credit Card (Mastercard)',
      entityType: EntityType.CREDIT_CARD,
      ...rx(/\b(?:5[1-5]\d{2}|222[1-9]|22[3-9]\d|2[3-6]\d{2}|27[01]\d|2720)[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g),
      confidence: 0.6,
      validator: 'luhn',
      examples: ['5500-0000-0000-0004', '2221-0000-0000-0009'],
    },

    // American Express (15 digits, starts with 34 or 37)
    {
      id: 'credit-card-amex',
      name: 'Credit Card (Amex)',
      entityType: EntityType.CREDIT_CARD,
      ...rx(/\b3[47]\d{2}[-\s]?\d{6}[-\s]?\d{5}\b/g),
      confidence: 0.6,
      validator: 'luhn',
      examples: ['3782-822463-10005', '371449635398431'],
    },

    // Discover (16 digits, starts with 6011 or 65)
    {
      id: 'credit-card-discover',
      name: 'Credit Card (Discover)',
      entityType: EntityType.CREDIT_CARD,
      ...rx(/\b6(?:011|5\d{2})[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g),
      confidence: 0.6,
      validator: 'luhn',
      examples: ['6011-0000-0000-0004', '6500-0000-0000-0002'],
    },

    // China UnionPay (16-19 digits, starts with 62)
    {
      id: 'credit-card-unionpay',
      name: 'Credit Card (UnionPay)',
      entityType: EntityType.CREDIT_CARD,
      ...rx(/\b62\d{14,17}\b/g),
      confidence: 0.6,
      validator: 'luhn',
      examples: ['6212345678901232', '6212345678901234569'],
    },

    // Date patterns (various formats)
    {
      id: 'date-mm-dd-yyyy',
      name: 'Date (MM/DD/YYYY)',
      entityType: EntityType.DATE,
      // Same separator in both places: 01/15/2024, 01-15-2024, 01.15.2024
      ...rx(/\b(?:0?[1-9]|1[0-2])([/.-])(?:0?[1-9]|[12][0-9]|3[01])\1(?:19|20)\d{2}\b/g),
      confidence: 0.85,
      examples: ['01/15/2024', '12/31/2023', '1/1/2024', '01-15-2024'],
    },

    {
      id: 'date-yyyy-mm-dd',
      name: 'Date (YYYY-MM-DD)',
      entityType: EntityType.DATE,
      ...rx(/\b(?:19|20)\d{2}([/.-])(?:0?[1-9]|1[0-2])\1(?:0?[1-9]|[12][0-9]|3[01])\b/g),
      confidence: 0.85,
      examples: ['2024-01-15', '2023-12-31', '2024/01/15', '2024.1.15'],
    },

    {
      id: 'date-month-dd-yyyy',
      name: 'Date (Month DD, YYYY)',
      entityType: EntityType.DATE,
      ...rx(new RegExp(String.raw`\b(?:${MONTH})\s+${DAY},?\s+(?:19|20)\d{2}\b`, 'gi')),
      confidence: 0.85,
      examples: ['January 15, 2024', 'Jan 15, 2024', 'Sept. 3 2024', 'March 3rd, 2024'],
    },

    {
      id: 'date-dd-month-yyyy',
      name: 'Date (DD Month YYYY)',
      entityType: EntityType.DATE,
      ...rx(new RegExp(String.raw`\b${DAY}(?:\s+of)?\s+(?:${MONTH}),?\s+(?:19|20)\d{2}\b`, 'gi')),
      confidence: 0.85,
      examples: ['15 January 2024', '15th Jan 2024', '3rd of March, 2024'],
    },

    // Month and year only: less specific, so it sits at the default threshold
    {
      id: 'date-month-yyyy',
      name: 'Date (Month YYYY)',
      entityType: EntityType.DATE,
      // Capitalized only, so "may 2024" in running text isn't a date; skips the
      // tail of "15 January 2024", which the rule above detects in full
      ...rx(new RegExp(String.raw`(?<!\d(?:st|nd|rd|th)?\s+(?:of\s+)?)\b(?:${MONTH})\s+(?:19|20)\d{2}\b`, 'g')),
      confidence: 0.7,
      examples: ['January 2024', 'Sept 2023'],
    },

    // DD/MM/YYYY (International format)
    {
      id: 'date-dd-mm-yyyy',
      name: 'Date (DD/MM/YYYY)',
      entityType: EntityType.DATE,
      // Same separator in both places: 15/01/2024, 15-01-2024, 15.01.2024
      ...rx(/\b(?:0?[1-9]|[12][0-9]|3[01])([/.-])(?:0?[1-9]|1[0-2])\1(?:19|20)\d{2}\b/g),
      confidence: 0.75,
      examples: ['15/01/2024', '31/12/2023', '1/1/2024', '15.01.2024'],
    },

    // 2-digit year: could be MM/DD/YY or DD/MM/YY, and reads like other slashed
    // numbers, so it needs a date label nearby to pass the default threshold
    {
      id: 'date-short-year',
      name: 'Date (MM/DD/YY)',
      entityType: EntityType.DATE,
      ...rx(/\b\d{1,2}\/\d{1,2}\/\d{2}\b/g),
      confidence: 0.6,
      validator: 'short-year-date',
      examples: ['01/15/24', '31/12/23'],
      contextKeywords: DATE_KEYWORDS,
      contextWindow: 30,
      confidenceBoost: 1.5, // 0.6 → 0.9 with a date label
    },

    // YYYYMMDD: indistinguishable from order or account numbers on its own
    {
      id: 'date-compact',
      name: 'Date (YYYYMMDD)',
      entityType: EntityType.DATE,
      ...rx(/\b(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\b/g),
      confidence: 0.5,
      validator: 'compact-date',
      examples: ['20240115'],
      contextKeywords: DATE_KEYWORDS,
      contextWindow: 30,
      confidenceBoost: 1.8, // 0.5 → 0.9 with a date label
    },

    // Chinese Date Format (YYYY年MM月DD日), also with spaces, 号, or full-width digits
    {
      id: 'date-chinese',
      name: 'Date (Chinese)',
      entityType: EntityType.DATE,
      ...rx(/(?<![0-9０-９])[12１２][0-9０-９]{3}\s*年\s*[0-9０-９]{1,2}\s*月\s*[0-9０-９]{1,2}\s*[日号]/g),
      confidence: 0.90,
      validator: 'cn-date',
      examples: ['2024年1月15日', '2024年01月15日', '2024 年 1 月 15 日', '2024年1月15号', '２０２４年１月１５日'],
      scripts: ['chinese', 'japanese', 'cjk'], // Chinese/Japanese date format
    },

    // Chinese year and month (2024年1月), or month and day (1月15日)
    {
      id: 'date-chinese-partial',
      name: 'Date (Chinese, partial)',
      entityType: EntityType.DATE,
      ...rx(/(?<![0-9０-９])[12１２][0-9０-９]{3}\s*年\s*[0-9０-９]{1,2}\s*月(?!\s*[0-9０-９])|(?<![0-9０-９]|年\s*)[0-9０-９]{1,2}\s*月\s*[0-9０-９]{1,2}\s*[日号]/g),
      confidence: 0.7,
      validator: 'cn-date',
      examples: ['2024年1月', '1月15日', '12月31号'],
      scripts: ['chinese', 'japanese', 'cjk'],
    },

    // Chinese numerals, as in court judgments and contracts (二〇二四年一月十五日)
    {
      id: 'date-chinese-numerals',
      name: 'Date (Chinese numerals)',
      entityType: EntityType.DATE,
      ...rx(/[〇零一二三四五六七八九]{4}\s*年\s*(?:十[一二]?|[一二三四五六七八九])\s*月(?:\s*(?:[一二]?十[一二三四五六七八九]?|三十一?|[一二三四五六七八九])\s*[日号])?/g),
      confidence: 0.85,
      examples: ['二〇二四年一月十五日', '一九九九年十二月三十一日', '二〇二四年三月'],
      scripts: ['chinese', 'japanese', 'cjk'],
    },

    // ============================================================================
    // OTHER PATTERNS (CUSTOM entity type)
    // ============================================================================

    // IPv4 Address
    // Clause numbers in legal and insurance documents (1.1.3.6) look exactly like IPs,
    // so skip longer dotted runs (1.1.3.6.2) and explicit clause markers, and keep
    // the base confidence below the default threshold unless network words are nearby.
    {
      id: 'ip-address-ipv4',
      name: 'IP Address (IPv4)',
      entityType: EntityType.CUSTOM,
      ...rx(/(?<![\d.]|(?:第|§|section|clause|article)\s*)(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(?!\.?\d)(?!\s*[条款项节章])/gi),
      confidence: 0.6,
      examples: ['192.168.1.1', '10.0.0.1', '172.16.0.1'],
      contextKeywords: ['ip', 'ip address', 'ipv4', 'server', 'host', 'hostname', 'gateway', 'dns', 'subnet', 'router', 'proxy', 'vpn', 'firewall', '服务器', '网关', '主机', '子网', '内网', '外网'],
      contextWindow: 30,
      confidenceBoost: 1.5, // 0.6 → 0.9 with network context
    },

    // IPv6 Address (simplified pattern)
    {
      id: 'ip-address-ipv6',
      name: 'IP Address (IPv6)',
      entityType: EntityType.CUSTOM,
      ...rx(/\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b/g),
      confidence: 0.90,
      examples: ['2001:0db8:85a3:0000:0000:8a2e:0370:7334'],
    },

    // URL with protocol (HTTP/HTTPS) - high confidence
    {
      id: 'url-with-protocol',
      name: 'URL (with protocol)',
      entityType: EntityType.CUSTOM,
      ...rx(/\bhttps?:\/\/[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z]{2,6}\b(?:[-a-zA-Z0-9()@:%_\+.~#?&\/=]*)/g),
      confidence: 0.95,
      examples: [
        'https://example.com',
        'http://subdomain.example.com/path',
        'https://example.com/path?query=value',
      ],
    },

    // URL without protocol - lower confidence to reduce false positives
    {
      id: 'url-without-protocol',
      name: 'URL (without protocol)',
      entityType: EntityType.CUSTOM,
      ...rx(/\b(?:www\.)[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z]{2,6}\b(?:[-a-zA-Z0-9()@:%_\+.~#?&\/=]*)/g),
      confidence: 0.70,
      examples: [
        'www.example.com',
        'www.subdomain.example.com/path',
      ],
    },

    // Bitcoin Address
    {
      id: 'crypto-bitcoin',
      name: 'Crypto (Bitcoin)',
      entityType: EntityType.CUSTOM,
      ...rx(/\b(?:[13][a-km-zA-HJ-NP-Z1-9]{25,34}|bc1[a-z0-9]{39,59})\b/g),
      confidence: 0.85,
      validator: 'bitcoin',
      examples: [
        '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
        'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
      ],
    },
  ],
};
