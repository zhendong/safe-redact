#!/usr/bin/env node
/**
 * Collects everything the desktop app needs to run fully offline into
 * desktop-assets/, which the `desktop` Vite mode serves and copies into dist/.
 *
 *   vendor/tesseract/  tesseract.js, its worker, WASM core, and language data
 *   models/            the NER model, downloaded once from Hugging Face; the app runs it
 *                      in native ONNX Runtime (src-tauri/src/ner.rs)
 *
 * Files are copied from node_modules on every run (cheap). The model is only
 * downloaded when missing or when its checksum does not match.
 */
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'desktop-assets');
const modules = join(root, 'node_modules');

const MODEL_ID = 'Xenova/bert-base-NER';
const MODEL_REVISION = '8e892123e8b7c2c0c2bd1dcb598b7d244c4e53aa';
const MODEL_FILES = {
  'config.json': null,
  'tokenizer.json': null,
  'tokenizer_config.json': null,
  'special_tokens_map.json': null,
  'onnx/model_quantized.onnx': 'caaee70a5518ec7f9e46e5308fcc9263a8c227703a9ce46cf61c69a552349648',
};
const OCR_LANGUAGES = ['eng', 'chi_sim'];

async function copyInto(dest, src) {
  await mkdir(dirname(dest), { recursive: true });
  await copyFile(src, dest);
}

async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function copyRuntimeFiles() {
  for (const name of ['tesseract.min.js', 'worker.min.js']) {
    await copyInto(join(out, 'vendor/tesseract', name), join(modules, 'tesseract.js/dist', name));
  }
  const corePackage = join(modules, 'tesseract.js-core');
  for (const name of await readdir(corePackage)) {
    // OCR uses the LSTM engine; these builds embed their WASM, with and without SIMD
    if (/^tesseract-core(-simd)?-lstm\.wasm\.js$/.test(name)) {
      await copyInto(join(out, 'vendor/tesseract/core', name), join(corePackage, name));
    }
  }
  // tesseract.js uses the 4.0.0_best_int data by default for the LSTM engine
  for (const lang of OCR_LANGUAGES) {
    const file = `${lang}.traineddata.gz`;
    await copyInto(
      join(out, 'vendor/tesseract/lang', file),
      join(modules, '@tesseract.js-data', lang, '4.0.0_best_int', file),
    );
  }
}

async function downloadModel() {
  for (const [file, expectedSha] of Object.entries(MODEL_FILES)) {
    const dest = join(out, 'models', MODEL_ID, file);
    if (existsSync(dest) && (!expectedSha || (await sha256(dest)) === expectedSha)) continue;

    const url = `https://huggingface.co/${MODEL_ID}/resolve/${MODEL_REVISION}/${file}`;
    console.log(`Downloading ${url}`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to download ${url}: ${response.status}`);
    await mkdir(dirname(dest), { recursive: true });
    const tmp = `${dest}.part`;
    await writeFile(tmp, Buffer.from(await response.arrayBuffer()));
    if (expectedSha && (await sha256(tmp)) !== expectedSha) {
      throw new Error(`Checksum mismatch for ${file}`);
    }
    await rename(tmp, dest);
  }
}

await copyRuntimeFiles();
await downloadModel();
console.log(`Desktop assets ready in ${out}`);
