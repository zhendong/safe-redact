import type { EntityType } from '@/lib/types';

/**
 * A rule pack as written in a .json file. See docs/rule-packs.md for the format.
 */
export interface RulePack {
  id: string;                              // Stable id; installing the same id again updates the pack
  name: string;
  version?: string;
  description?: string;
  author?: string;
  rules: RuleDefinition[];
  validators?: Record<string, string>;     // Name → JavaScript function source, run in a sandboxed worker
}

export interface RuleDefinition {
  id: string;                              // Unique within the pack
  name: string;                            // Shown on detected entities
  entityType?: EntityType;                 // Default: CUSTOM
  pattern: string;                         // Regular expression source
  flags?: string;                          // Any of "imsu"; matching is always global
  confidence?: number;                     // Base confidence 0-1 (default: 0.8)
  validator?: string;                      // Built-in validator, or a name from the pack's validators
  group?: number | string;                 // Capture group to detect instead of the whole match
  contextKeywords?: string[];              // Words that raise confidence when found nearby
  contextWindow?: number;                  // Characters searched on each side (default: 10)
  confidenceBoost?: number;                // Confidence multiplier when a keyword is nearby (default: 1.2)
  requireContext?: boolean;                // Only detect when a context keyword is nearby
  excludeKeywords?: string[];              // Skip matches with any of these words nearby
  scripts?: string[];                      // Only run on documents in these scripts (e.g. "chinese", "latin")
  examples?: string[];                     // Text the rule must detect, checked on install
  counterExamples?: string[];              // Text the rule must not detect, checked on install
}

/** A user-installed pack and its on/off state */
export interface InstalledPack {
  pack: RulePack;
  enabled: boolean;
  disabledRules: string[];
  installedAt: number;
}

export interface RulePackStore {
  packs: InstalledPack[];
  builtinDisabledRules: string[];          // Built-in rules the user turned off
}
