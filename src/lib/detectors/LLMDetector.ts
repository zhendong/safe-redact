import type { DetectedEntity, ProcessedPage, EntityPosition } from '@/lib/types';
import { EntityType } from '@/lib/types';
import { generateId } from '@/utils/validation';
import { extractContext } from '@/utils/text-utils';
import { NER_MODEL } from '@/utils/constants';
import { isDesktop } from '@/platform';
import { createLogger } from '@/utils/logger';
import { NerModel } from './nerModels';
import { extendChineseAddresses, mergeTouchingSpans } from './nerDecoding';

const log = createLogger('LLMDetector');

const ENTITY_TYPES: Record<string, EntityType> = {
  PER: EntityType.PERSON,
  ORG: EntityType.ORGANIZATION,
  LOC: EntityType.LOCATION,
  DATE: EntityType.DATE,
};

/**
 * Entity detection with a local NER model (transformers.js, or native ONNX Runtime on desktop)
 */
export class LLMDetector {
  private static model: NerModel | null = null;
  private static initializationPromise: Promise<void> | null = null;

  /**
   * Preload the model in the background (static method for sharing across instances)
   */
  static async preloadModel(onProgress?: (progress: number, message: string) => void): Promise<void> {
    // If already initialized or initializing, return existing promise
    if (LLMDetector.model) {
      onProgress?.(100, 'Model already loaded');
      return;
    }
    if (LLMDetector.initializationPromise) {
      return LLMDetector.initializationPromise;
    }

    LLMDetector.initializationPromise = (async () => {
      const start = performance.now();
      log.info('Model loading', { model: NER_MODEL, runtime: isDesktop ? 'native' : 'wasm' });
      try {
        onProgress?.(0, 'Starting model download...');
        LLMDetector.model = await NerModel.load(NER_MODEL, progress => {
          const percent = Math.round(progress);
          onProgress?.(percent, percent < 100 ? `Downloading model: ${percent}%` : 'Initializing model...');
        });
        log.info('Model ready', { ms: Math.round(performance.now() - start) });
        onProgress?.(100, 'Model ready');
      } catch (error) {
        LLMDetector.initializationPromise = null;
        log.error('Model failed to load', error, { model: NER_MODEL, ms: Math.round(performance.now() - start) });
        throw error;
      }
    })();

    return LLMDetector.initializationPromise;
  }

  /**
   * Check if model is already loaded
   */
  static isModelLoaded(): boolean {
    return LLMDetector.model !== null;
  }

  /**
   * Initialize the NER model (uses the shared model if already loaded)
   */
  async initialize(onProgress?: (progress: number, message: string) => void): Promise<void> {
    if (LLMDetector.model) {
      onProgress?.(100, 'Using preloaded model');
      return;
    }
    return LLMDetector.preloadModel(onProgress);
  }

  /**
   * Finds entities in text as character ranges, so their text can be sliced from the original
   */
  private async findSpans(text: string): Promise<Array<{ type: EntityType; start: number; end: number; score: number }>> {
    if (!LLMDetector.model) {
      throw new Error('LLM detector not initialized. Call initialize() first.');
    }
    const spans = mergeTouchingSpans(await LLMDetector.model.findSpans(text));
    return extendChineseAddresses(text, spans, 'LOC').flatMap(span =>
      ENTITY_TYPES[span.type] ? [{ ...span, type: ENTITY_TYPES[span.type] }] : []
    );
  }

  /**
   * Detect entities in PDF pages using NER
   */
  async detectEntities(
    pages: ProcessedPage[],
    onProgress?: (progress: number) => void
  ): Promise<DetectedEntity[]> {
    const allEntities: DetectedEntity[] = [];

    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
      const page = pages[pageIndex];
      const pageEntities = await this.detectInPage(page);
      allEntities.push(...pageEntities);

      onProgress?.(Math.round(((pageIndex + 1) / pages.length) * 100));
    }

    return allEntities;
  }

  /**
   * Detect entities in a single page
   */
  private async detectInPage(page: ProcessedPage): Promise<DetectedEntity[]> {
    const text = page.textContent;
    const entities: DetectedEntity[] = [];
    const seenEntities = new Set<string>();

    let spans: Awaited<ReturnType<LLMDetector['findSpans']>>;
    try {
      spans = await this.findSpans(text);
    } catch (error) {
      log.error('Page classification failed', error, { page: page.pageNumber });
      return entities;
    }
    log.debug('Page classified', { page: page.pageNumber, chars: text.length, spans: spans.length });

    for (const span of spans) {
      const searchText = text.slice(span.start, span.end).trim();
      // Skip very short entities
      if (searchText.length < 2) continue;

      const entityKey = `${searchText}:${span.type}`;
      if (seenEntities.has(entityKey)) continue;
      seenEntities.add(entityKey);

      // Use mupdf to find position in PDF
      const position = this.findPositionWithSearch(page, searchText);
      if (!position) {
        log.debug('Could not locate entity on page', { page: page.pageNumber, type: span.type, chars: searchText.length });
        continue;
      }

      entities.push({
        id: generateId(),
        text: searchText,
        entityType: span.type,
        confidence: span.score,
        position,
        detectionMethod: 'ml_ner',
        status: 'rejected',
        contextText: extractContext(text, span.start, span.end - span.start),
      });
    }

    return entities;
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
   * Use MuPDF's native search to find precise position in PDF
   */
  private findPositionWithSearch(
    page: ProcessedPage,
    searchText: string
  ): EntityPosition | null {
    try {
      const mupdfPage = page.pdfPageObject;

      // Try the original search first
      let rawHits = mupdfPage.search(searchText, 100);

      // If no hits found and search contains newlines with special characters, try fallbacks
      if ((!rawHits || rawHits.length === 0) && searchText.includes('\n')) {
        log.debug('Multi-line search found nothing, trying fallbacks', { page: page.pageNumber });

        // Strategy 1: Try searching without hyphens before newlines (soft hyphen issue)
        if (searchText.match(/-\n/)) {
          const searchWithoutHyphen = searchText.replace(/-\n/g, '\n');
          rawHits = mupdfPage.search(searchWithoutHyphen, 100);

          if (rawHits && rawHits.length > 0) {
            log.debug('Search fallback matched', { strategy: 'hyphen-removed', page: page.pageNumber });
          }
        }

        // Strategy 2: Try searching with hyphen and newline removed (joined text)
        if ((!rawHits || rawHits.length === 0) && searchText.match(/-\n/)) {
          const searchJoined = searchText.replace(/-\n/g, '');
          rawHits = mupdfPage.search(searchJoined, 100);

          if (rawHits && rawHits.length > 0) {
            log.debug('Search fallback matched', { strategy: 'joined', page: page.pageNumber });
          }
        }

        // Strategy 3: Try searching with just newline removed (hyphen kept)
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

      log.debug('MuPDF search', {
        page: page.pageNumber,
        multiline: searchText.includes('\n'),
        rawHits: rawHits.length,
        hits: hits.length,
      });

      // For now, use the first hit
      // TODO: Handle multiple occurrences by tracking offset in text
      return this.convertQuadToPosition(hits[0], page);
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
   * Detect entities in plain text (for DOCX documents)
   * Returns simplified entities without page/position info
   */
  async detectEntitiesInChunks(
    text: string,
    onProgress?: (progress: number) => void
  ): Promise<Array<{ text: string; entityType: string; confidence: number }>> {
    const entities: Array<{ text: string; entityType: string; confidence: number }> = [];
    const seenEntities = new Set<string>();

    for (const span of await this.findSpans(text)) {
      const searchText = text.slice(span.start, span.end).trim();
      if (searchText.length < 2) continue;

      const entityKey = `${searchText}:${span.type}`;
      if (seenEntities.has(entityKey)) continue;
      seenEntities.add(entityKey);
      entities.push({ text: searchText, entityType: span.type, confidence: span.score });
    }
    onProgress?.(100);

    return entities;
  }

  /**
   * Check if detector is ready
   */
  isReady(): boolean {
    return LLMDetector.model !== null;
  }

  /**
   * Clean up resources (static, shared across instances)
   */
  async dispose(): Promise<void> {
    // Note: We keep the model loaded for reuse across documents
    // To fully unload, use the static clearModel() method
  }

  /**
   * Clear the loaded model from memory (static method)
   */
  static async clearModel(): Promise<void> {
    LLMDetector.model = null;
    LLMDetector.initializationPromise = null;
  }
}
