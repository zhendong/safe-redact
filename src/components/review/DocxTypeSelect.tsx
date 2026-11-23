import { useId } from 'react';
import { EntityType } from '@/lib/types';
import { useLanguage } from '@/contexts/LanguageContext';
import { getEntityDisplayName } from '@/utils/entity-types';

interface Props {
  value: EntityType;
  onChange: (value: EntityType) => void;
  text?: string;
}

const types = [EntityType.PERSON, EntityType.ORGANIZATION, EntityType.LOCATION,
  EntityType.DATE, EntityType.ID_NUMBER, EntityType.CREDIT_CARD, EntityType.PHONE,
  EntityType.EMAIL, EntityType.CUSTOM];

export function DocxTypeSelect({ value, onChange, text }: Props) {
  const { t, language } = useLanguage();
  const id = useId();
  return (
    <div className="relative min-w-0" onClick={event => event.stopPropagation()}>
      <label htmlFor={id} className="mb-1 block text-xs text-gray-600 dark:text-gray-300">
        {t('reversible.replacementType')}
        {text && <span className="sr-only">: {text}</span>}
      </label>
      <select id={id} name="docx-replacement-type" value={value === EntityType.PREDEFINED ? EntityType.CUSTOM : value}
        onChange={event => onChange(event.target.value as EntityType)}
        className="w-full min-h-12 min-w-0 rounded-lg border border-gray-500 bg-white px-2 text-base sm:text-sm text-gray-900 dark:bg-gray-900 dark:text-gray-100 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink dark:focus-visible:outline-paper">
        {types.map(type => <option key={type} value={type}>{type === EntityType.CUSTOM
          ? t('reversible.otherText') : getEntityDisplayName(type, language)}</option>)}
      </select>
    </div>
  );
}
