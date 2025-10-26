import { useCallback, useState } from 'react';
import { validateFile } from '@/utils/validation';

interface FileUploadProps {
  onFileSelect: (file: File) => void;
}

export function FileUpload({ onFileSelect }: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback(
    (file: File) => {
      const validation = validateFile(file);
      if (!validation.valid) {
        setError(validation.error || 'Invalid file');
        return;
      }

      setError(null);
      onFileSelect(file);
    },
    [onFileSelect]
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

  const handleClick = useCallback(() => {
    const input = document.getElementById('file-input') as HTMLInputElement;
    input?.click();
  }, []);

  return (
    <div className="w-full max-w-2xl mx-auto p-8">
      <div
        className={`
          relative border-2 border-dashed rounded-lg p-12
          transition-all duration-200 ease-in-out cursor-pointer
          ${
            isDragging
              ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-400'
              : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:border-gray-400 dark:hover:border-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700'
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
            handleClick();
          }
        }}
      >
        <input
          id="file-input"
          type="file"
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          onChange={handleFileInput}
          className="hidden"
          aria-label="Upload PDF or DOCX file"
        />

        <div className="flex flex-col items-center justify-center gap-4">
          <svg
            className="w-16 h-16 text-gray-400 dark:text-gray-500"
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

          <div className="text-center">
            <p className="text-lg font-medium text-gray-700 dark:text-gray-200">
              Drag and Drop PDF or DOCX Here
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              or click to browse
            </p>
          </div>

          <p className="text-xs text-gray-400 dark:text-gray-500">
            Maximum file size: 50MB
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

      <div className="mt-8 p-6 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
        <h3 className="text-lg font-semibold text-blue-900 dark:text-blue-200 mb-4 flex items-center gap-2">
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          Frequently Asked Questions
        </h3>
        <div className="space-y-3 text-sm">
          <details className="group">
            <summary className="cursor-pointer font-medium text-blue-900 dark:text-blue-200 list-none flex items-start gap-2">
              <svg className="w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0 mt-0.5 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              Is SafeRedact running locally in my device?
            </summary>
            <p className="mt-2 ml-6 sm:ml-7 text-blue-800 dark:text-blue-300">
              Yes, SafeRedact runs entirely in your browser. All processing happens on YOUR device. Your documents NEVER leave your browser, and no data is uploaded to any server. In fact, you can now trun off your WIFI and SafeRedact will still work!
            </p>
          </details>

          <details className="group">
            <summary className="cursor-pointer font-medium text-blue-900 dark:text-blue-200 list-none flex items-start gap-2">
              <svg className="w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0 mt-0.5 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              Which kind of information can be detected by SafeRedact?
            </summary>
            <p className="mt-2 ml-6 sm:ml-7 text-blue-800 dark:text-blue-300">
              SafeRedact can detect various types of sensitive information including email addresses, phone numbers, credit card numbers, social security numbers, IP addresses, URLs, dates, and custom patterns you define. It uses both predefined patterns and local AI model detection (thanking to webGPU, but the feature is still in beta and need tunning). When removing sensitive information, SafeRedact replaces the detected text with a black box and remove the underlaying texts to ensure complete redaction.
            </p>
          </details>

          <details className="group">
            <summary className="cursor-pointer font-medium text-blue-900 dark:text-blue-200 list-none flex items-start gap-2">
              <svg className="w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0 mt-0.5 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              What kind of information would be removed if sanitization is enabled?
            </summary>
            <p className="mt-2 ml-6 sm:ml-7 text-blue-800 dark:text-blue-300">
              When sanitization is enabled, SafeRedact automatically removes document metadata (author, creation date, modification date, etc.), comments, tracked changes, hidden text, and other embedded information that might reveal sensitive details about the document's origin or editing history.
            </p>
          </details>

          <details className="group">
            <summary className="cursor-pointer font-medium text-blue-900 dark:text-blue-200 list-none flex items-start gap-2">
              <svg className="w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0 mt-0.5 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              Can SafeRedact detect texts in images?
            </summary>
            <p className="mt-2 ml-6 sm:ml-7 text-blue-800 dark:text-blue-300">
              No, SafeRedact cannot detect or redact text within images. However, SafeRedact will list all found images inside the files, which you can view inside the metadata view. This allows you to review images manually for any sensitive information.
            </p>
          </details>

          <details className="group">
            <summary className="cursor-pointer font-medium text-blue-900 dark:text-blue-200 list-none flex items-start gap-2">
              <svg className="w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0 mt-0.5 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              Are there tracking or analytics services inside the app?
            </summary>
            <p className="mt-2 ml-6 sm:ml-7 text-blue-800 dark:text-blue-300">
              No, SafeRedact does not include any tracking or analytics services. Your privacy is well respected. No usage data, files, or personal information is ever collected or transmitted.
            </p>
          </details>

          <details className="group">
            <summary className="cursor-pointer font-medium text-blue-900 dark:text-blue-200 list-none flex items-start gap-2">
              <svg className="w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0 mt-0.5 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              Is SafeRedact open source?
            </summary>
            <p className="mt-2 ml-6 sm:ml-7 text-blue-800 dark:text-blue-300">
              Yes! SafeRedact is fully open source under the MIT License. You can view, audit, and contribute to the source code on{' '}
              <a
                href="https://github.com/zhendong/safe-redact"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 underline font-medium"
              >
                GitHub
              </a>
              . Contributions, bug reports, and feature requests are welcomed!
            </p>
          </details>
        </div>

        <div className="mt-6 pt-4 border-t border-blue-200 dark:border-blue-700">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-blue-900 dark:text-blue-200">
                Can't find what you're looking for?
              </p>
              <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                Report a bug, request a feature, or ask a question
              </p>
            </div>
            <a
              href="https://github.com/zhendong/safe-redact/issues/new"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
              </svg>
              Report an Issue
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
