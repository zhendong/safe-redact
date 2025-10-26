/**
 * Coordinate conversion and bounding box utilities
 */

import type { BoundingBox } from '@/lib/types';
import { COORDINATE_TOLERANCE } from './constants';

/**
 * Convert Y coordinate from top-left origin to bottom-left origin
 * MuPDF uses top-left origin, PDF coordinate system uses bottom-left
 */
export function convertTopToBottomOrigin(y: number, height: number, pageHeight: number): number {
  return pageHeight - y - height;
}

/**
 * Convert Y coordinate from bottom-left origin to top-left origin
 */
export function convertBottomToTopOrigin(y: number, height: number, pageHeight: number): number {
  return pageHeight - y - height;
}

/**
 * Convert MuPDF quad array to bounding box
 * Quad format: [x0, y0, x1, y1, x2, y2, x3, y3]
 */
export function quadToBoundingBox(quads: number[][], pageHeight: number): BoundingBox | null {
  if (!quads || quads.length === 0) {
    return null;
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const quad of quads) {
    for (let i = 0; i < 8; i += 2) {
      minX = Math.min(minX, quad[i]);
      maxX = Math.max(maxX, quad[i]);
      minY = Math.min(minY, quad[i + 1]);
      maxY = Math.max(maxY, quad[i + 1]);
    }
  }

  return {
    x: minX,
    y: pageHeight - maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Convert bounding box to MuPDF rect format [x0, y0, x1, y1]
 * Converts from bottom-left origin to top-left origin
 */
export function boundingBoxToMuPdfRect(
  bbox: BoundingBox,
  pageHeight: number,
  margin: number = 0
): [number, number, number, number] {
  const x0 = bbox.x - margin;
  const y0 = pageHeight - bbox.y - bbox.height - margin;
  const x1 = bbox.x + bbox.width + margin;
  const y1 = pageHeight - bbox.y + margin;

  return [x0, y0, x1, y1];
}

/**
 * Check if two bounding boxes are at the same position within tolerance
 */
export function areBoundingBoxesEqual(
  box1: BoundingBox,
  box2: BoundingBox,
  tolerance: number = COORDINATE_TOLERANCE.STANDARD
): boolean {
  return (
    Math.abs(box1.x - box2.x) < tolerance &&
    Math.abs(box1.y - box2.y) < tolerance &&
    Math.abs(box1.width - box2.width) < tolerance &&
    Math.abs(box1.height - box2.height) < tolerance
  );
}

/**
 * Calculate overlap ratio between two bounding boxes (IoU - Intersection over Union)
 */
export function calculateBoundingBoxOverlap(box1: BoundingBox, box2: BoundingBox): number {
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
