import PizZip from 'pizzip';
import type { DetectedEntity } from '@/lib/types';
import type { ParsedDocx } from '@/lib/parsers/DocxParser';
import { DOCX_NAMESPACE } from '@/utils/docx-constants';
import { parseXmlSafely, serializeXml } from '@/utils/xml-utils';
import { DocumentSanitizer } from '@/lib/sanitize/DocumentSanitizer';
import { extendMappings, placeholderPattern, validateMappings } from './mappings';
import { ReversibleError, type ReplacementMapping } from './types';
import type { Language } from '@/i18n/translations';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XML_SPACE = 'http://www.w3.org/XML/1998/namespace';
interface TextNode { node: Element; start: number; end: number; }
interface Edit { start: number; end: number; replacement: string; }

function readXml(xml: string): Document {
  try { return parseXmlSafely(xml); }
  catch { throw new ReversibleError('document'); }
}

function setText(node: Element, text: string) {
  node.textContent = text;
  // Word otherwise drops leading/trailing spaces introduced by a replacement.
  node.setAttributeNS(XML_SPACE, 'xml:space', 'preserve');
}

/** Edits run backwards so offsets remain valid, even with several edits in one run. */
function applyEdits(nodes: TextNode[], edits: Edit[]): void {
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    let first = true;
    for (const { node, start, end } of nodes) {
      if (start >= edit.end || end <= edit.start) continue;
      const text = node.textContent ?? '';
      const from = Math.max(0, edit.start - start);
      const to = Math.min(end - start, edit.end - start);
      setText(node, text.slice(0, from) + (first ? edit.replacement : '') + text.slice(to));
      first = false;
    }
  }
}

export interface ReplacementPlan {
  documentXml: string;
  mappings: ReplacementMapping[];
  replacements: Record<string, string>;
  redactedCount: number;
  protectedCount: number;
  reservedLabels: string[];
}

export function prepareDocxReplacement(
  documentXml: string,
  entities: DetectedEntity[],
  previous: ReplacementMapping[] = [],
  previousReservedLabels: string[] = [],
  language?: Language,
): ReplacementPlan {
  const xml = readXml(documentXml);
  const nodes: TextNode[] = [];
  let fullText = '';
  let actualText = '';
  // Match DocxParser's synthetic spaces, while storing the actual original text.
  for (const node of Array.from(xml.getElementsByTagNameNS(DOCX_NAMESPACE, 't'))) {
    const text = node.textContent ?? '';
    if (!text) continue;
    if (nodes.length) fullText += ' ';
    nodes.push({ node, start: fullText.length, end: fullText.length + text.length });
    fullText += text;
    actualText += text;
  }
  const barriers = Array.from(xml.getElementsByTagNameNS(DOCX_NAMESPACE, '*')).filter(node =>
    ['p', 'tab', 'br', 'cr', 'drawing', 'pict', 'instrText', 'fldChar', 'delText'].includes(node.localName));
  const crossesBoundary = (first: Element, last: Element) => first !== last && barriers.some(barrier =>
    (first.compareDocumentPosition(barrier) & Node.DOCUMENT_POSITION_FOLLOWING) &&
    (last.compareDocumentPosition(barrier) & Node.DOCUMENT_POSITION_PRECEDING));

  const protectedRanges: Array<{ start: number; end: number }> = [];
  // Labels can already be split across runs by Word. Map their real offsets back
  // to the parser's offsets so another pass cannot redact a piece of a label.
  let actualOffset = 0;
  const actualNodes = nodes.map(node => {
    const result = { ...node, actualStart: actualOffset, actualEnd: actualOffset + node.end - node.start };
    actualOffset = result.actualEnd;
    return result;
  });
  for (const match of actualText.matchAll(placeholderPattern())) {
    const startNode = actualNodes.find(node => node.actualEnd > match.index)!;
    const end = match.index + match[0].length;
    const endNode = actualNodes.find(node => node.actualEnd >= end)!;
    if (crossesBoundary(startNode.node, endNode.node)) continue;
    protectedRanges.push({
      start: startNode.start + match.index - startNode.actualStart,
      end: endNode.start + end - endNode.actualStart,
    });
  }

  let protectedCount = 0;
  const ranges: Array<{ entity: DetectedEntity; start: number; end: number; original: string }> = [];
  const candidates = entities.filter(entity => entity.status === 'confirmed')
    .sort((a, b) => b.text.length - a.text.length || a.position.textIndex - b.position.textIndex);
  for (const entity of candidates) {
    const start = entity.position.textIndex;
    const end = start + entity.text.length;
    if (!entity.text || start < 0 || fullText.slice(start, end) !== entity.text) throw new ReversibleError('invalid');
    const protectedRange = protectedRanges.find(range => start < range.end && end > range.start);
    if (protectedRange) {
      if (start < protectedRange.start || end > protectedRange.end) throw new ReversibleError('overlap');
      protectedCount++;
      continue;
    }
    const overlap = ranges.find(range => start < range.end && end > range.start);
    if (overlap) {
      if (start >= overlap.start && end <= overlap.end) continue;
      throw new ReversibleError('overlap');
    }
    const affected = nodes.filter(node => node.start < end && node.end > start);
    if (!affected.length) throw new ReversibleError('invalid');
    if (crossesBoundary(affected[0].node, affected[affected.length - 1].node)) throw new ReversibleError('boundary');
    const original = affected
      .map(({ node, start: nodeStart, end: nodeEnd }) => (node.textContent ?? '')
        .slice(Math.max(0, start - nodeStart), Math.min(nodeEnd - nodeStart, end - nodeStart))).join('');
    if (!original) throw new ReversibleError('invalid');
    ranges.push({ entity, start, end, original });
  }
  ranges.sort((a, b) => a.start - b.start);
  const sourceText = fullText + '\n' + actualText;
  const reservedLabels = [...new Set([...previousReservedLabels,
    ...Array.from(sourceText.matchAll(placeholderPattern()), match => match[0])])];
  const mappings = extendMappings(previous, ranges.map(range => ({
    original: range.original, entityType: range.entity.replacementType ?? range.entity.entityType,
  })), sourceText, reservedLabels, language);
  const byOriginal = new Map(mappings.map(mapping => [mapping.original, mapping.replacement]));
  const replacements: Record<string, string> = {};
  const edits = ranges.map(range => {
    const replacement = byOriginal.get(range.original)!;
    replacements[range.entity.id] = replacement;
    return { start: range.start, end: range.end, replacement };
  });
  applyEdits(nodes, edits);
  return { documentXml: serializeXml(xml), mappings, replacements, redactedCount: edits.length, protectedCount, reservedLabels };
}

export async function createReversibleDocx(
  document: ParsedDocx,
  plan: ReplacementPlan,
  sanitize: boolean,
): Promise<Blob> {
  // Never mutate the review snapshot: exporting again must start with the original.
  let zip = new PizZip(document.zip.generate({ type: 'uint8array' }));
  zip.file('word/document.xml', plan.documentXml);
  if (sanitize) zip = await new DocumentSanitizer().sanitizeDocx({ ...document, zip });
  return zip.generate({ type: 'blob', mimeType: DOCX_MIME });
}

export interface RestoreResult {
  blob: Blob;
  restoredCount: number;
  matches: Array<ReplacementMapping & { count: number }>;
  missing: string[];
  unknown: string[];
}

/** Replace exact labels within paragraphs, including labels split across Word runs. */
export async function restoreDocx(file: File, mappings: ReplacementMapping[]): Promise<RestoreResult> {
  // Reading the DOCX yields control; keep the validated one-to-one table stable.
  mappings = mappings.map(mapping => ({ ...mapping }));
  validateMappings(mappings);
  let zip: PizZip;
  try { zip = new PizZip(await file.arrayBuffer()); }
  catch { throw new ReversibleError('document'); }
  if (!zip.file('word/document.xml')) throw new ReversibleError('document');
  const byLabel = new Map(mappings.map(mapping => [mapping.replacement, mapping]));
  const counts = new Map<string, number>();
  const unknown = new Set<string>();

  for (const part of zip.file(/^word\/(?:document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/)) {
    const xml = readXml(part.asText());
    for (const paragraph of Array.from(xml.getElementsByTagNameNS(DOCX_NAMESPACE, 'p'))) {
      const nodes: TextNode[] = [];
      let text = '';
      // Do not match through tabs, line breaks, fields, drawings or nested paragraphs.
      // Bookmarks and proofing/run-format markers may safely split a label.
      const visit = (element: Element) => {
        for (const child of Array.from(element.children)) {
          if (child.namespaceURI === DOCX_NAMESPACE && child.localName === 't') {
            const value = child.textContent ?? '';
            nodes.push({ node: child, start: text.length, end: text.length + value.length });
            text += value;
          } else if (child.namespaceURI === DOCX_NAMESPACE &&
            ['tab', 'br', 'cr', 'p', 'drawing', 'pict', 'instrText', 'fldChar', 'delText'].includes(child.localName)) {
            text += '\u0000';
          } else visit(child);
        }
      };
      visit(paragraph);
      const edits: Edit[] = [];
      for (const match of text.matchAll(placeholderPattern())) {
        const mapping = byLabel.get(match[0]);
        if (!mapping) { unknown.add(match[0]); continue; }
        counts.set(match[0], (counts.get(match[0]) ?? 0) + 1);
        edits.push({ start: match.index, end: match.index + match[0].length, replacement: mapping.original });
      }
      applyEdits(nodes, edits);
    }
    zip.file(part.name, serializeXml(xml));
  }
  const matches = mappings.filter(mapping => counts.has(mapping.replacement))
    .map(mapping => ({ ...mapping, count: counts.get(mapping.replacement)! }));
  return {
    blob: zip.generate({ type: 'blob', mimeType: DOCX_MIME }),
    restoredCount: matches.reduce((total, match) => total + match.count, 0),
    matches,
    missing: mappings.filter(mapping => !counts.has(mapping.replacement)).map(mapping => mapping.replacement),
    unknown: [...unknown],
  };
}
