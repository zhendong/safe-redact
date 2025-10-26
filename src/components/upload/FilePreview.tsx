import { formatFileSize } from '@/utils/validation';

interface FilePreviewProps {
  file: File;
  pageCount?: number;
  onRemove: () => void;
  onStartAnalysis: () => void;
}

export function FilePreview({
  file,
  pageCount,
  onRemove,
  onStartAnalysis,
}: FilePreviewProps) {
  return (
    <div className="w-full max-w-2xl mx-auto p-8">
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 shadow-sm">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0">
              <svg
                className="w-12 h-12 text-red-500 dark:text-red-400"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-medium text-gray-900 dark:text-white break-all">
                {file.name}
              </h3>
              <div className="mt-1 text-sm text-gray-500 dark:text-gray-400 space-y-1">
                <p>Size: {formatFileSize(file.size)}</p>
                {pageCount !== undefined && <p>Pages: {pageCount}</p>}
              </div>
            </div>
          </div>

          <button
            onClick={onRemove}
            className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            aria-label="Remove file"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>

        <button
          onClick={onStartAnalysis}
          className="w-full mt-4 px-6 py-3 bg-blue-600 dark:bg-blue-500 text-white font-medium rounded-lg hover:bg-blue-700 dark:hover:bg-blue-600 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
        >
          Start Analysis
        </button>
      </div>
    </div>
  );
}
