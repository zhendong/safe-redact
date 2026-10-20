import type { DetectionConfig } from '@/lib/types';
import { DEFAULT_CONFIDENCE_THRESHOLDS } from './constants';

export type ConfidenceLevel = 'high' | 'medium' | 'low';
type Thresholds = DetectionConfig['confidenceThresholds'];

/**
 * The single place that turns a score into a level, so card colours, filters,
 * counts, and bulk actions always agree. Everything below the medium
 * threshold is "low", so no detection falls outside every filter.
 */
export function getConfidenceLevel(confidence: number, thresholds: Thresholds = DEFAULT_CONFIDENCE_THRESHOLDS): ConfidenceLevel {
  if (confidence >= thresholds.high) return 'high';
  if (confidence >= thresholds.medium) return 'medium';
  return 'low';
}

/** Lowest score kept at detection time for an aggressiveness setting */
export function getMinimumConfidence(aggressiveness: DetectionConfig['aggressiveness'], thresholds: Thresholds): number {
  if (aggressiveness === 'conservative') return thresholds.high;
  if (aggressiveness === 'balanced') return thresholds.medium;
  return thresholds.low;
}
