import type { DetectedEntity, ProcessedPage, EntityPosition, RegexPattern } from '@/lib/types';
import { getPatternsForText } from '@/utils/regex-patterns';
import { findRuleMatches, type RuleMatch } from '@/lib/rules/matcher';
import { WorkerScriptHost, type ScriptValidatorHost } from '@/lib/rules/sandbox';
import { getEnabledRulePacks } from '@/lib/rules/store';
import type { RulePack } from '@/lib/rules/types';
import { generateId } from '@/utils/validation';
import { extractContext } from '@/utils/text-utils';
import { createLogger } from '@/utils/logger';
import { createYielder } from '@/utils/yield';

const log = createLogger('RegexDetector');

/** The entity fields that come from the rule that matched */
export function entityFromMatch(match: RuleMatch): Pick<DetectedEntity, 'text' | 'entityType' | 'confidence' | 'detectionMethod' | 'ruleName'> {
  return {
    text: match.text,
    entityType: match.pattern.entityType,
    confidence: match.confidence,
    detectionMethod: match.pattern.detectionMethod ?? 'regex',
    ruleName: match.pattern.ruleId ? match.pattern.name : undefined,
  };
}

/** Patterns from rule packs with code need a sandbox; create one only then */
function needsSandbox(patterns: RegexPattern[]): boolean {
  return patterns.some(pattern => pattern.scriptValidator);
}

export class RegexDetector {
  /**
   * Detect entities using the enabled rules. Matching is synchronous, so it
   * yields to the browser between pages (or patterns, for DOCX text) and
   * reports the fraction done through `onProgress`.
   */
  async detectEntities(content: string | ProcessedPage[], onProgress?: (fraction: number) => void): Promise<DetectedEntity[]> {
    const allEntities: DetectedEntity[] = [];
    const yieldToBrowser = createYielder();
    const packs = getEnabledRulePacks();
    let host: ScriptValidatorHost | undefined;
    const sandbox = (patterns: RegexPattern[]) => {
      if (!host && needsSandbox(patterns)) host = new WorkerScriptHost();
      return host;
    };

    try {
      if (typeof content === 'string') {
        // Use language-aware pattern selection for DOCX content
        const selectedPatterns = getPatternsForText(content);

        for (const [index, pattern] of selectedPatterns.entries()) {
          await yieldToBrowser();
          onProgress?.(index / selectedPatterns.length);
          const matches = await findRuleMatches(content, [pattern], { host: sandbox([pattern]), packs });

          allEntities.push(...matches.map(match => ({
            ...entityFromMatch(match),
            id: generateId(),
            status: 'rejected' as const,
            position: {
              pageNumber: 1, // DOCX doesn't have pages in XML
              textIndex: match.index,
              boundingBox: { x: 0, y: 0, width: 0, height: 0 }, // No coordinates needed for DOCX
            },
            contextText: extractContext(content, match.index, match.text.length),
          })));
        }
      } else {
        for (const [index, page] of content.entries()) {
          await yieldToBrowser();
          onProgress?.(index / content.length);
          const pageEntities = await this.detectInPage(page, sandbox, packs);
          allEntities.push(...pageEntities);
        }
      }
    } finally {
      host?.dispose();
    }
    return allEntities;
  }

  /**
   * Detect entities in a single page
   */
  private async detectInPage(
    page: ProcessedPage,
    sandbox: (patterns: RegexPattern[]) => ScriptValidatorHost | undefined,
    packs: Map<string, RulePack>,
  ): Promise<DetectedEntity[]> {
    const entities: DetectedEntity[] = [];
    const mupdfPage = page.pdfPageObject;

    // Combine text content with form field data for comprehensive search
    const combinedText = this.getCombinedText(page);
    const text = combinedText.text;

    // Use language-aware pattern selection for PDF pages
    const selectedPatterns = getPatternsForText(text);
    const matches = await findRuleMatches(text, selectedPatterns, { host: sandbox(selectedPatterns), packs });

    for (const [i, match] of matches.entries()) {
      // Check if this match is from a form field
      const formFieldInfo = this.findFormFieldForMatch(page, match.index, match.text, combinedText);

      // Try using MuPDF's native search for precise positioning
      let position = formFieldInfo?.position ||
                     this.findPositionWithSearch(mupdfPage, page, match.text, match.index);
      log.debug('Pattern matched', {
        pattern: match.pattern.name || match.pattern.entityType,
        page: page.pageNumber,
        match: i + 1,
        positioned: Boolean(position),
      });
      // Fallback to text item-based method if search fails
      if (!position) {
        position = this.findPosition(page, match.index, match.text);
        if (!position) {
          continue;
        }
      }

      entities.push({
        ...entityFromMatch(match),
        id: generateId(),
        position,
        status: 'rejected',
        contextText: extractContext(text, match.index, match.text.length),
      });
    }

    return entities;
  }

  /**
   * Combine text content with form field data for comprehensive search
   */
  private getCombinedText(page: ProcessedPage): { text: string; offsets: Array<{ start: number; end: number; type: 'content' | 'form'; formFieldIndex?: number }> } {
    const offsets: Array<{ start: number; end: number; type: 'content' | 'form'; formFieldIndex?: number }> = [];
    let text = page.textContent;

    offsets.push({
      start: 0,
      end: text.length,
      type: 'content'
    });

    // Append form field data
    if (page.formFields && page.formFields.length > 0) {
      for (let i = 0; i < page.formFields.length; i++) {
        const field = page.formFields[i];

        // Include field name, label, and value for searching
        const formText = [field.name, field.label, field.value]
          .filter(Boolean)
          .join(' ');

        if (formText) {
          const start = text.length + 1; // +1 for space separator
          text += ' ' + formText;
          const end = text.length;

          offsets.push({
            start,
            end,
            type: 'form',
            formFieldIndex: i
          });
        }

        // Include options for choice fields
        if (field.options && field.options.length > 0) {
          const optionsText = field.options.join(' ');
          const start = text.length + 1;
          text += ' ' + optionsText;
          const end = text.length;

          offsets.push({
            start,
            end,
            type: 'form',
            formFieldIndex: i
          });
        }
      }
    }

    return { text, offsets };
  }

  /**
   * Find if a match is from a form field and get its position
   */
  private findFormFieldForMatch(
    page: ProcessedPage,
    matchIndex: number,
    matchedText: string,
    combinedText: { text: string; offsets: Array<{ start: number; end: number; type: 'content' | 'form'; formFieldIndex?: number }> }
  ): { position: EntityPosition } | null {
    const matchEnd = matchIndex + matchedText.length;

    for (const offset of combinedText.offsets) {
      if (offset.type === 'form' &&
          matchIndex >= offset.start &&
          matchEnd <= offset.end &&
          offset.formFieldIndex !== undefined) {

        const formField = page.formFields?.[offset.formFieldIndex];
        if (formField) {
          return {
            position: {
              pageNumber: page.pageNumber,
              boundingBox: formField.bounds,
              textIndex: -1, // Indicate this is from a form field
              transform: [1, 0, 0, 1, formField.bounds.x, formField.bounds.y],
              formFieldName: formField.name, // Store form field name for deletion
            }
          };
        }
      }
    }

    return null;
  }

  /**
   * Normalize MuPDF search hits to handle inconsistent nesting
   * MuPDF sometimes returns [[[quad],[quad]], [quad], [quad]] for multi-line matches
   * instead of [[quad,quad], [quad,quad]]
   */
  private normalizeSearchHits(rawHits: any[], page: ProcessedPage, searchText: string): number[][][] {
    if (!rawHits || rawHits.length === 0) {
      return [];
    }

    // Step 1: Flatten extra nesting - convert [[quad], [quad]] to [quad, quad]
    const flattenedHits: number[][][] = [];

    for (const hit of rawHits) {
      if (!Array.isArray(hit)) continue;

      // Check if this is a quad (8 numbers) or array of quads
      if (hit.length === 8 && typeof hit[0] === 'number') {
        // Single quad, wrap it properly
        flattenedHits.push([hit as number[]]);
      } else if (Array.isArray(hit[0])) {
        // Check if all elements are single-element arrays containing quads
        const isNestedQuads = hit.every((item: any) =>
          Array.isArray(item) &&
          item.length === 1 &&
          Array.isArray(item[0]) &&
          item[0].length === 8 &&
          typeof item[0][0] === 'number'
        );

        if (isNestedQuads) {
          // Flatten: [[quad], [quad]] -> [quad, quad]
          flattenedHits.push(hit.map((item: any) => item[0]) as number[][]);
        } else {
          // Check if all elements are quads (arrays of 8 numbers)
          const allQuads = hit.every((item: any) =>
            Array.isArray(item) && item.length === 8 && typeof item[0] === 'number'
          );

          if (allQuads) {
            // Proper format: [quad, quad]
            flattenedHits.push(hit as number[][]);
          } else {
            // Mixed or unknown structure, treat as separate hits
            for (const item of hit) {
              if (Array.isArray(item) && item.length === 8 && typeof item[0] === 'number') {
                flattenedHits.push([item as number[]]);
              }
            }
          }
        }
      }
    }

    // Step 2: Merge spatially close quads ONLY if search text contains newlines
    // This handles cases where multi-line matches are split into separate hits
    // For single-line searches, we keep hits separate to avoid merging distinct matches on the same line
    if (!searchText.includes('\n')) {
      // No newlines - return flattened hits as-is
      return flattenedHits;
    }

    const mergedHits: number[][][] = [];
    let currentGroup: number[][] = [];

    for (let i = 0; i < flattenedHits.length; i++) {
      const hit = flattenedHits[i];

      if (currentGroup.length === 0) {
        currentGroup = [...hit];
      } else {
        // Check if this hit is close to the previous one (likely same match)
        const lastQuad = currentGroup[currentGroup.length - 1];
        const firstQuad = hit[0];

        // Calculate distance between last quad of current group and first quad of new hit
        const isClose = this.areQuadsClose(lastQuad, firstQuad, page);

        if (isClose) {
          // Merge into current group
          currentGroup.push(...hit);
        } else {
          // Start new group
          mergedHits.push(currentGroup);
          currentGroup = [...hit];
        }
      }
    }

    // Add last group
    if (currentGroup.length > 0) {
      mergedHits.push(currentGroup);
    }

    return mergedHits;
  }

  /**
   * Check if two quads are spatially close (likely part of same match)
   */
  private areQuadsClose(quad1: number[], quad2: number[], page: ProcessedPage): boolean {
    // Calculate center points and dimensions
    const x1 = (quad1[0] + quad1[2] + quad1[4] + quad1[6]) / 4;
    const y1 = (quad1[1] + quad1[3] + quad1[5] + quad1[7]) / 4;
    const height1 = Math.abs(quad1[5] - quad1[1]); // Approximate height

    const x2 = (quad2[0] + quad2[2] + quad2[4] + quad2[6]) / 4;
    const y2 = (quad2[1] + quad2[3] + quad2[5] + quad2[7]) / 4;
    const height2 = Math.abs(quad2[5] - quad2[1]); // Approximate height

    // Calculate distances
    const verticalDistance = Math.abs(y2 - y1);
    const horizontalDistance = Math.abs(x2 - x1);

    // Average height for threshold
    const avgHeight = (height1 + height2) / 2;

    // Quads are close if:
    // 1. Vertical distance is less than 2x average height (within ~2 lines)
    // 2. Horizontal distance is small (within same column/area)
    const verticalThreshold = avgHeight * 2;
    const horizontalThreshold = page.dimensions.width * 0.3; // Within 30% of page width

    return verticalDistance < verticalThreshold && horizontalDistance < horizontalThreshold;
  }

  /**
   * Use MuPDF's native search to find precise position
   */
  private findPositionWithSearch(
    mupdfPage: any,
    page: ProcessedPage,
    searchText: string,
    matchIndex: number
  ): EntityPosition | null {
    try {
      // Try the original search first
      let rawHits = mupdfPage.search(searchText, 100);

      // If no hits found and search contains newlines with special characters, try fallbacks
      if ((!rawHits || rawHits.length === 0) && searchText.includes('\n')) {
        log.debug('Multi-line search found nothing, trying fallbacks', { page: page.pageNumber });

        // Strategy 1: Try searching without hyphens before newlines (soft hyphen issue)
        // Example: "4-\n1301" -> "4\n1301"
        if (searchText.match(/-\n/)) {
          const searchWithoutHyphen = searchText.replace(/-\n/g, '\n');
          rawHits = mupdfPage.search(searchWithoutHyphen, 100);

          if (rawHits && rawHits.length > 0) {
            log.debug('Search fallback matched', { strategy: 'hyphen-removed', page: page.pageNumber });
          }
        }

        // Strategy 2: Try searching with hyphen and newline removed (joined text)
        // Example: "4-\n1301" -> "41301"
        if ((!rawHits || rawHits.length === 0) && searchText.match(/-\n/)) {
          const searchJoined = searchText.replace(/-\n/g, '');
          rawHits = mupdfPage.search(searchJoined, 100);

          if (rawHits && rawHits.length > 0) {
            log.debug('Search fallback matched', { strategy: 'joined', page: page.pageNumber });
          }
        }

        // Strategy 3: Try searching with just newline removed (hyphen kept)
        // Example: "4-\n1301" -> "4-1301"
        if (!rawHits || rawHits.length === 0) {
          const searchNoNewline = searchText.replace(/\n/g, '');
          rawHits = mupdfPage.search(searchNoNewline, 100);

          if (rawHits && rawHits.length > 0) {
            log.debug('Search fallback matched', { strategy: 'newline-removed', page: page.pageNumber });
          }
        }
      }

      if (!rawHits || rawHits.length === 0) {
        log.debug('All search strategies failed', { page: page.pageNumber, chars: searchText.length });
        return null;
      }

      // Normalize hits to handle inconsistent nesting and merge close quads (only for multi-line matches)
      const hits = this.normalizeSearchHits(rawHits, page, searchText);

      if (hits.length === 0) {
        return null;
      }

      // For multiple matches, count which occurrence this is. MuPDF search ignores case
      // and collapses whitespace, so count the same way or the hits won't line up
      // (e.g. "secret … SECRET" would put both boxes on the first word)
      const textBefore = page.textContent.substring(0, matchIndex);
      const occurrencePattern = searchText.trim()
        .split(/\s+/)
        .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('\\s+');
      const occurrenceIndex = (textBefore.match(new RegExp(occurrencePattern, 'gi')) || []).length;

      log.debug('MuPDF search', {
        page: page.pageNumber,
        multiline: searchText.includes('\n'),
        rawHits: rawHits.length,
        hits: hits.length,
        occurrence: occurrenceIndex,
        matchIndex,
      });

      if (occurrenceIndex >= hits.length) {
        // Don't guess with another occurrence's box: that would leave this one visible.
        // Returning null falls back to locating the match by its text offset.
        log.warn('Occurrence beyond search hits, falling back to text position', { page: page.pageNumber, occurrence: occurrenceIndex, hits: hits.length });
        return null;
      }

      return this.convertQuadToPosition(hits[occurrenceIndex], page);
    } catch (error) {
      log.warn('MuPDF search failed', { page: page.pageNumber, error: String(error) });
      return null;
    }
  }

  /**
   * Convert MuPDF Quad array to EntityPosition
   */
  private convertQuadToPosition(quads: number[][], page: ProcessedPage): EntityPosition | null {
    if (!quads || quads.length === 0) {
      return null;
    }

    // Merge all quads (for multi-line matches) into one bounding box
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    for (const quad of quads) {
      // Quad format: [x0, y0, x1, y1, x2, y2, x3, y3]
      for (let i = 0; i < 8; i += 2) {
        minX = Math.min(minX, quad[i]);
        maxX = Math.max(maxX, quad[i]);
        minY = Math.min(minY, quad[i + 1]);
        maxY = Math.max(maxY, quad[i + 1]);
      }
    }

    const pageHeight = page.dimensions.height;

    // MuPDF uses top-left origin, convert to bottom-left
    const boundingBox = {
      x: minX,
      y: pageHeight - maxY, // Convert from top to bottom origin
      width: maxX - minX,
      height: maxY - minY,
    };

    return {
      pageNumber: page.pageNumber,
      boundingBox,
      textIndex: 0, // Not relevant with search-based approach
      transform: [1, 0, 0, 1, minX, pageHeight - maxY],
    };
  }

  /**
   * Find position in PDF coordinates using PDF.js viewport transformation
   */
  private findPosition(
    page: ProcessedPage,
    textIndex: number,
    matchedText: string
  ) {
    // Find the text item that contains this match
    log.debug('Falling back to text item position', { page: page.pageNumber, textIndex });
    let currentIndex = 0;
    let itemIndex = -1;
    let offsetInItem = 0;

    for (let i = 0; i < page.textItems.length; i++) {
      const item = page.textItems[i];
      const itemLength = item.str.length;

      if (currentIndex <= textIndex && textIndex < currentIndex + itemLength) {
        itemIndex = i;
        offsetInItem = textIndex - currentIndex;
        break;
      }

      currentIndex += itemLength + 1; // +1 for space/newline
    }

    if (itemIndex === -1) {
      return null;
    }

    const item = page.textItems[itemIndex];
    if (!item) {
      return null;
    }

    const transform = item.transform;

    // Get the position from transform matrix
    // transform[4] = x position (left edge)
    // transform[5] = y position (bottom edge in bottom-left origin coordinate system)
    const tx = transform[4];
    const ty = transform[5];

    // Item height from the text item
    const itemHeight = item.height;

    // Calculate the width for only the matched text
    const itemText = item.str;
    const matchLength = matchedText.length;
    const itemLength = itemText.length;

    // Calculate average character width
    const avgCharWidth = item.width / itemLength;

    // Calculate offset and width based on average character width
    const offsetWidth = avgCharWidth * offsetInItem;
    const matchWidth = avgCharWidth * matchLength;

    // Add small padding to ensure coverage
    const padding = avgCharWidth * 0.1;

    // Calculate bounding box
    // x: start position + offset for the match within the item
    // y: already in bottom-left origin from parser (ty is bottom of text)
    // width: width of matched text
    // height: height of text item
    const boundingBox = {
      x: tx + offsetWidth - padding,
      y: ty,
      width: matchWidth + (padding * 2),
      height: itemHeight,
    };

    return {
      pageNumber: page.pageNumber,
      boundingBox,
      textIndex: itemIndex,
      transform: item.transform,
    };
  }
}
