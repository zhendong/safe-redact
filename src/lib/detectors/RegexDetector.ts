import type { DetectedEntity, ProcessedPage, EntityPosition, RegexPattern } from '@/lib/types';
import { EntityType } from '@/lib/types';
import { getAllPatterns, getPatternsForText, getContextConfidenceBoost } from '@/utils/regex-patterns';
import { generateId } from '@/utils/validation';
import { extractContext } from '@/utils/text-utils';
import { DEFAULT_SEARCH_CONTEXT_WINDOW, DEFAULT_CONFIDENCE_BOOST } from '@/utils/constants';

export class RegexDetector {
  /**
   * Detect entities using regex patterns
   */
  async detectEntities(content: string | ProcessedPage[]): Promise<DetectedEntity[]> {
    const allEntities: DetectedEntity[] = [];

    if (typeof content === 'string') {
      // Use language-aware pattern selection for DOCX content
      const selectedPatterns = getPatternsForText(content);

      for (const pattern of selectedPatterns) {
        const matches = this.findMatches(content, pattern.pattern, pattern.entityType, pattern.name);

        allEntities.push(...matches.map(match => {
          // Apply context-aware confidence boost
          let confidence = pattern.confidence;
          if (pattern.contextKeywords && pattern.contextKeywords.length > 0) {
            const windowSize = pattern.contextWindowSize ?? DEFAULT_SEARCH_CONTEXT_WINDOW;
            const boostMultiplier = pattern.confidenceBoost ?? DEFAULT_CONFIDENCE_BOOST;
            const boost = getContextConfidenceBoost(
              content,
              match.index,
              match.text.length,
              pattern.contextKeywords,
              windowSize,
              boostMultiplier
            );
            confidence = Math.min(1.0, confidence * boost); // Cap at 1.0
          }

          return {
            ...match,
            id: generateId(),
            detectionMethod: 'regex' as const,
            confidence,
            status: 'rejected' as const,
            position: {
              pageNumber: 1, // DOCX doesn't have pages in XML
              textIndex: match.index,
              boundingBox: { x: 0, y: 0, width: 0, height: 0 }, // No coordinates needed for DOCX
            },
            contextText: extractContext(content, match.index, match.text.length),
          };
        }));
      }
    } else {
      for (const page of content) {
        const pageEntities = this.detectInPage(page);
        allEntities.push(...pageEntities);
      }
    }
    return allEntities;
  }

  /**
   * Detect entities in a single page
   */
  private detectInPage(page: ProcessedPage): DetectedEntity[] {
    const entities: DetectedEntity[] = [];
    const mupdfPage = page.pdfPageObject;

    // Combine text content with form field data for comprehensive search
    const combinedText = this.getCombinedText(page);
    const text = combinedText.text;

    // Use language-aware pattern selection for PDF pages
    const selectedPatterns = getPatternsForText(text);

    for (const pattern of selectedPatterns) {
      // Reset regex state
      pattern.pattern.lastIndex = 0;

      let match: RegExpExecArray | null;
      let matchCount = 0;
      while ((match = pattern.pattern.exec(text)) !== null) {
        matchCount++;
        const matchedText = match[0];

        // Validate using custom validator if provided
        if (pattern.validator && !pattern.validator(matchedText)) {
          continue;
        }

        // Check if this match is from a form field
        const formFieldInfo = this.findFormFieldForMatch(page, match.index, matchedText, combinedText);

        // Try using MuPDF's native search for precise positioning
        let position = formFieldInfo?.position ||
                       this.findPositionWithSearch(mupdfPage, page, matchedText, match.index);
        console.debug(`Match #${matchCount} for pattern ${pattern.name || pattern.entityType}:`, matchedText, 'at index:', match.index, 'Position found:', JSON.stringify(position));
        // Fallback to text item-based method if search fails
        if (!position) {
          position = this.findPosition(page, match.index, matchedText);
          if (!position) {
            continue;
          }
        }

        // Extract context
        const contextText = extractContext(text, match.index, matchedText.length);

        // Apply context-aware confidence boost
        let confidence = pattern.confidence;
        if (pattern.contextKeywords && pattern.contextKeywords.length > 0) {
          const windowSize = pattern.contextWindowSize ?? DEFAULT_SEARCH_CONTEXT_WINDOW;
          const boostMultiplier = pattern.confidenceBoost ?? DEFAULT_CONFIDENCE_BOOST;
          const boost = getContextConfidenceBoost(
            text,
            match.index,
            matchedText.length,
            pattern.contextKeywords,
            windowSize,
            boostMultiplier
          );
          confidence = Math.min(1.0, confidence * boost); // Cap at 1.0
        }

        entities.push({
          id: generateId(),
          text: matchedText,
          entityType: pattern.entityType,
          confidence,
          position,
          detectionMethod: 'regex',
          status: 'rejected',
          contextText,
        });
      }
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

      console.debug('MuPDF raw hits for:', searchText, rawHits);

      // If no hits found and search contains newlines with special characters, try fallbacks
      if ((!rawHits || rawHits.length === 0) && searchText.includes('\n')) {
        console.debug('Original search failed for multi-line text, trying fallback strategies...');

        // Strategy 1: Try searching without hyphens before newlines (soft hyphen issue)
        // Example: "4-\n1301" -> "4\n1301"
        if (searchText.match(/-\n/)) {
          const searchWithoutHyphen = searchText.replace(/-\n/g, '\n');
          console.debug('Trying without hyphen before newline:', searchWithoutHyphen);
          rawHits = mupdfPage.search(searchWithoutHyphen, 100);

          if (rawHits && rawHits.length > 0) {
            console.debug('Success with hyphen removed before newline');
          }
        }

        // Strategy 2: Try searching with hyphen and newline removed (joined text)
        // Example: "4-\n1301" -> "41301"
        if ((!rawHits || rawHits.length === 0) && searchText.match(/-\n/)) {
          const searchJoined = searchText.replace(/-\n/g, '');
          console.debug('Trying with hyphen and newline removed:', searchJoined);
          rawHits = mupdfPage.search(searchJoined, 100);

          if (rawHits && rawHits.length > 0) {
            console.debug('Success with joined text (no hyphen, no newline)');
          }
        }

        // Strategy 3: Try searching with just newline removed (hyphen kept)
        // Example: "4-\n1301" -> "4-1301"
        if (!rawHits || rawHits.length === 0) {
          const searchNoNewline = searchText.replace(/\n/g, '');
          console.debug('Trying with newline removed:', searchNoNewline);
          rawHits = mupdfPage.search(searchNoNewline, 100);

          if (rawHits && rawHits.length > 0) {
            console.debug('Success with newline removed');
          }
        }
      }

      if (!rawHits || rawHits.length === 0) {
        console.debug('All search strategies failed for:', searchText);
        return null;
      }

      // Normalize hits to handle inconsistent nesting and merge close quads (only for multi-line matches)
      const hits = this.normalizeSearchHits(rawHits, page, searchText);

      if (hits.length === 0) {
        return null;
      }

      // For multiple matches, we need to count which occurrence this is
      // by checking how many times the text appears before this index
      const textBefore = page.textContent.substring(0, matchIndex);
      const occurrenceIndex = (textBefore.match(new RegExp(searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;

      console.debug('MuPDF search for:', searchText,
                    '\n  Contains newline:', searchText.includes('\n'),
                    '\n  Raw hits:', rawHits.length,
                    '\n  Normalized hits:', hits.length,
                    '\n  Occurrence index:', occurrenceIndex,
                    '\n  Match index:', matchIndex);

      if (occurrenceIndex >= hits.length) {
        // Use first hit as fallback
        console.warn(`Occurrence index ${occurrenceIndex} >= hits length ${hits.length}, using first hit`);
        return this.convertQuadToPosition(hits[0], page);
      }

      return this.convertQuadToPosition(hits[occurrenceIndex], page);
    } catch (error) {
      console.warn('MuPDF search failed for:', searchText, error);
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
    console.debug("falling back to text item position for:", matchedText, "at index:", textIndex);
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


  /**
   * Detect entities of a specific type
   */
  async detectEntityType(
    pages: ProcessedPage[],
    entityType: EntityType
  ): Promise<DetectedEntity[]> {
    const allPatterns = getAllPatterns();
    const patterns = allPatterns.filter(p => p.entityType === entityType);
    const allEntities: DetectedEntity[] = [];

    for (const page of pages) {
      const pageEntities = this.detectInPageWithPatterns(page, patterns);
      allEntities.push(...pageEntities);
    }

    return allEntities;
  }

  /**
   * Detect entities using specific patterns
   */
  private detectInPageWithPatterns(
    page: ProcessedPage,
    patterns: RegexPattern[]
  ): DetectedEntity[] {
    const entities: DetectedEntity[] = [];
    const mupdfPage = page.pdfPageObject;

    // Combine text content with form field data for comprehensive search
    const combinedText = this.getCombinedText(page);
    const text = combinedText.text;

    for (const pattern of patterns) {
      pattern.pattern.lastIndex = 0;

      let match: RegExpExecArray | null;
      while ((match = pattern.pattern.exec(text)) !== null) {
        const matchedText = match[0];

        if (pattern.validator && !pattern.validator(matchedText)) {
          continue;
        }

        // Check if this match is from a form field
        const formFieldInfo = this.findFormFieldForMatch(page, match.index, matchedText, combinedText);

        // Try using MuPDF's native search for precise positioning
        let position = formFieldInfo?.position ||
                       this.findPositionWithSearch(mupdfPage, page, matchedText, match.index);

        // Fallback to text item-based method if search fails
        if (!position) {
          position = this.findPosition(page, match.index, matchedText);
          if (!position) {
            continue;
          }
        }

        const contextText = extractContext(text, match.index, matchedText.length);

        // Apply context-aware confidence boost
        let confidence = pattern.confidence;
        if (pattern.contextKeywords && pattern.contextKeywords.length > 0) {
          const windowSize = pattern.contextWindowSize ?? DEFAULT_SEARCH_CONTEXT_WINDOW;
          const boostMultiplier = pattern.confidenceBoost ?? DEFAULT_CONFIDENCE_BOOST;
          const boost = getContextConfidenceBoost(
            text,
            match.index,
            matchedText.length,
            pattern.contextKeywords,
            windowSize,
            boostMultiplier
          );
          confidence = Math.min(1.0, confidence * boost); // Cap at 1.0
        }

        entities.push({
          id: generateId(),
          text: matchedText,
          entityType: pattern.entityType,
          confidence,
          position,
          detectionMethod: 'regex',
          status: 'rejected',
          contextText,
        });
      }
    }

    return entities;
  }

    /**
   * Find all matches for a pattern in docx text
   */
  private findMatches(
    text: string,
    pattern: RegExp,
    entityType: EntityType,
    patternName?: string
  ): Array<{ text: string; entityType: EntityType; index: number }> {
    const matches: Array<{ text: string; entityType: EntityType; index: number }> = [];

    // Ensure the pattern has the 'g' flag for global matching
    let flags = pattern.flags;
    if (!flags.includes('g')) {
      flags += 'g';
    }

    const globalPattern = new RegExp(pattern.source, flags);

    let match;
    let matchCount = 0;
    while ((match = globalPattern.exec(text)) !== null) {
      matchCount++;
      const matchedText = match[0];

      // Apply validator if exists
      const allPatterns = getAllPatterns();
      const patternDef = allPatterns.find(p => p.entityType === entityType && p.pattern.source === pattern.source);
      if (patternDef?.validator && !patternDef.validator(matchedText)) {
        continue;
      }

      matches.push({
        text: matchedText,
        entityType,
        index: match.index,
      });
    }

    return matches;
  }
}
