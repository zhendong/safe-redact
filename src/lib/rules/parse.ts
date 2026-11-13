import { EntityType } from '@/lib/types';
import { compileRule } from './compile';
import { BUILTIN_PACK_ID } from './builtin-pack';
import { findRuleMatches } from './matcher';
import { checkValidatorSource, type ScriptValidatorHost } from './sandbox';
import type { RuleDefinition, RulePack } from './types';

const MAX_PACK_BYTES = 512 * 1024;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const ENTITY_TYPES: EntityType[] = Object.values(EntityType).filter(type => type !== EntityType.PREDEFINED);

export class RulePackError extends Error {
  constructor(public readonly problems: string[]) {
    super(problems.join('\n'));
    this.name = 'RulePackError';
  }
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(item => typeof item === 'string');

/**
 * Check a pack's structure and compile its rules. Throws RulePackError listing
 * every problem found.
 */
export function parseRulePack(input: string | unknown): RulePack {
  if (typeof input === 'string') {
    if (input.length > MAX_PACK_BYTES) throw new RulePackError(['The file is larger than 512 KB']);
    try {
      input = JSON.parse(input);
    } catch {
      throw new RulePackError(['The file is not valid JSON']);
    }
  }
  const problems: string[] = [];
  const pack = input as RulePack;
  if (!pack || typeof pack !== 'object' || Array.isArray(pack)) throw new RulePackError(['A rule pack must be a JSON object']);

  if (typeof pack.id !== 'string' || !ID_PATTERN.test(pack.id)) problems.push('"id" must be letters, digits, ".", "_" or "-"');
  else if (pack.id === BUILTIN_PACK_ID) problems.push(`"id" may not be "${BUILTIN_PACK_ID}"`);
  if (typeof pack.name !== 'string' || !pack.name.trim()) problems.push('"name" is required');
  for (const field of ['version', 'description', 'author'] as const) {
    if (pack[field] !== undefined && typeof pack[field] !== 'string') problems.push(`"${field}" must be a string`);
  }

  if (pack.validators !== undefined) {
    if (!pack.validators || typeof pack.validators !== 'object' || Array.isArray(pack.validators)) {
      problems.push('"validators" must map names to JavaScript function source');
    } else {
      for (const [name, source] of Object.entries(pack.validators)) {
        if (typeof source !== 'string') problems.push(`Validator "${name}" must be a string of JavaScript`);
        else {
          const problem = checkValidatorSource(name, source);
          if (problem) problems.push(problem);
        }
      }
    }
  }

  if (!Array.isArray(pack.rules) || pack.rules.length === 0) {
    problems.push('"rules" must be a non-empty list');
  } else {
    const ids = new Set<string>();
    pack.rules.forEach((rule, i) => {
      const label = typeof rule?.id === 'string' ? `Rule "${rule.id}"` : `Rule ${i + 1}`;
      const ruleProblems = checkRule(rule, label);
      if (typeof rule?.id === 'string') {
        if (ids.has(rule.id)) ruleProblems.push(`${label}: duplicate id`);
        ids.add(rule.id);
      }
      problems.push(...ruleProblems);
      if (ruleProblems.length === 0 && problems.length === 0) {
        try {
          compileRule(rule, pack);
        } catch (error) {
          problems.push(error instanceof Error ? error.message : String(error));
        }
      }
    });
  }

  if (problems.length) throw new RulePackError(problems);
  return pack;
}

function checkRule(rule: RuleDefinition, label: string): string[] {
  const problems: string[] = [];
  if (!rule || typeof rule !== 'object') return [`${label}: must be an object`];
  if (typeof rule.id !== 'string' || !ID_PATTERN.test(rule.id)) problems.push(`${label}: "id" must be letters, digits, ".", "_" or "-"`);
  if (typeof rule.name !== 'string' || !rule.name.trim()) problems.push(`${label}: "name" is required`);
  if (typeof rule.pattern !== 'string' || !rule.pattern) problems.push(`${label}: "pattern" is required`);
  if (rule.flags !== undefined && (typeof rule.flags !== 'string' || !/^[imsu]*$/.test(rule.flags))) {
    problems.push(`${label}: "flags" may only contain i, m, s and u`);
  }
  if (rule.entityType !== undefined && !ENTITY_TYPES.includes(rule.entityType)) {
    problems.push(`${label}: "entityType" must be one of ${ENTITY_TYPES.join(', ')}`);
  }
  if (rule.confidence !== undefined && !(typeof rule.confidence === 'number' && rule.confidence >= 0 && rule.confidence <= 1)) {
    problems.push(`${label}: "confidence" must be between 0 and 1`);
  }
  if (rule.confidenceBoost !== undefined && !(typeof rule.confidenceBoost === 'number' && rule.confidenceBoost > 0)) {
    problems.push(`${label}: "confidenceBoost" must be a positive number`);
  }
  if (rule.contextWindow !== undefined && !(Number.isInteger(rule.contextWindow) && rule.contextWindow >= 0 && rule.contextWindow <= 500)) {
    problems.push(`${label}: "contextWindow" must be a whole number from 0 to 500`);
  }
  if (rule.group !== undefined && !(typeof rule.group === 'string' || (Number.isInteger(rule.group) && rule.group >= 0))) {
    problems.push(`${label}: "group" must be a group number or name`);
  }
  if (rule.validator !== undefined && typeof rule.validator !== 'string') problems.push(`${label}: "validator" must be a name`);
  if (rule.requireContext !== undefined && typeof rule.requireContext !== 'boolean') problems.push(`${label}: "requireContext" must be true or false`);
  if (rule.requireContext && !rule.contextKeywords?.length) problems.push(`${label}: "requireContext" needs "contextKeywords"`);
  for (const field of ['contextKeywords', 'excludeKeywords', 'scripts', 'examples', 'counterExamples'] as const) {
    if (rule[field] !== undefined && !isStringArray(rule[field])) problems.push(`${label}: "${field}" must be a list of strings`);
  }
  return problems;
}

/**
 * Run every rule against its examples and counter-examples. Returns the
 * failures; an empty list means the pack works as its author described.
 */
export async function testRulePack(pack: RulePack, host?: ScriptValidatorHost): Promise<string[]> {
  const failures: string[] = [];
  const packs = new Map([[pack.id, pack]]);
  // Loads the pack's code, so syntax errors surface here instead of being skipped
  if (pack.validators && host) await host.validate(pack, []);
  for (const rule of pack.rules) {
    const pattern = compileRule(rule, pack);
    for (const example of rule.examples ?? []) {
      const matches = await findRuleMatches(example, [pattern], { host, packs });
      if (matches.length === 0) failures.push(`Rule "${rule.id}" did not detect its example "${example}"`);
    }
    for (const example of rule.counterExamples ?? []) {
      const matches = await findRuleMatches(example, [pattern], { host, packs });
      if (matches.length > 0) failures.push(`Rule "${rule.id}" detected its counter-example "${example}"`);
    }
  }
  return failures;
}
