import { translations, type Language } from '@/i18n/translations';

interface TranslatableWarning {
  type: string;
  count?: number;
  description: string;
  details?: string;
  hiddenLayerCount?: number;
  hiddenLayerNames?: string[];
  fileNames?: string[];
  insertions?: number;
  deletions?: number;
  moves?: number;
  formatChanges?: number;
}

function interpolate(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text;
  return text.replace(/\{\{(\w+)\}\}/g, (match, name) =>
    name in vars ? String(vars[name]) : match
  );
}

/**
 * Rebuilds a hidden-content warning's description/details in the given
 * language from structured data, instead of the pre-formatted English
 * strings baked in by the parsers.
 */
export function translateHiddenContentWarning(
  warning: TranslatableWarning,
  language: Language
): { description: string; details?: string } {
  const dict = translations[language].hiddenContentTypes as Record<string, Record<string, string>>;
  const entry = dict[warning.type];
  if (!entry) {
    return { description: warning.description, details: warning.details };
  }

  const count = warning.count ?? 0;
  const description = interpolate(entry.description, { count });

  switch (warning.type) {
    case 'ocg_layers': {
      const hiddenCount = warning.hiddenLayerCount ?? 0;
      const details = hiddenCount > 0
        ? interpolate(entry.detailsHidden, { hiddenCount, names: (warning.hiddenLayerNames || []).join(', ') })
        : interpolate(entry.detailsVisible, { count });
      return { description, details };
    }
    case 'embedded_files': {
      const fileNames = warning.fileNames || [];
      let details = interpolate(entry.details, { files: fileNames.slice(0, 5).join(', ') });
      if (fileNames.length > 5) {
        details += interpolate(entry.andMore, { count: fileNames.length - 5 });
      }
      return { description, details };
    }
    case 'track_changes': {
      const parts: string[] = [];
      if (warning.insertions) parts.push(interpolate(entry.insertion, { count: warning.insertions }));
      if (warning.deletions) parts.push(interpolate(entry.deletion, { count: warning.deletions }));
      if (warning.moves) parts.push(interpolate(entry.move, { count: warning.moves }));
      if (warning.formatChanges) parts.push(interpolate(entry.formatChange, { count: warning.formatChanges }));
      return { description, details: parts.join(', ') };
    }
    default:
      return { description, details: entry.details };
  }
}

/**
 * Rebuilds the hidden-content report summary in the given language from
 * the warnings' severities, instead of the pre-formatted English summary
 * string produced by the parsers.
 */
export function translateHiddenContentSummary(
  warnings: Array<{ severity: 'high' | 'medium' | 'low' }>,
  language: Language
): string {
  const dict = translations[language].hiddenContentSummary;
  if (warnings.length === 0) return dict.none;

  const high = warnings.filter((w) => w.severity === 'high').length;
  const medium = warnings.filter((w) => w.severity === 'medium').length;
  const low = warnings.filter((w) => w.severity === 'low').length;

  const parts: string[] = [];
  if (high > 0) parts.push(interpolate(dict.highSeverity, { count: high }));
  if (medium > 0) parts.push(interpolate(dict.mediumSeverity, { count: medium }));
  if (low > 0) parts.push(interpolate(dict.lowSeverity, { count: low }));

  return interpolate(dict.found, { count: warnings.length }) + parts.join(', ') + dict.enableSanitize;
}
