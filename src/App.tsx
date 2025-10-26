import { useState, useEffect } from 'react';
import packageJson from '../package.json';
import { FileUpload } from '@/components/upload/FileUpload';
import { FilePreview } from '@/components/upload/FilePreview';
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
import { DocxViewer } from '@/components/viewer/DocxViewer';
import type { ProcessedDocument, ProcessedPage, ProcessingStage, DetectedEntity, BoundingBox, EntityType, DetectionConfig } from '@/lib/types';
import { EntityType as EntityTypeEnum } from '@/lib/types';
import { generateId } from '@/utils/validation';
import { STORAGE_KEYS, DEFAULT_CONFIDENCE_THRESHOLDS } from '@/utils/constants';
import { generateRedactedFilename } from '@/utils/file-utils';
import { useMemo } from 'react';
import { useTheme } from '@/contexts/ThemeContext';

type AppStage = 'upload' | 'preview' | 'processing' | 'review' | 'redacting' | 'complete';
type FileType = 'pdf' | 'docx';

function App() {
  const { theme, toggleTheme } = useTheme();
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
        return {
          ...parsed,
          sanitizeDocument: parsed.sanitizeDocument ?? false,
        };
      } catch (e) {
        console.error('Failed to parse saved config:', e);
      }
    }
    return {
      enabledEntityTypes: Object.values(EntityTypeEnum),
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
    if (!allEntities) return { high: 0, medium: 0, low: 0 };
    const highThreshold = detectionConfig?.confidenceThresholds.high ?? DEFAULT_CONFIDENCE_THRESHOLDS.high;
    const mediumThreshold = detectionConfig?.confidenceThresholds.medium ?? DEFAULT_CONFIDENCE_THRESHOLDS.medium;
    const lowThreshold = detectionConfig?.confidenceThresholds.low ?? DEFAULT_CONFIDENCE_THRESHOLDS.low;

    return {
      high: allEntities.filter((e) => e.confidence >= highThreshold).length,
      medium: allEntities.filter((e) => e.confidence >= mediumThreshold && e.confidence < highThreshold).length,
      low: allEntities.filter((e) => e.confidence >= lowThreshold && e.confidence < mediumThreshold).length,
    };
  }, [processedDocument, processedDocx, detectionConfig]);

  const filteredEntities = useMemo(() => {
    const allEntities = processedDocument?.allEntities || processedDocx?.allEntities;
    if (!allEntities) return [];
    return allEntities.filter((entity) => {
      // Filter by type
      if (!enabledTypes.has(entity.entityType)) return false;

      // Filter by confidence
      const highThreshold = detectionConfig?.confidenceThresholds.high ?? DEFAULT_CONFIDENCE_THRESHOLDS.high;
      const mediumThreshold = detectionConfig?.confidenceThresholds.medium ?? DEFAULT_CONFIDENCE_THRESHOLDS.medium;
      const lowThreshold = detectionConfig?.confidenceThresholds.low ?? DEFAULT_CONFIDENCE_THRESHOLDS.low;

      if (entity.confidence >= highThreshold && !showHighConfidence) return false;
      if (entity.confidence >= mediumThreshold && entity.confidence < highThreshold && !showMediumConfidence) return false;
      if (entity.confidence >= lowThreshold && entity.confidence < mediumThreshold && !showLowConfidence) return false;

      return true;
    });
  }, [processedDocument, processedDocx, enabledTypes, showHighConfidence, showMediumConfidence, showLowConfidence, detectionConfig]);

  const confirmedCount = useMemo(() => {
    return filteredEntities.filter((e) => e.status === 'confirmed').length;
  }, [filteredEntities]);

  // Save detection config to localStorage whenever it changes
  const handleConfigChange = (config: DetectionConfig) => {
    setDetectionConfig(config);
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(config));
  };

  const handleFileSelect = (file: File) => {
    setSelectedFile(file);
    // Detect file type
    const type: FileType = file.name.toLowerCase().endsWith('.docx') ? 'docx' : 'pdf';
    setFileType(type);
    setStage('preview');
    setError(null);
  };

  const handleRemoveFile = () => {
    setSelectedFile(null);
    setFileType(null);
    setProcessedDocument(null);
    setProcessedDocx(null);
    setStage('upload');
    setError(null);
  };

  const handleBackToUpload = () => {
    setSelectedFile(null);
    setFileType(null);
    setProcessedDocument(null);
    setProcessedDocx(null);
    setStage('upload');
    setError(null);
  };

  const handleEntitySelect = (entity: DetectedEntity) => {
    setSelectedEntityId(entity.id);
    setCurrentPage(entity.position.pageNumber);
    // On mobile, switch to document view when selecting an entity
    if (window.innerWidth < 1024) {
      setViewMode('document');
    }
  };

  const handleEntityConfirm = (entityId: string | string[]) => {
    const entityIds = Array.isArray(entityId) ? entityId : [entityId];

    if (processedDocument) {
      const updatedEntities = processedDocument.allEntities.map(e =>
        entityIds.includes(e.id) ? { ...e, status: 'confirmed' as const } : e
      );

      const updatedPages = processedDocument.pages.map(page => ({
        ...page,
        entities: page.entities.map(e =>
          entityIds.includes(e.id) ? { ...e, status: 'confirmed' as const } : e
        ),
      }));

      setProcessedDocument({
        ...processedDocument,
        allEntities: updatedEntities,
        pages: updatedPages,
      });
    } else if (processedDocx) {
      const updatedEntities = processedDocx.allEntities.map(e =>
        entityIds.includes(e.id) ? { ...e, status: 'confirmed' as const } : e
      );

      setProcessedDocx({
        ...processedDocx,
        allEntities: updatedEntities,
      });
    }
  };

  const handleEntityReject = (entityId: string | string[]) => {
    const entityIds = Array.isArray(entityId) ? entityId : [entityId];

    if (processedDocument) {
      const updatedEntities = processedDocument.allEntities.map(e =>
        entityIds.includes(e.id) ? { ...e, status: 'rejected' as const } : e
      );

      const updatedPages = processedDocument.pages.map(page => ({
        ...page,
        entities: page.entities.map(e =>
          entityIds.includes(e.id) ? { ...e, status: 'rejected' as const } : e
        ),
      }));

      setProcessedDocument({
        ...processedDocument,
        allEntities: updatedEntities,
        pages: updatedPages,
      });
    } else if (processedDocx) {
      const updatedEntities = processedDocx.allEntities.map(e =>
        entityIds.includes(e.id) ? { ...e, status: 'rejected' as const } : e
      );

      setProcessedDocx({
        ...processedDocx,
        allEntities: updatedEntities,
      });
    }
  };


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
              status: 'rejected',
              contextText: `Found on page ${page.pageNumber}`,
            };
            foundEntities.push(entity);
          }
        }
      } catch (error) {
        console.warn(`MuPDF search failed on page ${page.pageNumber}:`, error);
      }
    }

    return foundEntities;
  };

  // Check if two bounding boxes overlap
  const boundingBoxesOverlap = (box1: BoundingBox, box2: BoundingBox): boolean => {
    // Use a small threshold to account for floating point precision
    const threshold = 2;

    // Check if boxes are essentially the same or overlap significantly
    const xOverlap = Math.abs(box1.x - box2.x) < threshold;
    const yOverlap = Math.abs(box1.y - box2.y) < threshold;
    const widthSimilar = Math.abs(box1.width - box2.width) < threshold;
    const heightSimilar = Math.abs(box1.height - box2.height) < threshold;

    return xOverlap && yOverlap && widthSimilar && heightSimilar;
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
    }
  };

  const handleApplyRedactionsPdf = async () => {
    if (!processedDocument || !selectedFile) return;

    // Get confirmed entities
    const confirmedEntities = processedDocument.allEntities.filter(
      e => e.status === 'confirmed'
    );

    if (confirmedEntities.length === 0) {
      setError('No entities confirmed for redaction');
      return;
    }

    setStage('redacting');
    setError(null);

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
        engine.downloadRedactedPdf(result.pdfBlob, filename);

        setStage('complete');
        setProcessingStage({
          stage: 'complete',
          progress: 100,
          message: `Successfully redacted ${result.redactedCount} entities`,
        });
      } else {
        setError(result.error || 'Redaction failed');
        setStage('review');
      }
    } catch (err) {
      console.error('Redaction error:', err);
      setError(err instanceof Error ? err.message : 'An error occurred during redaction');
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
      setError('No entities confirmed for redaction');
      return;
    }

    setStage('redacting');
    setError(null);

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
        redactor.downloadRedactedDocx(result.pdfBlob, selectedFile.name);

        setStage('complete');
        setProcessingStage({
          stage: 'complete',
          progress: 100,
          message: `Successfully redacted ${result.redactedCount} entities`,
        });
      } else {
        setError(result.error || 'Redaction failed');
        setStage('review');
      }
    } catch (err) {
      console.error('Redaction error:', err);
      setError(err instanceof Error ? err.message : 'An error occurred during redaction');
      setStage('review');
    }
  };

  const handleStartAnalysis = async () => {
    if (!selectedFile || !fileType) return;

    setStage('processing');
    setError(null);

    try {
      if (fileType === 'pdf') {
        await processPdf();
      } else {
        await processDocx();
      }
    } catch (err) {
      console.error('Processing error:', err);
      setError(err instanceof Error ? err.message : 'An error occurred during processing');
      setStage('preview');
    }
  };

  const processPdf = async () => {
    if (!selectedFile) return;

    // Parse PDF
    const parser = new PdfParser((progress: ParseProgress) => {
      setProcessingStage({
        stage: progress.stage === 'loading' ? 'parsing' : progress.stage,
        progress: progress.progress,
        message: progress.message,
      });
    });

    const document = await parser.parsePdf(selectedFile);

    const allEntities: DetectedEntity[] = [];

    // Detect entities using regex (includes predefined words)
    if (detectionConfig.useRegexPatterns) {
      setProcessingStage({
        stage: 'detecting',
        progress: 50,
        message: 'Detecting sensitive information...',
      });

      const detector = new RegexDetector();
      const regexEntities = await detector.detectEntities(document.pages);
      allEntities.push(...regexEntities);
    }

    // Detect entities using LLM if enabled
    if (detectionConfig.useMLModel) {
      try {
        setProcessingStage({
          stage: 'loading_model',
          progress: 60,
          message: 'Loading LLM model...',
        });

        const llmDetector = new LLMDetector();
        await llmDetector.initialize((progress, message) => {
          setProcessingStage({
            stage: 'loading_model',
            progress: 60 + (progress * 0.15), // 60-75%
            message,
          });
        });

        setProcessingStage({
          stage: 'detecting',
          progress: 75,
          message: 'Detecting entities with LLM...',
        });

        // Use page-based detection for PDFs with mupdf positioning
        const llmEntities = await llmDetector.detectEntities(document.pages, (progress) => {
          setProcessingStage({
            stage: 'detecting',
            progress: 75 + (progress * 0.10), // 75-85%
            message: `Detecting entities with LLM... ${progress}%`,
          });
        });

        allEntities.push(...llmEntities);

        await llmDetector.dispose();
      } catch (error) {
        console.error('LLM detection failed, continuing with regex only:', error);
        setProcessingStage({
          stage: 'detecting',
          progress: 85,
          message: 'LLM detection failed, using regex patterns only...',
        });
      }
    }

    // Deduplicate entities
    setProcessingStage({
      stage: 'aggregating',
      progress: 90,
      message: 'Removing duplicates...',
    });

    console.debug("all detected entities %s", JSON.stringify(allEntities));
    const aggregator = new EntityAggregator();
    let entities = aggregator.deduplicateEntities(allEntities);
    console.debug("deduplicated entities %s", JSON.stringify(entities));
    // Filter entities based on detection config
    entities = filterEntitiesByConfig(entities);
    console.debug("filtered entities %s", JSON.stringify(entities));
    // Update document with detected entities
    document.allEntities = entities;

    // Assign entities to their respective pages
    for (const entity of entities) {
      const page = document.pages.find(p => p.pageNumber === entity.position.pageNumber);
      if (page) {
        page.entities.push(entity);
      }
    }

    setProcessingStage({
      stage: 'complete',
      progress: 100,
      message: `Found ${entities.length} entities`,
    });

    setProcessedDocument(document);
    setStage('review');
  };

  const processDocx = async () => {
    if (!selectedFile) return;

    // Parse DOCX
    const parser = new DocxParser((progress) => {
      setProcessingStage({
        stage: progress.stage as any,
        progress: progress.progress,
        message: progress.message,
      });
    });

    const docx = await parser.parseDocx(selectedFile);

    const allEntities: DetectedEntity[] = [];

    // Detect entities using regex (includes predefined words)
    if (detectionConfig.useRegexPatterns) {
      setProcessingStage({
        stage: 'detecting',
        progress: 60,
        message: 'Detecting sensitive information...',
      });

      const detector = new RegexDetector();
      const regexEntities = await detector.detectEntities(docx.fullText);
      allEntities.push(...regexEntities);
    }

    // Detect entities using LLM if enabled
    if (detectionConfig.useMLModel) {
      try {
        setProcessingStage({
          stage: 'loading_model',
          progress: 70,
          message: 'Loading LLM model...',
        });

        const llmDetector = new LLMDetector();
        await llmDetector.initialize((progress, message) => {
          setProcessingStage({
            stage: 'loading_model',
            progress: 70 + (progress * 0.15), // 70-85%
            message,
          });
        });

        setProcessingStage({
          stage: 'detecting',
          progress: 85,
          message: 'Detecting entities with LLM...',
        });

        const llmEntities = await llmDetector.detectEntitiesInChunks(docx.fullText, 512, (progress) => {
          setProcessingStage({
            stage: 'detecting',
            progress: 85 + (progress * 0.10), // 85-95%
            message: `Detecting entities with LLM... ${progress}%`,
          });
        });
        console.log(JSON.stringify(llmEntities));
        // TODO: Convert simplified entities to DetectedEntity format
        // allEntities.push(...llmEntities);
        console.log(JSON.stringify(allEntities));
        await llmDetector.dispose();
      } catch (error) {
        console.error('LLM detection failed, continuing with regex only:', error);
        setProcessingStage({
          stage: 'detecting',
          progress: 95,
          message: 'LLM detection failed, using regex patterns only...',
        });
      }
    }

    // Deduplicate entities
    const aggregator = new EntityAggregator();
    let entities = aggregator.deduplicateEntities(allEntities);
    console.log("deduplicated entities %s", JSON.stringify(entities));
    // Filter entities based on detection config
    entities = filterEntitiesByConfig(entities);
    console.log("filtered entities %s", JSON.stringify(entities));
    // Update DOCX with detected entities
    docx.allEntities = entities;

    setProcessingStage({
      stage: 'complete',
      progress: 100,
      message: `Found ${entities.length} entities`,
    });

    setProcessedDocx(docx);
    setStage('review');
  };

  const filterEntitiesByConfig = (entities: DetectedEntity[]): DetectedEntity[] => {
    return entities.filter(entity => {
      // Filter by enabled entity types
      if (!detectionConfig.enabledEntityTypes.includes(entity.entityType)) {
        return false;
      }

      // Filter by confidence based on aggressiveness
      if (detectionConfig.aggressiveness === 'conservative') {
        return entity.confidence >= detectionConfig.confidenceThresholds.high;
      } else if (detectionConfig.aggressiveness === 'balanced') {
        return entity.confidence >= detectionConfig.confidenceThresholds.medium;
      } else {
        // aggressive
        return entity.confidence >= detectionConfig.confidenceThresholds.low;
      }
    });
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 sm:py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 sm:gap-3">
              <svg
                className="w-6 h-6 sm:w-8 sm:h-8 text-blue-600"
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
              <h1 className="text-lg sm:text-2xl font-bold text-gray-900 dark:text-white">SafeRedact</h1>
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
              {/* Desktop buttons */}
              <a
                href="https://buymeacoffee.com/zhendong"
                target="_blank"
                rel="noopener noreferrer"
                className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 bg-yellow-400 hover:bg-yellow-500 text-gray-900 font-medium rounded-md transition-colors text-xs"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20.216 6.415l-.132-.666c-.119-.598-.388-1.163-1.001-1.379-.197-.069-.42-.098-.57-.241-.152-.143-.196-.366-.231-.572-.065-.378-.125-.756-.192-1.133-.057-.325-.102-.69-.25-.987-.195-.4-.597-.634-.996-.788a5.723 5.723 0 00-.626-.194c-1-.263-2.05-.36-3.077-.416a25.834 25.834 0 00-3.7.062c-.915.083-1.88.184-2.75.5-.318.116-.646.256-.888.501-.297.302-.393.77-.177 1.146.154.267.415.456.692.58.36.162.737.284 1.123.366 1.075.238 2.189.331 3.287.37 1.218.05 2.437.01 3.65-.118.299-.033.598-.073.896-.119.352-.054.578-.513.474-.834-.124-.383-.457-.531-.834-.473-.466.074-.96.108-1.382.146-1.177.08-2.358.082-3.536.006a22.228 22.228 0 01-1.157-.107c-.086-.01-.18-.025-.258-.036-.243-.036-.484-.08-.724-.13-.111-.027-.111-.185 0-.212h.005c.277-.06.557-.108.838-.147h.002c.131-.009.263-.032.394-.048a25.076 25.076 0 013.426-.12c.674.019 1.347.067 2.017.144l.228.031c.267.04.533.088.798.145.392.085.895.113 1.07.542.055.137.08.288.111.431l.319 1.484a.237.237 0 01-.199.284h-.003c-.037.006-.075.01-.112.015a36.704 36.704 0 01-4.743.295 37.059 37.059 0 01-4.699-.304c-.14-.017-.293-.042-.417-.06-.326-.048-.649-.108-.973-.161-.393-.065-.768-.032-1.123.161-.29.16-.527.404-.675.701-.154.316-.199.66-.267 1-.069.34-.176.707-.135 1.056.087.753.613 1.365 1.37 1.502a39.69 39.69 0 0011.343.376.483.483 0 01.535.53l-.071.697-1.018 9.907c-.041.41-.047.832-.125 1.237-.122.637-.553 1.028-1.182 1.171-.577.131-1.165.2-1.756.205-.656.004-1.31-.025-1.966-.022-.699.004-1.556-.06-2.095-.58-.475-.458-.54-1.174-.605-1.793l-.731-7.013-.322-3.094c-.037-.351-.286-.695-.678-.678-.336.015-.718.3-.678.679l.228 2.185.949 9.112c.147 1.344 1.174 2.068 2.446 2.272.742.12 1.503.144 2.257.156.966.016 1.942.053 2.892-.122 1.408-.258 2.465-1.198 2.616-2.657.34-3.332.683-6.663 1.024-9.995l.215-2.087a.484.484 0 01.39-.426c.402-.078.787-.212 1.074-.518.455-.488.546-1.124.385-1.766zm-1.478.772c-.145.137-.363.201-.578.233-2.416.359-4.866.54-7.308.46-1.748-.06-3.477-.254-5.207-.498-.17-.024-.353-.055-.47-.18-.22-.236-.111-.71-.054-.995.052-.26.152-.609.463-.646.484-.057 1.046.148 1.526.22.577.088 1.156.165 1.737.226 2.48.253 4.993.335 7.486.196.45-.025.9-.075 1.346-.155.299-.053.59-.11.794.265.102.186.078.446-.01.628-.061.127-.164.249-.325.326z"/>
                </svg>
                <span className="hidden md:inline">Buy Me a Coffee</span>
              </a>
              <button
                onClick={toggleTheme}
                className="hidden sm:block p-2 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                aria-label="Toggle dark mode"
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
                className="hidden sm:block p-2 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                Settings
              </button>
              <button
                onClick={() => setIsAboutOpen(true)}
                className="hidden sm:block p-2 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                About
              </button>

              {/* Mobile menu button */}
              <button
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className="sm:hidden p-2 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                aria-label="Menu"
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
                    toggleTheme();
                    setIsMobileMenuOpen(false);
                  }}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                >
                  {theme === 'light' ? (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                      </svg>
                      Dark Mode
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                      </svg>
                      Light Mode
                    </>
                  )}
                </button>
                <button
                  onClick={() => {
                    setIsSettingsOpen(true);
                    setIsMobileMenuOpen(false);
                  }}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  Settings
                </button>
                <button
                  onClick={() => {
                    setIsAboutOpen(true);
                    setIsMobileMenuOpen(false);
                  }}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  About
                </button>
                <a
                  href="https://buymeacoffee.com/zhendong"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-3 py-2 text-sm bg-yellow-400 hover:bg-yellow-500 text-gray-900 font-medium rounded-lg transition-colors"
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M20.216 6.415l-.132-.666c-.119-.598-.388-1.163-1.001-1.379-.197-.069-.42-.098-.57-.241-.152-.143-.196-.366-.231-.572-.065-.378-.125-.756-.192-1.133-.057-.325-.102-.69-.25-.987-.195-.4-.597-.634-.996-.788a5.723 5.723 0 00-.626-.194c-1-.263-2.05-.36-3.077-.416a25.834 25.834 0 00-3.7.062c-.915.083-1.88.184-2.75.5-.318.116-.646.256-.888.501-.297.302-.393.77-.177 1.146.154.267.415.456.692.58.36.162.737.284 1.123.366 1.075.238 2.189.331 3.287.37 1.218.05 2.437.01 3.65-.118.299-.033.598-.073.896-.119.352-.054.578-.513.474-.834-.124-.383-.457-.531-.834-.473-.466.074-.96.108-1.382.146-1.177.08-2.358.082-3.536.006a22.228 22.228 0 01-1.157-.107c-.086-.01-.18-.025-.258-.036-.243-.036-.484-.08-.724-.13-.111-.027-.111-.185 0-.212h.005c.277-.06.557-.108.838-.147h.002c.131-.009.263-.032.394-.048a25.076 25.076 0 013.426-.12c.674.019 1.347.067 2.017.144l.228.031c.267.04.533.088.798.145.392.085.895.113 1.07.542.055.137.08.288.111.431l.319 1.484a.237.237 0 01-.199.284h-.003c-.037.006-.075.01-.112.015a36.704 36.704 0 01-4.743.295 37.059 37.059 0 01-4.699-.304c-.14-.017-.293-.042-.417-.06-.326-.048-.649-.108-.973-.161-.393-.065-.768-.032-1.123.161-.29.16-.527.404-.675.701-.154.316-.199.66-.267 1-.069.34-.176.707-.135 1.056.087.753.613 1.365 1.37 1.502a39.69 39.69 0 0011.343.376.483.483 0 01.535.53l-.071.697-1.018 9.907c-.041.41-.047.832-.125 1.237-.122.637-.553 1.028-1.182 1.171-.577.131-1.165.2-1.756.205-.656.004-1.31-.025-1.966-.022-.699.004-1.556-.06-2.095-.58-.475-.458-.54-1.174-.605-1.793l-.731-7.013-.322-3.094c-.037-.351-.286-.695-.678-.678-.336.015-.718.3-.678.679l.228 2.185.949 9.112c.147 1.344 1.174 2.068 2.446 2.272.742.12 1.503.144 2.257.156.966.016 1.942.053 2.892-.122 1.408-.258 2.465-1.198 2.616-2.657.34-3.332.683-6.663 1.024-9.995l.215-2.087a.484.484 0 01.39-.426c.402-.078.787-.212 1.074-.518.455-.488.546-1.124.385-1.766zm-1.478.772c-.145.137-.363.201-.578.233-2.416.359-4.866.54-7.308.46-1.748-.06-3.477-.254-5.207-.498-.17-.024-.353-.055-.47-.18-.22-.236-.111-.71-.054-.995.052-.26.152-.609.463-.646.484-.057 1.046.148 1.526.22.577.088 1.156.165 1.737.226 2.48.253 4.993.335 7.486.196.45-.025.9-.075 1.346-.155.299-.053.59-.11.794.265.102.186.078.446-.01.628-.061.127-.164.249-.325.326z"/>
                  </svg>
                  Buy Me a Coffee
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
                Report Issue
              </a>
            </div>
          </div>
        )}

        {stage === 'upload' && (
          <FileUpload onFileSelect={handleFileSelect} />
        )}

        {stage === 'preview' && selectedFile && (
          <FilePreview
            file={selectedFile}
            onRemove={handleRemoveFile}
            onStartAnalysis={handleStartAnalysis}
          />
        )}

        {(stage === 'processing' || stage === 'redacting') && (
          <div className="flex flex-col items-center justify-center min-h-[400px]">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-8">
              {stage === 'processing' ? 'Processing' : 'Redacting'} {selectedFile?.name}
            </h2>
            <ProgressIndicator stage={processingStage} />
          </div>
        )}

        {stage === 'complete' && (
          <div className="flex flex-col items-center justify-center min-h-[400px]">
            <div className="text-center max-w-md">
              <div className="mb-6">
                <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full mb-4">
                  <svg className="w-8 h-8 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                  Redaction Complete
                </h2>
                <p className="text-gray-600 dark:text-gray-300">
                  {processingStage.message}
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                  Your redacted PDF has been downloaded
                </p>
              </div>
              <div className="flex flex-col gap-3">
                <button
                  onClick={handleBackToUpload}
                  className="px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Process Another Document
                </button>
                <button
                  onClick={() => setStage('review')}
                  className="px-6 py-3 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 font-medium rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                >
                  Back to Review
                </button>
              </div>
            </div>
          </div>
        )}

        {stage === 'review' && (processedDocument || processedDocx) && (
          <div className="space-y-3 sm:space-y-4">
              {/* Review Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-0">
                <div className="flex items-center gap-2 sm:gap-4">
                  <button
                    onClick={handleBackToUpload}
                    className="px-3 sm:px-4 py-2 text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors flex-shrink-0"
                  >
                    ← Back
                  </button>
                  <div className="min-w-0">
                    <h2 className="text-base sm:text-xl font-semibold text-gray-900 dark:text-white truncate">
                      {selectedFile?.name}
                    </h2>
                    <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-300">
                      {processedDocument
                        ? `${processedDocument.pageCount} pages • ${processedDocument.allEntities.length} entities`
                        : `${processedDocx?.allEntities.length} entities`
                      }
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 sm:gap-3">
                  <button
                    onClick={() => setIsMetadataModalOpen(true)}
                    className="px-3 sm:px-4 py-2 text-xs sm:text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 font-medium rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors flex items-center gap-1.5 sm:gap-2"
                  >
                    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="hidden sm:inline">Review Metadata</span>
                    <span className="sm:hidden">Metadata</span>
                  </button>
                  <button
                    className="px-4 sm:px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-xs sm:text-sm whitespace-nowrap"
                    onClick={handleApplyRedactions}
                    disabled={confirmedCount === 0}
                  >
                    <span className="hidden sm:inline">Apply Redactions ({confirmedCount})</span>
                    <span className="sm:hidden">Apply ({confirmedCount})</span>
                  </button>
                </div>
              </div>

              {/* Filters Section - Desktop only (mobile filters are in EntityList) */}
              <div className="hidden lg:block bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4">
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
                  confirmedCount={confirmedCount}
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
                <div className="hidden lg:flex lg:flex-initial lg:h-auto lg:w-96 lg:flex-shrink-0 bg-white dark:bg-gray-800 rounded-lg shadow-sm overflow-hidden flex-col">
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
                    confirmedCount={confirmedCount}
                    />
                </div>

                {/* Mobile Entity List - Only visible when viewMode is 'entities' */}
                <div className={`lg:hidden flex-1 bg-white dark:bg-gray-800 rounded-lg shadow-sm overflow-hidden flex flex-col ${viewMode === 'document' ? 'hidden' : ''}`}>
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
                    confirmedCount={confirmedCount}
                      compactCards={true}
                  />
                </div>

              {/* Document Viewer - PDF or DOCX */}
              <div className={`flex-1 bg-white dark:bg-gray-800 rounded-lg shadow-sm overflow-hidden flex flex-col min-h-[400px] ${viewMode === 'entities' ? 'hidden lg:flex' : ''}`}
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
                      />
                    </div>

                    {/* Page Navigation for PDF */}
                    <div className="flex-shrink-0 border-t border-gray-200 dark:border-gray-700 p-3 sm:p-4 flex items-center justify-center gap-2 sm:gap-4">
                      <button
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        className="min-w-[44px] min-h-[44px] px-4 sm:px-4 py-2.5 sm:py-2 text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors active:scale-95"
                      >
                        <span className="hidden sm:inline">← Previous</span>
                        <span className="sm:hidden">←</span>
                      </button>
                      <span className="text-xs sm:text-sm text-gray-700 dark:text-gray-300 font-medium">
                        Page {currentPage} of {processedDocument.pageCount}
                      </span>
                      <button
                        onClick={() => setCurrentPage(p => Math.min(processedDocument.pageCount, p + 1))}
                        disabled={currentPage === processedDocument.pageCount}
                        className="min-w-[44px] min-h-[44px] px-4 sm:px-4 py-2.5 sm:py-2 text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors active:scale-95"
                      >
                        <span className="hidden sm:inline">Next →</span>
                        <span className="sm:hidden">→</span>
                      </button>
                    </div>
                  </>
                )}

                {processedDocx && (
                  <DocxViewer
                    htmlContent={processedDocx.htmlContent}
                    entities={filteredEntities}
                    selectedEntityId={selectedEntityId}
                    onEntityClick={handleEntitySelect}
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
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setIsAboutOpen(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-4">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">About SafeRedact</h2>
              <button
                onClick={() => setIsAboutOpen(false)}
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
                  className="w-12 h-12 text-blue-600"
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
                  <p className="text-sm text-gray-600 dark:text-gray-300">Version {packageJson.version}</p>
                </div>
              </div>

              <p className="text-sm text-gray-600 dark:text-gray-300">
                A privacy-focused document redaction tool that helps you identify and remove sensitive information from PDFs and DOCX files.
              </p>

              <div className="pt-4 mt-4 border-t border-gray-200 dark:border-gray-700">
                <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Need Help?</h4>
                <a
                  href="https://github.com/zhendong/safe-redact/issues/new"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
                  </svg>
                  Report an Issue
                </a>
                <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                  Report bugs, request features, or ask questions on GitHub
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
        hiddenContentReport={processedDocument?.hiddenContentReport || (processedDocx?.hiddenContentReport as any)}
        fileType={fileType || 'pdf'}
      />

    </div>
  );
}

export default App;
