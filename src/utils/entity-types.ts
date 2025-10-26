import { EntityType } from '@/lib/types';

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
  [EntityType.SSN]: {
    type: EntityType.SSN,
    displayName: 'SSN',
    color: '#EF4444', // red
    description: 'Social Security Numbers',
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
    description: 'User-defined patterns',
  },
};

/**
 * Get entity type color
 */
export function getEntityColor(entityType: EntityType): string {
  return ENTITY_TYPE_METADATA[entityType]?.color || '#6B7280';
}

/**
 * Get entity type display name
 */
export function getEntityDisplayName(entityType: EntityType): string {
  return ENTITY_TYPE_METADATA[entityType]?.displayName || entityType;
}

/**
 * Get entity type description
 */
export function getEntityDescription(entityType: EntityType): string {
  return ENTITY_TYPE_METADATA[entityType]?.description || '';
}

/**
 * Get CSS class name for entity type
 */
export function getEntityClassName(entityType: EntityType): string {
  return `entity-${entityType.toLowerCase()}`;
}

/**
 * Default enabled entity types for detection
 */
export const DEFAULT_ENABLED_ENTITY_TYPES: EntityType[] = [
  EntityType.PERSON,
  EntityType.ORGANIZATION,
  EntityType.LOCATION,
  EntityType.DATE,
  EntityType.SSN,
  EntityType.CREDIT_CARD,
  EntityType.PHONE,
  EntityType.EMAIL,
];
