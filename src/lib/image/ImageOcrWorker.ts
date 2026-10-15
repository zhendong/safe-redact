import { isDesktop } from '@/platform';

interface OcrLogMessage {
  status: string;
  progress: number;
}

interface ImageOcrWorker {
  recognize: (
    image: HTMLCanvasElement,
    options: object,
    output: { tsv: boolean }
  ) => Promise<{ data: { tsv?: string } }>;
}

type WorkerFactory = (logger: (message: OcrLogMessage) => void) => Promise<ImageOcrWorker>;

/** One initialized OCR worker stays available for the lifetime of the open page. */
export class ImageOcrWorkerManager {
  private workerPromise: Promise<ImageOcrWorker> | null = null;
  private progressListener?: (progress: number) => void;

  constructor(private readonly factory: WorkerFactory) {}

  preload(): Promise<ImageOcrWorker> {
    if (!this.workerPromise) {
      this.workerPromise = Promise.resolve()
        .then(() => this.factory(message => {
          if (message.status === 'recognizing text') this.progressListener?.(message.progress);
        }))
        .catch(error => {
          this.workerPromise = null;
          throw error;
        });
    }
    return this.workerPromise;
  }

  async recognize(image: HTMLCanvasElement, onProgress?: (progress: number) => void) {
    const worker = await this.preload();
    this.progressListener = onProgress;
    try {
      return await worker.recognize(image, {}, { tsv: true });
    } finally {
      this.progressListener = undefined;
    }
  }
}

interface TesseractGlobal {
  createWorker: (
    languages: string[],
    oem: number,
    options: {
      logger: (message: OcrLogMessage) => void;
      workerPath?: string;
      corePath?: string;
      langPath?: string;
    }
  ) => Promise<ImageOcrWorker>;
}

async function getTesseract(): Promise<TesseractGlobal> {
  const browserWindow = window as Window & { Tesseract?: TesseractGlobal };
  if (browserWindow.Tesseract) return browserWindow.Tesseract;

  // The initial CDN tag may have failed while the page was offline. Retry it.
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = isDesktop
      ? '/vendor/tesseract/tesseract.min.js'
      : 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    script.onload = () => browserWindow.Tesseract
      ? resolve(browserWindow.Tesseract)
      : reject(new Error('OCR script did not initialize'));
    script.onerror = () => {
      script.remove();
      reject(new Error('OCR could not load. Check your internet connection and try again.'));
    };
    document.head.appendChild(script);
  });
}

export const imageOcrWorker = new ImageOcrWorkerManager(async logger => {
  const tesseract = await getTesseract();
  // The desktop app bundles the worker, WASM core, and language data so OCR works offline
  const offlinePaths = isDesktop
    ? {
        workerPath: new URL('/vendor/tesseract/worker.min.js', window.location.href).href,
        corePath: new URL('/vendor/tesseract/core', window.location.href).href,
        langPath: new URL('/vendor/tesseract/lang', window.location.href).href,
      }
    : {};
  return tesseract.createWorker(['eng', 'chi_sim'], 1, { logger, ...offlinePaths });
});
