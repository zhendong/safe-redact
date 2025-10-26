/**
 * Comprehensive test suite for predefined-words.ts
 * Tests multi-language pattern matching across different scripts
 */
import { createPatternFromWord, PredefinedWord } from '../src/utils/predefined-words';

interface TestCase {
  text: string;
  shouldMatch: boolean;
  description?: string;
}

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function testPattern(
  description: string,
  word: PredefinedWord,
  testCases: TestCase[]
) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`TEST: ${description}`);
  console.log(`${'='.repeat(80)}`);
  console.log(`Word: "${word.word}"`);
  console.log(`Case Sensitive: ${word.caseSensitive}, Whole Word: ${word.wholeWord}`);

  const pattern = createPatternFromWord(word);
  console.log(`Pattern: ${pattern.source}`);
  console.log(`Flags: ${pattern.flags}`);
  console.log('');

  testCases.forEach(({ text, shouldMatch, description: testDesc }) => {
    totalTests++;
    // Reset lastIndex for each test
    pattern.lastIndex = 0;
    const matches = text.match(pattern);
    const didMatch = matches !== null && matches.length > 0;
    const passed = didMatch === shouldMatch;

    if (passed) {
      passedTests++;
    } else {
      failedTests++;
    }

    const status = passed ? '✓ PASS' : '✗ FAIL';
    const testDescription = testDesc ? ` (${testDesc})` : '';
    console.log(`${status}${testDescription}`);
    console.log(`  Text: "${text.replace(/\n/g, '\\n').replace(/\t/g, '\\t')}"`);
    console.log(`  Expected: ${shouldMatch ? 'MATCH' : 'NO MATCH'}, Got: ${didMatch ? 'MATCH' : 'NO MATCH'}`);
    if (matches) {
      console.log(`  Matched: "${matches[0].replace(/\n/g, '\\n').replace(/\t/g, '\\t')}"`);
    }
    console.log('');
  });
}

// =============================================================================
// LATIN SCRIPT TESTS
// =============================================================================

testPattern('Latin - English (basic matching)', {
  id: '1',
  word: 'password',
  caseSensitive: false,
  wholeWord: true,
  createdAt: Date.now()
}, [
  { text: 'password', shouldMatch: true, description: 'Exact match' },
  { text: 'Password', shouldMatch: true, description: 'Case insensitive' },
  { text: 'PASSWORD', shouldMatch: true, description: 'All caps' },
  { text: 'PaSsWoRd', shouldMatch: true, description: 'Mixed case' },
]);

testPattern('Latin - English (cross-line matching)', {
  id: '2',
  word: 'password',
  caseSensitive: false,
  wholeWord: true,
  createdAt: Date.now()
}, [
  { text: 'pass\nword', shouldMatch: true, description: 'Single line break' },
  { text: 'pass \nword', shouldMatch: true, description: 'Space before line break' },
  { text: 'pass\n word', shouldMatch: true, description: 'Space after line break' },
  { text: 'pass \n word', shouldMatch: true, description: 'Spaces around line break' },
  { text: 'pass\t\nword', shouldMatch: true, description: 'Tab and line break' },
  { text: 'p a s s w o r d', shouldMatch: true, description: 'Spaces between all chars' },
]);

testPattern('Latin - English (word boundaries)', {
  id: '3',
  word: 'password',
  caseSensitive: false,
  wholeWord: true,
  createdAt: Date.now()
}, [
  { text: 'This is a password test', shouldMatch: true, description: 'Word with spaces' },
  { text: 'password!', shouldMatch: true, description: 'Word with punctuation' },
  { text: 'password.', shouldMatch: true, description: 'Word with period' },
  { text: 'password,', shouldMatch: true, description: 'Word with comma' },
  { text: '(password)', shouldMatch: true, description: 'Word in parentheses' },
  { text: 'mypassword', shouldMatch: false, description: 'Part of another word (prefix)' },
  { text: 'password123', shouldMatch: false, description: 'Part of another word (suffix)' },
]);

testPattern('Latin - English (case sensitive)', {
  id: '4',
  word: 'Password',
  caseSensitive: true,
  wholeWord: true,
  createdAt: Date.now()
}, [
  { text: 'Password', shouldMatch: true, description: 'Exact case match' },
  { text: 'password', shouldMatch: false, description: 'Wrong case (lowercase)' },
  { text: 'PASSWORD', shouldMatch: false, description: 'Wrong case (uppercase)' },
  { text: 'PaSsWoRd', shouldMatch: false, description: 'Wrong case (mixed)' },
]);

testPattern('Latin - English (partial match - wholeWord: false)', {
  id: '5',
  word: 'pass',
  caseSensitive: false,
  wholeWord: false,
  createdAt: Date.now()
}, [
  { text: 'pass', shouldMatch: true, description: 'Exact match' },
  { text: 'password', shouldMatch: true, description: 'Part of word' },
  { text: 'bypass', shouldMatch: true, description: 'Part of word (prefix)' },
  { text: 'compass', shouldMatch: true, description: 'Part of word (middle)' },
]);

// =============================================================================
// CJK SCRIPT TESTS (Chinese, Japanese)
// =============================================================================

testPattern('CJK - Chinese (basic matching)', {
  id: '10',
  word: '密码',
  caseSensitive: false,
  wholeWord: true,
  createdAt: Date.now()
}, [
  { text: '密码', shouldMatch: true, description: 'Exact match' },
  { text: '密 码', shouldMatch: true, description: 'With space' },
  { text: '密\n码', shouldMatch: true, description: 'Cross line break' },
  { text: '密\t码', shouldMatch: true, description: 'With tab' },
  { text: '密\t\n码', shouldMatch: true, description: 'Tab and line break' },
]);

testPattern('CJK - Chinese (word boundaries)', {
  id: '11',
  word: '密码',
  caseSensitive: false,
  wholeWord: true,
  createdAt: Date.now()
}, [
  { text: '这是密码测试', shouldMatch: false, description: 'No boundaries' },
  { text: '这是 密码 测试', shouldMatch: true, description: 'Space boundaries' },
  { text: '密码，这是测试', shouldMatch: true, description: 'Punctuation boundary (comma)' },
  { text: '密码。', shouldMatch: true, description: 'Punctuation boundary (period)' },
  { text: '「密码」', shouldMatch: true, description: 'CJK quotation marks' },
  { text: '密码！', shouldMatch: true, description: 'CJK exclamation' },
  { text: '密\n码测试', shouldMatch: false, description: 'Line break but no end boundary' },
]);

testPattern('CJK - Chinese (partial match - wholeWord: false)', {
  id: '12',
  word: '密码',
  caseSensitive: false,
  wholeWord: false,
  createdAt: Date.now()
}, [
  { text: '密码', shouldMatch: true, description: 'Exact match' },
  { text: '这是密码测试', shouldMatch: true, description: 'Part of sentence' },
  { text: '密\n码测试', shouldMatch: true, description: 'Cross line in sentence' },
]);

testPattern('CJK - Japanese Katakana', {
  id: '13',
  word: 'パスワード',
  caseSensitive: false,
  wholeWord: true,
  createdAt: Date.now()
}, [
  { text: 'パスワード', shouldMatch: true, description: 'Exact match' },
  { text: 'パス\nワード', shouldMatch: true, description: 'Cross line break' },
  { text: 'これはパスワードです', shouldMatch: false, description: 'No boundaries' },
  { text: 'これは パスワード です', shouldMatch: true, description: 'Space boundaries' },
  { text: 'パスワード。', shouldMatch: true, description: 'With period' },
]);

testPattern('CJK - Japanese Hiragana', {
  id: '14',
  word: 'ひみつ',
  caseSensitive: false,
  wholeWord: true,
  createdAt: Date.now()
}, [
  { text: 'ひみつ', shouldMatch: true, description: 'Exact match' },
  { text: 'ひ\nみつ', shouldMatch: true, description: 'Cross line break' },
  { text: 'これはひみつです', shouldMatch: false, description: 'No boundaries' },
  { text: 'これは ひみつ です', shouldMatch: true, description: 'Space boundaries' },
]);

testPattern('CJK - Mixed Chinese Characters', {
  id: '15',
  word: '用户名',
  caseSensitive: false,
  wholeWord: true,
  createdAt: Date.now()
}, [
  { text: '用户名', shouldMatch: true, description: 'Exact match' },
  { text: '用\n户\n名', shouldMatch: true, description: 'Multiple line breaks' },
  { text: '用 户 名', shouldMatch: true, description: 'Multiple spaces' },
]);

// =============================================================================
// HANGUL (KOREAN) SCRIPT TESTS
// =============================================================================

testPattern('Hangul - Korean (basic matching)', {
  id: '20',
  word: '비밀번호',
  caseSensitive: false,
  wholeWord: true,
  createdAt: Date.now()
}, [
  { text: '비밀번호', shouldMatch: true, description: 'Exact match' },
  { text: '비밀\n번호', shouldMatch: true, description: 'Cross line break' },
  { text: '비 밀 번 호', shouldMatch: true, description: 'With spaces' },
]);

testPattern('Hangul - Korean (word boundaries)', {
  id: '21',
  word: '비밀번호',
  caseSensitive: false,
  wholeWord: true,
  createdAt: Date.now()
}, [
  { text: '이것은 비밀번호 입니다', shouldMatch: true, description: 'Space boundaries' },
  { text: '비밀번호.', shouldMatch: true, description: 'Punctuation boundary' },
  { text: '비밀번호는', shouldMatch: false, description: 'No boundary (particle)' },
  { text: '비밀번호, 입력', shouldMatch: true, description: 'Comma boundary' },
]);

// =============================================================================
// ARABIC SCRIPT TESTS
// =============================================================================

testPattern('Arabic - Basic matching', {
  id: '30',
  word: 'كلمة',
  caseSensitive: false,
  wholeWord: true,
  createdAt: Date.now()
}, [
  { text: 'كلمة', shouldMatch: true, description: 'Exact match (no diacritics)' },
  { text: 'كَلِمَة', shouldMatch: true, description: 'With diacritics (fatha, kasra)' },
  { text: 'كُلْمَة', shouldMatch: true, description: 'With different diacritics' },
  { text: 'كل\nمة', shouldMatch: true, description: 'Cross line break' },
]);

testPattern('Arabic - Word boundaries', {
  id: '31',
  word: 'كلمة',
  caseSensitive: false,
  wholeWord: true,
  createdAt: Date.now()
}, [
  { text: 'هذه كلمة سرية', shouldMatch: true, description: 'Space boundaries' },
  { text: 'كلمة.', shouldMatch: true, description: 'Punctuation boundary' },
  { text: 'كلمة،', shouldMatch: true, description: 'Arabic comma' },
]);

testPattern('Arabic - Persian text', {
  id: '32',
  word: 'رمز',
  caseSensitive: false,
  wholeWord: true,
  createdAt: Date.now()
}, [
  { text: 'رمز', shouldMatch: true, description: 'Exact match' },
  { text: 'رَمْز', shouldMatch: true, description: 'With diacritics' },
  { text: 'این رمز است', shouldMatch: true, description: 'In Persian sentence' },
]);

// =============================================================================
// HEBREW SCRIPT TESTS
// =============================================================================

testPattern('Hebrew - Basic matching', {
  id: '40',
  word: 'סיסמה',
  caseSensitive: false,
  wholeWord: true,
  createdAt: Date.now()
}, [
  { text: 'סיסמה', shouldMatch: true, description: 'Exact match (no niqqud)' },
  { text: 'סִיסְמָה', shouldMatch: true, description: 'With niqqud' },
  { text: 'סי\nסמה', shouldMatch: true, description: 'Cross line break' },
]);

testPattern('Hebrew - Word boundaries', {
  id: '41',
  word: 'סיסמה',
  caseSensitive: false,
  wholeWord: true,
  createdAt: Date.now()
}, [
  { text: 'זו סיסמה שלי', shouldMatch: true, description: 'Space boundaries' },
  { text: 'סיסמה.', shouldMatch: true, description: 'Punctuation boundary' },
  { text: 'סיסמה:', shouldMatch: true, description: 'Colon boundary' },
]);

// =============================================================================
// DEVANAGARI SCRIPT TESTS (Hindi, Sanskrit)
// =============================================================================

testPattern('Devanagari - Hindi (basic matching)', {
  id: '50',
  word: 'पासवर्ड',
  caseSensitive: false,
  wholeWord: true,
  createdAt: Date.now()
}, [
  { text: 'पासवर्ड', shouldMatch: true, description: 'Exact match' },
  { text: 'पास\nवर्ड', shouldMatch: true, description: 'Cross line break' },
  { text: 'पा स वर्ड', shouldMatch: true, description: 'With spaces' },
]);

testPattern('Devanagari - Hindi (word boundaries)', {
  id: '51',
  word: 'पासवर्ड',
  caseSensitive: false,
  wholeWord: true,
  createdAt: Date.now()
}, [
  { text: 'यह पासवर्ड है', shouldMatch: true, description: 'Space boundaries' },
  { text: 'पासवर्ड।', shouldMatch: true, description: 'Devanagari danda' },
  { text: 'पासवर्ड,', shouldMatch: true, description: 'Comma boundary' },
]);

testPattern('Devanagari - Sanskrit with conjuncts', {
  id: '52',
  word: 'संस्कृत',
  caseSensitive: false,
  wholeWord: true,
  createdAt: Date.now()
}, [
  { text: 'संस्कृत', shouldMatch: true, description: 'Exact match with conjuncts' },
  { text: 'सं\nस्कृत', shouldMatch: true, description: 'Cross line break' },
]);

// =============================================================================
// THAI SCRIPT TESTS
// =============================================================================

testPattern('Thai - Basic matching', {
  id: '60',
  word: 'รหัสผ่าน',
  caseSensitive: false,
  wholeWord: true,
  createdAt: Date.now()
}, [
  { text: 'รหัสผ่าน', shouldMatch: true, description: 'Exact match with tone marks' },
  { text: 'รหัส\nผ่าน', shouldMatch: true, description: 'Cross line break' },
  { text: 'ร หั ส ผ่ า น', shouldMatch: true, description: 'With spaces' },
]);

testPattern('Thai - Word boundaries', {
  id: '61',
  word: 'รหัสผ่าน',
  caseSensitive: false,
  wholeWord: true,
  createdAt: Date.now()
}, [
  { text: 'นี่คือ รหัสผ่าน ของฉัน', shouldMatch: true, description: 'Space boundaries' },
  { text: 'รหัสผ่าน.', shouldMatch: true, description: 'Punctuation boundary' },
]);

// =============================================================================
// CYRILLIC SCRIPT TESTS (Russian, Ukrainian, etc.)
// =============================================================================

testPattern('Cyrillic - Russian (basic matching)', {
  id: '70',
  word: 'пароль',
  caseSensitive: false,
  wholeWord: true,
  createdAt: Date.now()
}, [
  { text: 'пароль', shouldMatch: true, description: 'Exact match lowercase' },
  { text: 'ПАРОЛЬ', shouldMatch: true, description: 'All uppercase' },
  { text: 'Пароль', shouldMatch: true, description: 'Title case' },
  { text: 'ПаРоЛь', shouldMatch: true, description: 'Mixed case' },
  { text: 'пар\nоль', shouldMatch: true, description: 'Cross line break' },
  { text: 'п а р о л ь', shouldMatch: true, description: 'With spaces' },
]);

testPattern('Cyrillic - Russian (word boundaries)', {
  id: '71',
  word: 'пароль',
  caseSensitive: false,
  wholeWord: true,
  createdAt: Date.now()
}, [
  { text: 'Это пароль доступа', shouldMatch: true, description: 'Space boundaries' },
  { text: 'пароль.', shouldMatch: true, description: 'Punctuation boundary' },
  { text: 'пароль!', shouldMatch: true, description: 'Exclamation boundary' },
  { text: 'мойпароль', shouldMatch: false, description: 'Part of word (no boundary)' },
]);

testPattern('Cyrillic - Russian (case sensitive)', {
  id: '72',
  word: 'Пароль',
  caseSensitive: true,
  wholeWord: true,
  createdAt: Date.now()
}, [
  { text: 'Пароль', shouldMatch: true, description: 'Exact case match' },
  { text: 'пароль', shouldMatch: false, description: 'Wrong case (lowercase)' },
  { text: 'ПАРОЛЬ', shouldMatch: false, description: 'Wrong case (uppercase)' },
]);

testPattern('Cyrillic - Ukrainian', {
  id: '73',
  word: 'пароль',
  caseSensitive: false,
  wholeWord: true,
  createdAt: Date.now()
}, [
  { text: 'пароль', shouldMatch: true, description: 'Exact match' },
  { text: 'Це пароль користувача', shouldMatch: true, description: 'In Ukrainian sentence' },
]);

// =============================================================================
// EDGE CASES AND MIXED SCENARIOS
// =============================================================================

testPattern('Edge Case - Single character', {
  id: '80',
  word: 'a',
  caseSensitive: false,
  wholeWord: true,
  createdAt: Date.now()
}, [
  { text: 'a', shouldMatch: true, description: 'Single char match' },
  { text: 'A', shouldMatch: true, description: 'Case insensitive single char' },
  { text: 'abc', shouldMatch: false, description: 'Part of word' },
  { text: 'a b c', shouldMatch: true, description: 'Standalone with spaces' },
]);

testPattern('Edge Case - Special characters in word', {
  id: '81',
  word: 'test@123',
  caseSensitive: false,
  wholeWord: false,
  createdAt: Date.now()
}, [
  { text: 'test@123', shouldMatch: true, description: 'Exact match with special chars' },
  { text: 'test\n@\n123', shouldMatch: true, description: 'Cross line breaks' },
]);

testPattern('Edge Case - Numbers', {
  id: '82',
  word: '12345',
  caseSensitive: false,
  wholeWord: true,
  createdAt: Date.now()
}, [
  { text: '12345', shouldMatch: true, description: 'Exact number match' },
  { text: '123456', shouldMatch: false, description: 'Part of larger number' },
  { text: 'ID: 12345', shouldMatch: true, description: 'Number with boundary' },
]);

testPattern('Edge Case - Empty spaces around', {
  id: '83',
  word: 'test',
  caseSensitive: false,
  wholeWord: true,
  createdAt: Date.now()
}, [
  { text: '  test  ', shouldMatch: true, description: 'Multiple spaces around' },
  { text: '\ntest\n', shouldMatch: true, description: 'Newlines around' },
  { text: '\t test \t', shouldMatch: true, description: 'Tabs around' },
]);

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
  console.log('\n❌ SOME TESTS FAILED');
  process.exit(1);
} else {
  console.log('\n✅ ALL TESTS PASSED');
  process.exit(0);
}
