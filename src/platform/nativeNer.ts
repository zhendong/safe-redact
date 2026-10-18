/**
 * Desktop only: runs the NER model in native ONNX Runtime (src-tauri/src/ner.rs)
 * instead of WebAssembly.
 *
 * WebKit gives pages served from the app's custom scheme no SharedArrayBuffer,
 * so WebAssembly inference is single-threaded there. Tokenization and
 * post-processing still happen in the frontend, so results match the web version.
 */
import { Tensor } from '@huggingface/transformers';
import { invoke } from '@tauri-apps/api/core';
import type { NerInputs } from '@/lib/detectors/nerModels';

const toNumbers = (tensor?: Tensor) =>
  tensor ? Array.from(tensor.data as BigInt64Array, value => Number(value)) : undefined;

export async function loadNativeNerModel(numLabels: number) {
  await invoke('ner_load');

  return async (inputs: NerInputs): Promise<Tensor> => {
    const [batch, sequenceLength] = inputs.input_ids.dims;
    const logits = await invoke<ArrayBuffer>('ner_run', {
      input: {
        dims: [batch, sequenceLength],
        inputIds: toNumbers(inputs.input_ids),
        attentionMask: toNumbers(inputs.attention_mask),
        tokenTypeIds: toNumbers(inputs.token_type_ids),
      },
    });
    return new Tensor('float32', new Float32Array(logits), [batch, sequenceLength, numLabels]);
  };
}
