import type { DetectedEntity, ProcessedPage, EntityPosition } from '@/lib/types';
import { EntityType } from '@/lib/types';
import { generateId } from '@/utils/validation';
import { extractContext, splitTextWithOverlap } from '@/utils/text-utils';
import { LLM_CHUNKING } from '@/utils/constants';
import { pipeline, type TokenClassificationPipeline, env } from '@huggingface/transformers';

// Configure transformers.js to use CDN for models
env.allowLocalModels = false;
env.allowRemoteModels = true;

/**
 * Entity detection using local LLM (transformers.js)
 * Runs NER models entirely in the browser
 */
export class LLMDetector {
  private static pipeline: TokenClassificationPipeline | null = null;
  private static isInitialized = false;
  private static initializationPromise: Promise<void> | null = null;
  private modelName: string;

  constructor(modelName: string = 'Xenova/bert-base-NER') {
    this.modelName = modelName;
  }

  /**
   * Preload the model in the background (static method for sharing across instances)
   */
  static async preloadModel(
    modelName: string = 'Xenova/bert-base-NER',
    onProgress?: (progress: number, message: string) => void
  ): Promise<void> {
    // If already initialized or initializing, return existing promise
    if (LLMDetector.isInitialized) {
      onProgress?.(100, 'Model already loaded');
      return Promise.resolve();
    }

    if (LLMDetector.initializationPromise) {
      return LLMDetector.initializationPromise;
    }

    // Create new initialization promise
    LLMDetector.initializationPromise = (async () => {
      try {
        onProgress?.(0, 'Starting model download...');

        const pipelineResult = await pipeline('token-classification', modelName, {
          progress_callback: (data: any) => {
            if (data.status === 'progress' && data.progress) {
              const progress = Math.round(data.progress);
              onProgress?.(progress, `Downloading model: ${progress}%`);
            } else if (data.status === 'download') {
              onProgress?.(0, `Downloading: ${data.name}`);
            } else if (data.status === 'done') {
              onProgress?.(50, 'Initializing model...');
            }
          },
        });
        LLMDetector.pipeline = pipelineResult as TokenClassificationPipeline;

        LLMDetector.isInitialized = true;
        onProgress?.(100, 'Model ready');
      } catch (error) {
        LLMDetector.initializationPromise = null;
        console.error('Failed to preload model:', error);
        throw error;
      }
    })();

    return LLMDetector.initializationPromise;
  }

  /**
   * Check if model is already loaded
   */
  static isModelLoaded(): boolean {
    return LLMDetector.isInitialized;
  }

  /**
   * Initialize the NER pipeline (uses shared static pipeline if already loaded)
   */
  async initialize(onProgress?: (progress: number, message: string) => void): Promise<void> {
    // Use preloaded model if available
    if (LLMDetector.isInitialized) {
      onProgress?.(100, 'Using preloaded model');
      return Promise.resolve();
    }

    // Otherwise, preload now
    return LLMDetector.preloadModel(this.modelName, onProgress);
  }

  /**
   * Detect entities in PDF pages using NER
   */
  async detectEntities(
    pages: ProcessedPage[],
    onProgress?: (progress: number) => void
  ): Promise<DetectedEntity[]> {
    if (!LLMDetector.isInitialized || !LLMDetector.pipeline) {
      throw new Error('LLM detector not initialized. Call initialize() first.');
    }

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
    const entities: DetectedEntity[] = [];
    const text = page.textContent;

    // Split into chunks to handle pages longer than model's token limit (512 tokens)
    // Use character-based chunking with overlap to prevent missing entities at boundaries
    const chunks = splitTextWithOverlap(text, LLM_CHUNKING.CHUNK_SIZE, LLM_CHUNKING.CHUNK_OVERLAP);

    const seenEntities = new Set<string>(); // Deduplicate entities from overlapping chunks

    for (let i = 0; i < chunks.length; i++) {
      const { text: chunk, offset } = chunks[i];

      try {
        if (!LLMDetector.pipeline) {
          throw new Error('Pipeline not initialized');
        }
        const results = await LLMDetector.pipeline(chunk);
        console.log(`Page ${page.pageNumber},\n Chunk ${i + 1}/${chunks.length}: ${chunk},\n results:`, results);
        // Use official transformers aggregation strategy
        const aggregatedEntities = this.aggregate(results, 'first');

        // Convert and find actual positions in PDF using mupdf search
        for (const aggEntity of aggregatedEntities) {
          const entityType = this.mapNERLabelToEntityType(aggEntity.entity_group);
          const searchText = aggEntity.word.trim();

          // Skip very short entities
          if (!searchText || searchText.length < 2) {
            continue;
          }

          // Deduplicate entities from overlapping regions
          const entityKey = `${searchText}:${entityType}`;
          if (seenEntities.has(entityKey)) {
            continue;
          }
          seenEntities.add(entityKey);

          // Use mupdf to find position in PDF
          const position = this.findPositionWithSearch(page, searchText, offset);

          if (!position) {
            console.warn('Could not find position for entity:', searchText);
            continue;
          }

          const matchIndex = text.indexOf(searchText);
          const contextText = matchIndex !== -1 ? extractContext(text, matchIndex, searchText.length) : searchText;

          entities.push({
            id: generateId(),
            text: searchText,
            entityType,
            confidence: aggEntity.score,
            position,
            detectionMethod: 'ml_ner',
            status: 'pending',
            contextText,
          });
        }
      } catch (error) {
        console.error(`Error processing chunk ${i} on page ${page.pageNumber}:`, error);
      }
    }

    return entities;
  }

  /**
   * Main aggregation method matching transformers implementation
   * Supports strategies: 'none', 'simple', 'first', 'average', 'max'
   */
  private aggregate(
    preEntities: any[],
    aggregationStrategy: 'none' | 'simple' | 'first' | 'average' | 'max'
  ): any[] {
    // Gather pre-entities with scores
    const gatheredEntities = this.gatherPreEntities(preEntities);
    // console.log('Gathered entities:', gatheredEntities);
    if (aggregationStrategy === 'none' || aggregationStrategy === 'simple') {
      const entities = gatheredEntities.map(preEntity => {
        const entityIdx = this.argmax(preEntity.scores);
        return {
          entity: preEntity.entity,
          score: preEntity.scores[entityIdx],
          index: preEntity.index,
          word: preEntity.word,
          start: preEntity.start,
          end: preEntity.end,
        };
      });

      if (aggregationStrategy === 'none') {
        return entities;
      }
      return this.groupEntities(entities);
    } else {
      // For word-based strategies (first, average, max)
      const entities = this.aggregateWords(gatheredEntities, aggregationStrategy);
      return this.groupEntities(entities);
    }
  }

  /**
   * Gather pre-entities with scores (simplified for transformers.js)
   */
  private gatherPreEntities(tokens: any[]): any[] {
    return tokens.map((token, idx) => {
      const word = token.word;
      const entity = token.entity || token.entity_group;
      const score = token.score;

      // For transformers.js, we don't have full score arrays
      // Create a simplified scores array
      const scores = [score];

      // A token is a subword if it starts with ## AND it's not the first token
      // (First token can't be a continuation)
      const isSubword = word.startsWith('##') && idx > 0;

      return {
        word,
        entity,
        scores,
        score,
        start: token.start,
        end: token.end,
        index: idx,
        is_subword: isSubword,
      };
    });
  }

  /**
   * Aggregate words using specified strategy
   */
  private aggregateWords(
    entities: any[],
    aggregationStrategy: 'first' | 'average' | 'max'
  ): any[] {
    const wordEntities: any[] = [];
    let wordGroup: any[] | null = null;

    for (const entity of entities) {
      if (wordGroup === null) {
        wordGroup = [entity];
      } else if (entity.is_subword) {
        wordGroup.push(entity);
      } else {
        wordEntities.push(this.aggregateWord(wordGroup, aggregationStrategy));
        wordGroup = [entity];
      }
    }

    // Last item
    if (wordGroup !== null) {
      wordEntities.push(this.aggregateWord(wordGroup, aggregationStrategy));
    }

    return wordEntities;
  }

  /**
   * Aggregate a single word using specified strategy
   */
  private aggregateWord(
    entities: any[],
    aggregationStrategy: 'first' | 'average' | 'max'
  ): any {
    // Merge subword tokens with proper spacing
    let word = '';
    for (let i = 0; i < entities.length; i++) {
      const token = entities[i].word;

      if (token.startsWith('##')) {
        if (i === 0) {
          // First token starting with ## (edge case) - strip the prefix
          word = token.substring(2);
        } else {
          // Subword token - attach to previous word
          word += token.substring(2);
        }
      } else if (i === 0) {
        // First token
        word = token;
      } else {
        // Regular token - add space
        word += ' ' + token;
      }
    }

    let score: number;
    let entity: string;

    if (aggregationStrategy === 'first') {
      score = entities[0].score;
      entity = entities[0].entity;
    } else if (aggregationStrategy === 'max') {
      const maxEntity = entities.reduce((max, e) => e.score > max.score ? e : max);
      score = maxEntity.score;
      entity = maxEntity.entity;
    } else if (aggregationStrategy === 'average') {
      score = entities.reduce((sum, e) => sum + e.score, 0) / entities.length;
      entity = entities[0].entity; // Use first entity type
    } else {
      throw new Error('Invalid aggregation_strategy');
    }

    return {
      entity,
      score,
      word,
      start: entities[0].start,
      end: entities[entities.length - 1].end,
    };
  }

  /**
   * Group adjacent entities with the same entity tag
   */
  private groupEntities(entities: any[]): any[] {
    const entityGroups: any[] = [];
    let entityGroupDisagg: any[] = [];

    for (const entity of entities) {
      if (entityGroupDisagg.length === 0) {
        entityGroupDisagg.push(entity);
        continue;
      }

      const [bi, tag] = this.getTag(entity.entity);
      const [lastBi, lastTag] = this.getTag(entityGroupDisagg[entityGroupDisagg.length - 1].entity);

      if (tag === lastTag && bi !== 'B') {
        entityGroupDisagg.push(entity);
      } else {
        entityGroups.push(this.groupSubEntities(entityGroupDisagg));
        entityGroupDisagg = [entity];
      }
    }

    if (entityGroupDisagg.length > 0) {
      entityGroups.push(this.groupSubEntities(entityGroupDisagg));
    }

    return entityGroups;
  }

  /**
   * Group sub-entities into a single entity group
   */
  private groupSubEntities(entities: any[]): any {
    // Get the entity tag without B-/I- prefix
    const entity = entities[0].entity.split('-').slice(-1)[0];
    const scores = entities.map(e => e.score);
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;

    // Merge tokens with proper spacing
    let word = '';
    for (let i = 0; i < entities.length; i++) {
      const token = entities[i].word;

      if (token.startsWith('##')) {
        if (i === 0) {
          // First token starting with ## (edge case) - strip the prefix
          word = token.substring(2);
        } else {
          // Subword token - attach to previous word
          word += token.substring(2);
        }
      } else if (i === 0) {
        // First token
        word = token;
      } else {
        // Regular token - add space
        word += ' ' + token;
      }
    }

    return {
      entity_group: entity,
      score: avgScore,
      word,
      start: entities[0].start,
      end: entities[entities.length - 1].end,
    };
  }

  /**
   * Extract B/I tag and entity type
   */
  private getTag(entityName: string): [string, string] {
    if (entityName.startsWith('B-')) {
      return ['B', entityName.substring(2)];
    } else if (entityName.startsWith('I-')) {
      return ['I', entityName.substring(2)];
    } else {
      return ['I', entityName];
    }
  }

  /**
   * Find index of maximum value in array
   */
  private argmax(arr: number[]): number {
    return arr.indexOf(Math.max(...arr));
  }

  /**
   * Map NER model labels to our EntityType enum
   */
  private mapNERLabelToEntityType(label: string): EntityType {
    const normalizedLabel = label.toUpperCase().replace(/^(B-|I-)/, '');

    const labelMap: Record<string, EntityType> = {
      'PER': EntityType.PERSON,
      'PERSON': EntityType.PERSON,
      'ORG': EntityType.ORGANIZATION,
      'ORGANIZATION': EntityType.ORGANIZATION,
      'LOC': EntityType.LOCATION,
      'LOCATION': EntityType.LOCATION,
      'GPE': EntityType.LOCATION, // Geo-Political Entity
      'DATE': EntityType.DATE,
      'TIME': EntityType.DATE,
      'MISC': EntityType.CUSTOM,
    };

    return labelMap[normalizedLabel] || EntityType.CUSTOM;
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
    searchText: string,
    offset: number
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
      const hits = this.normalizeSearchHits(rawHits, page, searchText);

      if (hits.length === 0) {
        return null;
      }

      console.debug('MuPDF search for:', searchText,
                    '\n  Contains newline:', searchText.includes('\n'),
                    '\n  Raw hits:', rawHits.length,
                    '\n  Normalized hits:', hits.length);

      // For now, use the first hit
      // TODO: Handle multiple occurrences by tracking offset in text
      return this.convertQuadToPosition(hits[0], page);
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
   * Detect entities in plain text (for DOCX documents)
   * Returns simplified entities without page/position info
   */
  async detectEntitiesInChunks(
    text: string,
    tokenLimit: number = LLM_CHUNKING.TOKEN_LIMIT,
    onProgress?: (progress: number) => void
  ): Promise<Array<{ text: string; entityType: string; confidence: number }>> {
    if (!LLMDetector.isInitialized || !LLMDetector.pipeline) {
      throw new Error('LLM detector not initialized. Call initialize() first.');
    }

    const chunks = splitTextWithOverlap(text, LLM_CHUNKING.CHUNK_SIZE, LLM_CHUNKING.CHUNK_OVERLAP);
    const allEntities: Array<{ text: string; entityType: string; confidence: number }> = [];
    const seenEntities = new Set<string>();

    for (let i = 0; i < chunks.length; i++) {
      const { text: chunkText, offset } = chunks[i];

      try {
        if (!LLMDetector.pipeline) {
          throw new Error('Pipeline not initialized');
        }
        const results = await LLMDetector.pipeline(chunkText);
        const aggregatedResults = this.aggregate(results, 'first');

        for (const result of aggregatedResults) {
          const entityType = this.mapNERLabelToEntityType(result.entity_group);
          if (!entityType) continue;

          const searchText = result.word.trim();
          if (!searchText || searchText.length < 2) continue;

          // Deduplicate entities from overlapping chunks
          const entityKey = `${searchText}:${entityType}`;
          if (seenEntities.has(entityKey)) continue;

          seenEntities.add(entityKey);
          allEntities.push({
            text: searchText,
            entityType,
            confidence: result.score,
          });
        }
      } catch (error) {
        console.warn(`Error detecting entities in chunk ${i}:`, error);
      }

      onProgress?.(Math.round(((i + 1) / chunks.length) * 100));
    }

    return allEntities;
  }

  /**
   * Check if detector is ready
   */
  isReady(): boolean {
    return LLMDetector.isInitialized && LLMDetector.pipeline !== null;
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
    LLMDetector.pipeline = null;
    LLMDetector.isInitialized = false;
    LLMDetector.initializationPromise = null;
  }
}
