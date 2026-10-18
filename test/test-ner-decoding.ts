/**
 * Tests for turning NER token predictions into spans of the original text
 */
import {
  alignTokens,
  decodeSpans,
  extendChineseAddresses,
  mergeTouchingSpans,
  tokenWindows,
  type NerSpan,
} from '../src/lib/detectors/nerDecoding';

let passed = 0;
let failed = 0;

function check(description: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
    console.log(`✓ ${description}`);
  } else {
    failed++;
    console.log(`✗ ${description}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
  }
}

const slices = (text: string, spans: NerSpan[]) => spans.map(s => `${s.type}:${text.slice(s.start, s.end)}`);
const predict = (labels: string[]) => labels.map(label => ({ label, score: 0.9 }));

console.log('\n=== alignTokens ===');
{
  const text = '甲方：张三，住址 Bei Jing';
  const tokens = ['甲', '方', '：', '张', '三', '，', '住', '址', 'bei', 'jing'];
  check('aligns CJK characters and uncased Latin words', alignTokens(text, tokens).map(o => o && text.slice(...o)), [
    '甲', '方', '：', '张', '三', '，', '住', '址', 'Bei', 'Jing',
  ]);
}
{
  const text = 'Telstra in Zürich';
  check('aligns subword pieces and accented text', alignTokens(text, ['Tel', '##stra', 'in', 'zurich']).map(o => o && text.slice(...o)), [
    'Tel', 'stra', 'in', 'Zürich',
  ]);
}
{
  const text = '王㛃女士';
  check('unknown tokens get the text between their neighbours', alignTokens(text, ['王', '[UNK]', '女', '士']).map(o => o && text.slice(...o)), [
    '王', '㛃', '女', '士',
  ]);
}

console.log('\n=== tokenWindows ===');
{
  const windows = tokenWindows(1200, 510, 64);
  const kept = windows.flatMap(w => Array.from({ length: w.keepEnd - w.keepStart }, (_, i) => w.keepStart + i));
  check('every token is kept by exactly one window', kept, Array.from({ length: 1200 }, (_, i) => i));
  check('windows fit the model', windows.every(w => w.end - w.start <= 510 && w.keepStart >= w.start && w.keepEnd <= w.end), true);
  check('short text is a single window', tokenWindows(5, 510, 64), [{ start: 0, end: 5, keepStart: 0, keepEnd: 5 }]);
}

console.log('\n=== decodeSpans ===');
{
  const text = '甲方：张三';
  const tokens = ['甲', '方', '：', '张', '三'];
  const spans = decodeSpans(tokens, alignTokens(text, tokens), predict(['O', 'O', 'O', 'B-PER', 'I-PER']));
  check('CJK entities are sliced without spaces', slices(text, spans), ['PER:张三']);
}
{
  const text = 'Bachelor of Telecommunication Engineering';
  const tokens = ['Bachelor', 'of', 'Tel', '##eco', '##mmunication', 'Engineering'];
  // A stray label on a subword piece must not become an entity of its own
  const spans = decodeSpans(tokens, alignTokens(text, tokens), predict(['O', 'O', 'O', 'I-ORG', 'I-ORG', 'O']));
  check('subword pieces follow their word\'s first piece', slices(text, spans), []);
}
{
  const text = 'Telstra and Wells Fargo';
  const tokens = ['Tel', '##stra', 'and', 'Wells', 'Far', '##go'];
  const spans = decodeSpans(tokens, alignTokens(text, tokens), predict(['B-ORG', 'O', 'O', 'B-ORG', 'I-ORG', 'O']));
  check('whole words are kept, and an O token ends a span', slices(text, spans), ['ORG:Telstra', 'ORG:Wells Fargo']);
}
{
  const text = '江苏特斯拉';
  const tokens = ['江', '苏', '特', '斯', '拉'];
  const spans = decodeSpans(tokens, alignTokens(text, tokens), predict(['B-address', 'E-address', 'B-company', 'I-company', 'E-company']));
  check('BIOES labels', slices(text, spans), ['address:江苏', 'company:特斯拉']);
}

console.log('\n=== span post-processing ===');
{
  const text = '上海浦东新区张江路88号的李晓明';
  const spans: NerSpan[] = [
    { type: 'LOC', start: 0, end: 2, score: 0.9 },
    { type: 'LOC', start: 2, end: 6, score: 0.8 },
    { type: 'LOC', start: 6, end: 9, score: 0.9 },
    { type: 'PER', start: 13, end: 16, score: 0.9 },
  ];
  const merged = mergeTouchingSpans(spans);
  check('touching spans of the same type merge', slices(text, merged), ['LOC:上海浦东新区张江路', 'PER:李晓明']);
  check('Chinese addresses extend over house numbers', slices(text, extendChineseAddresses(text, merged, 'LOC')), [
    'LOC:上海浦东新区张江路88号', 'PER:李晓明',
  ]);
}
{
  const text = '北京市朝阳区建国路3栋502室';
  const spans = extendChineseAddresses(text, [{ type: 'LOC', start: 0, end: 9, score: 0.9 }], 'LOC');
  check('building and room numbers are included', slices(text, spans), ['LOC:北京市朝阳区建国路3栋502室']);
}
{
  const text = 'Room 12号 in Sydney';
  const spans = extendChineseAddresses(text, [{ type: 'LOC', start: 12, end: 18, score: 0.9 }], 'LOC');
  check('Latin-script locations are not extended', slices(text, spans), ['LOC:Sydney']);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
