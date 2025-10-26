/**
 * Test suite for language detection and pattern filtering
 * Tests the language-aware pattern selection to reduce false positives
 */
import { DocumentScript, detectDocumentScript, getScriptStatistics } from '../src/utils/language-detection';
import { filterPatternsByScript, getPatternsForText, REGEX_PATTERNS } from '../src/utils/regex-patterns';

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

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function testLanguageDetection(
  description: string,
  text: string,
  expectedScripts: DocumentScript[]
) {
  totalTests++;
  const detectedScripts = detectDocumentScript(text);

  // Check if all expected scripts are detected and vice versa
  const passed = expectedScripts.length === detectedScripts.length &&
    expectedScripts.every(s => detectedScripts.includes(s));

  if (passed) {
    passedTests++;
  } else {
    failedTests++;
  }

  const status = passed ? '✓ PASS' : '✗ FAIL';
  console.log(`${status}: ${description}`);
  console.log(`  Expected: [${expectedScripts.join(', ')}], Got: [${detectedScripts.join(', ')}]`);

  if (!passed) {
    const stats = getScriptStatistics(text);
    console.log(`  Stats:`, stats.percentages);
  }
  console.log('');
}

function testPatternFiltering(
  description: string,
  scripts: DocumentScript[],
  shouldIncludePatterns: string[],
  shouldExcludePatterns: string[]
) {
  totalTests++;

  const filteredPatterns = filterPatternsByScript(REGEX_PATTERNS, scripts);
  const patternNames = filteredPatterns.map(p => p.name);

  const includedCorrectly = shouldIncludePatterns.every(name =>
    patternNames.includes(name)
  );

  const excludedCorrectly = shouldExcludePatterns.every(name =>
    !patternNames.includes(name)
  );

  const passed = includedCorrectly && excludedCorrectly;

  if (passed) {
    passedTests++;
  } else {
    failedTests++;
  }

  const status = passed ? '✓ PASS' : '✗ FAIL';
  console.log(`${status}: ${description}`);
  console.log(`  Scripts: [${scripts.join(', ')}], Patterns: ${filteredPatterns.length}/${REGEX_PATTERNS.length}`);

  if (!passed) {
    if (!includedCorrectly) {
      const missing = shouldIncludePatterns.filter(name => !patternNames.includes(name));
      console.log(`  Missing expected patterns:`, missing);
    }
    if (!excludedCorrectly) {
      const unexpected = shouldExcludePatterns.filter(name => patternNames.includes(name));
      console.log(`  Unexpected patterns included:`, unexpected);
    }
  }
  console.log('');
}

console.log('='.repeat(80));
console.log('LANGUAGE DETECTION TESTS');
console.log('='.repeat(80));
console.log('');

// =============================================================================
// LATIN SCRIPT DETECTION
// =============================================================================

testLanguageDetection(
  'English text',
  'This is a sample English text with some words and numbers 12345.',
  [DocumentScript.LATIN]
);

testLanguageDetection(
  'French text',
  'Bonjour, ceci est un texte en français avec des accents.',
  [DocumentScript.LATIN]
);

testLanguageDetection(
  'Spanish text',
  'Hola, este es un texto en español con caracteres especiales.',
  [DocumentScript.LATIN]
);

// =============================================================================
// CHINESE SCRIPT DETECTION
// =============================================================================

testLanguageDetection(
  'Chinese text with numbers (Simplified)',
  '这是一份中文文档，包含了一些敏感信息需要被识别和处理。身份证号码：110101199003071234',
  [DocumentScript.CHINESE]
);

testLanguageDetection(
  'Chinese text with email address',
  '姓名：张三，电话：138-0013-8000，邮箱：test@example.com',
  [DocumentScript.CHINESE, DocumentScript.LATIN]
);

testLanguageDetection(
  'Chinese text (Traditional)',
  '這是一份繁體中文文檔，包含了一些敏感資訊需要被識別和處理。',
  [DocumentScript.CHINESE]
);

// =============================================================================
// JAPANESE SCRIPT DETECTION
// =============================================================================

testLanguageDetection(
  'Japanese text (Mixed)',
  'これは日本語のテキストです。パスワードは秘密にしてください。',
  [DocumentScript.JAPANESE]
);

testLanguageDetection(
  'Japanese text (Hiragana)',
  'これはひらがなだけのてきすとです。',
  [DocumentScript.JAPANESE]
);

testLanguageDetection(
  'Japanese text (Katakana)',
  'コレハカタカナダケノテキストデス。',
  [DocumentScript.JAPANESE]
);

// =============================================================================
// KOREAN SCRIPT DETECTION
// =============================================================================

testLanguageDetection(
  'Korean text',
  '이것은 한국어 텍스트입니다. 비밀번호를 안전하게 보관하세요.',
  [DocumentScript.KOREAN]
);

testLanguageDetection(
  'Korean text with numbers',
  '이것은 한국어 문서입니다. 이름: 홍길동, 전화번호: 010-1234-5678, 주소: 서울특별시',
  [DocumentScript.KOREAN]
);

// =============================================================================
// ARABIC SCRIPT DETECTION
// =============================================================================

testLanguageDetection(
  'Arabic text',
  'هذا نص باللغة العربية. يجب حماية المعلومات الحساسة.',
  [DocumentScript.ARABIC]
);

testLanguageDetection(
  'Arabic text with diacritics',
  'هَذَا نَصٌّ بِاللُّغَةِ الْعَرَبِيَّةِ مَعَ التَّشْكِيلِ.',
  [DocumentScript.ARABIC]
);

// =============================================================================
// HEBREW SCRIPT DETECTION
// =============================================================================

testLanguageDetection(
  'Hebrew text',
  'זהו טקסט בעברית. יש להגן על מידע רגיש.',
  [DocumentScript.HEBREW]
);

// =============================================================================
// DEVANAGARI SCRIPT DETECTION
// =============================================================================

testLanguageDetection(
  'Hindi text',
  'यह हिंदी में एक पाठ है। संवेदनशील जानकारी की रक्षा करनी चाहिए।',
  [DocumentScript.DEVANAGARI]
);

// =============================================================================
// THAI SCRIPT DETECTION
// =============================================================================

testLanguageDetection(
  'Thai text',
  'นี่คือข้อความภาษาไทย ต้องปกป้องข้อมูลที่สำคัญ',
  [DocumentScript.THAI]
);

// =============================================================================
// CYRILLIC SCRIPT DETECTION
// =============================================================================

testLanguageDetection(
  'Russian text',
  'Это текст на русском языке. Необходимо защищать конфиденциальную информацию.',
  [DocumentScript.CYRILLIC]
);

testLanguageDetection(
  'Ukrainian text',
  'Це текст українською мовою. Потрібно захищати конфіденційну інформацію.',
  [DocumentScript.CYRILLIC]
);

// =============================================================================
// MULTI-SCRIPT DETECTION
// =============================================================================

testLanguageDetection(
  'Mixed English-Chinese',
  'This document contains both English and 中文内容 in the same text. 这是一个混合文档。',
  [DocumentScript.LATIN, DocumentScript.CJK]
);

testLanguageDetection(
  'Mixed English-Japanese',
  'This is a mixed document with some 日本語テキスト included.',
  [DocumentScript.JAPANESE, DocumentScript.LATIN]
);

// =============================================================================
// PATTERN FILTERING TESTS
// =============================================================================

console.log('='.repeat(80));
console.log('PATTERN FILTERING TESTS');
console.log('='.repeat(80));
console.log('');

testPatternFiltering(
  'Latin script should include US SSN, exclude Chinese patterns',
  [DocumentScript.LATIN],
  ['SSN (US)', 'Email', 'Phone (US)'],
  ['Phone (China Mobile)', 'Phone (China Landline)', 'Chinese National ID']
);

testPatternFiltering(
  'Chinese script should include Chinese patterns',
  [DocumentScript.CHINESE],
  ['Phone (China Mobile)', 'Phone (China Landline)', 'Chinese National ID', 'Date (Chinese)'],
  ['US Passport'] // US-specific pattern should be excluded
);

testPatternFiltering(
  'CJK script should include Chinese patterns',
  [DocumentScript.CJK],
  ['Phone (China Mobile)', 'Phone (China Landline)', 'Date (Chinese)'],
  ['US Passport'] // US-specific pattern should be excluded
);

testPatternFiltering(
  'Multi-script (Chinese + Latin) should include both sets of patterns',
  [DocumentScript.CHINESE, DocumentScript.LATIN],
  ['Email', 'Phone (International)', 'SSN (US)', 'Phone (China Mobile)', 'Phone (US)'], // Patterns from both scripts
  [] // Multi-script should not exclude anything from included scripts
);

testPatternFiltering(
  'Japanese script should exclude China-specific patterns',
  [DocumentScript.JAPANESE],
  ['Date (Chinese)', 'Email'], // Chinese date format used in Japanese too
  ['Phone (China Mobile)', 'Phone (China Landline)', 'Chinese National ID', 'Chinese Passport (Current)']
);


// =============================================================================
// SUMMARY
// =============================================================================

console.log('='.repeat(80));
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
