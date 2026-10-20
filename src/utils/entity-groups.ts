import type { DetectedEntity } from '@/lib/types';
import { EntityType } from '@/lib/types';

/**
 * Types decided as a whole on the Choose screen. People rarely want to keep
 * some phone numbers and redact others, so these start selected.
 */
export const STRUCTURED_TYPES: readonly EntityType[] = [
  EntityType.PHONE,
  EntityType.EMAIL,
  EntityType.SSN,
  EntityType.CREDIT_CARD,
  EntityType.CUSTOM,
  EntityType.PREDEFINED,
];

/** Types decided value by value: names, places, and dates need a person to judge them */
export const VALUE_TYPES: readonly EntityType[] = [
  EntityType.PERSON,
  EntityType.ORGANIZATION,
  EntityType.LOCATION,
  EntityType.DATE,
];

/** Every occurrence of one value of one type */
export interface ValueGroup {
  key: string;
  type: EntityType;
  /** The value as first found in the document */
  text: string;
  ids: string[];
  /** Whether every occurrence will be redacted */
  selected: boolean;
  /** Surrounding text of the first few occurrences */
  contexts: string[];
}

/**
 * Choices on the Choose screen apply to every occurrence, so a value or type
 * counts as selected only when all of them are. A partial selection made on
 * the Check screen shows as unselected, never as fully redacted.
 */
export function allSelected(entities: DetectedEntity[]): boolean {
  return entities.length > 0 && entities.every(e => e.status === 'confirmed');
}

/** Occurrences differing only in case or spacing are the same value */
function valueKey(entity: DetectedEntity): string {
  return `${entity.entityType}\u0000${entity.text.trim().replace(/\s+/g, ' ').toLowerCase()}`;
}

/** Groups entities by type and value, most frequent first */
export function groupByValue(entities: DetectedEntity[]): ValueGroup[] {
  const groups = new Map<string, DetectedEntity[]>();
  for (const entity of entities) {
    const key = valueKey(entity);
    const group = groups.get(key);
    if (group) group.push(entity);
    else groups.set(key, [entity]);
  }
  return [...groups.entries()]
    .map(([key, members]) => ({
      key,
      type: members[0].entityType,
      text: members[0].text.trim(),
      ids: members.map(e => e.id),
      selected: allSelected(members),
      contexts: members.map(e => e.contextText).filter((c): c is string => !!c).slice(0, 3),
    }))
    .sort((a, b) => b.ids.length - a.ids.length || a.text.localeCompare(b.text));
}

/** Starting selection after analysis: structured types are selected, everything else waits for the user */
export function applyDefaultSelection(entities: DetectedEntity[]): DetectedEntity[] {
  return entities.map(entity =>
    STRUCTURED_TYPES.includes(entity.entityType) ? { ...entity, status: 'confirmed' as const } : entity,
  );
}
