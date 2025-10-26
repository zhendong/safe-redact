import type { DetectedEntity } from '@/lib/types';

export class EntityAggregator {
  /**
   * Deduplicate and merge overlapping entities
   */
  deduplicateEntities(entities: DetectedEntity[]): DetectedEntity[] {
    // Group entities by page
    const entitiesByPage = new Map<number, DetectedEntity[]>();
    for (const entity of entities) {
      const pageNum = entity.position.pageNumber;
      if (!entitiesByPage.has(pageNum)) {
        entitiesByPage.set(pageNum, []);
      }
      entitiesByPage.get(pageNum)!.push(entity);
    }

    // Deduplicate within each page
    const deduplicated: DetectedEntity[] = [];
    for (const [pageNum, pageEntities] of entitiesByPage.entries()) {
      const pageDeduped = this.deduplicatePageEntities(pageEntities);
      deduplicated.push(...pageDeduped);
    }

    return deduplicated;
  }

  /**
   * Deduplicate entities on a single page
   */
  private deduplicatePageEntities(entities: DetectedEntity[]): DetectedEntity[] {
    if (entities.length === 0) return [];

    // Sort by position (top to bottom, left to right)
    const sorted = [...entities].sort((a, b) => {
      const yDiff = a.position.boundingBox.y - b.position.boundingBox.y;
      if (Math.abs(yDiff) > 5) return yDiff;
      return a.position.boundingBox.x - b.position.boundingBox.x;
    });

    const result: DetectedEntity[] = [];
    const used = new Set<number>();

    for (let i = 0; i < sorted.length; i++) {
      if (used.has(i)) continue;

      const entity = sorted[i];
      let bestMatch = entity;

      // Check for overlaps with remaining entities
      for (let j = i + 1; j < sorted.length; j++) {
        if (used.has(j)) continue;

        const other = sorted[j];
        const overlap = this.calculateOverlap(entity, other);

        // If overlap is high (>80%), merge them
        if (overlap > 0.8) {
          // Keep the one with higher confidence
          if (other.confidence > bestMatch.confidence) {
            bestMatch = other;
          }
          used.add(j);
        }
        // If same text at same position, it's a duplicate
        else if (
          entity.text.toLowerCase() === other.text.toLowerCase() &&
          this.isSamePosition(entity, other)
        ) {
          // Average the confidence if from different methods
          if (entity.detectionMethod !== other.detectionMethod) {
            bestMatch = {
              ...entity,
              confidence: (entity.confidence + other.confidence) / 2,
              detectionMethod: 'ml_ner', // Prefer ML detection
            };
          } else if (other.confidence > bestMatch.confidence) {
            bestMatch = other;
          }
          used.add(j);
        }
      }

      result.push(bestMatch);
      used.add(i);
    }

    return result;
  }

  /**
   * Calculate overlap ratio between two entities
   */
  private calculateOverlap(e1: DetectedEntity, e2: DetectedEntity): number {
    const box1 = e1.position.boundingBox;
    const box2 = e2.position.boundingBox;

    // Calculate intersection
    const x1 = Math.max(box1.x, box2.x);
    const y1 = Math.max(box1.y, box2.y);
    const x2 = Math.min(box1.x + box1.width, box2.x + box2.width);
    const y2 = Math.min(box1.y + box1.height, box2.y + box2.height);

    if (x2 <= x1 || y2 <= y1) return 0; // No overlap

    const intersectionArea = (x2 - x1) * (y2 - y1);
    const area1 = box1.width * box1.height;
    const area2 = box2.width * box2.height;
    const unionArea = area1 + area2 - intersectionArea;

    return intersectionArea / unionArea;
  }

  /**
   * Check if two entities are at the same position
   */
  private isSamePosition(e1: DetectedEntity, e2: DetectedEntity): boolean {
    const box1 = e1.position.boundingBox;
    const box2 = e2.position.boundingBox;

    const xDiff = Math.abs(box1.x - box2.x);
    const yDiff = Math.abs(box1.y - box2.y);
    const widthDiff = Math.abs(box1.width - box2.width);
    const heightDiff = Math.abs(box1.height - box2.height);

    // Allow small differences (within 5 units)
    return xDiff < 5 && yDiff < 5 && widthDiff < 5 && heightDiff < 5;
  }

  /**
   * Sort entities by various criteria
   */
  sortEntities(
    entities: DetectedEntity[],
    sortBy: 'page' | 'confidence' | 'type'
  ): DetectedEntity[] {
    const sorted = [...entities];

    switch (sortBy) {
      case 'page':
        sorted.sort((a, b) => {
          const pageDiff = a.position.pageNumber - b.position.pageNumber;
          if (pageDiff !== 0) return pageDiff;
          const yDiff = a.position.boundingBox.y - b.position.boundingBox.y;
          if (Math.abs(yDiff) > 5) return yDiff;
          return a.position.boundingBox.x - b.position.boundingBox.x;
        });
        break;

      case 'confidence':
        sorted.sort((a, b) => b.confidence - a.confidence);
        break;

      case 'type':
        sorted.sort((a, b) => {
          const typeDiff = a.entityType.localeCompare(b.entityType);
          if (typeDiff !== 0) return typeDiff;
          return b.confidence - a.confidence;
        });
        break;
    }

    return sorted;
  }
}
