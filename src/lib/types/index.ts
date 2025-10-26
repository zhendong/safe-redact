// ============================================================================
// CORE ENTITY TYPES
// ============================================================================

/**
 * Main entity detection result
 */
export interface DetectedEntity {
  id: string;                              // Unique identifier (uuidv4)
  text: string;                            // The actual detected text
  entityType: EntityType;                  // Classification of entity
  confidence: number;                      // 0.0 to 1.0
  position: EntityPosition;                // Location in document
  detectionMethod: DetectionMethod;        // How it was detected
  status: EntityStatus;                    // Current review status
  contextText?: string;                    // Surrounding text (±50 chars)
}

/**
 * Entity position in PDF coordinate space
 */
export interface EntityPosition {
  pageNumber: number;                      // 1-indexed page number
  boundingBox: BoundingBox;                // Rectangle coordinates
  textIndex: number;                       // Index in textContent.items array (-1 for form fields)
  transform?: number[];                    // Transform matrix
  formFieldName?: string;                  // Form field name (if from form field)
}

/**
 * Bounding box in PDF coordinates (bottom-left origin)
 */
export interface BoundingBox {
  x: number;                               // Left edge
  y: number;                               // Bottom edge
  width: number;                           // Width of box
  height: number;                          // Height of box
}

// ============================================================================
// ENUMS
// ============================================================================

/**
 * Supported entity types
 */
export enum EntityType {
  PERSON = 'PERSON',                       // Person names
  ORGANIZATION = 'ORG',                    // Company/org names
  LOCATION = 'LOC',                        // Places, addresses
  DATE = 'DATE',                           // Dates
  SSN = 'SSN',                             // Social Security Numbers
  CREDIT_CARD = 'CREDIT_CARD',             // Credit card numbers
  PHONE = 'PHONE',                         // Phone numbers
  EMAIL = 'EMAIL',                         // Email addresses
  CUSTOM = 'CUSTOM'                        // User-defined patterns
}

/**
 * Detection methods
 */
export type DetectionMethod = 'ml_ner' | 'regex' | 'custom' | 'manual';

/**
 * Entity review status
 */
export type EntityStatus = 'pending' | 'confirmed' | 'rejected' | 'modified';

// ============================================================================
// DOCUMENT PROCESSING
// ============================================================================

/**
 * Extracted image data from document
 */
export interface ExtractedImage {
  id: string;                              // Unique identifier
  filename: string;                        // Suggested filename
  mimeType: string;                        // Image MIME type (image/png, image/jpeg, etc.)
  data: Blob;                              // Image data as Blob
  width?: number;                          // Image width in pixels
  height?: number;                         // Image height in pixels
  pageNumber?: number;                     // Page number (for PDFs)
  location?: string;                       // Location in document (for DOCX)
  transform?: string;                      // CSS transform for display (for PDFs)
  bbox?: BoundingBox;                      // Position in document (for PDFs)
}

/**
 * Document metadata
 */
export interface DocumentMetadata {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
  creator?: string;
  producer?: string;
  creationDate?: string;
  modificationDate?: string;
  images?: ExtractedImage[];               // Extracted images from document
  [key: string]: string | ExtractedImage[] | undefined;
}

/**
 * Complete processed document
 */
export interface ProcessedDocument {
  id: string;                              // Document hash or UUID
  filename: string;                        // Original filename
  fileSize: number;                        // Size in bytes
  pageCount: number;                       // Total pages
  pages: ProcessedPage[];                  // Per-page data
  allEntities: DetectedEntity[];           // All detected entities
  processingTime: number;                  // Time taken (ms)
  createdAt: number;                       // Timestamp
  hiddenContentReport?: HiddenContentReport; // Hidden content detection results
  metadata?: DocumentMetadata;             // Document metadata
}

/**
 * Single page processing result
 */
export interface ProcessedPage {
  pageNumber: number;                      // 1-indexed
  textContent: string;                     // Combined text
  textItems: TextItem[];                   // Individual text items
  entities: DetectedEntity[];              // Entities on this page
  pdfPageObject: any;                      // MuPDF PDFPage object
  viewport: any;                           // Page viewport info { width, height }
  dimensions: {
    width: number;
    height: number;
  };
  formFields?: FormFieldData[];            // Form fields on this page
  images?: ExtractedImage[];
}

/**
 * Individual text item
 */
export interface TextItem {
  str: string;                             // Text content
  transform: number[];                     // Transform matrix [a,b,c,d,e,f]
  width: number;                           // Width in PDF units
  height: number;                          // Height in PDF units
  fontName: string;                        // Font identifier
}

/**
 * PDF form field data
 */
export interface FormFieldData {
  name: string;                            // Field name
  label: string;                           // Field label
  value: string;                           // Field value
  fieldType: string;                       // Field type (button, text, choice, etc.)
  flags: number;                           // Field flags
  isReadOnly: boolean;                     // Read-only flag
  isRequired: boolean;                     // Required flag
  isButton: boolean;                       // Is button type
  isText: boolean;                         // Is text type
  isChoice: boolean;                       // Is choice type
  options?: string[];                      // Options for choice fields
  maxLength?: number;                      // Max length for text fields
  bounds: BoundingBox;                     // Field position
}

// ============================================================================
// FEEDBACK AND LEARNING
// ============================================================================

/**
 * User feedback entry stored in IndexedDB
 */
export interface FeedbackEntry {
  id: string;                              // UUID
  timestamp: number;                       // Unix timestamp
  documentId: string;                      // Associated document
  original: DetectedEntity;                // Original detection
  correction: EntityCorrection;            // User's correction
  context: EntityContext;                  // Surrounding context
}

/**
 * User correction details
 */
export interface EntityCorrection {
  action: CorrectionAction;                // Type of correction
  correctText?: string;                    // If boundary changed
  correctEntityType?: EntityType;          // If reclassified
  correctPosition?: EntityPosition;        // If moved
  userNote?: string;                       // Optional explanation
}

/**
 * Correction action types
 */
export type CorrectionAction =
  | 'false_positive'      // Incorrectly detected
  | 'false_negative'      // Missed detection (user added)
  | 'boundary_correction' // Wrong text boundaries
  | 'reclassify'          // Wrong entity type
  | 'confirm';            // Confirmed as correct

/**
 * Context around entity for learning
 */
export interface EntityContext {
  surroundingText: string;                 // Text before and after
  windowSize: number;                      // Characters included
  precedingText: string;                   // Text before entity
  followingText: string;                   // Text after entity
}

/**
 * Custom learned pattern
 */
export interface CustomPattern {
  id: string;                              // UUID
  pattern: string;                         // Regex pattern (as string)
  entityType: EntityType;                  // What it detects
  confidence: number;                      // Base confidence (0-1)
  examples: string[];                      // Example matches
  createdAt: number;                       // When learned
  matchCount: number;                      // Times successfully matched
  lastUsed: number;                        // Last usage timestamp
}

// ============================================================================
// DETECTION CONFIGURATION
// ============================================================================

/**
 * Detection settings
 */
export interface DetectionConfig {
  enabledEntityTypes: EntityType[];        // Which types to detect
  confidenceThresholds: {
    high: number;                          // Auto-confirm threshold (0.90)
    medium: number;                        // Review threshold (0.70)
    low: number;                           // Flag threshold (0.50)
  };
  useMLModel: boolean;                     // Enable ML-based NER
  useRegexPatterns: boolean;               // Enable regex detection
  useCustomPatterns: boolean;              // Enable learned patterns
  aggressiveness: 'conservative' | 'balanced' | 'aggressive';
  sanitizeDocument: boolean;               // Strip metadata and hidden content
}

/**
 * Regex pattern definition
 */
export interface RegexPattern {
  name: string;                            // Pattern identifier
  entityType: EntityType;                  // What it detects
  pattern: RegExp;                         // The regex
  confidence: number;                      // Base confidence
  validator?: (match: string) => boolean;  // Optional validation function
  examples: string[];                      // Example matches
  scripts?: string[];                      // Applicable scripts/languages (for filtering)
  contextKeywords?: string[];              // Keywords that boost confidence when found near match
  contextWindowSize?: number;              // Characters before/after to search for keywords (default: 50)
  confidenceBoost?: number;                // Confidence multiplier when keywords found (default: 1.2 = +20%)
}

// ============================================================================
// REDACTION
// ============================================================================

/**
 * Redaction job configuration
 */
export interface RedactionJob {
  documentId: string;                      // Source document
  entitiesToRedact: string[];              // Entity IDs to redact
  redactionStyle: RedactionStyle;          // How to redact
  outputFilename: string;                  // Output filename
}

/**
 * Redaction visual style
 */
export interface RedactionStyle {
  color: string;                           // Fill color (default: black)
  opacity: number;                         // Opacity (1.0 = solid)
  addBorder: boolean;                      // Add border around redaction
  borderColor?: string;                    // Border color
  borderWidth?: number;                    // Border width
}

/**
 * Redaction result
 */
export interface RedactionResult {
  success: boolean;                        // Whether redaction succeeded
  pdfBlob?: Blob;                          // Redacted PDF file
  error?: string;                          // Error message if failed
  redactedCount: number;                   // Number of redactions applied
  processingTime: number;                  // Time taken (ms)
}

// ============================================================================
// UI STATE
// ============================================================================

/**
 * Application state
 */
export interface AppState {
  currentDocument: ProcessedDocument | null;
  selectedEntities: Set<string>;           // Selected entity IDs
  currentPage: number;                     // Current page number
  viewMode: 'review' | 'redact' | 'compare';
  isProcessing: boolean;                   // Processing in progress
  error: string | null;                    // Current error message
  settings: DetectionConfig;               // User settings
}

/**
 * Processing stage for progress tracking
 */
export interface ProcessingStage {
  stage: ProcessingStageType;
  progress: number;                        // 0-100
  message: string;                         // User-facing message
}

export type ProcessingStageType =
  | 'uploading'
  | 'parsing'
  | 'loading_model'
  | 'detecting'
  | 'aggregating'
  | 'complete';

// ============================================================================
// STATISTICS AND ANALYTICS
// ============================================================================

/**
 * Detection statistics
 */
export interface DetectionStats {
  totalEntities: number;
  byType: Record<EntityType, number>;
  byConfidence: {
    high: number;
    medium: number;
    low: number;
  };
  byMethod: Record<DetectionMethod, number>;
  averageConfidence: number;
  processingTime: number;
}

/**
 * Feedback analytics
 */
export interface FeedbackAnalytics {
  totalCorrections: number;
  falsePositiveRate: number;
  falseNegativeRate: number;
  accuracyByType: Record<EntityType, number>;
  customPatternsCreated: number;
  improvementRate: number;                 // % improvement over time
}

// ============================================================================
// HIDDEN CONTENT DETECTION
// ============================================================================

/**
 * Hidden content warning
 */
export interface HiddenContentWarning {
  type: HiddenContentType;
  severity: 'high' | 'medium' | 'low';
  description: string;
  pageNumbers?: number[];
  count?: number;
  details?: string;
}

/**
 * Types of hidden content
 */
export type HiddenContentType =
  | 'ocg_layers'
  | 'hidden_annotations'
  | 'form_fields'
  | 'embedded_files'
  | 'javascript'
  | 'transparent_objects'
  | 'offpage_content';

/**
 * Hidden content detection report
 */
export interface HiddenContentReport {
  hasHiddenContent: boolean;
  warnings: HiddenContentWarning[];
  summary: string;
}
