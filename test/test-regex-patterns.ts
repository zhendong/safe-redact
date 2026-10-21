/**
 * Comprehensive test suite for regex-patterns.ts
 * Tests all entity detection patterns with positive and negative cases
 *
 * NOTE: Some patterns have validators (Luhn check for credit cards, checksum for IDs, etc.)
 * Tests may fail if the test data doesn't pass these validators, even if the regex matches.
 * This is expected behavior and ensures high-quality detection.
 */
import { REGEX_PATTERNS, getPatternByName, getAllPatterns, getContextConfidenceBoost } from '../src/utils/regex-patterns';
import { EntityType } from '../src/lib/types';
import { addPredefinedWord, clearPredefinedWords } from '../src/utils/predefined-words';

// Mock localStorage for Node.js environment
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; }
  };
})();

(global as any).localStorage = localStorageMock;

interface TestCase {
  text: string;
  shouldMatch: boolean;
  description?: string;
  expectedMatch?: string; // Expected matched string
}

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function testRegexPattern(
  patternName: string,
  testCases: TestCase[]
) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`TEST: ${patternName}`);
  console.log(`${'='.repeat(80)}`);

  const patternDef = getPatternByName(patternName);
  if (!patternDef) {
    console.log(`❌ Pattern "${patternName}" not found!`);
    return;
  }

  console.log(`Entity Type: ${patternDef.entityType}`);
  console.log(`Pattern: ${patternDef.pattern.source}`);
  console.log(`Confidence: ${patternDef.confidence}`);
  console.log(`Has Validator: ${patternDef.validator ? 'Yes' : 'No'}`);
  console.log('');

  testCases.forEach(({ text, shouldMatch, description, expectedMatch }) => {
    totalTests++;
    // Reset pattern state
    patternDef.pattern.lastIndex = 0;

    const matches = text.match(patternDef.pattern);
    const validatedMatches = (matches ?? []).filter(match => !patternDef.validator || patternDef.validator(match));
    const didMatch = validatedMatches.length > 0;

    const passed = didMatch === shouldMatch && (!expectedMatch || validatedMatches[0] === expectedMatch);

    if (passed) {
      passedTests++;
    } else {
      failedTests++;
    }

    const status = passed ? '✓ PASS' : '✗ FAIL';
    const testDescription = description ? ` (${description})` : '';
    console.log(`${status}${testDescription}`);
    console.log(`  Text: "${text}"`);
    console.log(`  Expected: ${shouldMatch ? 'MATCH' : 'NO MATCH'}, Got: ${didMatch ? 'MATCH' : 'NO MATCH'}`);
    if (matches) {
      console.log(`  Matched: "${matches[0]}"`);
      if (expectedMatch && validatedMatches[0] !== expectedMatch) {
        console.log(`  ⚠️  Expected to match: "${expectedMatch}"`);
      }
    }
    console.log('');
  });
}

// =============================================================================
// SSN (US Social Security Number) TESTS
// =============================================================================

testRegexPattern('SSN (US, no separators)', [
  { text: '123456789', shouldMatch: true, description: 'Bare 9 digits' },
  { text: '000456789', shouldMatch: false, description: 'Invalid area 000' },
  { text: '1234567890', shouldMatch: false, description: '10 digits' },
]);

testRegexPattern('SSN (US)', [
  // Valid SSNs
  { text: '123-45-6789', shouldMatch: true, description: 'Valid SSN with dashes' },
  { text: '123 45 6789', shouldMatch: true, description: 'Valid SSN with spaces' },
  { text: '123456789', shouldMatch: false, description: 'No separators (handled by the low-confidence pattern)' },
  { text: '123-45 6789', shouldMatch: false, description: 'Mixed separators' },
  { text: 'SSN: 987-65-4321', shouldMatch: true, description: 'SSN in context' },
  { text: '900-12-3456', shouldMatch: true, description: 'Valid post-2011 area (900-999)' },

  // Invalid SSNs (should be rejected by validator)
  { text: '000-12-3456', shouldMatch: false, description: 'Invalid area 000' },
  { text: '666-12-3456', shouldMatch: false, description: 'Invalid area 666' },
  { text: '123-00-3456', shouldMatch: false, description: 'Invalid group 00' },
  { text: '123-45-0000', shouldMatch: false, description: 'Invalid serial 0000' },

  // Not SSNs
  { text: '12-345-6789', shouldMatch: false, description: 'Wrong format' },
  { text: '1234567890', shouldMatch: false, description: 'Too many digits' },
]);

// =============================================================================
// EMAIL TESTS
// =============================================================================

testRegexPattern('Email', [
  { text: 'a@b.c|m', shouldMatch: false, description: 'Pipe is not part of a TLD' },
  // Valid emails
  { text: 'user@example.com', shouldMatch: true, description: 'Simple email' },
  { text: 'john.doe@company.org', shouldMatch: true, description: 'Email with dot in name' },
  { text: 'name+tag@domain.co.uk', shouldMatch: true, description: 'Email with + and .co.uk' },
  { text: 'user123@test-domain.com', shouldMatch: true, description: 'Email with numbers and dash' },
  { text: 'Contact: admin@example.com', shouldMatch: true, description: 'Email in context' },
  { text: 'my.email_2024@company-site.io', shouldMatch: true, description: 'Complex valid email' },

  // Invalid emails
  { text: '@example.com', shouldMatch: false, description: 'Missing local part' },
  { text: 'user@', shouldMatch: false, description: 'Missing domain' },
  { text: 'user@.com', shouldMatch: false, description: 'Invalid domain' },
  { text: 'user name@example.com', shouldMatch: true, description: 'Extracts valid email from text', expectedMatch: 'name@example.com' },
  { text: 'not-an-email', shouldMatch: false, description: 'Not an email' },
]);

// =============================================================================
// PHONE NUMBER TESTS
// =============================================================================

testRegexPattern('Phone (US)', [
  // Valid US phone numbers (using 212 area code and exchange 456)
  { text: '(212) 456-7890', shouldMatch: true, description: 'US phone with parens' },
  { text: '212-456-7890', shouldMatch: true, description: 'US phone with dashes' },
  { text: '212.456.7890', shouldMatch: true, description: 'US phone with dots' },
  { text: '2124567890', shouldMatch: false, description: 'No separators (handled by the low-confidence pattern)' },
  { text: '212-056-7890', shouldMatch: false, description: 'Exchange starting with 0' },
  { text: '+1-212-456-7890', shouldMatch: true, description: 'US phone with country code' },
  { text: '+1 (212) 456-7890', shouldMatch: true, description: 'US phone with +1 and parens' },

  // Invalid
  { text: '123-4567', shouldMatch: false, description: 'Too short' },
  { text: '55-123-4567', shouldMatch: false, description: 'Wrong format' },
  { text: '(212) 555-0123', shouldMatch: false, description: 'Fictional 555-01XX' },
  { text: '012-456-7890', shouldMatch: false, description: 'Area code starting with 0' },
  { text: '112-456-7890', shouldMatch: false, description: 'Area code starting with 1' },
  { text: 'Call (212) 456-7890 now', shouldMatch: true, description: 'Opening paren is part of the match', expectedMatch: '(212) 456-7890' },
]);

testRegexPattern('Phone (US, no separators)', [
  { text: '2124567890', shouldMatch: true, description: 'Bare 10 digits' },
  { text: '+12124567890', shouldMatch: true, description: 'With +1' },
  { text: 'Order 1234567890 shipped', shouldMatch: false, description: 'Area code starting with 1' },
]);

testRegexPattern('Phone (International)', [
  { text: '+44 20 71234567', shouldMatch: true, description: 'UK phone' },
  { text: '+44 20 7123 4567', shouldMatch: true, description: 'UK phone grouped' },
  { text: '+33 142868200', shouldMatch: true, description: 'France phone' },
  { text: '+86 13800138000', shouldMatch: true, description: 'China phone' },
  { text: '+81-3-12345678', shouldMatch: true, description: 'Japan phone' },
  { text: '+49 3012345678', shouldMatch: true, description: 'Germany phone' },
  { text: 'Tel: +44 20 7123 4567', shouldMatch: true, description: 'After a label', expectedMatch: '+44 20 7123 4567' },
  { text: 'Tel:+44 20 7123 4567', shouldMatch: true, description: 'Directly after a colon', expectedMatch: '+44 20 7123 4567' },

  // Invalid
  { text: '+1234567890123456', shouldMatch: false, description: 'Too long (>15 digits)' },
  { text: '+1-2', shouldMatch: false, description: 'Too short (<8 digits)' },
]);

testRegexPattern('Phone (China Mobile)', [
  // Valid China mobile numbers
  { text: '138-0013-8000', shouldMatch: true, description: 'China mobile with dashes' },
  { text: '13800138000', shouldMatch: true, description: 'China mobile no separators' },
  { text: '158 0013 8000', shouldMatch: true, description: 'China mobile with spaces' },
  { text: '186-1234-5678', shouldMatch: true, description: 'China mobile 186' },
  { text: '199-8888-8888', shouldMatch: true, description: 'China mobile 199' },

  // Invalid
  { text: '128-0013-8000', shouldMatch: false, description: 'Invalid prefix (12x)' },
  { text: '238-0013-8000', shouldMatch: false, description: 'Invalid prefix (23x)' },
  { text: '1380013800', shouldMatch: false, description: 'Wrong length (10 digits)' },
]);

testRegexPattern('Phone (China Landline)', [
  // Valid China landline numbers
  { text: '010-12345678', shouldMatch: true, description: 'Beijing landline' },
  { text: '021-12345678', shouldMatch: true, description: 'Shanghai landline' },
  { text: '0755-1234567', shouldMatch: true, description: 'Shenzhen landline (7 digits)' },
  { text: '0571-12345678', shouldMatch: true, description: 'Hangzhou landline (8 digits)' },
  { text: '0851 12345678', shouldMatch: true, description: 'Landline with space' },

  // Invalid
  { text: '10-12345678', shouldMatch: false, description: 'Missing leading 0' },
  { text: '0755-123456', shouldMatch: false, description: 'Too few digits' },
]);

// =============================================================================
// CREDIT CARD TESTS
// =============================================================================

testRegexPattern('Credit Card (Generic)', [
  { text: '3530111333300000', shouldMatch: true, description: 'JCB (no brand-specific pattern)' },
  { text: '3530 1113 3330 0000', shouldMatch: true, description: 'JCB grouped' },
  { text: 'Card 3530111333300000 50 dollars', shouldMatch: true, description: 'Followed by another number', expectedMatch: '3530111333300000' },
  { text: 'Card 3530 1113 3330 0000 50 dollars', shouldMatch: true, description: 'Grouped, followed by another number', expectedMatch: '3530 1113 3330 0000' },
  { text: 'Card 3530 1113 3330 0000 123', shouldMatch: true, description: 'Followed by a 3-digit CVV (redacted with it)', expectedMatch: '3530 1113 3330 0000 123' },
  { text: '6222 0212 3456 7890 128', shouldMatch: true, description: 'UnionPay 19 grouped 4-4-4-4-3' },
  { text: '3782 822463 10005', shouldMatch: true, description: 'Amex 4-6-5' },
  { text: '3530111333300000\n2024', shouldMatch: true, description: 'Does not continue onto the next line', expectedMatch: '3530111333300000' },
  { text: '3530111333300001', shouldMatch: false, description: 'Fails Luhn' },
]);

testRegexPattern('Credit Card (Visa)', [
  // Valid Visa cards (these are test numbers that pass Luhn)
  { text: '4111111111111111', shouldMatch: true, description: 'Test Visa card (no separators)' },
  { text: '4111 1111 1111 1111', shouldMatch: true, description: 'Test Visa card (with spaces)' },
  { text: '4111-1111-1111-1111', shouldMatch: true, description: 'Test Visa card (with dashes)' },
  { text: '4012888888881881', shouldMatch: true, description: 'Test Visa card 2' },

  // Invalid
  { text: '4532-1234-5678-9012', shouldMatch: false, description: 'Fails Luhn check' },
  { text: '5532-1234-5678-9010', shouldMatch: false, description: 'Not Visa (starts with 5)' },
  { text: '4532-1234-567', shouldMatch: false, description: 'Too short' },
]);

testRegexPattern('Credit Card (Mastercard)', [
  // Valid Mastercard
  { text: '5500 0000 0000 0004', shouldMatch: true, description: 'Test Mastercard (51-55)' },
  { text: '5500-0000-0000-0004', shouldMatch: true, description: 'Mastercard with dashes' },
  { text: '2221 0000 0000 0009', shouldMatch: true, description: 'Test Mastercard (2221-2720)' },

  // Invalid
  { text: '5500-0000-0000-0005', shouldMatch: false, description: 'Fails Luhn check' },
  { text: '4500-0000-0000-0004', shouldMatch: false, description: 'Not Mastercard prefix' },
]);

testRegexPattern('Credit Card (Amex)', [
  // Valid Amex
  { text: '3782 822463 10005', shouldMatch: true, description: 'Test Amex (15 digits)' },
  { text: '3782-822463-10005', shouldMatch: true, description: 'Amex with dashes' },
  { text: '371449635398431', shouldMatch: true, description: 'Test Amex no separators' },

  // Invalid
  { text: '3782-822463-10006', shouldMatch: false, description: 'Fails Luhn check' },
  { text: '3882-822463-10005', shouldMatch: false, description: 'Wrong prefix (38)' },
  { text: '3782-822463-100', shouldMatch: false, description: 'Too short' },
]);

testRegexPattern('Credit Card (UnionPay)', [
  // Valid UnionPay
  { text: '6212345678901232', shouldMatch: true, description: 'UnionPay 16 digits (passes Luhn)' },

  // Invalid
  { text: '6234567890123458', shouldMatch: false, description: 'Valid format but fails Luhn check' },
  { text: '6212345678901266', shouldMatch: false, description: 'Fails Luhn check' },
  { text: '6312345678901234', shouldMatch: false, description: 'Wrong prefix (63)' },
  { text: '621234567890123', shouldMatch: false, description: 'Too short' },
]);

// =============================================================================
// DATE TESTS
// =============================================================================

testRegexPattern('Date (MM/DD/YYYY)', [
  // Valid dates
  { text: '01/15/2024', shouldMatch: true, description: 'Valid MM/DD/YYYY' },
  { text: '12/31/2023', shouldMatch: true, description: 'End of year' },
  { text: '1/1/2024', shouldMatch: true, description: 'Without leading zeros' },
  { text: '06/30/1999', shouldMatch: true, description: '20th century' },

  // Invalid
  { text: '13/01/2024', shouldMatch: false, description: 'Invalid month (13)' },
  { text: '01/32/2024', shouldMatch: false, description: 'Invalid day (32)' },
  { text: '1/1/1899', shouldMatch: false, description: 'Year too old' },
  { text: '2024/01/15', shouldMatch: false, description: 'Wrong format' },
  { text: '01-15-2024', shouldMatch: true, description: 'Dashes' },
  { text: '01.15.2024', shouldMatch: true, description: 'Dots' },
  { text: '01/15-2024', shouldMatch: false, description: 'Mixed separators' },
]);

testRegexPattern('Date (YYYY-MM-DD)', [
  // Valid dates
  { text: '2024-01-15', shouldMatch: true, description: 'Valid ISO date' },
  { text: '2023-12-31', shouldMatch: true, description: 'End of year' },
  { text: '1999-06-30', shouldMatch: true, description: '20th century' },

  // Invalid
  { text: '2024-13-01', shouldMatch: false, description: 'Invalid month (13)' },
  { text: '2024-01-32', shouldMatch: false, description: 'Invalid day (32)' },
  { text: '01-15-2024', shouldMatch: false, description: 'Wrong order' },
  { text: '2024/01/15', shouldMatch: true, description: 'Slashes' },
  { text: '2024.1.15', shouldMatch: true, description: 'Dots without zeros' },
  { text: '2024-01/15', shouldMatch: false, description: 'Mixed separators' },
  { text: '2024-01-150', shouldMatch: false, description: 'Day runs into more digits' },
]);

testRegexPattern('Date (DD/MM/YYYY)', [
  { text: '15/01/2024', shouldMatch: true, description: 'Slashes' },
  { text: '15.01.2024', shouldMatch: true, description: 'Dots (German style)' },
  { text: '15-01-2024', shouldMatch: true, description: 'Dashes' },
  { text: '15/13/2024', shouldMatch: false, description: 'Invalid month (13)' },
]);

testRegexPattern('Date (MM/DD/YY)', [
  { text: 'Date: 01/15/24', shouldMatch: true, expectedMatch: '01/15/24', description: 'Month first' },
  { text: '31/12/23', shouldMatch: true, description: 'Day first' },
  { text: '13/13/24', shouldMatch: false, description: 'Neither reading is a date' },
  { text: '01/15/2024', shouldMatch: false, description: '4-digit year belongs to other rules' },
]);

testRegexPattern('Date (YYYYMMDD)', [
  { text: 'DOB 20240115', shouldMatch: true, expectedMatch: '20240115', description: 'Compact date' },
  { text: '20240229', shouldMatch: true, description: 'Leap day' },
  { text: '20230229', shouldMatch: false, description: 'Not a leap year' },
  { text: '20241315', shouldMatch: false, description: 'Invalid month' },
  { text: '11010519491231002X', shouldMatch: false, description: 'Inside an ID number' },
]);

testRegexPattern('Date (Chinese)', [
  // Valid Chinese dates
  { text: '2024年1月15日', shouldMatch: true, description: 'Chinese date without zeros' },
  { text: '2024年01月15日', shouldMatch: true, description: 'Chinese date with zeros' },
  { text: '2023年12月31日', shouldMatch: true, description: 'End of year Chinese' },
  { text: '1999年6月30日', shouldMatch: true, description: '20th century Chinese' },

  // Invalid
  { text: '2024年13月15日', shouldMatch: false, description: 'Invalid month (13)' },
  { text: '2024年1月32日', shouldMatch: false, description: 'Invalid day (32)' },
  { text: '1899年1月15日', shouldMatch: false, description: 'Year too old' },
  { text: '2024 年 1 月 15 日', shouldMatch: true, description: 'Spaces from PDF extraction' },
  { text: '2024年1月15号', shouldMatch: true, description: '号 instead of 日' },
  { text: '２０２４年１月１５日', shouldMatch: true, description: 'Full-width digits' },
  { text: '2024年2月30日', shouldMatch: false, description: 'No such day' },
]);

testRegexPattern('Date (Chinese, partial)', [
  { text: '于2024年1月签订', shouldMatch: true, expectedMatch: '2024年1月', description: 'Year and month' },
  { text: '于3月5日到期', shouldMatch: true, expectedMatch: '3月5日', description: 'Month and day' },
  { text: '12月31号', shouldMatch: true, description: 'Month and day with 号' },
  { text: '2024年1月15日', shouldMatch: false, description: 'Full dates belong to the full rule' },
  { text: '13月5日', shouldMatch: false, description: 'Invalid month' },
  { text: '2月30日', shouldMatch: false, description: 'No such day' },
]);

testRegexPattern('Date (Chinese numerals)', [
  { text: '二〇二四年一月十五日', shouldMatch: true, description: 'Court judgment style' },
  { text: '一九九九年十二月三十一日', shouldMatch: true, description: 'End of year' },
  { text: '二〇二四年三月', shouldMatch: true, description: 'Year and month' },
  { text: '二〇二四年十五月', shouldMatch: false, description: 'Invalid month' },
]);

testRegexPattern('Date (Month DD, YYYY)', [
  // Valid month-written dates
  { text: 'January 15, 2024', shouldMatch: true, description: 'Full month name' },
  { text: 'December 31, 2023', shouldMatch: true, description: 'End of year' },
  { text: 'March 1, 1999', shouldMatch: true, description: 'Single digit day' },

  { text: 'Jan 15, 2024', shouldMatch: true, description: 'Abbreviated month' },
  { text: 'Jan. 15, 2024', shouldMatch: true, description: 'Abbreviation with period' },
  { text: 'Sept 3 2024', shouldMatch: true, description: 'Sept, no comma' },
  { text: 'March 3rd, 2024', shouldMatch: true, description: 'Ordinal day' },

  // Invalid
  { text: 'January 32, 2024', shouldMatch: false, description: 'Invalid day (32)' },
  { text: 'January 15, 1850', shouldMatch: false, description: 'Year too old' },
]);

testRegexPattern('Date (DD Month YYYY)', [
  { text: '15 January 2024', shouldMatch: true, description: 'Day first' },
  { text: '15th Jan 2024', shouldMatch: true, description: 'Ordinal and abbreviation' },
  { text: 'the 3rd of March, 2024', shouldMatch: true, expectedMatch: '3rd of March, 2024', description: '"of" and comma' },
  { text: '32 January 2024', shouldMatch: false, description: 'Invalid day (32)' },
]);

testRegexPattern('Date (Month YYYY)', [
  { text: 'Effective January 2024', shouldMatch: true, expectedMatch: 'January 2024', description: 'Month and year' },
  { text: 'Dec. 2023', shouldMatch: true, description: 'Abbreviation with period' },
  { text: '15 January 2024', shouldMatch: false, description: 'Tail of a full date' },
  { text: 'you may 2024', shouldMatch: false, description: 'Lowercase "may" is not a month' },
]);

// =============================================================================
// CHINESE NATIONAL ID TESTS
// =============================================================================

testRegexPattern('Chinese National ID', [
  // Valid checksums
  { text: '11010519491231002X', shouldMatch: true, description: 'Valid ID with X check digit' },
  { text: '11010519491231002x', shouldMatch: true, description: 'Lowercase x check digit' },
  { text: '身份证号：11010519491231002X，住址', shouldMatch: true, description: 'Inside Chinese text', expectedMatch: '11010519491231002X' },
  { text: '110105 19491231 002X', shouldMatch: true, description: '6-8-4 grouping with spaces' },
  { text: '110105-19491231-002X', shouldMatch: true, description: '6-8-4 grouping with hyphens' },
  { text: '110 105 1949 1231 002X', shouldMatch: false, description: 'Arbitrary grouping' },

  // Note: These have invalid checksums and will fail validator
  // Pattern matches format, but validator requires correct checksum
  { text: '110101199001010010', shouldMatch: false, description: 'Valid format but invalid checksum' },
  { text: '31010519900307234X', shouldMatch: false, description: 'Valid format but invalid checksum' },
  { text: '440305199003071234', shouldMatch: false, description: 'Valid format but invalid checksum' },

  // Invalid format
  { text: '11010119900307234', shouldMatch: false, description: 'Too short (17 digits)' },
  { text: '1101011990030723456', shouldMatch: false, description: 'Too long (19 digits)' },
  { text: '11010119900307234A', shouldMatch: false, description: 'Invalid check char (A)' },
]);

// =============================================================================
// PASSPORT TESTS
// =============================================================================

testRegexPattern('Chinese Passport (Current)', [
  // Valid current format: E + letter (A-H,J-N,R-Z) + 7 digits
  { text: 'EA1234567', shouldMatch: true, description: 'Current passport EA prefix' },
  { text: 'EB9876543', shouldMatch: true, description: 'Current passport EB prefix' },
  { text: 'EG1234567', shouldMatch: true, description: 'Current passport EG prefix' },

  // Invalid
  { text: 'E1234567', shouldMatch: false, description: 'Too short (missing letter after E)' },
  { text: 'EA12345678', shouldMatch: false, description: 'Too long (8 digits instead of 7)' },
  { text: 'E12345678', shouldMatch: false, description: 'Wrong format (digit instead of letter after E)' },
  { text: 'EP1234567', shouldMatch: false, description: 'Invalid second letter (P excluded)' },
]);

testRegexPattern('US Passport', [
  // Valid US passports (current format: 1 letter + 8 digits)
  { text: 'C12345678', shouldMatch: true, description: 'One letter + 8 digits' },
  { text: 'A98765432', shouldMatch: true, description: 'Another valid format' },
  { text: 'Z11111111', shouldMatch: true, description: 'Z prefix valid' },

  // Invalid
  { text: 'AB1234567', shouldMatch: false, description: 'Two letters + 7 digits (wrong format)' },
  { text: '123456789', shouldMatch: false, description: '9 digits (no letter)' },
  { text: 'AB123456', shouldMatch: false, description: 'Too short' },
  { text: '12345678', shouldMatch: false, description: 'Wrong length (8 digits, no letter)' },
]);

// =============================================================================
// IP ADDRESS TESTS
// =============================================================================

testRegexPattern('IP Address (IPv4)', [
  // Valid IPv4
  { text: '192.168.1.1', shouldMatch: true, description: 'Private IP' },
  { text: '8.8.8.8', shouldMatch: true, description: 'Google DNS' },
  { text: '10.0.0.1', shouldMatch: true, description: 'Private network' },
  { text: '255.255.255.255', shouldMatch: true, description: 'Broadcast address' },

  // Invalid
  { text: '256.1.1.1', shouldMatch: false, description: 'Octet > 255' },
  { text: '192.168.1', shouldMatch: false, description: 'Incomplete IP' },
  { text: '192.168.1.1.1', shouldMatch: false, description: 'Part of a longer dotted run' },

  // Clause numbers in legal/insurance documents
  { text: '1.1.3.6.2 保险责任', shouldMatch: false, description: 'Five-level clause number' },
  { text: '第1.1.3.6条', shouldMatch: false, description: 'Chinese clause marker' },
  { text: '1.1.3.6 条 保险责任', shouldMatch: false, description: 'Followed by 条' },
  { text: 'Section 1.1.3.6 Exclusions', shouldMatch: false, description: 'Section marker' },
  { text: 'see § 2.1.4.3', shouldMatch: false, description: 'Section sign' },
  { text: 'IP: 10.0.0.1.', shouldMatch: true, description: 'Sentence-ending period', expectedMatch: '10.0.0.1' },
]);

testRegexPattern('IP Address (IPv6)', [
  // Valid IPv6 (full format only, :: notation not supported)
  { text: '2001:0db8:85a3:0000:0000:8a2e:0370:7334', shouldMatch: true, description: 'Full IPv6' },

  // Note: Current pattern doesn't support :: abbreviation notation
  // This is a known limitation documented in pattern-analysis.md
  { text: '2001:db8:85a3::8a2e:370:7334', shouldMatch: false, description: 'IPv6 with :: (not supported)' },
  { text: '::1', shouldMatch: false, description: 'IPv6 loopback (not supported)' },
  { text: 'fe80::1', shouldMatch: false, description: 'Link-local IPv6 (not supported)' },

  // Invalid
  { text: '::gggg', shouldMatch: false, description: 'Invalid hex' },
  { text: '192.168.1.1', shouldMatch: false, description: 'IPv4 not IPv6' },
]);

// =============================================================================
// URL TESTS
// =============================================================================

testRegexPattern('URL (with protocol)', [
  // Valid URLs with protocol
  { text: 'https://example.com', shouldMatch: true, description: 'HTTPS URL' },
  { text: 'http://www.example.org', shouldMatch: true, description: 'HTTP URL with www' },
  { text: 'https://subdomain.example.com/path/to/page', shouldMatch: true, description: 'URL with path' },
  { text: 'https://example.com?query=test', shouldMatch: true, description: 'URL with query' },
  { text: 'https://example.com#section', shouldMatch: true, description: 'URL with fragment' },

  // Invalid
  { text: 'ftp://example.com', shouldMatch: false, description: 'FTP not HTTP(S)' },
  { text: 'example.com', shouldMatch: false, description: 'Missing protocol' },
  { text: 'http://', shouldMatch: false, description: 'Incomplete URL' },
]);

testRegexPattern('URL (without protocol)', [
  // Valid URLs without protocol but with www
  { text: 'www.example.com', shouldMatch: true, description: 'URL with www prefix' },
  { text: 'www.subdomain.example.com/path', shouldMatch: true, description: 'URL with www and path' },
  { text: 'www.example.org/page?query=test', shouldMatch: true, description: 'URL with www and query' },

  // Invalid
  { text: 'example.com', shouldMatch: false, description: 'Missing both protocol and www' },
  { text: 'http://example.com', shouldMatch: false, description: 'Has protocol (wrong pattern)' },
  { text: 'document.pdf', shouldMatch: false, description: 'File name not URL' },
]);

// =============================================================================
// CRYPTOCURRENCY TESTS
// =============================================================================

testRegexPattern('Crypto (Bitcoin)', [
  // Valid Bitcoin addresses
  { text: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', shouldMatch: true, description: 'Bitcoin P2PKH (Genesis)' },
  { text: '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy', shouldMatch: true, description: 'Bitcoin P2SH' },
  { text: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', shouldMatch: true, description: 'Bitcoin Bech32' },
  { text: 'bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297', shouldMatch: true, description: 'Bitcoin Taproot (bech32m)' },

  // Invalid
  { text: '3J98t1WpEZ73CNmYviecrnyiWrnqRhWNLy', shouldMatch: false, description: 'One character changed (checksum fails)' },
  { text: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfN', shouldMatch: false, description: 'Truncated (checksum fails)' },
  { text: 'ref 1234567891234567891234567891', shouldMatch: false, description: 'Long number that fits the alphabet' },
  { text: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdx', shouldMatch: false, description: 'Bech32 checksum fails' },
  { text: '0A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', shouldMatch: false, description: 'Invalid prefix (0)' },
  { text: '1ABC', shouldMatch: false, description: 'Too short' },
]);

// =============================================================================
// PREDEFINED WORDS TESTS
// =============================================================================

console.log(`\n${'='.repeat(80)}`);
console.log(`TEST: Predefined Words Integration`);
console.log(`${'='.repeat(80)}`);

// Clear any existing predefined words
clearPredefinedWords();

// Add some test predefined words
try {
  addPredefinedWord('SECRET', false, true);
  addPredefinedWord('机密', false, true); // Chinese
  addPredefinedWord('пароль', false, true); // Russian

  console.log('Added predefined words: SECRET, 机密, пароль\n');

  // Get all patterns including predefined
  const allPatterns = getAllPatterns();
  const predefinedPatterns = allPatterns.filter(p => p.name.startsWith('Predefined:'));

  console.log(`Total patterns: ${allPatterns.length}`);
  console.log(`Predefined patterns: ${predefinedPatterns.length}\n`);

  // Test each predefined pattern
  predefinedPatterns.forEach(pattern => {
    totalTests++;
    const testTexts = [
      { text: 'This is SECRET information', expected: true },
      { text: '这是机密文件', expected: false }, // No boundary
      { text: '这是 机密 文件', expected: true }, // With boundary
      { text: 'Это пароль пользователя', expected: true },
    ];

    let testPassed = false;
    for (const { text, expected } of testTexts) {
      pattern.pattern.lastIndex = 0;
      const match = pattern.pattern.test(text);
      if ((match && expected) || (!match && !expected)) {
        testPassed = true;
        break;
      }
    }

    if (testPassed) {
      passedTests++;
      console.log(`✓ PASS: ${pattern.name}`);
    } else {
      failedTests++;
      console.log(`✗ FAIL: ${pattern.name}`);
    }
  });

  console.log('');
} catch (error) {
  console.error('Error testing predefined words:', error);
}

// =============================================================================
// CONTEXT CONFIDENCE TESTS
// =============================================================================

function testContextConfidence(patternName: string, text: string, match: string, expectedConfidence: number, description: string) {
  totalTests++;
  const p = getPatternByName(patternName)!;
  const index = text.indexOf(match);
  const confidence = Math.min(1, p.confidence * getContextConfidenceBoost(
    text, index, match.length, p.contextKeywords ?? [], p.contextWindowSize ?? 10, p.confidenceBoost ?? 1.2
  ));
  const passed = Math.abs(confidence - expectedConfidence) < 1e-9;
  if (passed) passedTests++; else failedTests++;
  console.log(`${passed ? '✓ PASS' : '✗ FAIL'} (${description})`);
  console.log(`  Text: "${text}"  Expected confidence: ${expectedConfidence}, Got: ${confidence}\n`);
}

console.log(`\n${'='.repeat(80)}\nTEST: Context confidence\n${'='.repeat(80)}`);
testContextConfidence('IP Address (IPv4)', '1.1.3.6 被保险人的义务', '1.1.3.6', 0.6, 'Clause number without network context stays below default threshold');
testContextConfidence('IP Address (IPv4)', 'The recipient shall notify the principal under 1.1.3.6', '1.1.3.6', 0.6, '"ip" inside "recipient"/"principal" is not a keyword');
testContextConfidence('IP Address (IPv4)', 'Server IP: 10.0.0.1', '10.0.0.1', 0.9, 'Network context boosts IP');
testContextConfidence('IP Address (IPv4)', '服务器地址 192.168.1.10', '192.168.1.10', 0.9, 'Chinese network keyword boosts IP');
testContextConfidence('SSN (US, no separators)', 'Invoice 123456789 total due', '123456789', 0.5, 'Bare 9 digits without a label stay below default threshold');
testContextConfidence('SSN (US, no separators)', 'SSN: 123456789', '123456789', 0.9, 'Bare 9 digits next to an SSN label');
testContextConfidence('Phone (US, no separators)', 'Order 2124567890 shipped', '2124567890', 0.5, 'Bare 10 digits without a label stay below default threshold');
testContextConfidence('Phone (US, no separators)', 'Phone: 2124567890', '2124567890', 0.9, 'Bare 10 digits next to a phone label');
testContextConfidence('Date (YYYYMMDD)', 'Order 20240115 shipped', '20240115', 0.5, 'Bare 8 digits without a label stay below default threshold');
testContextConfidence('Date (YYYYMMDD)', 'Date of birth: 20240115', '20240115', 0.9, 'Bare 8 digits next to a date label');
testContextConfidence('Date (MM/DD/YY)', 'Ratio 1/2/24 applied', '1/2/24', 0.6, 'Short-year date without a label stays below default threshold');
testContextConfidence('Date (MM/DD/YY)', '出生日期 01/15/24', '01/15/24', 0.9, 'Short-year date next to a Chinese date label');

// =============================================================================
// SUMMARY
// =============================================================================

console.log('\n' + '='.repeat(80));
console.log('TEST SUMMARY');
console.log('='.repeat(80));
console.log(`Total Tests: ${totalTests}`);
console.log(`Passed: ${passedTests} (${((passedTests / totalTests) * 100).toFixed(1)}%)`);
console.log(`Failed: ${failedTests} (${((failedTests / totalTests) * 100).toFixed(1)}%)`);
console.log('='.repeat(80));

if (failedTests > 0) {
  const successRate = ((passedTests / totalTests) * 100).toFixed(1);
  console.log(`\n⚠️  SOME TESTS FAILED (${successRate}% success rate)`);
  console.log('\nNote: Some failures may be due to:');
  console.log('  - Validator rejections (Luhn check, checksum validation, etc.)');
  console.log('  - Pattern-specific matching behavior');
  console.log('  - Test data not meeting validation requirements');
  console.log('\nReview individual test results above for details.');
  process.exit(1);
} else {
  console.log('\n✅ ALL TESTS PASSED');
  process.exit(0);
}
