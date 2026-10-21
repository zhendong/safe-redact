import { EntityType } from '@/lib/types';
import type { DetectionConfig } from '@/lib/types';
import { translations, type Language } from '@/i18n/translations';

/**
 * Entity type metadata including colors and display names
 */

export interface EntityTypeMetadata {
  type: EntityType;
  displayName: string;
  color: string;
  description: string;
  icon?: string;
}

export const ENTITY_TYPE_METADATA: Record<EntityType, EntityTypeMetadata> = {
  [EntityType.PERSON]: {
    type: EntityType.PERSON,
    displayName: 'Person',
    color: '#3B82F6', // blue
    description: 'Person names',
  },
  [EntityType.ORGANIZATION]: {
    type: EntityType.ORGANIZATION,
    displayName: 'Organization',
    color: '#10B981', // green
    description: 'Company or organization names',
  },
  [EntityType.LOCATION]: {
    type: EntityType.LOCATION,
    displayName: 'Location',
    color: '#F59E0B', // amber
    description: 'Places and addresses',
  },
  [EntityType.DATE]: {
    type: EntityType.DATE,
    displayName: 'Date',
    color: '#6B7280', // gray
    description: 'Dates and time references',
  },
  [EntityType.ID_NUMBER]: {
    type: EntityType.ID_NUMBER,
    displayName: 'ID Number',
    color: '#EF4444', // red
    description: 'Personal ID numbers such as social security numbers, national IDs, and passports',
  },
  [EntityType.CREDIT_CARD]: {
    type: EntityType.CREDIT_CARD,
    displayName: 'Credit Card',
    color: '#DC2626', // dark red
    description: 'Credit card numbers',
  },
  [EntityType.PHONE]: {
    type: EntityType.PHONE,
    displayName: 'Phone',
    color: '#F97316', // orange
    description: 'Phone numbers',
  },
  [EntityType.EMAIL]: {
    type: EntityType.EMAIL,
    displayName: 'Email',
    color: '#8B5CF6', // purple
    description: 'Email addresses',
  },
  [EntityType.CUSTOM]: {
    type: EntityType.CUSTOM,
    displayName: 'Custom',
    color: '#EC4899', // pink
    description: 'Other patterns such as URLs, IP addresses, and crypto addresses',
  },
  [EntityType.PREDEFINED]: {
    type: EntityType.PREDEFINED,
    displayName: 'Predefined Words',
    color: '#14B8A6', // teal
    description: 'Words from your predefined list',
  },
};

/**
 * Get entity type color
 */
export function getEntityColor(entityType: EntityType): string {
  return ENTITY_TYPE_METADATA[entityType]?.color || '#6B7280';
}

/**
 * Get entity type display name, translated for the given language
 */
export function getEntityDisplayName(entityType: EntityType, language: Language = 'en'): string {
  return translations[language].entityTypes[entityType]?.name
    || ENTITY_TYPE_METADATA[entityType]?.displayName
    || entityType;
}

/**
 * Get entity type description, translated for the given language
 */
export function getEntityDescription(entityType: EntityType, language: Language = 'en'): string {
  return translations[language].entityTypes[entityType]?.description
    || ENTITY_TYPE_METADATA[entityType]?.description
    || '';
}

/**
 * Get CSS class name for entity type
 */
export function getEntityClassName(entityType: EntityType): string {
  return `entity-${entityType.toLowerCase()}`;
}

/**
 * Entity types that existed before saved settings recorded `knownEntityTypes`
 */
const LEGACY_ENTITY_TYPES: EntityType[] = [
  EntityType.PERSON,
  EntityType.ORGANIZATION,
  EntityType.LOCATION,
  EntityType.DATE,
  EntityType.ID_NUMBER,
  EntityType.CREDIT_CARD,
  EntityType.PHONE,
  EntityType.EMAIL,
  EntityType.CUSTOM,
];

/** Saved name of ID_NUMBER, which then covered only SSNs */
const LEGACY_SSN = 'SSN';

/**
 * Rename SSN in settings saved before ID_NUMBER existed. ID numbers stay
 * enabled if SSNs or Custom (which had the other ID rules) were enabled.
 */
function migrateSsnType(config: DetectionConfig): DetectionConfig {
  const known = config.knownEntityTypes as string[] | undefined;
  if (known && !known.includes(LEGACY_SSN)) return config;
  const enabled = (config.enabledEntityTypes ?? []) as string[];
  const withoutSsn = (types: string[]) => types.filter(type => type !== LEGACY_SSN) as EntityType[];
  const idEnabled = enabled.includes(LEGACY_SSN) || enabled.includes(EntityType.CUSTOM);
  return {
    ...config,
    enabledEntityTypes: [...withoutSsn(enabled), ...(idEnabled ? [EntityType.ID_NUMBER] : [])],
    knownEntityTypes: known && [...withoutSsn(known), EntityType.ID_NUMBER],
  };
}

/**
 * Enable entity types added since the settings were saved, so new types
 * (e.g. PREDEFINED) aren't silently filtered out for existing users
 */
export function enableNewEntityTypes(saved: DetectionConfig): DetectionConfig {
  const config = migrateSsnType(saved);
  const allTypes = Object.values(EntityType);
  const known = config.knownEntityTypes ?? LEGACY_ENTITY_TYPES;
  const newTypes = allTypes.filter(type => !known.includes(type));
  return {
    ...config,
    enabledEntityTypes: [...(config.enabledEntityTypes ?? []), ...newTypes],
    knownEntityTypes: allTypes,
  };
}

/**
 * Default enabled entity types for detection
 */
export const DEFAULT_ENABLED_ENTITY_TYPES: EntityType[] = [
  EntityType.PERSON,
  EntityType.ORGANIZATION,
  EntityType.LOCATION,
  EntityType.DATE,
  EntityType.ID_NUMBER,
  EntityType.CREDIT_CARD,
  EntityType.PHONE,
  EntityType.EMAIL,
];
