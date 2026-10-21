import type { RegexPattern } from '@/lib/types';
import { DEFAULT_CONFIDENCE_BOOST, DEFAULT_SEARCH_CONTEXT_WINDOW } from '@/utils/constants';
import { createLogger } from '@/utils/logger';
import { hasContextKeywords } from './context';
import type { ScriptCall, ScriptValidatorHost } from './sandbox';
import type { RulePack } from './types';

const log = createLogger('RuleMatcher');

export interface RuleMatch {
  pattern: RegexPattern;
  text: string;
  index: number;
  confidence: number;
}

interface PendingScript {
  match: RuleMatch;
  call: ScriptCall;
}

/**
 * Run patterns over text and apply each rule's conditions: validator, context
 * keywords, required and excluded context, and capture group. Validators from a
 * pack's code run in `host`; packs maps pack ids to their definitions for it.
 */
export async function findRuleMatches(
  text: string,
  patterns: RegexPattern[],
  options: { host?: ScriptValidatorHost; packs?: Map<string, RulePack> } = {},
): Promise<RuleMatch[]> {
  const matches: RuleMatch[] = [];
  const scripted = new Map<string, PendingScript[]>();

  for (const pattern of patterns) {
    const regex = new RegExp(pattern.pattern.source, pattern.pattern.flags.includes('g') ? pattern.pattern.flags : pattern.pattern.flags + 'g');
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      // An empty match would never advance; user patterns can produce one
      if (match[0] === '') {
        regex.lastIndex++;
        continue;
      }

      let matchedText = match[0];
      let index = match.index;
      if (pattern.group !== undefined) {
        const groupText = typeof pattern.group === 'number' ? match[pattern.group] : match.groups?.[pattern.group];
        const span = typeof pattern.group === 'number' ? match.indices?.[pattern.group] : match.indices?.groups?.[pattern.group];
        if (!groupText || !span) continue;
        matchedText = groupText;
        index = span[0];
      }

      if (pattern.validator && !pattern.validator(matchedText)) continue;

      const windowSize = pattern.contextWindowSize ?? DEFAULT_SEARCH_CONTEXT_WINDOW;
      if (pattern.excludeKeywords?.length && hasContextKeywords(text, index, matchedText.length, pattern.excludeKeywords, windowSize)) {
        continue;
      }
      let confidence = pattern.confidence;
      if (pattern.contextKeywords?.length) {
        const hasContext = hasContextKeywords(text, index, matchedText.length, pattern.contextKeywords, windowSize);
        if (!hasContext && pattern.requireContext) continue;
        if (hasContext) confidence = Math.min(1, confidence * (pattern.confidenceBoost ?? DEFAULT_CONFIDENCE_BOOST));
      }

      const ruleMatch = { pattern, text: matchedText, index, confidence };
      if (pattern.scriptValidator && pattern.packId) {
        const calls = scripted.get(pattern.packId) ?? [];
        calls.push({
          match: ruleMatch,
          call: {
            validator: pattern.scriptValidator,
            match: matchedText,
            groups: Array.from(match).slice(1),
            before: text.slice(Math.max(0, index - windowSize), index),
            after: text.slice(index + matchedText.length, index + matchedText.length + windowSize),
          },
        });
        scripted.set(pattern.packId, calls);
      } else {
        matches.push(ruleMatch);
      }
    }
  }

  for (const [packId, pending] of scripted) {
    const pack = options.packs?.get(packId);
    let results: Array<boolean | number | null>;
    try {
      if (!pack || !options.host) throw new Error('No validator sandbox for this pack');
      results = await options.host.validate(pack, pending.map(p => p.call));
    } catch (error) {
      // Keep the matches: a missed redaction is worse than an extra one to review
      log.warn('Pack validators failed, keeping their matches', { pack: packId, matches: pending.length, error: String(error) });
      results = pending.map(() => null);
    }
    pending.forEach(({ match }, i) => {
      const result = results[i];
      if (result === false) return;
      if (typeof result === 'number') match.confidence = result;
      matches.push(match);
    });
  }

  return matches;
}
