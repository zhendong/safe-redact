import { useState, useEffect, useRef } from 'react';
import packageJson from '../package.json';
import { FileUpload } from '@/components/upload/FileUpload';
import { ChooseEntities } from '@/components/review/ChooseEntities';
import { ProgressIndicator } from '@/components/common/ProgressIndicator';
import { DocumentViewer } from '@/components/viewer/DocumentViewer';
import { FilterBar } from '@/components/review/FilterBar';
import { EntityList } from '@/components/review/EntityList';
import { MobileViewSwitcher } from '@/components/review/MobileViewSwitcher';
import { SettingsPanel } from '@/components/settings/SettingsPanel';
import { MetadataReviewModal } from '@/components/review/MetadataReviewModal';
import { PdfParser } from '@/lib/parsers/PdfParser';
import type { ParseProgress } from '@/lib/parsers/PdfParser';
import { DocxParser } from '@/lib/parsers/DocxParser';
import type { ParsedDocx } from '@/lib/parsers/DocxParser';
import { RegexDetector } from '@/lib/detectors/RegexDetector';
import { LLMDetector } from '@/lib/detectors/LLMDetector';
import { EntityAggregator } from '@/lib/detectors/EntityAggregator';
import { RedactionEngine } from '@/lib/redaction/RedactionEngine';
import { DocxRedactor } from '@/lib/redaction/DocxRedactor';
import { processImage as processUploadedImage } from '@/lib/image/ImageProcessor';
import { redactImage, downloadRedactedImage } from '@/lib/image/ImageRedactor';
import { detectImageEntities } from '@/lib/image/ImageOcr';
import { DocxViewer } from '@/components/viewer/DocxViewer';
import type { ProcessedDocument, ProcessedPage, ProcessingStage, DetectedEntity, BoundingBox, EntityType, DetectionConfig } from '@/lib/types';
import { EntityType as EntityTypeEnum } from '@/lib/types';
import { generateId, validateFile } from '@/utils/validation';
import { isDesktop, onDesktopFileOpened, onDesktopExportRequested, setDesktopExportEnabled, confirmAction } from '@/platform';
import { STORAGE_KEYS, DEFAULT_CONFIDENCE_THRESHOLDS } from '@/utils/constants';
import { generateRedactedFilename } from '@/utils/file-utils';
import { buildWhitespaceTolerantPattern } from '@/utils/text-utils';
import { enableNewEntityTypes } from '@/utils/entity-types';
import { useMemo } from 'react';
import { useDialog } from '@/hooks/useDialog';
import { nextPaint } from '@/utils/yield';
import { applyDefaultSelection } from '@/utils/entity-groups';
import { getConfidenceLevel, getMinimumConfidence } from '@/utils/confidence';
import { useTheme } from '@/contexts/ThemeContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { createLogger, describeFile, timed } from '@/utils/logger';

const log = createLogger('App');

// choose: pick what to redact without the document; review: check the redacted document
type AppStage = 'upload' | 'processing' | 'choose' | 'review' | 'redacting' | 'complete';
type FileType = 'pdf' | 'docx' | 'image';
type ReviewSnapshot = { document: ProcessedDocument | null; docx: ParsedDocx | null };

const UNDO_LIMIT = 50;

/** Thrown inside an analysis run once the user has cancelled it */
class AnalysisCancelled extends Error {}

/** Progress and results from a cancelled run are dropped; the work itself runs to the end in the background */
interface AnalysisRun {
  progress: (stage: ProcessingStage) => void;
  /** Throws AnalysisCancelled if the user cancelled this run */
  check: () => void;
}

function App() {
  const { theme, toggleTheme } = useTheme();
  const { language, t, toggleLanguage } = useLanguage();
  const [stage, setStage] = useState<AppStage>('upload');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileType, setFileType] = useState<FileType | null>(null);
  const [processedDocument, setProcessedDocument] = useState<ProcessedDocument | null>(null);
  const [processedDocx, setProcessedDocx] = useState<ParsedDocx | null>(null);
  const [processingStage, setProcessingStage] = useState<ProcessingStage>({
    stage: 'uploading',
    progress: 0,
    message: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedEntityId, setSelectedEntityId] = useState<string | undefined>();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const aboutDialogRef = useDialog<HTMLDivElement>(isAboutOpen, () => setIsAboutOpen(false));
  const [isMetadataModalOpen, setIsMetadataModalOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'document' | 'entities'>('document');

  // Load detection config from localStorage or use defaults
  const [detectionConfig, setDetectionConfig] = useState<DetectionConfig>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Ensure new fields have defaults for backward compatibility
        return enableNewEntityTypes({
          ...parsed,
          sanitizeDocument: parsed.sanitizeDocument ?? false,
        });
      } catch (e) {
        log.error('Failed to parse saved config, using defaults', e);
      }
    }
    return {
      enabledEntityTypes: Object.values(EntityTypeEnum),
      knownEntityTypes: Object.values(EntityTypeEnum),
      confidenceThresholds: DEFAULT_CONFIDENCE_THRESHOLDS,
      useMLModel: false,
      useRegexPatterns: true,
      useCustomPatterns: false,
      aggressiveness: 'balanced',
      sanitizeDocument: false,
    };
  });

  // Shared filter state - initialized from detection config
  const [enabledTypes, setEnabledTypes] = useState<Set<EntityTypeEnum>>(
    new Set(detectionConfig.enabledEntityTypes)
  );
  const [showHighConfidence, setShowHighConfidence] = useState(true);
  const [showMediumConfidence, setShowMediumConfidence] = useState(true);
  const [showLowConfidence, setShowLowConfidence] = useState(true);

  // Sync enabled types with detection config when it changes
  useEffect(() => {
    setEnabledTypes(new Set(detectionConfig.enabledEntityTypes));
  }, [detectionConfig.enabledEntityTypes]);

  // Calculate entity counts and filtered entities for review stage
  const entityCounts = useMemo(() => {
    const allEntities = processedDocument?.allEntities || processedDocx?.allEntities;
    if (!allEntities) return {} as Record<EntityType, number>;
    const counts: Record<EntityType, number> = {} as Record<EntityType, number>;
    Object.values(EntityTypeEnum).forEach((type) => {
      counts[type] = allEntities.filter((e) => e.entityType === type).length;
    });
    return counts;
  }, [processedDocument, processedDocx]);

  const confidenceCounts = useMemo(() => {
    const allEntities = processedDocument?.allEntities || processedDocx?.allEntities;
    const counts = { high: 0, medium: 0, low: 0 };
    if (!allEntities) return counts;
    for (const e of allEntities) counts[getConfidenceLevel(e.confidence, detectionConfig.confidenceThresholds)]++;
    return counts;
  }, [processedDocument, processedDocx, detectionConfig.confidenceThresholds]);

  const filteredEntities = useMemo(() => {
    const allEntities = processedDocument?.allEntities || processedDocx?.allEntities;
    if (!allEntities) return [];
    return allEntities.filter((entity) => {
      // Filter by type
      if (!enabledTypes.has(entity.entityType)) return false;

      // Confidence filters only exist while advanced options are shown, so they can't hide items invisibly
      if (!detectionConfig.showAdvancedOptions) return true;
      const level = getConfidenceLevel(entity.confidence, detectionConfig.confidenceThresholds);
      if (level === 'high') return showHighConfidence;
      if (level === 'medium') return showMediumConfidence;
      return showLowConfidence;
    });
  }, [processedDocument, processedDocx, enabledTypes, showHighConfidence, showMediumConfidence, showLowConfidence, detectionConfig.showAdvancedOptions, detectionConfig.confidenceThresholds]);

  // Confirmed items in the filtered list, for the list stats
  const visibleConfirmedCount = useMemo(() => {
    return filteredEntities.filter((e) => e.status === 'confirmed').length;
  }, [filteredEntities]);

  // Every confirmed item is redacted on export, including ones hidden by filters
  const confirmedCount = useMemo(() => {
    const allEntities = processedDocument?.allEntities || processedDocx?.allEntities || [];
    return allEntities.filter((e) => e.status === 'confirmed').length;
  }, [processedDocument, processedDocx]);
  const hiddenConfirmedCount = confirmedCount - visibleConfirmedCount;

  // Review states before each edit, newest last, so edits can be undone
  const [undoStack, setUndoStack] = useState<ReviewSnapshot[]>([]);
  const recordUndo = () => {
    setUndoStack(stack => [...stack.slice(-(UNDO_LIMIT - 1)), { document: processedDocument, docx: processedDocx }]);
  };
  const handleUndo = () => {
    const previous = undoStack[undoStack.length - 1];
    if (!previous) return;
    setUndoStack(stack => stack.slice(0, -1));
    setProcessedDocument(previous.document);
    setProcessedDocx(previous.docx);
  };

  // Save detection config to localStorage whenever it changes
  const handleConfigChange = (config: DetectionConfig) => {
    setDetectionConfig(config);
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(config));
  };

  const handleFileSelect = (file: File) => {
    setSelectedFile(file);
    // Detect file type
    const type: FileType = file.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(file.name)
      ? 'image'
      : file.name.toLowerCase().endsWith('.docx') ? 'docx' : 'pdf';
    log.info('File selected', { type, ...describeFile(file) });
    setFileType(type);
    setError(null);
    // Analysis starts right away; the processing page has Cancel for a wrong file
    void handleStartAnalysis(file, type);
  };

  const handleBackToUpload = () => {
    setSelectedFile(null);
    setFileType(null);
    setProcessedDocument(null);
    setProcessedDocx(null);
    setUndoStack([]);
    setStage('upload');
    setError(null);
  };

  // Leaving the review discards it, so ask first, as opening a file from the menu does
  const handleLeaveReview = async () => {
    if (
      !(await confirmAction(t('review.discardReview', { name: selectedFile?.name ?? '' }), {
        title: t('review.discardReviewTitle'),
        okLabel: t('review.discardReviewConfirm'),
        cancelLabel: t('common.cancel'),
      }))
    ) {
      return;
    }
    handleBackToUpload();
  };

  const handleEntitySelect = (entity: DetectedEntity) => {
    setSelectedEntityId(entity.id);
    setCurrentPage(entity.position.pageNumber);
    // On mobile, switch to document view when selecting an entity
    if (window.innerWidth < 1024) {
      setViewMode('document');
    }
  };

  const setEntityStatus = (entityId: string | string[], status: 'confirmed' | 'rejected') => {
    const entityIds = new Set(Array.isArray(entityId) ? entityId : [entityId]);
    const allEntities = processedDocument?.allEntities ?? processedDocx?.allEntities ?? [];
    // Skip no-op clicks so they don't fill the undo history
    if (!allEntities.some(e => entityIds.has(e.id) && e.status !== status)) return;
    recordUndo();
    const update = (e: DetectedEntity) => (entityIds.has(e.id) ? { ...e, status } : e);

    if (processedDocument) {
      setProcessedDocument({
        ...processedDocument,
        allEntities: processedDocument.allEntities.map(update),
        pages: processedDocument.pages.map(page => ({ ...page, entities: page.entities.map(update) })),
      });
    } else if (processedDocx) {
      setProcessedDocx({ ...processedDocx, allEntities: processedDocx.allEntities.map(update) });
    }
  };
  const handleEntityConfirm = (entityId: string | string[]) => setEntityStatus(entityId, 'confirmed');
  const handleEntityReject = (entityId: string | string[]) => setEntityStatus(entityId, 'rejected');


  const handleManualEntityCreate = (
    boundingBox: BoundingBox,
    entityType: EntityType,
    pageNumber: number,
    selectedText?: string,
    searchOccurrences: boolean = true,
    formFieldName?: string
  ) => {
    if (!processedDocument) return;

    // Find the page viewport to create proper position data
    const page = processedDocument.pages.find(p => p.pageNumber === pageNumber);
    if (!page) return;
    recordUndo();

    const newEntity: DetectedEntity = {
      id: generateId(),
      text: selectedText || '[Manual Selection]',
      entityType,
      confidence: 1.0,
      position: {
        pageNumber,
        boundingBox,
        textIndex: formFieldName ? -1 : 0, // -1 indicates form field
        formFieldName, // Store form field name for deletion
      },
      detectionMethod: 'manual',
      status: 'confirmed',
      contextText: 'Manually selected area',
    };

    // If text was extracted and search is enabled, search for similar occurrences
    if (selectedText && selectedText.length > 0 && searchOccurrences) {
      const allFoundEntities = searchForTextOccurrences(selectedText, entityType, pageNumber, boundingBox);

      // Filter out the manual selection itself from search results by comparing positions
      const similarEntities = allFoundEntities.filter(entity => {
        // Skip if it's on the same page and overlaps with the manual selection
        if (entity.position.pageNumber === pageNumber) {
          return !boundingBoxesOverlap(entity.position.boundingBox, boundingBox);
        }
        return true;
      });

      // Update document with new entity and similar occurrences
      const updatedEntities = [...processedDocument.allEntities, newEntity, ...similarEntities];
      const updatedPages = processedDocument.pages.map(p => {
        const pageEntities = similarEntities.filter(e => e.position.pageNumber === p.pageNumber);
        if (p.pageNumber === pageNumber) {
          return {
            ...p,
            entities: [...p.entities, newEntity, ...pageEntities],
          };
        } else if (pageEntities.length > 0) {
          return {
            ...p,
            entities: [...p.entities, ...pageEntities],
          };
        }
        return p;
      });

      setProcessedDocument({
        ...processedDocument,
        allEntities: updatedEntities,
        pages: updatedPages,
      });
    } else {
      // No text extracted or search disabled, just add the single entity
      const updatedEntities = [...processedDocument.allEntities, newEntity];
      const updatedPages = processedDocument.pages.map(p => {
        if (p.pageNumber === pageNumber) {
          return {
            ...p,
            entities: [...p.entities, newEntity],
          };
        }
        return p;
      });

      setProcessedDocument({
        ...processedDocument,
        allEntities: updatedEntities,
        pages: updatedPages,
      });
    }

    // Select the new entity
    setSelectedEntityId(newEntity.id);
  };

  // DOCX: redact every occurrence of text the user selected in the preview
  const handleDocxTextRedact = (selectedText: string) => {
    if (!processedDocx) return;
    const pattern = buildWhitespaceTolerantPattern(selectedText);
    if (!pattern) return;

    const manualEntities: DetectedEntity[] = [];
    for (const match of processedDocx.fullText.matchAll(pattern)) {
      manualEntities.push({
        id: generateId(),
        text: match[0],
        entityType: EntityTypeEnum.CUSTOM,
        confidence: 1.0,
        position: {
          pageNumber: 1,
          textIndex: match.index,
          boundingBox: { x: 0, y: 0, width: 0, height: 0 },
        },
        detectionMethod: 'manual',
        status: 'confirmed',
        contextText: 'Manually selected text',
      });
    }
    if (manualEntities.length === 0) {
      log.warn('Selected text not found in document text', { chars: selectedText.length });
      return;
    }

    // Merge with existing detections so overlapping ranges become one checked entity
    const allEntities = new EntityAggregator().deduplicateEntities([...processedDocx.allEntities, ...manualEntities]);
    log.info('Manual DOCX selection added', { occurrences: manualEntities.length });
    recordUndo();
    setProcessedDocx({ ...processedDocx, allEntities });
  };

  /**
   * Normalize MuPDF search hits to handle inconsistent nesting
   */
  const normalizeSearchHits = (rawHits: any[], page: ProcessedPage, searchText: string): number[][][] => {
    if (!rawHits || rawHits.length === 0) {
      return [];
    }

    // Step 1: Flatten extra nesting - convert [[quad], [quad]] to [quad, quad]
    const flattenedHits: number[][][] = [];

    for (const hit of rawHits) {
      if (!Array.isArray(hit)) continue;

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
          // Check if all elements are quads
          const allQuads = hit.every((item: any) =>
            Array.isArray(item) && item.length === 8 && typeof item[0] === 'number'
          );

          if (allQuads) {
            // Proper format: [quad, quad]
            flattenedHits.push(hit as number[][]);
          } else {
            // Mixed structure, treat as separate hits
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

    for (const hit of flattenedHits) {
      if (currentGroup.length === 0) {
        currentGroup = [...hit];
      } else {
        const lastQuad = currentGroup[currentGroup.length - 1];
        const firstQuad = hit[0];

        // Check if quads are close (same approach as in detectors)
        const x1 = (lastQuad[0] + lastQuad[2] + lastQuad[4] + lastQuad[6]) / 4;
        const y1 = (lastQuad[1] + lastQuad[3] + lastQuad[5] + lastQuad[7]) / 4;
        const height1 = Math.abs(lastQuad[5] - lastQuad[1]);

        const x2 = (firstQuad[0] + firstQuad[2] + firstQuad[4] + firstQuad[6]) / 4;
        const y2 = (firstQuad[1] + firstQuad[3] + firstQuad[5] + firstQuad[7]) / 4;
        const height2 = Math.abs(firstQuad[5] - firstQuad[1]);

        const verticalDistance = Math.abs(y2 - y1);
        const horizontalDistance = Math.abs(x2 - x1);
        const avgHeight = (height1 + height2) / 2;

        const isClose = verticalDistance < avgHeight * 2 &&
                        horizontalDistance < page.dimensions.width * 0.3;

        if (isClose) {
          currentGroup.push(...hit);
        } else {
          mergedHits.push(currentGroup);
          currentGroup = [...hit];
        }
      }
    }

    if (currentGroup.length > 0) {
      mergedHits.push(currentGroup);
    }

    return mergedHits;
  };

  // Search for text occurrences across all pages using mupdf
  const searchForTextOccurrences = (
    searchText: string,
    entityType: EntityType,
    excludePageNumber: number,
    excludeBoundingBox: BoundingBox
  ): DetectedEntity[] => {
    if (!processedDocument || !searchText || searchText.length === 0) return [];

    const foundEntities: DetectedEntity[] = [];

    // Search through each page using mupdf's search method
    for (const page of processedDocument.pages) {
      if (page.imageBlob && page.ocrWords) {
        const escaped = searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const matches = detectImageEntities(
          { text: page.textContent, textItems: page.textItems, words: page.ocrWords },
          page.dimensions.width,
          page.dimensions.height,
          [{ name: 'manual', entityType, pattern: new RegExp(escaped, 'gi'), confidence: 1, examples: [] }]
        );
        // The user asked to redact every occurrence, so matches start checked
        foundEntities.push(...matches.map(entity => ({ ...entity, detectionMethod: 'manual' as const, status: 'confirmed' as const })));
        continue;
      }
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

        if (!rawHits || rawHits.length === 0) continue;

        // Normalize hits to handle inconsistent nesting and merge close quads (only for multi-line matches)
        const hits = normalizeSearchHits(rawHits, page, searchText);

        // Create an entity for each normalized hit
        for (const hit of hits) {
          const position = convertQuadToPosition(hit, page);

          if (position) {
            const entity: DetectedEntity = {
              id: generateId(),
              text: searchText,
              entityType,
              confidence: 1.0,
              position,
              detectionMethod: 'manual',
              // The user asked to redact every occurrence, so matches start checked
              status: 'confirmed',
              contextText: `Found on page ${page.pageNumber}`,
            };
            foundEntities.push(entity);
          }
        }
      } catch (error) {
        log.warn('MuPDF search failed', { page: page.pageNumber, error: String(error) });
      }
    }

    return foundEntities;
  };

  // Whether a search hit is the manual selection itself: most of the hit lies inside the drawn box.
  // A hand-drawn box never lines up exactly with the text, so comparing edges would miss it.
  const boundingBoxesOverlap = (hit: BoundingBox, selection: BoundingBox): boolean => {
    const width = Math.min(hit.x + hit.width, selection.x + selection.width) - Math.max(hit.x, selection.x);
    const height = Math.min(hit.y + hit.height, selection.y + selection.height) - Math.max(hit.y, selection.y);
    if (width <= 0 || height <= 0) return false;
    return width * height >= 0.5 * hit.width * hit.height;
  };

  // Convert MuPDF Quad array to EntityPosition
  const convertQuadToPosition = (quads: number[][], page: ProcessedPage): import('@/lib/types').EntityPosition | null => {
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
      textIndex: 0, // Use 0 for text content (not -1, which indicates form field)
    };
  };

  const handleApplyRedactions = async () => {
    if (!selectedFile) return;

    // Route to appropriate redaction handler
    if (fileType === 'pdf') {
      await handleApplyRedactionsPdf();
    } else if (fileType === 'docx') {
      await handleApplyRedactionsDocx();
    } else if (fileType === 'image') {
      await handleApplyRedactionsImage();
    }
  };

  // Desktop: files opened from the menu, Dock, or Finder, and File > Save Redacted File…
  const handleDesktopFileOpened = async (file: File) => {
    if (stage === 'processing' || stage === 'redacting') return;
    const validation = validateFile(file);
    if (!validation.valid) {
      setError(validation.error || t('errors.invalidFileType'));
      return;
    }
    if (
      (stage === 'choose' || stage === 'review') &&
      !(await confirmAction(t('common.discardReview', { name: file.name }), {
        title: t('common.discardReviewTitle'),
        okLabel: t('common.discardReviewConfirm'),
        cancelLabel: t('common.cancel'),
      }))
    ) {
      return;
    }
    handleBackToUpload();
    handleFileSelect(file);
  };
  const desktopHandlersRef = useRef({ handleDesktopFileOpened, handleApplyRedactions, stage });
  useEffect(() => {
    desktopHandlersRef.current = { handleDesktopFileOpened, handleApplyRedactions, stage };
  });
  useEffect(() => {
    const stopOpen = onDesktopFileOpened(file => void desktopHandlersRef.current.handleDesktopFileOpened(file));
    const stopExport = onDesktopExportRequested(() => {
      const current = desktopHandlersRef.current;
      if (current.stage === 'review') void current.handleApplyRedactions();
    });
    return () => {
      stopOpen();
      stopExport();
    };
  }, []);
  useEffect(() => setDesktopExportEnabled(stage === 'review'), [stage]);

  // Cmd/Ctrl+Z undoes review edits; text fields keep their own undo
  const undoRef = useRef(handleUndo);
  useEffect(() => {
    undoRef.current = handleUndo;
  });
  useEffect(() => {
    if (stage !== 'choose' && stage !== 'review') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== 'z') return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      event.preventDefault();
      undoRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [stage]);

  const handleApplyRedactionsImage = async () => {
    const image = processedDocument?.pages[0]?.imageBlob;
    if (!selectedFile || !processedDocument || !image) return;
    const confirmed = processedDocument.allEntities.filter(entity => entity.status === 'confirmed');
    if (!confirmed.length) {
      setError(t('errors.noEntitiesConfirmed'));
      return;
    }
    setStage('redacting');
    setError(null);
    log.info('Redaction started', { type: 'image', entities: confirmed.length });
    try {
      setProcessingStage({ stage: 'detecting', progress: 20, message: t('progress.redacting') });
      const blob = await redactImage(image, confirmed);
      if (!(await downloadRedactedImage(blob, selectedFile.name))) {
        // Save dialog cancelled: return to review so the user can export again
        log.info('Save cancelled');
        setStage('review');
        return;
      }
      log.info('Redaction finished', { type: 'image', redacted: confirmed.length, bytes: blob.size });
      setProcessingStage({ stage: 'complete', progress: 100, message: t('progress.redactionSuccess', { count: confirmed.length }) });
      setStage('complete');
    } catch (err) {
      log.error('Redaction failed', err, { type: 'image' });
      setError(err instanceof Error ? err.message : t('errors.redactionError'));
      setStage('review');
    }
  };

  const handleApplyRedactionsPdf = async () => {
    if (!processedDocument || !selectedFile) return;

    // Get confirmed entities
    const confirmedEntities = processedDocument.allEntities.filter(
      e => e.status === 'confirmed'
    );

    if (confirmedEntities.length === 0) {
      setError(t('errors.noEntitiesConfirmed'));
      return;
    }

    setStage('redacting');
    setError(null);

    log.info('Redaction started', { type: 'pdf', entities: confirmedEntities.length, sanitize: detectionConfig.sanitizeDocument });
    try {
      const engine = new RedactionEngine();

      const result = await engine.applyRedactions(
        selectedFile,
        processedDocument,
        confirmedEntities,
        (progress, message) => {
          setProcessingStage({
            stage: 'detecting', // reusing stage for redacting
            progress,
            message,
          });
        },
        detectionConfig.sanitizeDocument
      );

      if (result.success && result.pdfBlob) {
        // Download the redacted PDF
        const filename = generateRedactedFilename(selectedFile.name);
        if (!(await engine.downloadRedactedPdf(result.pdfBlob, filename))) {
          log.info('Save cancelled');
          setStage('review');
          return;
        }
        log.info('Redaction finished', { type: 'pdf', redacted: result.redactedCount, bytes: result.pdfBlob.size });

        setStage('complete');
        setProcessingStage({
          stage: 'complete',
          progress: 100,
          message: t('progress.redactionSuccess', { count: result.redactedCount }),
        });
      } else {
        log.error('Redaction failed', result.error, { type: fileType ?? undefined });
        setError(result.error || t('errors.redactionFailedGeneric'));
        setStage('review');
      }
    } catch (err) {
      log.error('Redaction failed', err, { type: fileType ?? undefined });
      setError(err instanceof Error ? err.message : t('errors.redactionError'));
      setStage('review');
    }
  };

  const handleApplyRedactionsDocx = async () => {
    if (!processedDocx || !selectedFile) return;

    // Get confirmed entities
    const confirmedEntities = processedDocx.allEntities.filter(
      e => e.status === 'confirmed'
    );

    if (confirmedEntities.length === 0) {
      setError(t('errors.noEntitiesConfirmed'));
      return;
    }

    setStage('redacting');
    setError(null);

    log.info('Redaction started', { type: 'docx', entities: confirmedEntities.length, sanitize: detectionConfig.sanitizeDocument });
    try {
      const redactor = new DocxRedactor();

      const result = await redactor.applyRedactions(
        selectedFile,
        processedDocx,
        confirmedEntities,
        (progress, message) => {
          setProcessingStage({
            stage: 'detecting', // reusing stage for redacting
            progress,
            message,
          });
        },
        detectionConfig.sanitizeDocument
      );

      if (result.success && result.pdfBlob) {
        // Download the redacted DOCX (pdfBlob is reused for consistency)
        if (!(await redactor.downloadRedactedDocx(result.pdfBlob, selectedFile.name))) {
          log.info('Save cancelled');
          setStage('review');
          return;
        }
        log.info('Redaction finished', { type: 'docx', redacted: result.redactedCount, bytes: result.pdfBlob.size });

        setStage('complete');
        setProcessingStage({
          stage: 'complete',
          progress: 100,
          message: t('progress.redactionSuccess', { count: result.redactedCount }),
        });
      } else {
        log.error('Redaction failed', result.error, { type: fileType ?? undefined });
        setError(result.error || t('errors.redactionFailedGeneric'));
        setStage('review');
      }
    } catch (err) {
      log.error('Redaction failed', err, { type: fileType ?? undefined });
      setError(err instanceof Error ? err.message : t('errors.redactionError'));
      setStage('review');
    }
  };

  // Bumped on every start and cancel, so a run can tell whether it is still current
  const analysisRunRef = useRef(0);

  const handleStartAnalysis = async (file: File, type: FileType) => {
    // Browser only: the model downloads on first use, so ask before starting
    if (
      detectionConfig.useMLModel &&
      (await LLMDetector.needsDownload()) &&
      !(await confirmAction(t('analysis.modelDownload'), {
        title: t('analysis.modelDownloadTitle'),
        okLabel: t('analysis.modelDownloadConfirm'),
        cancelLabel: t('common.cancel'),
      }))
    ) {
      handleBackToUpload();
      return;
    }

    const runId = ++analysisRunRef.current;
    const isCurrent = () => analysisRunRef.current === runId;
    const run: AnalysisRun = {
      progress: next => {
        if (isCurrent()) setProcessingStage(next);
      },
      check: () => {
        if (!isCurrent()) throw new AnalysisCancelled();
      },
    };

    setUndoStack([]);
    setProcessingStage({ stage: 'parsing', progress: 0, message: t('progress.parsingText') });
    setStage('processing');
    setError(null);

    try {
      // Parsing blocks the main thread, so show the processing page before it starts
      await nextPaint();
      run.check();
      await timed(log, 'Analysis', async () => {
        if (type === 'pdf') {
          await processPdf(run, file);
        } else if (type === 'docx') {
          await processDocx(run, file);
        } else {
          await processImage(run, file);
        }
      }, {
        type,
        regex: detectionConfig.useRegexPatterns,
        ml: detectionConfig.useMLModel,
        aggressiveness: detectionConfig.aggressiveness,
      });
    } catch (err) {
      if (err instanceof AnalysisCancelled || !isCurrent()) return;
      handleBackToUpload();
      setError(err instanceof Error ? err.message : t('errors.processingError'));
    }
  };

  const handleCancelAnalysis = () => {
    analysisRunRef.current++;
    log.info('Analysis cancelled');
    handleBackToUpload();
  };

  const processImage = async (run: AnalysisRun, file: File) => {
    run.progress({ stage: 'parsing', progress: 0, message: t('progress.recognizingImage') });
    const document = await processUploadedImage(file, progress => {
      run.progress({ stage: 'parsing', progress, message: t('progress.recognizingImage') });
    });
    const entities = applyDefaultSelection(detectionConfig.useRegexPatterns
      ? filterEntitiesByConfig(document.allEntities)
      : []);
    log.info('Entities detected', { ocr: document.allEntities.length, filtered: entities.length });
    document.allEntities = entities;
    document.pages[0].entities = entities;
    run.check();
    setProcessedDocument(document);
    setCurrentPage(1);
    setStage('choose');
  };

  const processPdf = async (run: AnalysisRun, file: File) => {

    // Parse PDF
    // Parsing takes the first half of the bar; detection the rest
    const parser = new PdfParser((progress: ParseProgress) => {
      run.progress({
        stage: 'parsing',
        progress: progress.progress * 0.5,
        message: progress.currentPage && progress.totalPages
          ? t('progress.parsingPage', { current: progress.currentPage, total: progress.totalPages })
          : t('progress.parsingText'),
      });
    });

    const document = await timed(log, 'PDF parsing', () => parser.parsePdf(file));
    log.info('PDF parsed', {
      pages: document.pages.length,
      scannedPages: document.pages.filter(page => page.imageBlob).length,
      textChars: document.pages.reduce((sum, page) => sum + page.textContent.length, 0),
    });

    const allEntities: DetectedEntity[] = [];

    // Detect entities using regex (includes predefined words)
    if (detectionConfig.useRegexPatterns) {
      run.progress({
        stage: 'detecting',
        progress: 50,
        message: t('progress.detectingSensitiveInfo'),
      });
      // Detection is synchronous, so let the progress paint first
      await nextPaint();

      // Without AI, pattern matching is most of the remaining work
      const end = detectionConfig.useMLModel ? 60 : 88;
      const detector = new RegexDetector();
      const regexEntities = await timed(log, 'Regex detection', () => detector.detectEntities(document.pages, fraction => {
        run.progress({ stage: 'detecting', progress: 50 + fraction * (end - 50), message: t('progress.detectingSensitiveInfo') });
      }));
      log.info('Regex entities detected', { count: regexEntities.length });
      allEntities.push(...regexEntities);
    }

    // Detect entities using LLM if enabled
    if (detectionConfig.useMLModel) {
      try {
        run.progress({
          stage: 'loading_model',
          progress: 60,
          message: t('progress.loadingLLMModel'),
        });

        const llmDetector = new LLMDetector();
        await llmDetector.initialize((progress, message) => {
          run.progress({
            stage: 'loading_model',
            progress: 60 + (progress * 0.15), // 60-75%
            message,
          });
        });

        run.progress({
          stage: 'detecting',
          progress: 75,
          message: t('progress.detectingWithLLM'),
        });

        // Use page-based detection for PDFs with mupdf positioning
        const llmEntities = await timed(log, 'ML detection', () => llmDetector.detectEntities(document.pages, (progress) => {
          run.progress({
            stage: 'detecting',
            progress: 75 + (progress * 0.10), // 75-85%
            message: t('progress.detectingWithLLMProgress', { progress }),
          });
        }));
        log.info('ML entities detected', { count: llmEntities.length });

        allEntities.push(...llmEntities);

        await llmDetector.dispose();
      } catch (error) {
        log.error('ML detection failed, continuing with regex only', error);
        run.progress({
          stage: 'detecting',
          progress: 85,
          message: t('progress.llmDetectionFailedFallback'),
        });
      }
    }

    // Deduplicate entities
    run.progress({
      stage: 'aggregating',
      progress: 90,
      message: t('progress.removingDuplicates'),
    });
    await nextPaint();

    const aggregator = new EntityAggregator();
    let entities = aggregator.deduplicateEntities(allEntities);
    const deduplicatedCount = entities.length;
    // Filter entities based on detection config
    entities = applyDefaultSelection(filterEntitiesByConfig(entities));
    log.info('Entities aggregated', { detected: allEntities.length, deduplicated: deduplicatedCount, filtered: entities.length });
    // Update document with detected entities
    document.allEntities = entities;

    // Assign entities to their respective pages
    for (const entity of entities) {
      const page = document.pages.find(p => p.pageNumber === entity.position.pageNumber);
      if (page) {
        page.entities.push(entity);
      }
    }

    run.progress({
      stage: 'complete',
      progress: 100,
      message: t('progress.foundEntities', { count: entities.length }),
    });

    run.check();
    setProcessedDocument(document);
    setStage('choose');
  };

  const processDocx = async (run: AnalysisRun, file: File) => {

    // Parse DOCX
    // Parsing takes the bar up to 60%; detection the rest
    const parser = new DocxParser((progress) => {
      run.progress({
        stage: 'parsing',
        progress: progress.progress * 0.6,
        message: t('progress.parsingText'),
      });
    });

    const docx = await timed(log, 'DOCX parsing', () => parser.parseDocx(file));
    log.info('DOCX parsed', { textChars: docx.fullText.length });

    const allEntities: DetectedEntity[] = [];

    // Detect entities using regex (includes predefined words)
    if (detectionConfig.useRegexPatterns) {
      run.progress({
        stage: 'detecting',
        progress: 60,
        message: t('progress.detectingSensitiveInfo'),
      });
      // Detection is synchronous, so let the progress paint first
      await nextPaint();

      // Without AI, pattern matching is most of the remaining work
      const end = detectionConfig.useMLModel ? 70 : 92;
      const detector = new RegexDetector();
      const regexEntities = await timed(log, 'Regex detection', () => detector.detectEntities(docx.fullText, fraction => {
        run.progress({ stage: 'detecting', progress: 60 + fraction * (end - 60), message: t('progress.detectingSensitiveInfo') });
      }));
      log.info('Regex entities detected', { count: regexEntities.length });
      allEntities.push(...regexEntities);
    }

    // Detect entities using LLM if enabled
    if (detectionConfig.useMLModel) {
      try {
        run.progress({
          stage: 'loading_model',
          progress: 70,
          message: t('progress.loadingLLMModel'),
        });

        const llmDetector = new LLMDetector();
        await llmDetector.initialize((progress, message) => {
          run.progress({
            stage: 'loading_model',
            progress: 70 + (progress * 0.15), // 70-85%
            message,
          });
        });

        run.progress({
          stage: 'detecting',
          progress: 85,
          message: t('progress.detectingWithLLM'),
        });

        const llmEntities = await llmDetector.detectEntitiesInText(docx.fullText, (progress) => {
          run.progress({
            stage: 'detecting',
            progress: 85 + (progress * 0.10), // 85-95%
            message: t('progress.detectingWithLLMProgress', { progress }),
          });
        });
        log.info('ML entities detected', { count: llmEntities.length });
        allEntities.push(...llmEntities);
        await llmDetector.dispose();
      } catch (error) {
        log.error('ML detection failed, continuing with regex only', error);
        run.progress({
          stage: 'detecting',
          progress: 95,
          message: t('progress.llmDetectionFailedFallback'),
        });
      }
    }

    // Deduplicate entities
    const aggregator = new EntityAggregator();
    let entities = aggregator.deduplicateEntities(allEntities);
    const deduplicatedCount = entities.length;
    // Filter entities based on detection config
    entities = applyDefaultSelection(filterEntitiesByConfig(entities));
    log.info('Entities aggregated', { detected: allEntities.length, deduplicated: deduplicatedCount, filtered: entities.length });
    // Update DOCX with detected entities
    docx.allEntities = entities;

    run.progress({
      stage: 'complete',
      progress: 100,
      message: t('progress.foundEntities', { count: entities.length }),
    });

    run.check();
    setProcessedDocx(docx);
    setStage('choose');
  };

  const filterEntitiesByConfig = (entities: DetectedEntity[]): DetectedEntity[] => {
    return entities.filter(entity => {
      // Filter by enabled entity types
      if (!detectionConfig.enabledEntityTypes.includes(entity.entityType)) {
        return false;
      }

      return entity.confidence >= getMinimumConfidence(detectionConfig.aggressiveness, detectionConfig.confidenceThresholds);
    });
  };

  return (
    <div className="min-h-screen bg-paper dark:bg-gray-900">
      {/* Header */}
      {/* In the macOS app the header doubles as the title bar: it stays on top, leaves room
          for the window buttons, and drags the window */}
      <header
        className={`sticky top-0 z-40 bg-paper/80 dark:bg-gray-900/80 backdrop-blur-md backdrop-saturate-150 border-b border-gray-200/70 dark:border-gray-800 ${isDesktop ? 'pl-16' : ''}`}
        data-tauri-drag-region
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 sm:py-4" data-tauri-drag-region>
          <div className="flex items-center justify-between" data-tauri-drag-region>
            <div className="flex items-center gap-2 sm:gap-3" data-tauri-drag-region>
              <svg
                className="w-6 h-6 sm:w-7 sm:h-7 text-ink dark:text-paper"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                />
              </svg>
              <h1 className="text-lg sm:text-xl font-semibold tracking-tight text-gray-900 dark:text-white">SafeRedact</h1>
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
              {/* Desktop buttons */}
              <a
                href="https://buymeacoffee.com/zhendong"
                target="_blank"
                rel="noopener noreferrer"
                className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-2 text-xs font-medium hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-200/60 dark:hover:bg-gray-800 rounded-full transition-colors"
                title={t('header.buyMeCoffee')}
              >
                <svg className="w-4 h-4 text-accent" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20.216 6.415l-.132-.666c-.119-.598-.388-1.163-1.001-1.379-.197-.069-.42-.098-.57-.241-.152-.143-.196-.366-.231-.572-.065-.378-.125-.756-.192-1.133-.057-.325-.102-.69-.25-.987-.195-.4-.597-.634-.996-.788a5.723 5.723 0 00-.626-.194c-1-.263-2.05-.36-3.077-.416a25.834 25.834 0 00-3.7.062c-.915.083-1.88.184-2.75.5-.318.116-.646.256-.888.501-.297.302-.393.77-.177 1.146.154.267.415.456.692.58.36.162.737.284 1.123.366 1.075.238 2.189.331 3.287.37 1.218.05 2.437.01 3.65-.118.299-.033.598-.073.896-.119.352-.054.578-.513.474-.834-.124-.383-.457-.531-.834-.473-.466.074-.96.108-1.382.146-1.177.08-2.358.082-3.536.006a22.228 22.228 0 01-1.157-.107c-.086-.01-.18-.025-.258-.036-.243-.036-.484-.08-.724-.13-.111-.027-.111-.185 0-.212h.005c.277-.06.557-.108.838-.147h.002c.131-.009.263-.032.394-.048a25.076 25.076 0 013.426-.12c.674.019 1.347.067 2.017.144l.228.031c.267.04.533.088.798.145.392.085.895.113 1.07.542.055.137.08.288.111.431l.319 1.484a.237.237 0 01-.199.284h-.003c-.037.006-.075.01-.112.015a36.704 36.704 0 01-4.743.295 37.059 37.059 0 01-4.699-.304c-.14-.017-.293-.042-.417-.06-.326-.048-.649-.108-.973-.161-.393-.065-.768-.032-1.123.161-.29.16-.527.404-.675.701-.154.316-.199.66-.267 1-.069.34-.176.707-.135 1.056.087.753.613 1.365 1.37 1.502a39.69 39.69 0 0011.343.376.483.483 0 01.535.53l-.071.697-1.018 9.907c-.041.41-.047.832-.125 1.237-.122.637-.553 1.028-1.182 1.171-.577.131-1.165.2-1.756.205-.656.004-1.31-.025-1.966-.022-.699.004-1.556-.06-2.095-.58-.475-.458-.54-1.174-.605-1.793l-.731-7.013-.322-3.094c-.037-.351-.286-.695-.678-.678-.336.015-.718.3-.678.679l.228 2.185.949 9.112c.147 1.344 1.174 2.068 2.446 2.272.742.12 1.503.144 2.257.156.966.016 1.942.053 2.892-.122 1.408-.258 2.465-1.198 2.616-2.657.34-3.332.683-6.663 1.024-9.995l.215-2.087a.484.484 0 01.39-.426c.402-.078.787-.212 1.074-.518.455-.488.546-1.124.385-1.766zm-1.478.772c-.145.137-.363.201-.578.233-2.416.359-4.866.54-7.308.46-1.748-.06-3.477-.254-5.207-.498-.17-.024-.353-.055-.47-.18-.22-.236-.111-.71-.054-.995.052-.26.152-.609.463-.646.484-.057 1.046.148 1.526.22.577.088 1.156.165 1.737.226 2.48.253 4.993.335 7.486.196.45-.025.9-.075 1.346-.155.299-.053.59-.11.794.265.102.186.078.446-.01.628-.061.127-.164.249-.325.326z"/>
                </svg>
                <span className="hidden md:inline">{t('header.buyMeCoffee')}</span>
              </a>
              <button
                onClick={toggleLanguage}
                className="hidden sm:block px-2.5 py-2 text-xs font-medium hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-200/60 dark:hover:bg-gray-800 rounded-full transition-colors"
                aria-label={t('header.language')}
                title={t('header.language')}
              >
                {language === 'en' ? '中文' : 'EN'}
              </button>
              <button
                onClick={toggleTheme}
                className="hidden sm:block p-2 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-200/60 dark:hover:bg-gray-800 rounded-full transition-colors"
                aria-label={t('header.toggleDarkMode')}
              >
                {theme === 'light' ? (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                  </svg>
                )}
              </button>
              <button
                onClick={() => setIsSettingsOpen(true)}
                className="hidden sm:block p-2 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-200/60 dark:hover:bg-gray-800 rounded-full transition-colors"
              >
                {t('header.settings')}
              </button>
              <button
                onClick={() => setIsAboutOpen(true)}
                className="hidden sm:block p-2 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-200/60 dark:hover:bg-gray-800 rounded-full transition-colors"
              >
                {t('header.about')}
              </button>

              {/* Mobile menu button */}
              <button
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className="sm:hidden p-2 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-200/60 dark:hover:bg-gray-800 rounded-full transition-colors"
                aria-label={t('header.menu')}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
            </div>
          </div>

          {/* Mobile dropdown menu */}
          {isMobileMenuOpen && (
            <div className="sm:hidden border-t border-gray-200 dark:border-gray-700 py-2 px-4">
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => {
                    toggleLanguage();
                    setIsMobileMenuOpen(false);
                  }}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-200/60 dark:hover:bg-gray-800 rounded-full transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
                  </svg>
                  {language === 'en' ? '中文' : 'English'}
                </button>
                <button
                  onClick={() => {
                    toggleTheme();
                    setIsMobileMenuOpen(false);
                  }}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-200/60 dark:hover:bg-gray-800 rounded-full transition-colors"
                >
                  {theme === 'light' ? (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                      </svg>
                      {t('header.darkMode')}
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                      </svg>
                      {t('header.lightMode')}
                    </>
                  )}
                </button>
                <button
                  onClick={() => {
                    setIsSettingsOpen(true);
                    setIsMobileMenuOpen(false);
                  }}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-200/60 dark:hover:bg-gray-800 rounded-full transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  {t('header.settings')}
                </button>
                <button
                  onClick={() => {
                    setIsAboutOpen(true);
                    setIsMobileMenuOpen(false);
                  }}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-200/60 dark:hover:bg-gray-800 rounded-full transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {t('header.about')}
                </button>
                <a
                  href="https://buymeacoffee.com/zhendong"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-200/60 dark:hover:bg-gray-800 rounded-full transition-colors"
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  <svg className="w-4 h-4 text-accent" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M20.216 6.415l-.132-.666c-.119-.598-.388-1.163-1.001-1.379-.197-.069-.42-.098-.57-.241-.152-.143-.196-.366-.231-.572-.065-.378-.125-.756-.192-1.133-.057-.325-.102-.69-.25-.987-.195-.4-.597-.634-.996-.788a5.723 5.723 0 00-.626-.194c-1-.263-2.05-.36-3.077-.416a25.834 25.834 0 00-3.7.062c-.915.083-1.88.184-2.75.5-.318.116-.646.256-.888.501-.297.302-.393.77-.177 1.146.154.267.415.456.692.58.36.162.737.284 1.123.366 1.075.238 2.189.331 3.287.37 1.218.05 2.437.01 3.65-.118.299-.033.598-.073.896-.119.352-.054.578-.513.474-.834-.124-.383-.457-.531-.834-.473-.466.074-.96.108-1.382.146-1.177.08-2.358.082-3.536.006a22.228 22.228 0 01-1.157-.107c-.086-.01-.18-.025-.258-.036-.243-.036-.484-.08-.724-.13-.111-.027-.111-.185 0-.212h.005c.277-.06.557-.108.838-.147h.002c.131-.009.263-.032.394-.048a25.076 25.076 0 013.426-.12c.674.019 1.347.067 2.017.144l.228.031c.267.04.533.088.798.145.392.085.895.113 1.07.542.055.137.08.288.111.431l.319 1.484a.237.237 0 01-.199.284h-.003c-.037.006-.075.01-.112.015a36.704 36.704 0 01-4.743.295 37.059 37.059 0 01-4.699-.304c-.14-.017-.293-.042-.417-.06-.326-.048-.649-.108-.973-.161-.393-.065-.768-.032-1.123.161-.29.16-.527.404-.675.701-.154.316-.199.66-.267 1-.069.34-.176.707-.135 1.056.087.753.613 1.365 1.37 1.502a39.69 39.69 0 0011.343.376.483.483 0 01.535.53l-.071.697-1.018 9.907c-.041.41-.047.832-.125 1.237-.122.637-.553 1.028-1.182 1.171-.577.131-1.165.2-1.756.205-.656.004-1.31-.025-1.966-.022-.699.004-1.556-.06-2.095-.58-.475-.458-.54-1.174-.605-1.793l-.731-7.013-.322-3.094c-.037-.351-.286-.695-.678-.678-.336.015-.718.3-.678.679l.228 2.185.949 9.112c.147 1.344 1.174 2.068 2.446 2.272.742.12 1.503.144 2.257.156.966.016 1.942.053 2.892-.122 1.408-.258 2.465-1.198 2.616-2.657.34-3.332.683-6.663 1.024-9.995l.215-2.087a.484.484 0 01.39-.426c.402-.078.787-.212 1.074-.518.455-.488.546-1.124.385-1.766zm-1.478.772c-.145.137-.363.201-.578.233-2.416.359-4.866.54-7.308.46-1.748-.06-3.477-.254-5.207-.498-.17-.024-.353-.055-.47-.18-.22-.236-.111-.71-.054-.995.052-.26.152-.609.463-.646.484-.057 1.046.148 1.526.22.577.088 1.156.165 1.737.226 2.48.253 4.993.335 7.486.196.45-.025.9-.075 1.346-.155.299-.053.59-.11.794.265.102.186.078.446-.01.628-.061.127-.164.249-.325.326z"/>
                  </svg>
                  {t('header.buyMeCoffee')}
                </a>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-8">
        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <div className="flex items-start justify-between gap-4">
              <p className="text-sm text-red-600 dark:text-red-400 flex-1">{error}</p>
              <a
                href={`https://github.com/zhendong/safe-redact/issues/new?body=${encodeURIComponent(`**Error Description:**\n\n${error}\n\n**Steps to Reproduce:**\n1. \n\n**Expected Behavior:**\n\n**Actual Behavior:**\n`)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-900/40 hover:bg-red-200 dark:hover:bg-red-900/60 border border-red-300 dark:border-red-700 rounded-md transition-colors"
                title="Report this error on GitHub"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
                </svg>
                {t('errorBanner.reportIssue')}
              </a>
            </div>
          </div>
        )}

        {stage === 'upload' && (
          <FileUpload onFileSelect={handleFileSelect} />
        )}

        {stage === 'choose' && (processedDocument || processedDocx) && (
          <ChooseEntities
            fileName={selectedFile?.name ?? ''}
            entities={processedDocument?.allEntities ?? processedDocx?.allEntities ?? []}
            onSetStatus={setEntityStatus}
            onBack={() => void handleLeaveReview()}
            onUndo={handleUndo}
            canUndo={undoStack.length > 0}
            onContinue={() => setStage('review')}
          />
        )}

        {(stage === 'processing' || stage === 'redacting') && (
          <div className="flex flex-col items-center justify-center min-h-[400px]">
            <h2 className="font-serif text-3xl font-normal tracking-tight text-gray-900 dark:text-white mb-8">
              {stage === 'processing' ? t('progress.processing') : t('progress.redacting')} {selectedFile?.name}
            </h2>
            <ProgressIndicator stage={processingStage} />
            {stage === 'processing' && (
              <button onClick={handleCancelAnalysis} className="btn-ghost mt-8 px-6 py-2 text-sm">
                {t('progress.cancel')}
              </button>
            )}
          </div>
        )}

        {stage === 'complete' && (
          <div className="flex flex-col items-center justify-center min-h-[400px]">
            <div className="text-center max-w-md">
              <div className="mb-6">
                <div className="inline-flex items-center justify-center w-16 h-16 bg-ink dark:bg-paper rounded-full mb-4">
                  <svg className="w-8 h-8 text-paper dark:text-ink" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h2 className="font-serif text-4xl font-normal tracking-tight text-gray-900 dark:text-white mb-3">
                  {t('complete.title')}
                </h2>
                <p className="text-gray-600 dark:text-gray-300">
                  {processingStage.message}
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                  {t(fileType === 'image' ? 'complete.imageDownloaded' : fileType === 'docx' ? 'complete.docxDownloaded' : 'complete.downloaded')}
                </p>
                <p className={`text-sm mt-3 ${fileType !== 'image' && !detectionConfig.sanitizeDocument
                  ? 'px-4 py-3 rounded-lg bg-[#f6ece4] dark:bg-[#8a5233]/20 text-[#8a5233] dark:text-[#e8c9b4]'
                  : 'text-gray-500 dark:text-gray-400'}`}
                >
                  {t(fileType === 'image'
                    ? 'complete.imageMetadataRemoved'
                    : detectionConfig.sanitizeDocument ? 'complete.metadataRemoved' : 'complete.metadataKept')}
                </p>
              </div>
              <div className="flex flex-col gap-3">
                <button
                  onClick={handleBackToUpload}
                  className="btn-primary px-6 py-3"
                >
                  {t('complete.processAnother')}
                </button>
                <button
                  onClick={() => setStage('review')}
                  className="btn-ghost px-6 py-3"
                >
                  {t('complete.backToReview')}
                </button>
              </div>
            </div>
          </div>
        )}

        {stage === 'review' && (processedDocument || processedDocx) && (
          <div className="space-y-3 sm:space-y-4">
              {fileType === 'image' && (
                <p role="note" className="px-4 py-3 rounded-lg bg-[#f6ece4] dark:bg-[#8a5233]/20 text-sm text-[#8a5233] dark:text-[#e8c9b4]">
                  {t('common.imageOcrNotice')}
                </p>
              )}
              {/* Review Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-6">
                <div className="flex items-center gap-2 sm:gap-4 min-w-0 flex-1">
                  <button
                    onClick={() => setStage('choose')}
                    className="btn-ghost h-10 px-3 sm:px-4 text-sm flex-shrink-0 whitespace-nowrap"
                  >
                    {t('review.backToChoose')}
                  </button>
                  <button
                    onClick={handleUndo}
                    disabled={undoStack.length === 0}
                    title={t('review.undoTitle')}
                    className="btn-ghost h-10 px-3 sm:px-4 text-sm flex-shrink-0 whitespace-nowrap disabled:opacity-40"
                  >
                    {t('review.undo')}
                  </button>
                  <div className="min-w-0">
                    <h2 className="font-serif text-xl sm:text-3xl font-normal tracking-tight text-gray-900 dark:text-white truncate">
                      {selectedFile?.name}
                    </h2>
                    <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-300">
                      {processedDocument
                        ? t('review.pagesEntities', { pages: processedDocument.pageCount, entities: processedDocument.allEntities.length })
                        : t('review.entities', { count: processedDocx?.allEntities.length ?? 0 })
                      }
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:gap-3 flex-shrink-0">
                  {/* Images are always exported without metadata, so the toggle only applies to PDF and DOCX */}
                  {fileType !== 'image' && (
                    <label
                      className="inline-flex items-center gap-1.5 text-xs sm:text-sm text-gray-700 dark:text-gray-300 cursor-pointer whitespace-nowrap"
                      title={t('settings.stripMetadataDesc')}
                    >
                      <input
                        type="checkbox"
                        checked={detectionConfig.sanitizeDocument}
                        onChange={(e) => handleConfigChange({ ...detectionConfig, sanitizeDocument: e.target.checked })}
                        className="rounded border-gray-300 dark:border-gray-600"
                      />
                      {t('review.stripMetadata')}
                    </label>
                  )}
                  {/* Inline beside the buttons so the review area doesn't shift when it appears */}
                  {hiddenConfirmedCount > 0 && (
                    <span
                      role="status"
                      title={t('review.hiddenSelected', { count: hiddenConfirmedCount })}
                      aria-label={t('review.hiddenSelected', { count: hiddenConfirmedCount })}
                      className="px-2.5 py-1 rounded-full bg-[#f6ece4] dark:bg-[#8a5233]/20 text-xs text-[#8a5233] dark:text-[#e8c9b4] whitespace-nowrap"
                    >
                      {t('review.hiddenSelectedShort', { count: hiddenConfirmedCount })}
                    </span>
                  )}
                  <button
                    onClick={() => setIsMetadataModalOpen(true)}
                    className="btn-ghost h-10 px-3 sm:px-4 text-xs sm:text-sm gap-1.5 sm:gap-2 whitespace-nowrap"
                  >
                    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="hidden sm:inline">{t('review.reviewMetadata')}</span>
                    <span className="sm:hidden">{t('review.metadata')}</span>
                  </button>
                  <button
                    className="btn-primary h-10 px-4 sm:px-6 text-xs sm:text-sm whitespace-nowrap"
                    onClick={handleApplyRedactions}
                    disabled={confirmedCount === 0}
                  >
                    <span className="hidden sm:inline">{t('review.applyRedactions', { count: confirmedCount })}</span>
                    <span className="sm:hidden">{t('review.apply', { count: confirmedCount })}</span>
                  </button>
                </div>
              </div>

              <p className="text-sm text-gray-600 dark:text-gray-300">{t('review.checkHint')}</p>

              {/* Filters Section - Desktop only (mobile filters are in EntityList) */}
              <div className="hidden lg:block surface rounded-xl p-4">
                <FilterBar
                  entities={processedDocument?.allEntities || processedDocx?.allEntities || []}
                  enabledTypes={enabledTypes}
                  setEnabledTypes={setEnabledTypes}
                  showHighConfidence={showHighConfidence}
                  setShowHighConfidence={setShowHighConfidence}
                  showMediumConfidence={showMediumConfidence}
                  setShowMediumConfidence={setShowMediumConfidence}
                  showLowConfidence={showLowConfidence}
                  setShowLowConfidence={setShowLowConfidence}
                  detectionConfig={detectionConfig}
                  entityCounts={entityCounts}
                  confidenceCounts={confidenceCounts}
                  filteredCount={filteredEntities.length}
                  confirmedCount={visibleConfirmedCount}
                />
              </div>

              {/* Mobile View Switcher */}
              <MobileViewSwitcher
                viewMode={viewMode}
                onViewModeChange={setViewMode}
                entityCount={filteredEntities.length}
              />

              {/* Review Interface */}
              <div className="flex flex-col lg:flex-row gap-3 lg:gap-6" style={{ height: 'calc(100vh - 200px)', minHeight: '600px' }}>
                {/* Entity List Panel - Desktop only */}
                <div className="hidden lg:flex lg:flex-initial lg:h-auto lg:w-96 lg:flex-shrink-0 surface rounded-xl overflow-hidden flex-col">
                  <EntityList
                    entities={filteredEntities}
                    selectedEntityId={selectedEntityId}
                    onEntitySelect={handleEntitySelect}
                    onEntityConfirm={handleEntityConfirm}
                    onEntityReject={handleEntityReject}
                    detectionConfig={detectionConfig}
                    enabledTypes={enabledTypes}
                    setEnabledTypes={setEnabledTypes}
                    showHighConfidence={showHighConfidence}
                    setShowHighConfidence={setShowHighConfidence}
                    showMediumConfidence={showMediumConfidence}
                    setShowMediumConfidence={setShowMediumConfidence}
                    showLowConfidence={showLowConfidence}
                    setShowLowConfidence={setShowLowConfidence}
                    entityCounts={entityCounts}
                    confidenceCounts={confidenceCounts}
                    filteredCount={filteredEntities.length}
                    confirmedCount={visibleConfirmedCount}
                    />
                </div>

                {/* Mobile Entity List - Only visible when viewMode is 'entities' */}
                <div className={`lg:hidden flex-1 surface rounded-xl overflow-hidden flex flex-col ${viewMode === 'document' ? 'hidden' : ''}`}>
                  <EntityList
                    entities={filteredEntities}
                    selectedEntityId={selectedEntityId}
                    onEntitySelect={handleEntitySelect}
                    onEntityConfirm={handleEntityConfirm}
                    onEntityReject={handleEntityReject}
                    detectionConfig={detectionConfig}
                    enabledTypes={enabledTypes}
                    setEnabledTypes={setEnabledTypes}
                    showHighConfidence={showHighConfidence}
                    setShowHighConfidence={setShowHighConfidence}
                    showMediumConfidence={showMediumConfidence}
                    setShowMediumConfidence={setShowMediumConfidence}
                    showLowConfidence={showLowConfidence}
                    setShowLowConfidence={setShowLowConfidence}
                    entityCounts={entityCounts}
                    confidenceCounts={confidenceCounts}
                    filteredCount={filteredEntities.length}
                    confirmedCount={visibleConfirmedCount}
                      compactCards={true}
                  />
                </div>

              {/* Document Viewer - PDF or DOCX */}
              <div className={`flex-1 surface rounded-xl overflow-hidden flex flex-col min-h-[400px] ${viewMode === 'entities' ? 'hidden lg:flex' : ''}`}
              >
                {processedDocument && (
                  <>
                    <div className="flex-1 overflow-hidden">
                      <DocumentViewer
                        document={processedDocument}
                        currentPage={currentPage}
                        selectedEntityId={selectedEntityId}
                        onEntityClick={handleEntitySelect}
                        onManualEntityCreate={handleManualEntityCreate}
                        onPageChange={setCurrentPage}
                      />
                    </div>

                    {/* Page Navigation for PDF */}
                    <div className="flex-shrink-0 border-t border-gray-200 dark:border-gray-700 p-3 sm:p-4 flex items-center justify-center gap-2 sm:gap-4">
                      <button
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        className="btn-ghost min-w-[44px] min-h-[44px] px-4 sm:px-4 py-2.5 sm:py-2 text-sm active:scale-95"
                      >
                        <span className="hidden sm:inline">{t('review.previousFull')}</span>
                        <span className="sm:hidden">{t('review.previousShort')}</span>
                      </button>
                      <span className="text-xs sm:text-sm text-gray-700 dark:text-gray-300 font-medium">
                        {t('review.pageOf', { current: currentPage, total: processedDocument.pageCount })}
                      </span>
                      <button
                        onClick={() => setCurrentPage(p => Math.min(processedDocument.pageCount, p + 1))}
                        disabled={currentPage === processedDocument.pageCount}
                        className="btn-ghost min-w-[44px] min-h-[44px] px-4 sm:px-4 py-2.5 sm:py-2 text-sm active:scale-95"
                      >
                        <span className="hidden sm:inline">{t('review.nextFull')}</span>
                        <span className="sm:hidden">{t('review.nextShort')}</span>
                      </button>
                    </div>
                  </>
                )}

                {processedDocx && (
                  <DocxViewer
                    htmlContent={processedDocx.htmlContent}
                    fullText={processedDocx.fullText}
                    entities={filteredEntities}
                    selectedEntityId={selectedEntityId}
                    onEntityClick={handleEntitySelect}
                    onTextSelectionRedact={handleDocxTextRedact}
                  />
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Settings Panel */}
      <SettingsPanel
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        config={detectionConfig}
        onConfigChange={handleConfigChange}
      />

      {/* About Dialog */}
      {isAboutOpen && (
        <div className="fixed inset-0 bg-ink/40 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setIsAboutOpen(false)}>
          <div
            ref={aboutDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="about-dialog-title"
            tabIndex={-1}
            className="surface rounded-2xl shadow-[0_24px_60px_-28px_rgba(28,27,25,0.35)] p-7 max-w-md w-full mx-4 focus:outline-none"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-start mb-4">
              <h2 id="about-dialog-title" className="font-serif text-3xl font-normal tracking-tight text-gray-900 dark:text-white">{t('about.title')}</h2>
              <button
                onClick={() => setIsAboutOpen(false)}
                aria-label={t('common.close')}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              <div className="flex items-center gap-3 mb-6">
                <svg
                  className="w-12 h-12 text-ink dark:text-paper"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                  />
                </svg>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">SafeRedact</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-300">{t('about.version', { version: packageJson.version })}</p>
                </div>
              </div>

              <p className="text-sm text-gray-600 dark:text-gray-300">
                {t('about.description')}
              </p>

              <div className="pt-4 mt-4 border-t border-gray-200 dark:border-gray-700">
                <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">{t('about.needHelp')}</h4>
                <a
                  href="https://github.com/zhendong/safe-redact/issues/new"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-primary gap-2 px-4 py-2 text-sm"
                >
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
                  </svg>
                  {t('about.reportIssue')}
                </a>
                <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                  {t('about.reportIssueDesc')}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Metadata Review Modal */}
      <MetadataReviewModal
        isOpen={isMetadataModalOpen}
        onClose={() => setIsMetadataModalOpen(false)}
        metadata={processedDocument?.metadata || processedDocx?.metadata}
        metadataScanFailed={processedDocument?.metadataScanFailed}
        hiddenContentReport={processedDocument?.hiddenContentReport || (processedDocx?.hiddenContentReport as any)}
        fileType={fileType || 'pdf'}
      />

    </div>
  );
}

export default App;
