/**
 * Desktop only: a token-classification pipeline whose model runs in native
 * ONNX Runtime (src-tauri/src/ner.rs) instead of WebAssembly.
 *
 * WebKit gives pages served from the app's custom scheme no SharedArrayBuffer,
 * so WebAssembly inference is single-threaded there. Tokenization and the
 * pipeline's post-processing still come from transformers.js, so results match
 * the web version.
 */
import {
  AutoConfig,
  AutoTokenizer,
  Tensor,
  TokenClassificationPipeline,
} from '@huggingface/transformers';
import { invoke } from '@tauri-apps/api/core';

const toNumbers = (tensor?: Tensor) =>
  tensor ? Array.from(tensor.data as BigInt64Array, value => Number(value)) : undefined;

export async function createNativeNerPipeline(modelName: string): Promise<TokenClassificationPipeline> {
  const [config, tokenizer] = await Promise.all([
    AutoConfig.from_pretrained(modelName),
    AutoTokenizer.from_pretrained(modelName),
    invoke('ner_load'),
  ]);
  const numLabels = Object.keys((config as unknown as { id2label: Record<string, string> }).id2label).length;

  // The pipeline only calls the model with tokenizer output and reads `logits` and `config`
  const model = Object.assign(
    async (inputs: Record<string, Tensor>) => {
      const [batch, sequenceLength] = inputs.input_ids.dims;
      const logits = await invoke<ArrayBuffer>('ner_run', {
        input: {
          dims: [batch, sequenceLength],
          inputIds: toNumbers(inputs.input_ids),
          attentionMask: toNumbers(inputs.attention_mask),
          tokenTypeIds: toNumbers(inputs.token_type_ids),
        },
      });
      return {
        logits: new Tensor('float32', new Float32Array(logits), [batch, sequenceLength, numLabels]),
      };
    },
    { config, dispose: async () => [] },
  );

  return new TokenClassificationPipeline({
    task: 'token-classification',
    model,
    tokenizer,
  } as unknown as ConstructorParameters<typeof TokenClassificationPipeline>[0]);
}
