/**
 * Application constants
 */

// File validation
export const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB in bytes
export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];
export const ALLOWED_EXTENSIONS = ['.pdf', '.docx'];

// Detection thresholds
export const DEFAULT_CONFIDENCE_THRESHOLDS = {
  high: 0.90,
  medium: 0.70,
  low: 0.50,
};

// Context search window for keyword matching (for confidence boosting)
export const DEFAULT_SEARCH_CONTEXT_WINDOW = 10; // characters before and after
export const DEFAULT_CONFIDENCE_BOOST = 1.2;

// Context display window for user review
export const DISPLAY_CONTEXT_WINDOW = 50; // characters before and after

// Coordinate comparison tolerances (in PDF units)
export const COORDINATE_TOLERANCE = {
  STRICT: 2,    // For widget matching
  STANDARD: 5,  // For entity deduplication
} as const;

// Progress reporting stages (percentage ranges)
export const PROGRESS_STAGES = {
  LOADING: { start: 0, end: 10 },
  PARSING: { start: 10, end: 90 },
  CONVERTING: { start: 60, end: 90 },
  COMPLETE: { start: 90, end: 100 },
  SANITIZING: 96,
  FINALIZING: 95,
} as const;

// LLM text chunking configuration
export const LLM_CHUNKING = {
  CHUNK_SIZE: 2000,      // ~400-500 tokens for most text
  CHUNK_OVERLAP: 200,    // Overlap to catch entities at boundaries
  TOKEN_LIMIT: 512,      // Model token limit
} as const;

// PDF redaction settings
export const PDF_REDACTION = {
  MARGIN: 2,              // Margin around redaction box (pixels)
  PADDING_RATIO: 0.1,     // Padding as ratio of average character width
} as const;

// Memory limits
export const MAX_MEMORY_MB = 100; // Maximum memory per document
export const MAX_PAGES_WARNING = 50; // Warn user for documents with more pages

// Processing timeouts
export const PARSE_TIMEOUT_MS = 60000; // 1 minute
export const DETECTION_TIMEOUT_MS = 120000; // 2 minutes
export const REDACTION_TIMEOUT_MS = 60000; // 1 minute

// Model configuration
export const ML_MODEL_NAME = 'Xenova/bert-base-NER';
export const MODEL_CACHE_KEY = 'transformers-cache';

// Storage keys
export const STORAGE_KEYS = {
  SETTINGS: 'safe-redact-settings',
  FEEDBACK: 'safe-redact-feedback',
  CUSTOM_PATTERNS: 'safe-redact-custom-patterns',
} as const;

// Redaction defaults
export const DEFAULT_REDACTION_STYLE = {
  color: '#000000',
  opacity: 1.0,
  addBorder: false,
};

// UI constants
export const ZOOM_LEVELS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
export const DEFAULT_ZOOM = 1.0;

// Error messages
export const ERROR_MESSAGES = {
  INVALID_FILE_TYPE: 'Please upload a PDF or DOCX file',
  FILE_TOO_LARGE: `File exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit`,
  CORRUPTED_PDF: 'Unable to read file. Please try another file.',
  PARSING_FAILED: 'Failed to parse document. The file may be corrupted or use unsupported features.',
  DETECTION_FAILED: 'Entity detection failed. Please try again.',
  REDACTION_FAILED: 'Failed to generate redacted document. Please try again.',
  MEMORY_ERROR: 'Document too large. Try a smaller document.',
  NO_ENTITIES: 'No entities detected in this document.',
} as const;

// Success messages
export const SUCCESS_MESSAGES = {
  REDACTION_COMPLETE: 'Redaction complete!',
  FILE_UPLOADED: 'File uploaded successfully',
} as const;
