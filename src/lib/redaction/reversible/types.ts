import type { EntityType } from '@/lib/types';
import type { Language } from '@/i18n/translations';

export interface ReplacementMapping {
  original: string;
  replacement: string;
  entityType: EntityType;
}

export interface ReplacementRecord {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  revision: number;
  mappings: ReplacementMapping[];
  /** Labels already present in source documents must never be assigned later. */
  reservedLabels?: string[];
}

export interface ReversibleSelection {
  labelLanguage?: Language | 'auto';
}

export class ReversibleError extends Error {
  constructor(public readonly code: 'storage' | 'conflict' | 'name' | 'invalid' | 'overlap' | 'boundary' | 'document') {
    // Never put original text, record names, or XML in errors or diagnostics.
    super(`reversible.${code}`);
  }
}
