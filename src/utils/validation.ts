import { MAX_FILE_SIZE, ALLOWED_MIME_TYPES, ALLOWED_EXTENSIONS, ERROR_MESSAGES } from './constants';

/**
 * File validation result
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate uploaded file
 */
export function validateFile(file: File): ValidationResult {
  // Check file type
  const hasValidMimeType = ALLOWED_MIME_TYPES.includes(file.type);
  const hasValidExtension = ALLOWED_EXTENSIONS.some(ext =>
    file.name.toLowerCase().endsWith(ext)
  );

  if (!hasValidMimeType && !hasValidExtension) {
    return {
      valid: false,
      error: ERROR_MESSAGES.INVALID_FILE_TYPE,
    };
  }

  // Check file size
  if (file.size > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: ERROR_MESSAGES.FILE_TOO_LARGE,
    };
  }

  return { valid: true };
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Generate unique ID for entities with optional prefix
 */
export function generateId(prefix?: string): string {
  const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  return prefix ? `${prefix}-${id}` : id;
}

/**
 * Validate confidence score
 */
export function isValidConfidence(confidence: number): boolean {
  return confidence >= 0 && confidence <= 1;
}

/**
 * Normalize confidence to 0-1 range
 */
export function normalizeConfidence(confidence: number): number {
  return Math.max(0, Math.min(1, confidence));
}
