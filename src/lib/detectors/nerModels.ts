import {
  AutoConfig,
  AutoModelForTokenClassification,
  AutoTokenizer,
  Tensor,
  env,
  softmax,
  type PreTrainedTokenizer,
} from '@huggingface/transformers';
import { isDesktop } from '@/platform';
import { NER_WINDOW } from '@/utils/constants';
import { alignTokens, decodeSpans, tokenWindows, type NerSpan, type TokenPrediction } from './nerDecoding';

if (isDesktop) {
  // The desktop app bundles the model so it works offline; it runs in native ONNX Runtime
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  env.localModelPath = '/models/';
  env.useBrowserCache = false;
} else {
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
}


export interface NerInputs {
  input_ids: Tensor;
  attention_mask: Tensor;
  token_type_ids?: Tensor;
}

export type ProgressCallback = (progress: number) => void;

/** A token-classification model: a tokenizer plus a forward pass that returns logits */
export class NerModel {
  private readonly clsId: number;
  private readonly sepId: number;

  constructor(
    readonly name: string,
    private readonly tokenizer: PreTrainedTokenizer,
    private readonly id2label: Record<string, string>,
    private readonly forward: (inputs: NerInputs) => Promise<Tensor>,
  ) {
    // BERT-style tokenizers wrap a sequence as [CLS] ... [SEP]
    [this.clsId, this.sepId] = tokenizer.encode('');
  }

  /** Browser only: whether transformers.js has already cached this model's weights */
  static async isCached(name: string): Promise<boolean> {
    try {
      const cache = await caches.open('transformers-cache');
      const keys = await cache.keys();
      return keys.some(request => request.url.includes(`/${name}/`) && request.url.endsWith('.onnx'));
    } catch {
      // No Cache API (e.g. an insecure context), so the model can't have been cached
      return false;
    }
  }

  static async load(name: string, onProgress?: ProgressCallback): Promise<NerModel> {
    const progress_callback = (data: { status: string; progress?: number }) => {
      if (data.status === 'progress' && data.progress) onProgress?.(data.progress);
    };
    const [config, tokenizer] = await Promise.all([
      AutoConfig.from_pretrained(name, { progress_callback }),
      AutoTokenizer.from_pretrained(name, { progress_callback }),
    ]);
    const id2label = (config as unknown as { id2label: Record<string, string> }).id2label;

    let forward: (inputs: NerInputs) => Promise<Tensor>;
    if (isDesktop) {
      const { loadNativeNerModel } = await import('@/platform/nativeNer');
      forward = await loadNativeNerModel(Object.keys(id2label).length);
    } else {
      const model = await AutoModelForTokenClassification.from_pretrained(name, { dtype: 'q8', progress_callback });
      forward = async inputs => (await model(inputs)).logits;
    }
    onProgress?.(100);
    return new NerModel(name, tokenizer, id2label, forward);
  }

  /**
   * Finds entity spans in `text` of any length. The text is tokenized once and
   * classified in overlapping windows that fit the model, so nothing is truncated.
   */
  async findSpans(text: string): Promise<NerSpan[]> {
    const ids = this.tokenizer.encode(text, { add_special_tokens: false });
    if (ids.length === 0) return [];
    const tokens: string[] = this.tokenizer.model.convert_ids_to_tokens(ids);
    const offsets = alignTokens(text, tokens, this.tokenizer.unk_token);
    const predictions: TokenPrediction[] = tokens.map(() => ({ label: 'O', score: 1 }));

    for (const window of tokenWindows(ids.length, NER_WINDOW.TOKENS, NER_WINDOW.OVERLAP)) {
      const windowIds = [this.clsId, ...ids.slice(window.start, window.end), this.sepId];
      const shape = [1, windowIds.length];
      const logits = await this.forward({
        input_ids: new Tensor('int64', BigInt64Array.from(windowIds, BigInt), shape),
        attention_mask: new Tensor('int64', new BigInt64Array(windowIds.length).fill(1n), shape),
        token_type_ids: new Tensor('int64', new BigInt64Array(windowIds.length), shape),
      });

      const numLabels = logits.dims[2];
      const data = logits.data as Float32Array;
      for (let i = window.keepStart; i < window.keepEnd; i++) {
        // +1 skips [CLS]
        const row = i - window.start + 1;
        const probabilities = softmax(Array.from(data.subarray(row * numLabels, (row + 1) * numLabels)));
        let best = 0;
        for (let k = 1; k < numLabels; k++) if (probabilities[k] > probabilities[best]) best = k;
        predictions[i] = { label: this.id2label[best], score: probabilities[best] };
      }
    }

    return decodeSpans(tokens, offsets, predictions);
  }
}
