import { EntityType } from '@/lib/types';
import type { RegexPattern } from '@/lib/types';
import type { RuleDefinition, RulePack } from './types';
import { BUILTIN_PACK_ID } from './builtin-pack';
import { BUILTIN_VALIDATORS } from './validators';

export const DEFAULT_RULE_CONFIDENCE = 0.8;

/**
 * Turn a rule into the pattern the detectors run. Throws if the regex doesn't
 * compile or the validator doesn't exist.
 */
export function compileRule(rule: RuleDefinition, pack: RulePack): RegexPattern {
  // "d" gives capture group offsets, needed to detect a group instead of the whole match
  const flags = 'g' + (rule.flags ?? '').replace(/[gdy]/g, '') + (rule.group !== undefined ? 'd' : '');
  let pattern: RegExp;
  try {
    pattern = new RegExp(rule.pattern, flags);
  } catch (error) {
    throw new Error(`Rule "${rule.id}": invalid pattern (${error instanceof Error ? error.message : String(error)})`);
  }

  let validator: RegexPattern['validator'];
  let scriptValidator: string | undefined;
  if (rule.validator) {
    if (pack.validators && Object.hasOwn(pack.validators, rule.validator)) {
      scriptValidator = rule.validator;
    } else if (Object.hasOwn(BUILTIN_VALIDATORS, rule.validator)) {
      validator = BUILTIN_VALIDATORS[rule.validator];
    } else {
      throw new Error(`Rule "${rule.id}": unknown validator "${rule.validator}"`);
    }
  }

  return {
    name: rule.name,
    entityType: rule.entityType ?? EntityType.CUSTOM,
    pattern,
    confidence: rule.confidence ?? DEFAULT_RULE_CONFIDENCE,
    validator,
    scriptValidator,
    examples: rule.examples ?? [],
    scripts: rule.scripts,
    contextKeywords: rule.contextKeywords,
    contextWindowSize: rule.contextWindow,
    confidenceBoost: rule.confidenceBoost,
    requireContext: rule.requireContext,
    excludeKeywords: rule.excludeKeywords,
    group: rule.group,
    packId: pack.id,
    ruleId: rule.id,
    detectionMethod: pack.id === BUILTIN_PACK_ID ? 'regex' : 'custom',
  };
}

export function compilePack(pack: RulePack, disabledRules: string[] = []): RegexPattern[] {
  return pack.rules
    .filter(rule => !disabledRules.includes(rule.id))
    .map(rule => compileRule(rule, pack));
}
