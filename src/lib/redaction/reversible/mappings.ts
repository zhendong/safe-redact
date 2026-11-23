import { EntityType } from '@/lib/types';
import type { Language } from '@/i18n/translations';
import { ReversibleError, type ReplacementMapping } from './types';

const englishLabels: Record<EntityType, string> = {
  [EntityType.PERSON]: 'Person',
  [EntityType.ORGANIZATION]: 'Company',
  [EntityType.LOCATION]: 'Location',
  [EntityType.DATE]: 'Date',
  [EntityType.ID_NUMBER]: 'ID',
  [EntityType.CREDIT_CARD]: 'Card',
  [EntityType.PHONE]: 'Phone',
  [EntityType.EMAIL]: 'Email',
  [EntityType.CUSTOM]: 'Text',
  [EntityType.PREDEFINED]: 'Text',
};

const chineseLabels: Record<EntityType, string> = {
  [EntityType.PERSON]: '人员',
  [EntityType.ORGANIZATION]: '公司',
  [EntityType.LOCATION]: '地点',
  [EntityType.DATE]: '日期',
  [EntityType.ID_NUMBER]: '证件',
  [EntityType.CREDIT_CARD]: '银行卡',
  [EntityType.PHONE]: '电话',
  [EntityType.EMAIL]: '邮箱',
  [EntityType.CUSTOM]: '文本',
  [EntityType.PREDEFINED]: '文本',
};

export const placeholderPattern = () => /\[(?:(?:Person|Company|Location|Date|ID|Card|Phone|Email|Text) [A-Z]+|(?:人员|公司|地点|日期|证件|银行卡|电话|邮箱|文本)[1-9]\d*)\]/g;

/** The document decides the label language, independently of the app language.
 * Ignore existing labels and contact details, which can skew a Chinese document
 * toward Latin text after an earlier replacement pass.
 */
export function detectReplacementLanguage(text: string): Language {
  const content = text.replace(placeholderPattern(), '')
    .replace(/https?:\/\/\S+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '');
  const chinese = content.match(/\p{Script=Han}/gu)?.length ?? 0;
  const latin = content.match(/\p{Script=Latin}/gu)?.length ?? 0;
  return chinese > latin ? 'zh' : 'en';
}

function letters(index: number): string {
  let result = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    result = String.fromCharCode(65 + (n - 1) % 26) + result;
  }
  return result;
}

/** One exact original ↔ one unique label within each record. No alias folding. */
export function validateMappings(mappings: ReplacementMapping[]): void {
  const originals = new Set<string>();
  const replacements = new Set<string>();
  for (const mapping of mappings) {
    if (!mapping.original || !Object.hasOwn(englishLabels, mapping.entityType) ||
      placeholderPattern().exec(mapping.replacement)?.[0] !== mapping.replacement ||
      originals.has(mapping.original) || replacements.has(mapping.replacement) ||
      placeholderPattern().test(mapping.original)) {
      throw new ReversibleError('invalid');
    }
    originals.add(mapping.original);
    replacements.add(mapping.replacement);
  }
}

/** Existing mappings are immutable: old exports must remain restorable. */
export function extendMappings(
  previous: ReplacementMapping[],
  values: Array<{ original: string; entityType: EntityType }>,
  sourceText: string,
  reservedLabels: string[] = [],
  language: Language = detectReplacementLanguage(sourceText),
): ReplacementMapping[] {
  validateMappings(previous);
  const mappings = previous.map(mapping => ({ ...mapping }));
  const originals = new Set(mappings.map(mapping => mapping.original));
  const used = new Set([...mappings.map(mapping => mapping.replacement), ...reservedLabels]);
  const nextIndex = new Map<string, number>();
  for (const value of values) {
    if (originals.has(value.original)) continue;
    const label = (language === 'zh' ? chineseLabels : englishLabels)[value.entityType];
    let index = nextIndex.get(label) ?? 0;
    let replacement: string;
    do { replacement = language === 'zh' ? `[${label}${++index}]` : `[${label} ${letters(index++)}]`; }
    while (used.has(replacement) || sourceText.includes(replacement));
    nextIndex.set(label, index);
    mappings.push({ ...value, replacement });
    originals.add(value.original);
    used.add(replacement);
  }
  validateMappings(mappings);
  return mappings;
}
