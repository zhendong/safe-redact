import type { DetectedEntity, ProcessedPage } from '@/lib/types';
import { EntityType } from '@/lib/types';
import { generateId } from '@/utils/validation';
import { extractContext, splitTextWithOverlap } from '@/utils/text-utils';
import { MEMPRIVACY_CHUNKING, ML_MODEL_NAME } from '@/utils/constants';
import { findPositionWithSearch } from '@/lib/detectors/pdf-position';
import { pipeline, type TextGenerationPipeline, env } from '@huggingface/transformers';

// Configure transformers.js to load the model from the HuggingFace CDN.
env.allowLocalModels = false;
env.allowRemoteModels = true;

/**
 * One privacy item as returned by MemPrivacy-1.7B-RL.
 */
interface PrivacyItem {
  original_text: string;
  privacy_type: string;
  privacy_level: 'PL2' | 'PL3' | 'PL4';
}

/**
 * The full system prompt MemPrivacy-1.7B-RL was trained with. `{real_name}` is
 * substituted before inference. For document redaction we have no logged-in
 * user, so the name is left blank — every name in the text is then treated as a
 * third party and still extracted as identifiable PII.
 */
const SYSTEM_PROMPT = `You are a professional "Data Security and Privacy Compliance Expert." Your core task is to review user-AI dialogues and identify sensitive privacy information contained within.

# Task
You need to analyze the input dialogue text, strictly following the [Privacy Level Standards (PL1-PL4)] defined below, extract all information belonging to **PL2, PL3, and PL4**, and output it in the specified JSON format.

You are given:
1. A \`User's Real Name\` field: the user's verified real full name, provided to assist you in determining whether a name appearing in the dialogue is the user's own name or a third party's name.
2. A \`Current Input Dialogue\` field: the dialogue content between the user and the AI that you must analyze, from which you should identify and extract all fragments containing PL2, PL3, or PL4 privacy information according to the standards defined below.

# Privacy Level Standards & Classification Rules (Knowledge Base)

## 1. Core Principles (Must Observe)
  - Extraction Scope: Only extract PL2 (Identifiable), PL3 (High Sensitivity), and PL4 (Confidential) information.
  - Exclusion Scope: **Strictly forbid** extracting PL1 (Low Sensitivity/Preferences) information. Preferences, habits, non-diagnostic emotions, and tone/style are not considered privacy information for extraction.
  - Public Information Exception: Publicly known global/national-level public figures, well-known institutions, or famous locations that are part of general knowledge, and are not linked to the user's personal identity, trajectory, or private context in the dialogue, do not need to be identified or extracted.
  - Conflict Resolution:
    - Once a high-level rule (e.g., PL4) is matched, categorize it immediately; do not downgrade.
    - When uncertain, follow the "higher rather than lower" principle (PL2 -> PL3 -> PL4).
    - PL1 vs. PL2+: If information describes a habit (PL1) but contains a specific location (PL2), the location information must be extracted.

## 2. Detailed Definitions & Categories

### 【PL4: Confidential/Credentials/Critical Loss】 (Highest Priority)
  - Definition: Any authentication, authorization, signing, or access control material that can be "directly reused/immediately executed," or key secrets that, if leaked, could immediately lead to account takeover, financial loss, system lateral movement, or mass data exfiltration.
  - Classification Rules:
    1. Auth/Account: Passwords, PINs, Security Questions & Answers, Verification Codes (SMS/Email/MFA), Session Tokens, Cookies, OAuth Codes, Bank/Payment Card Security Codes (CVC, CVV), Backup/Recovery Codes, SSO Tickets.
    2. Keys/Signatures: API Keys, AccessKeys, Secret Keys, Private Keys, Mnemonics, Seed Phrases, Database Connection Strings, Certificate Private Keys, Signing Keys, Encryption Keys.
    3. System/Attack: Database strings, Admin portal URLs, Reproducible vulnerability details, Intranet entry points, Bastion host info, CI keys, Cloud keys, Production configurations.
    4. Undisclosed Business Info: Undisclosed financials, M&A materials, Core roadmaps, Internal pricing, Client lists, Contract originals, Exploit details, Vulnerability PoCs.
  - Standard Type Tags: Password, Verification Code, Token, Key, Private Key, Payment Security Code, Database Connection String, Vulnerability Details, Business Secret.

### 【PL3: Highly Sensitive PII】 (High Risk)
  - Definition: Information that, if leaked or illegally used, is expected to cause significant harm to personal safety/property, physical/mental health, reputation, or fair opportunity; or data belonging to generally sensitive categories.
  - Classification Rules:
    1. Documents: ID Card Number, Passport Number, Social Security/Insurance Number, Document Photos/Scans, Driver's License Number, License Plate Number.
    2. Financial: Bank/Payment Card Number, Basic Card Info, Account Info, Transaction Records/Bill Details, Salary/Income, Credit Reports, Debt/Loan Info, Assets/Net Worth.
    3. Health: Medical Records/History/Visits/Surgery, Diagnosis Results, Prescriptions, Specific Physiological Metrics (Blood Type/Sugar/Pressure/Lipids/Oxygen), Specific Body Metrics (Height/Weight/BMI), Reproductive Health, Mental Illness/Therapy Records. Metrics only when specific values are given.
    4. Trajectory: Precise Location, Accommodation Records, Detailed Trajectory (Travel Itinerary, Ticket Info), Commute Routes.
    5. Biometrics: Face, Fingerprint, Voiceprint, Iris features.
    6. Communication Content: Raw Chat Logs, SMS/Email Content, Call Detail Records.
    7. Sensitive Attributes: Ethnicity/Race, Religious Beliefs, Political Views.
    8. Others: Minor Information, Litigation/Penalty Records/Police Reports.
  - Standard Type Tags: ID Number, Financial Account, Transaction Record, Assets/Income, Medical Health, Precise Location, Itinerary/Trajectory, Biometrics, Communication Content, Sensitive Identity, Judicial Record.

### 【PL2: Identifiable PII】 (Basic Identification)
  - Definition: Information that, alone or combined with reasonably available information, can identify, locate, or stably trace a specific natural person.
  - Classification Rules:
    1. Direct Identifier: Real Name (Full Name), Specific Age, Date of Birth, Gender, Mobile Number, Landline, Email Address, Detailed Address, Zip Code, Work Address.
    2. Network Identifier: Account Username/ID/UID, Personal Homepage Link, Device Identifier, IP Address, Device ID, UserAgent, Reusable Cookies/Session Identifiers.
    3. Strong Combination: "Company + Job Title + Name", "School + Class + Name". Employer/Company Name, Job Title, School, and Class also need classification.
    4. Third-Party Identifiable Info: Personal information of Emergency Contacts/Relatives/Friends (Name, Phone, Email, Address, Relationship).
  - Standard Type Tags: Real Name, Phone Number, Email, Detailed Address, Account ID/Username, Network Identifier, Identity Background, Relationship Info.

### 【PL1: Public/Low Sensitivity】 (DO NOT EXTRACT)
  - Definition: Unable to identify a specific individual; merely style, preferences, or habits. Expression/interaction preferences, personality and non-diagnostic emotional self-descriptions, life rhythm and habits, interests, aesthetic and style preferences, motivations and goals.

# Extraction Granularity & Boundary Principles
**Core Principle:** Only extract "Sensitive Entities" or "Minimum Sensitive Fact Fragments." Strictly forbid extracting full sentences.
1. Remove Unnecessary Context: do not include introductory words ("My number is," "I live at") or punctuation (unless part of an address/value).
2. Maintain Semantic Integrity: for descriptive privacy (transactions, trajectories), extract the minimum phrase containing the core elements.
3. Values Must Combine with Unit/Object: standalone numbers are generally not extracted unless they are phone numbers, ID numbers, or specific amounts matching PL2-PL4 rules.
4. Real Name Must Be the User's Own Full Name: use the provided \`User's Real Name\` field to decide whether a name belongs to the user; non-matching names are third-party.

# Output Format (Requirements)
Strictly follow the JSON format. Do not include Markdown code block markers (like \`\`\`json). Output the JSON array directly. If no PL2-PL4 information is found, output an empty array \`[]\`.
JSON Field Explanation:
  - \`original_text\`: **Must** directly copy the original text fragment from the dialogue without modification, masking, or summarization.
  - \`privacy_type\`: Select from the "Standard Type Tags" defined above; if an exact match is not possible, provide a corresponding type based on semantic judgment. The value must be in English.
  - \`privacy_level\`: Limited to \`PL2\`, \`PL3\`, \`PL4\`.

# Input

**User's Real Name:** {real_name}

**Current Input Dialogue:**
`;

/**
 * Confidence assigned per privacy level. MemPrivacy does not emit per-span
 * scores, but the review UI filters by the aggressiveness thresholds
 * (conservative 0.90 / balanced 0.70 / aggressive 0.50), so higher-sensitivity
 * levels map to higher confidence to survive stricter settings.
 */
const LEVEL_CONFIDENCE: Record<PrivacyItem['privacy_level'], number> = {
  PL4: 0.99,
  PL3: 0.92,
  PL2: 0.85,
};

/**
 * Privacy detection using the local generative LLM MemPrivacy-1.7B-RL
 * (Qwen3-1.7B) via transformers.js + WebGPU. Unlike a token classifier, the
 * model is prompted with text and returns a JSON array of sensitive spans; we
 * then locate each span in the document the same way the old NER path did.
 */
export class MemPrivacyDetector {
  private static pipeline: TextGenerationPipeline | null = null;
  private static isInitialized = false;
  private static initializationPromise: Promise<void> | null = null;
  private modelName: string;

  constructor(modelName: string = ML_MODEL_NAME) {
    this.modelName = modelName;
  }

  /**
   * True when the current browser exposes the WebGPU API the model requires.
   */
  static isWebGPUSupported(): boolean {
    return typeof navigator !== 'undefined' && 'gpu' in navigator;
  }

  /**
   * Preload the model in the background (static method for sharing across instances)
   */
  static async preloadModel(
    modelName: string = ML_MODEL_NAME,
    onProgress?: (progress: number, message: string) => void
  ): Promise<void> {
    if (MemPrivacyDetector.isInitialized) {
      onProgress?.(100, 'Model already loaded');
      return Promise.resolve();
    }

    if (MemPrivacyDetector.initializationPromise) {
      return MemPrivacyDetector.initializationPromise;
    }

    MemPrivacyDetector.initializationPromise = (async () => {
      try {
        if (!MemPrivacyDetector.isWebGPUSupported()) {
          throw new Error(
            'MemPrivacy requires a WebGPU-capable browser (e.g. Chrome/Edge 113+ with WebGPU enabled).'
          );
        }

        onProgress?.(0, 'Starting model download...');

        // Pre-cache the large ONNX weight file ourselves. HF/Xet does not expose
        // Content-Length via CORS, so transformers.js's loader can't pre-size its
        // buffer and instead reallocates-and-copies on every chunk — at the end
        // the old and new ~1.5GB buffers coexist (~3GB peak), which overflows the
        // browser/WebGPU allocation limit. We stream the file into the browser
        // cache transformers.js reads from, stamped with Content-Length, so its
        // read allocates exactly once (~1.5GB peak).
        await MemPrivacyDetector.prefetchWeights(modelName, onProgress);

        const pipelineResult = await pipeline('text-generation', modelName, {
          device: 'webgpu',
          dtype: 'q4f16',
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
        MemPrivacyDetector.pipeline = pipelineResult as TextGenerationPipeline;

        MemPrivacyDetector.isInitialized = true;
        onProgress?.(100, 'Model ready');
      } catch (error) {
        MemPrivacyDetector.initializationPromise = null;
        console.error('Failed to preload model:', error);
        throw error;
      }
    })();

    return MemPrivacyDetector.initializationPromise;
  }

  /**
   * Stream the q4f16 ONNX weights into the cache transformers.js reads from,
   * stamped with a Content-Length header. This avoids transformers.js's
   * grow-by-realloc download path (which peaks at ~2x the file size and OOMs for
   * a ~1.5GB model). Best-effort: any failure just falls through to the normal
   * loader.
   */
  private static async prefetchWeights(
    modelName: string,
    onProgress?: (progress: number, message: string) => void
  ): Promise<void> {
    try {
      if (typeof caches === 'undefined' || typeof fetch === 'undefined') return;

      // Mirrors transformers.js's remote URL + browser cache name.
      const url = `https://huggingface.co/${modelName}/resolve/main/onnx/model_q4f16.onnx`;
      const cache = await caches.open('transformers-cache');
      if (await cache.match(url)) return; // already downloaded

      const response = await fetch(url);
      if (!response.ok || !response.body) return;

      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let loaded = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.length;
        // Content-Length is not exposed by HF/Xet CORS, so report bytes, not %.
        onProgress?.(0, `Downloading model: ${(loaded / 1e6).toFixed(0)} MB`);
      }

      const blob = new Blob(chunks); // browser backs large blobs on disk
      chunks.length = 0;
      const headers = new Headers();
      headers.set('Content-Length', String(blob.size));
      headers.set('Content-Type', 'application/octet-stream');
      await cache.put(url, new Response(blob, { status: 200, statusText: 'OK', headers }));
      onProgress?.(50, 'Model downloaded, initializing...');
    } catch (error) {
      // Non-fatal: let transformers.js fetch it the usual way.
      console.warn('Model prefetch failed; falling back to default loader:', error);
    }
  }

  /**
   * Check if model is already loaded
   */
  static isModelLoaded(): boolean {
    return MemPrivacyDetector.isInitialized;
  }

  /**
   * Initialize the pipeline (uses shared static pipeline if already loaded)
   */
  async initialize(onProgress?: (progress: number, message: string) => void): Promise<void> {
    if (MemPrivacyDetector.isInitialized) {
      onProgress?.(100, 'Using preloaded model');
      return Promise.resolve();
    }

    return MemPrivacyDetector.preloadModel(this.modelName, onProgress);
  }

  /**
   * Detect entities in PDF pages and resolve each to a position via MuPDF search.
   */
  async detectEntities(
    pages: ProcessedPage[],
    onProgress?: (progress: number) => void
  ): Promise<DetectedEntity[]> {
    if (!MemPrivacyDetector.isInitialized || !MemPrivacyDetector.pipeline) {
      throw new Error('MemPrivacy detector not initialized. Call initialize() first.');
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

    const chunks = splitTextWithOverlap(
      text,
      MEMPRIVACY_CHUNKING.CHUNK_SIZE,
      MEMPRIVACY_CHUNKING.CHUNK_OVERLAP
    );

    const seenEntities = new Set<string>(); // Deduplicate across overlapping chunks

    for (const { text: chunk } of chunks) {
      const items = await this.runModel(chunk);

      for (const item of items) {
        const searchText = item.original_text?.trim();
        if (!searchText || searchText.length < 2) {
          continue;
        }

        const entityType = mapPrivacyTypeToEntityType(item.privacy_type);

        const entityKey = `${searchText}:${entityType}`;
        if (seenEntities.has(entityKey)) {
          continue;
        }
        seenEntities.add(entityKey);

        const position = findPositionWithSearch(page, searchText);
        if (!position) {
          console.warn('Could not find position for entity:', searchText);
          continue;
        }

        const matchIndex = text.indexOf(searchText);
        const contextText =
          matchIndex !== -1 ? extractContext(text, matchIndex, searchText.length) : searchText;

        entities.push({
          id: generateId(),
          text: searchText,
          entityType,
          confidence: LEVEL_CONFIDENCE[item.privacy_level] ?? 0.85,
          position,
          detectionMethod: 'ml_ner',
          status: 'rejected',
          contextText,
        });
      }
    }

    return entities;
  }

  /**
   * Detect entities in plain text (for DOCX documents).
   * Returns simplified entities without page/position info.
   */
  async detectEntitiesInChunks(
    text: string,
    _tokenLimit?: number,
    onProgress?: (progress: number) => void
  ): Promise<Array<{ text: string; entityType: EntityType; confidence: number }>> {
    if (!MemPrivacyDetector.isInitialized || !MemPrivacyDetector.pipeline) {
      throw new Error('MemPrivacy detector not initialized. Call initialize() first.');
    }

    const chunks = splitTextWithOverlap(
      text,
      MEMPRIVACY_CHUNKING.CHUNK_SIZE,
      MEMPRIVACY_CHUNKING.CHUNK_OVERLAP
    );
    const allEntities: Array<{ text: string; entityType: EntityType; confidence: number }> = [];
    const seenEntities = new Set<string>();

    for (let i = 0; i < chunks.length; i++) {
      const items = await this.runModel(chunks[i].text);

      for (const item of items) {
        const searchText = item.original_text?.trim();
        if (!searchText || searchText.length < 2) continue;

        const entityType = mapPrivacyTypeToEntityType(item.privacy_type);
        const entityKey = `${searchText}:${entityType}`;
        if (seenEntities.has(entityKey)) continue;
        seenEntities.add(entityKey);

        allEntities.push({
          text: searchText,
          entityType,
          confidence: LEVEL_CONFIDENCE[item.privacy_level] ?? 0.85,
        });
      }

      onProgress?.(Math.round(((i + 1) / chunks.length) * 100));
    }

    return allEntities;
  }

  /**
   * Run the generative model on one chunk and parse its JSON output.
   */
  private async runModel(chunkText: string): Promise<PrivacyItem[]> {
    if (!MemPrivacyDetector.pipeline) {
      throw new Error('Pipeline not initialized');
    }

    // real_name left blank: every name is treated as a third party and extracted.
    const userContent =
      SYSTEM_PROMPT.replace('{real_name}', '') +
      JSON.stringify({ role: 'user', content: chunkText }, null, 2);

    // Build the Qwen3 chat prompt by hand: this model's chat template ships as a
    // separate chat_template.jinja that transformers.js does not load into the
    // tokenizer, so apply_chat_template() (i.e. passing a messages array) fails.
    // The trailing empty <think></think> block disables Qwen3 reasoning so the
    // model emits the JSON answer directly.
    const fullPrompt =
      `<|im_start|>user\n${userContent}<|im_end|>\n` +
      `<|im_start|>assistant\n<think>\n\n</think>\n\n`;

    try {
      const output = await MemPrivacyDetector.pipeline(fullPrompt, {
        max_new_tokens: MEMPRIVACY_CHUNKING.MAX_NEW_TOKENS,
        temperature: 0.1,
        top_p: 0.1,
        repetition_penalty: 1.05,
        do_sample: true,
        return_full_text: false,
      } as any);

      return parsePrivacyItems(extractGeneratedText(output));
    } catch (error) {
      console.error('Error running MemPrivacy model on chunk:', error);
      return [];
    }
  }

  /**
   * Check if detector is ready
   */
  isReady(): boolean {
    return MemPrivacyDetector.isInitialized && MemPrivacyDetector.pipeline !== null;
  }

  /**
   * Clean up resources. The model is kept loaded for reuse across documents;
   * use clearModel() to fully unload.
   */
  async dispose(): Promise<void> {
    // Intentionally a no-op: keep the (expensive) model warm between documents.
  }

  /**
   * Clear the loaded model from memory (static method)
   */
  static async clearModel(): Promise<void> {
    MemPrivacyDetector.pipeline = null;
    MemPrivacyDetector.isInitialized = false;
    MemPrivacyDetector.initializationPromise = null;
  }
}

/**
 * Pull the assistant's generated text out of a transformers.js text-generation
 * result, handling both chat-array and raw-string output shapes.
 */
function extractGeneratedText(output: any): string {
  const gen = Array.isArray(output) ? output[0]?.generated_text : output?.generated_text;
  if (Array.isArray(gen)) {
    // Chat format: take the last (assistant) message.
    const last = gen[gen.length - 1];
    return typeof last?.content === 'string' ? last.content : '';
  }
  return typeof gen === 'string' ? gen : '';
}

/**
 * Parse the model output into privacy items, tolerating <think> blocks, code
 * fences, and trailing prose around the JSON array.
 */
function parsePrivacyItems(raw: string): PrivacyItem[] {
  if (!raw) return [];

  // Strip any Qwen3 reasoning block and markdown code fences.
  let cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  cleaned = cleaned.replace(/```json\s*/gi, '').replace(/```/g, '').trim();

  const tryParse = (s: string): PrivacyItem[] | null => {
    try {
      const parsed = JSON.parse(s);
      return Array.isArray(parsed) ? (parsed as PrivacyItem[]) : null;
    } catch {
      return null;
    }
  };

  const direct = tryParse(cleaned);
  if (direct) return direct;

  // Fallback: extract the first JSON array substring.
  const match = cleaned.match(/\[[\s\S]*\]/);
  if (match) {
    const extracted = tryParse(match[0]);
    if (extracted) return extracted;
  }

  return [];
}

/**
 * Map a MemPrivacy `privacy_type` tag to the app's EntityType enum. Tags not
 * covered by a specific enum value fall back to CUSTOM so they are still
 * surfaced for review and redaction.
 */
function mapPrivacyTypeToEntityType(privacyType: string): EntityType {
  const tag = (privacyType || '').toLowerCase();

  if (tag.includes('real name') || tag.includes('name')) return EntityType.PERSON;
  if (tag.includes('phone') || tag.includes('landline') || tag.includes('mobile')) {
    return EntityType.PHONE;
  }
  if (tag.includes('email')) return EntityType.EMAIL;
  if (tag.includes('address') || tag.includes('location') || tag.includes('trajectory') || tag.includes('itinerary')) {
    return EntityType.LOCATION;
  }
  if (tag.includes('id number') || tag.includes('ssn') || tag.includes('passport') || tag.includes('social security')) {
    return EntityType.SSN;
  }
  if (tag.includes('financial account') || tag.includes('card') || tag.includes('payment')) {
    return EntityType.CREDIT_CARD;
  }
  if (tag.includes('company') || tag.includes('employer') || tag.includes('organization') || tag.includes('identity background')) {
    return EntityType.ORGANIZATION;
  }

  return EntityType.CUSTOM;
}
