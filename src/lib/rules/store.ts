/**
 * Installed rule packs and which rules are switched off, kept in localStorage
 */

import type { RegexPattern } from '@/lib/types';
import { STORAGE_KEYS } from '@/utils/constants';
import { createLogger } from '@/utils/logger';
import { BUILTIN_PACK } from './builtin-pack';
import { compilePack } from './compile';
import type { InstalledPack, RulePack, RulePackStore } from './types';

const log = createLogger('RulePacks');

export function getRulePackStore(): RulePackStore {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.RULE_PACKS);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<RulePackStore>;
      return { packs: parsed.packs ?? [], builtinDisabledRules: parsed.builtinDisabledRules ?? [] };
    }
  } catch (error) {
    log.error('Failed to load rule packs', error);
  }
  return { packs: [], builtinDisabledRules: [] };
}

export function saveRulePackStore(store: RulePackStore): void {
  localStorage.setItem(STORAGE_KEYS.RULE_PACKS, JSON.stringify(store));
}

function update(change: (store: RulePackStore) => void): RulePackStore {
  const store = getRulePackStore();
  change(store);
  saveRulePackStore(store);
  return store;
}

/** Install a parsed pack; a pack with the same id is replaced, keeping its on/off state */
export function installRulePack(pack: RulePack): RulePackStore {
  return update(store => {
    const existing = store.packs.find(p => p.pack.id === pack.id);
    const installed: InstalledPack = {
      pack,
      enabled: existing?.enabled ?? true,
      disabledRules: (existing?.disabledRules ?? []).filter(id => pack.rules.some(rule => rule.id === id)),
      installedAt: Date.now(),
    };
    store.packs = existing
      ? store.packs.map(p => (p === existing ? installed : p))
      : [...store.packs, installed];
  });
}

export function removeRulePack(packId: string): RulePackStore {
  return update(store => {
    store.packs = store.packs.filter(p => p.pack.id !== packId);
  });
}

export function setRulePackEnabled(packId: string, enabled: boolean): RulePackStore {
  return update(store => {
    const installed = store.packs.find(p => p.pack.id === packId);
    if (installed) installed.enabled = enabled;
  });
}

/** Switch one rule on or off; packId is BUILTIN_PACK.id for built-in rules */
export function setRuleEnabled(packId: string, ruleId: string, enabled: boolean): RulePackStore {
  return update(store => {
    const toggle = (ids: string[]) => (enabled ? ids.filter(id => id !== ruleId) : [...new Set([...ids, ruleId])]);
    if (packId === BUILTIN_PACK.id) {
      store.builtinDisabledRules = toggle(store.builtinDisabledRules);
    } else {
      const installed = store.packs.find(p => p.pack.id === packId);
      if (installed) installed.disabledRules = toggle(installed.disabledRules);
    }
  });
}

/** Enabled built-in and user rules, compiled for the detectors */
export function getEnabledRulePatterns(): RegexPattern[] {
  const store = getRulePackStore();
  const patterns = compilePack(BUILTIN_PACK, store.builtinDisabledRules);
  for (const installed of store.packs) {
    if (!installed.enabled) continue;
    try {
      patterns.push(...compilePack(installed.pack, installed.disabledRules));
    } catch (error) {
      // Packs are checked on install; this only happens if storage was edited by hand
      log.error('Skipping rule pack that no longer compiles', { pack: installed.pack.id, error: String(error) });
    }
  }
  return patterns;
}

/** Enabled user packs by id, for running their validators */
export function getEnabledRulePacks(): Map<string, RulePack> {
  return new Map(getRulePackStore().packs.filter(p => p.enabled).map(p => [p.pack.id, p.pack]));
}
