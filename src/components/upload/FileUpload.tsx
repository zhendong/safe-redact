import { useCallback, useState } from 'react';
import { validateFile } from '@/utils/validation';
import { useLanguage } from '@/contexts/LanguageContext';
import { isDesktop, pickFile } from '@/platform';

interface FileUploadProps {
  onFileSelect: (file: File) => void;
}

export function FileUpload({ onFileSelect }: FileUploadProps) {
  const { t } = useLanguage();
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback(
    (file: File) => {
      const validation = validateFile(file);
      if (!validation.valid) {
        setError(validation.error || t('errors.invalidFileType'));
        return;
      }

      setError(null);
      onFileSelect(file);
    },
    [onFileSelect, t]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) {
        handleFile(files[0]);
      }
    },
    [handleFile]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        handleFile(files[0]);
      }
    },
    [handleFile]
  );

  const handleClick = useCallback(async () => {
    if (isDesktop) {
      const file = await pickFile(t('upload.fileFilterName'), ['pdf', 'docx', 'png', 'jpg', 'jpeg', 'webp']);
      if (file) handleFile(file);
      return;
    }
    const input = document.getElementById('file-input') as HTMLInputElement;
    input?.click();
  }, [handleFile, t]);

  return (
    <div className="w-full max-w-2xl mx-auto px-2 sm:px-8 pb-8">
      <section className="text-center pt-10 sm:pt-16 pb-10 sm:pb-12">
        <p className="mb-5 text-xs tracking-[0.14em] uppercase text-gray-500 dark:text-gray-400">
          {t('upload.eyebrow')}
        </p>
        <h2 className="font-serif font-normal text-5xl sm:text-6xl leading-[1.04] tracking-tight text-gray-900 dark:text-white">
          {t('upload.heroTitle')}
          <br />
          <em className="text-gray-500 dark:text-gray-400 [:lang(zh-CN)_&]:not-italic">{t('upload.heroTitleEm')}</em>
        </h2>
        <p className="max-w-lg mx-auto mt-6 text-base sm:text-lg text-gray-500 dark:text-gray-400">
          {t('upload.heroLede')}
        </p>
      </section>

      <div
        className={`
          relative border border-dashed rounded-xl p-12
          transition-all duration-200 ease-in-out cursor-pointer
          ${
            isDragging
              ? 'border-ink bg-gray-100 dark:bg-gray-800 dark:border-gray-300 -translate-y-0.5'
              : 'border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-gray-500 dark:hover:border-gray-500 hover:-translate-y-0.5 hover:shadow-[0_18px_40px_-24px_rgba(28,27,25,0.25)]'
          }
        `}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            void handleClick();
          }
        }}
      >
        <input
          id="file-input"
          type="file"
          accept=".pdf,.docx,.png,.jpg,.jpeg,.webp,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/png,image/jpeg,image/webp"
          onChange={handleFileInput}
          className="hidden"
          aria-label={t('upload.uploadAriaLabel')}
        />

        <div className="flex flex-col items-center justify-center gap-4">
          <span className="grid place-items-center w-14 h-14 rounded-2xl bg-paper dark:bg-gray-900 border border-gray-200 dark:border-gray-700">
          <svg
            className="w-7 h-7 text-gray-600 dark:text-gray-300"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
            />
          </svg>
          </span>

          <div className="text-center">
            <p className="text-lg font-semibold tracking-tight text-gray-900 dark:text-gray-100">
              {t('upload.dragDrop')}
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {t('upload.orClickBrowse')}
            </p>
          </div>

          <p className="text-xs text-gray-400 dark:text-gray-500">
            {t('upload.maxFileSize')}
          </p>
        </div>
      </div>

      {error && (
        <div
          className="mt-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg"
          role="alert"
        >
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      <div className="mt-20">
        <h3 className="font-serif font-normal text-3xl sm:text-4xl tracking-tight text-gray-900 dark:text-white mb-6">
          {t('upload.faqTitle')}
        </h3>
        <div className="divide-y divide-gray-200 dark:divide-gray-800 border-y border-gray-200 dark:border-gray-800 text-[15px]">
          <details className="group py-4">
            <summary className="cursor-pointer font-medium text-gray-900 dark:text-gray-100 list-none flex items-start gap-2 hover:text-black dark:hover:text-white">
              <svg className="w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0 mt-0.5 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              {t('upload.faq1Q')}
            </summary>
            <p className="mt-2 ml-6 sm:ml-7 text-gray-500 dark:text-gray-400 leading-relaxed">
              {t('upload.faq1A')}
            </p>
          </details>

          <details className="group py-4">
            <summary className="cursor-pointer font-medium text-gray-900 dark:text-gray-100 list-none flex items-start gap-2 hover:text-black dark:hover:text-white">
              <svg className="w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0 mt-0.5 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              {t('upload.faq2Q')}
            </summary>
            <p className="mt-2 ml-6 sm:ml-7 text-gray-500 dark:text-gray-400 leading-relaxed">
              {t('upload.faq2A')}
            </p>
          </details>

          <details className="group py-4">
            <summary className="cursor-pointer font-medium text-gray-900 dark:text-gray-100 list-none flex items-start gap-2 hover:text-black dark:hover:text-white">
              <svg className="w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0 mt-0.5 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              {t('upload.faq3Q')}
            </summary>
            <p className="mt-2 ml-6 sm:ml-7 text-gray-500 dark:text-gray-400 leading-relaxed">
              {t('upload.faq3A')}
            </p>
          </details>

          <details className="group py-4">
            <summary className="cursor-pointer font-medium text-gray-900 dark:text-gray-100 list-none flex items-start gap-2 hover:text-black dark:hover:text-white">
              <svg className="w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0 mt-0.5 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              {t('upload.faq4Q')}
            </summary>
            <p className="mt-2 ml-6 sm:ml-7 text-gray-500 dark:text-gray-400 leading-relaxed">
              {t('upload.faq4A')}
            </p>
          </details>

          <details className="group py-4">
            <summary className="cursor-pointer font-medium text-gray-900 dark:text-gray-100 list-none flex items-start gap-2 hover:text-black dark:hover:text-white">
              <svg className="w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0 mt-0.5 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              {t('upload.faq5Q')}
            </summary>
            <p className="mt-2 ml-6 sm:ml-7 text-gray-500 dark:text-gray-400 leading-relaxed">
              {t('upload.faq5A')}
            </p>
          </details>

          <details className="group py-4">
            <summary className="cursor-pointer font-medium text-gray-900 dark:text-gray-100 list-none flex items-start gap-2 hover:text-black dark:hover:text-white">
              <svg className="w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0 mt-0.5 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              {t('upload.faq6Q')}
            </summary>
            <p className="mt-2 ml-6 sm:ml-7 text-gray-500 dark:text-gray-400 leading-relaxed">
              {t('upload.faq6A').split('{{link}}')[0]}
              <a
                href="https://github.com/zhendong/safe-redact"
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-900 dark:text-gray-100 underline underline-offset-2 decoration-accent font-medium hover:decoration-current"
              >
                GitHub
              </a>
              {t('upload.faq6A').split('{{link}}')[1]}
            </p>
          </details>
        </div>

        <div className="mt-10 p-6 sm:p-8 rounded-2xl bg-ink text-paper dark:bg-gray-800 dark:border dark:border-gray-700">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <p className="font-serif text-2xl leading-tight">
                {t('upload.cantFind')}
              </p>
              <p className="text-sm text-gray-300 dark:text-gray-400 mt-1.5">
                {t('upload.cantFindDesc')}
              </p>
            </div>
            <a
              href="https://github.com/zhendong/safe-redact/issues/new"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-paper text-ink text-sm font-medium whitespace-nowrap transition-all duration-200 hover:-translate-y-px hover:bg-white"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
              </svg>
              {t('upload.reportIssue')}
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
