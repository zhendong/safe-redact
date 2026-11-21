import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { EntityType } from '../src/lib/types';
import { compilePack } from '../src/lib/rules/compile';
import { findRuleMatches } from '../src/lib/rules/matcher';
import { parseRulePack, RulePackError, testRulePack } from '../src/lib/rules/parse';
import type { ScriptCall, ScriptValidatorHost } from '../src/lib/rules/sandbox';
import { buildSandboxSource } from '../src/lib/rules/sandbox';
import type { RulePack } from '../src/lib/rules/types';

// Node has no localStorage; rule packs are stored there
const store: Record<string, string> = {};
(globalThis as unknown as { localStorage: Pick<Storage, 'getItem' | 'setItem'> }).localStorage = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => { store[key] = value; },
};
const { getEnabledRulePatterns, getEnabledRulePacks, installRulePack, removeRulePack, setRuleEnabled, setRulePackEnabled } =
  await import('../src/lib/rules/store');
const { REGEX_PATTERNS } = await import('../src/utils/regex-patterns');
const { filterPatternsByScript } = await import('../src/utils/regex-patterns');
const { detectDocumentScript, DocumentScript } = await import('../src/utils/language-detection');

/** Runs validators with Function; the real host runs them in a locked-down worker */
class TestHost implements ScriptValidatorHost {
  calls: ScriptCall[] = [];
  async validate(pack: RulePack, calls: ScriptCall[]) {
    this.calls.push(...calls);
    return calls.map(call => {
      try {
        const fn = new Function(`return (${pack.validators![call.validator]})`)();
        const result = fn(call.match, { groups: call.groups, before: call.before, after: call.after });
        return typeof result === 'number' ? result : Boolean(result);
      } catch {
        return null;
      }
    });
  }
  dispose() {}
}

const employeePack: RulePack = {
  id: 'acme-hr',
  name: 'ACME HR',
  version: '1.0.0',
  rules: [
    {
      id: 'employee-id',
      name: 'Employee ID',
      pattern: 'EMP-(\\d{6})',
      validator: 'evenChecksum',
      examples: ['EMP-123456'],
      counterExamples: ['EMP-123453'],
    },
    {
      id: 'badge',
      name: 'Badge number',
      entityType: EntityType.CUSTOM,
      pattern: '(?:badge|工牌)\\s*[:：#]?\\s*(?<number>\\d{5})',
      flags: 'i',
      group: 'number',
      confidence: 0.6,
    },
    {
      id: 'salary',
      name: 'Salary',
      pattern: '\\$\\d{2,3},\\d{3}',
      contextKeywords: ['salary', '薪资'],
      contextWindow: 20,
      requireContext: true,
      excludeKeywords: ['example'],
      examples: ['salary: $85,000'],
      counterExamples: ['price: $85,000', 'example salary $85,000'],
    },
  ],
  validators: {
    // Digits must add up to an odd number
    evenChecksum: '(match) => match.replace(/\\D/g, "").split("").reduce((sum, d) => sum + Number(d), 0) % 2 === 1',
  },
};

// --- Parsing ---
assert.equal(parseRulePack(JSON.stringify(employeePack)).id, 'acme-hr');

function problemsOf(input: unknown): string[] {
  try {
    parseRulePack(input);
  } catch (error) {
    assert.ok(error instanceof RulePackError);
    return error.problems;
  }
  assert.fail('expected the pack to be rejected');
}

assert.deepEqual(problemsOf('not json'), ['The file is not valid JSON']);
assert.ok(problemsOf({ id: 'x', name: 'X', rules: [] }).includes('"rules" must be a non-empty list'));
assert.ok(problemsOf({ id: 'builtin', name: 'X', rules: [{ id: 'a', name: 'A', pattern: 'a' }] })[0].includes('may not be "builtin"'));
assert.ok(problemsOf({ id: 'x', name: 'X', rules: [{ id: 'a', name: 'A', pattern: '(' }] })[0].includes('invalid pattern'));
assert.ok(problemsOf({ id: 'x', name: 'X', rules: [{ id: 'a', name: 'A', pattern: 'a', validator: 'nope' }] })[0].includes('unknown validator'));
assert.ok(problemsOf({ id: 'x', name: 'X', rules: [{ id: 'a', name: 'A', pattern: 'a', flags: 'gy' }] })[0].includes('"flags"'));
assert.ok(problemsOf({ id: 'x', name: 'X', rules: [{ id: 'a', name: 'A', pattern: 'a', entityType: 'PREDEFINED' }] })[0].includes('"entityType"'));
assert.ok(problemsOf({ id: 'x', name: 'X', rules: [{ id: 'a', name: 'A', pattern: 'a', requireContext: true }] })[0].includes('needs "contextKeywords"'));
assert.ok(problemsOf({ id: 'x', name: 'X', rules: [{ id: 'a', name: 'A', pattern: 'a' }, { id: 'a', name: 'B', pattern: 'b' }] })[0].includes('duplicate id'));
assert.ok(problemsOf({
  id: 'x', name: 'X', rules: [{ id: 'a', name: 'A', pattern: 'a', validator: 'v' }],
  validators: { v: '() => import("https://example.com/steal")' },
})[0].includes('may not use "import"'));
console.log('Rule pack parsing passed');

// --- Conditions ---
const host = new TestHost();
const packs = new Map([[employeePack.id, employeePack]]);
const patterns = compilePack(employeePack);
const text = 'EMP-123453 and EMP-123456. Badge: 40213. salary: $85,000. price: $12,000. example salary: $99,000';
const matches = await findRuleMatches(text, patterns, { host, packs });
assert.deepEqual(matches.map(m => [m.pattern.ruleId, m.text]).sort(), [
  ['badge', '40213'],
  ['employee-id', 'EMP-123456'],
  ['salary', '$85,000'],
]);
const badge = matches.find(m => m.pattern.ruleId === 'badge')!;
assert.equal(text.slice(badge.index, badge.index + badge.text.length), '40213', 'group offset points at the group');
assert.equal(badge.pattern.detectionMethod, 'custom');
assert.equal(host.calls[0].before, '');
assert.deepEqual(host.calls[0].groups, ['123453']);
assert.deepEqual(await testRulePack(employeePack, host), []);

// A validator returning a number sets the confidence; one that throws keeps the match
const scored: RulePack = {
  id: 'scored', name: 'Scored',
  rules: [{ id: 'a', name: 'A', pattern: 'A\\d', validator: 'score' }, { id: 'b', name: 'B', pattern: 'B\\d', validator: 'broken' }],
  validators: { score: '(m) => Number(m[1]) / 10', broken: '() => { throw new Error("bug") }' },
};
const scoredMatches = await findRuleMatches('A7 B1', compilePack(scored), { host, packs: new Map([['scored', scored]]) });
assert.equal(scoredMatches.find(m => m.text === 'A7')!.confidence, 0.7);
assert.ok(scoredMatches.some(m => m.text === 'B1'));

// Without a sandbox, matches that need one are kept rather than silently lost
assert.equal((await findRuleMatches('EMP-123453', compilePack(employeePack))).length, 1);

// An empty match must not hang
assert.deepEqual(await findRuleMatches('abc', compilePack({ id: 'e', name: 'E', rules: [{ id: 'e', name: 'E', pattern: 'x*' }] })), []);

// Self-test reports examples the rule misses
const failures = await testRulePack({ id: 't', name: 'T', rules: [{ id: 'r', name: 'R', pattern: 'abc', examples: ['xyz'], counterExamples: ['abc'] }] });
assert.deepEqual(failures, ['Rule "r" did not detect its example "xyz"', 'Rule "r" detected its counter-example "abc"']);
console.log('Rule conditions and validators passed');

// --- Legal example: install-time checks and selected spans in a mixed document ---
const legalPack = parseRulePack(readFileSync(new URL('../docs/examples/legal-rule-pack.json', import.meta.url), 'utf8'));
assert.deepEqual(await testRulePack(legalPack), []);
const legalText = readFileSync(new URL('../docs/examples/legal-domain-sample.txt', import.meta.url), 'utf8');
const legalMatches = await findRuleMatches(legalText, compilePack(legalPack));
assert.deepEqual(legalMatches.map(match => match.text).sort(), [
  'CL-000123', 'CL-000789', 'MAT-2026-0042', 'MAT-2026-0044',
  'CTR-2026-0017', 'CTR-2026-0019', 'USD 85,000.00', '￥50000',
].sort());
for (const match of legalMatches) {
  assert.equal(legalText.slice(match.index, match.index + match.text.length), match.text, 'selected span excludes the field label');
  assert.ok(match.confidence >= 0.7, 'legal example matches survive the balanced confidence threshold');
}
console.log('Legal example pack self-tests and sample document passed');

// Exercise the shipped packs, not copies of their patterns. Compare rule + text +
// offset so a decoy with the same value cannot replace a missed intended match.
const domainExpectations: Record<string, Record<string, string[]>> = {
  healthcare: {
    'patient-mrn': ['MRN-0012345', 'PT-987654321'],
    'prescription-id': ['RX-2026-001234', 'RX-2026-005678'],
    'npi-number': ['1234567893', '1234567893'],
    'insurance-member-id': ['BCBS012345678', 'AETNA01234567'],
    'lab-accession': ['26L-012345', '26B-098765'],
  },
  finance: {
    'internal-account-ref': ['001-2345-6789', '100-0001-0001'],
    'wire-transfer-id': ['WT202611210001', 'WT202611210002'],
    'swift-bic': ['BOFAUS3N', 'CHASUS33XXX'],
    'loan-number': ['LN-2026-012345', 'LN-2026-098765'],
    'trading-account': ['TD12345678', 'MS98765432'],
  },
  education: {
    'student-id': ['2026012345', 'STU2026001'],
    'transcript-ref': ['TR-2026-00123', 'TR-2026-00456'],
    'financial-aid-id': ['FA-2026-012345', 'FA-2026-098765'],
    'gpa-value': ['3.85', '2.50'],
    'ferpa-education-record': ['ER2026-00123', 'ER2026-00456'],
  },
  'real-estate': {
    'mls-number': ['12345678', '987654321'],
    'escrow-number': ['ESC-2026-01234', 'ESC-2026-56789'],
    'deed-recording-number': ['2026-012345', '2026-01234567'],
    'parcel-number': ['123-456-789', '001-002-003'],
    'purchase-price': ['$750,000.00', '$1,200,000'],
  },
  insurance: {
    'policy-number': ['HO-1234567', 'AUTO-1234567890'],
    'claim-reference': ['CLM-2026-012345', 'CLM-2026-098765'],
    'adjuster-id': ['ADJ-01234', 'ADJ-56789'],
    'coverage-amount': ['$500,000.00', '$1,000,000'],
    'group-certificate': ['GC001-012345', 'GC042-098765'],
  },
  'it-devops': {
    'aws-access-key': ['AKIAIOSFODNN7EXAMPLE'],
    'generic-api-key': ['sk_live_abcdefghij1234567890'],
    'database-connection-string': [
      'postgresql://user:secret@db.internal:5432/production',
      'redis://default:mypassword@cache.internal:6379',
    ],
    'private-key-block': ['-----BEGIN RSA PRIVATE KEY-----\nFICTIONAL_KEY_MATERIAL_NOT_A_REAL_KEY\n-----END RSA PRIVATE KEY-----'],
    'gcp-service-account': ['my-service@my-project.iam.gserviceaccount.com', 'prod-worker@example-prod-123.iam.gserviceaccount.com'],
    'github-pat': ['ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij'],
  },
};

for (const [domain, expectedRules] of Object.entries(domainExpectations)) {
  const source = readFileSync(new URL(`../docs/examples/${domain}-rule-pack.json`, import.meta.url), 'utf8');
  const pack = parseRulePack(source);
  const text = readFileSync(new URL(`../docs/examples/${domain}-domain-sample.txt`, import.meta.url), 'utf8');
  assert.ok(!/\p{Script=Han}/u.test(source + text), `${domain}: examples stay English-only`);
  const host = new TestHost();
  const options = { host, packs: new Map([[pack.id, pack]]) };
  assert.deepEqual(await testRulePack(pack, host), [], `${domain}: install-time checks`);
  if (domain === 'healthcare') {
    // Execute the shipped checksum in the actual worker source, including its
    // lockdown prelude. Only 3 is valid for the CMS example root 123456789.
    let listener: (event: { data: { id: number; calls: ScriptCall[] } }) => void = () => assert.fail('sandbox listener missing');
    const replies: Array<{ type: string; results?: boolean[] }> = [];
    runInNewContext(buildSandboxSource(pack.validators!), {
      self: {
        postMessage: (reply: { type: string; results?: boolean[] }) => replies.push(reply),
        addEventListener: (_name: string, fn: typeof listener) => { listener = fn; },
      },
    }, { timeout: 1000 });
    assert.equal(replies[0]?.type, 'ready');
    listener({ data: { id: 1, calls: Array.from({ length: 10 }, (_, digit) => ({
      validator: 'npi-checksum', match: `123456789${digit}`, groups: [], before: '', after: '',
    })) } });
    assert.deepEqual(Array.from(replies[1].results!), Array.from({ length: 10 }, (_, digit) => digit === 3));
  }

  const patterns = compilePack(pack);
  assert.deepEqual(pack.rules.map(rule => rule.id).sort(), Object.keys(expectedRules).sort());
  for (const rule of pack.rules) {
    assert.deepEqual(rule.scripts, ['latin'], `${domain}/${rule.id}: script scope`);
    assert.ok(rule.examples?.length && rule.counterExamples?.length);
  }
  const selected = filterPatternsByScript(patterns, detectDocumentScript(text));
  assert.equal(selected.length, patterns.length, `${domain}: sample selects every rule`);
  assert.deepEqual(filterPatternsByScript(patterns, [DocumentScript.CHINESE]), [], `${domain}: skipped for Chinese documents`);

  const decoysStart = text.indexOf('Unrelated references below');
  assert.ok(decoysStart >= 0);
  const expected = Object.entries(expectedRules).flatMap(([ruleId, values]) => {
    let after = 0;
    return values.map(value => {
      const index = text.indexOf(value, after);
      assert.ok(index >= 0 && index < decoysStart, `${domain}: expected value in sample: ${value}`);
      after = index + value.length;
      return [ruleId, value, index];
    });
  });
  const matches = await findRuleMatches(text, selected, options);
  const actual = matches.map(match => [match.pattern.ruleId, match.text, match.index]);
  assert.deepEqual(actual.sort(), expected.sort(), `${domain}: exact sample spans`);
  for (const match of matches) {
    assert.equal(text.slice(match.index, match.index + match.text.length), match.text);
    assert.ok(match.confidence >= 0.7, `${domain}/${match.pattern.ruleId}: survives balanced threshold`);
  }

  // A field label must not match a suffix of another word, in either script.
  // Tokens and URLs in the DevOps pack have their own explicit boundaries.
  if (domain !== 'it-devops') {
    for (const pattern of patterns) {
      for (const prefix of ['Unrelated', '\u5b66']) {
        const example = pattern.ruleId === 'gpa-value' ? `Student ${prefix}GPA: 3.85` : prefix + pattern.examples[0];
        assert.deepEqual(await findRuleMatches(example, [pattern], options), [], `${domain}/${pattern.ruleId}: label boundary`);
      }
    }
  }
  console.log(`${domain}: ${pack.rules.length} rules, install checks and ${matches.length} exact sample spans passed`);
}

// --- Built-in pack ---
for (const pattern of REGEX_PATTERNS) {
  for (const example of pattern.examples) {
    const found = await findRuleMatches(example, [pattern]);
    assert.ok(found.length > 0, `${pattern.name} detects its example ${example}`);
  }
}
console.log(`Built-in pack: ${REGEX_PATTERNS.length} rules detect their examples`);

// --- Store ---
const builtinCount = getEnabledRulePatterns().length;
assert.equal(builtinCount, REGEX_PATTERNS.length);
installRulePack(employeePack);
assert.equal(getEnabledRulePatterns().length, builtinCount + 3);
assert.ok(getEnabledRulePacks().has('acme-hr'));
setRuleEnabled('acme-hr', 'salary', false);
assert.equal(getEnabledRulePatterns().length, builtinCount + 2);
setRuleEnabled('builtin', 'email', false);
assert.ok(!getEnabledRulePatterns().some(p => p.ruleId === 'email'));
setRuleEnabled('builtin', 'email', true);
installRulePack({ ...employeePack, version: '1.1.0' });
assert.equal(getEnabledRulePatterns().length, builtinCount + 2, 'updating a pack keeps rules switched off');
setRulePackEnabled('acme-hr', false);
assert.equal(getEnabledRulePatterns().length, builtinCount);
assert.ok(!getEnabledRulePacks().has('acme-hr'));
removeRulePack('acme-hr');
assert.equal(JSON.parse(store['safe-redact-rule-packs']).packs.length, 0);
console.log('Rule pack store passed');
