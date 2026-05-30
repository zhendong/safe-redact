import type { ProcessedPage, EntityPosition } from '@/lib/types';

/**
 * MuPDF-based position search for entity text.
 *
 * ML detectors (NER, generative LLMs) return plain text spans without
 * coordinates. These helpers locate that text inside a PDF page using MuPDF's
 * native search and convert the resulting quads into an {@link EntityPosition}.
 *
 * Extracted from the original LLMDetector so any detector can reuse it.
 */

/**
 * Check if two quads are spatially close (likely part of same match)
 */
function areQuadsClose(quad1: number[], quad2: number[], page: ProcessedPage): boolean {
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
 * Normalize MuPDF search hits to handle inconsistent nesting
 * MuPDF sometimes returns [[[quad],[quad]], [quad], [quad]] for multi-line matches
 * instead of [[quad,quad], [quad,quad]]
 */
function normalizeSearchHits(rawHits: any[], page: ProcessedPage, searchText: string): number[][][] {
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
      const isClose = areQuadsClose(lastQuad, firstQuad, page);

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
 * Convert MuPDF Quad array to EntityPosition
 */
function convertQuadToPosition(quads: number[][], page: ProcessedPage): EntityPosition | null {
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
 * Use MuPDF's native search to find the precise position of `searchText` on a page.
 * Returns null when the text cannot be located.
 */
export function findPositionWithSearch(
  page: ProcessedPage,
  searchText: string
): EntityPosition | null {
  try {
    const mupdfPage = page.pdfPageObject;

    // Try the original search first
    let rawHits = mupdfPage.search(searchText, 100);

    // If no hits found and search contains newlines with special characters, try fallbacks
    if ((!rawHits || rawHits.length === 0) && searchText.includes('\n')) {
      console.debug('Original search failed for multi-line text, trying fallback strategies...');

      // Strategy 1: Try searching without hyphens before newlines (soft hyphen issue)
      if (searchText.match(/-\n/)) {
        const searchWithoutHyphen = searchText.replace(/-\n/g, '\n');
        console.debug('Trying without hyphen before newline:', searchWithoutHyphen);
        rawHits = mupdfPage.search(searchWithoutHyphen, 100);

        if (rawHits && rawHits.length > 0) {
          console.debug('Success with hyphen removed before newline');
        }
      }

      // Strategy 2: Try searching with hyphen and newline removed (joined text)
      if ((!rawHits || rawHits.length === 0) && searchText.match(/-\n/)) {
        const searchJoined = searchText.replace(/-\n/g, '');
        console.debug('Trying with hyphen and newline removed:', searchJoined);
        rawHits = mupdfPage.search(searchJoined, 100);

        if (rawHits && rawHits.length > 0) {
          console.debug('Success with joined text (no hyphen, no newline)');
        }
      }

      // Strategy 3: Try searching with just newline removed (hyphen kept)
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
    const hits = normalizeSearchHits(rawHits, page, searchText);

    if (hits.length === 0) {
      return null;
    }

    console.debug('MuPDF search for:', searchText,
                  '\n  Contains newline:', searchText.includes('\n'),
                  '\n  Raw hits:', rawHits.length,
                  '\n  Normalized hits:', hits.length);

    // For now, use the first hit
    // TODO: Handle multiple occurrences by tracking offset in text
    return convertQuadToPosition(hits[0], page);
  } catch (error) {
    console.warn('MuPDF search failed for:', searchText, error);
    return null;
  }
}
