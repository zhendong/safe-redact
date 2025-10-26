import type { ProcessingStage } from '@/lib/types';

interface ProgressIndicatorProps {
  stage: ProcessingStage;
}

export function ProgressIndicator({ stage }: ProgressIndicatorProps) {
  return (
    <div className="w-full max-w-md mx-auto p-6">
      <div className="mb-4">
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
            {stage.message}
          </span>
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
            {Math.round(stage.progress)}%
          </span>
        </div>
        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5">
          <div
            className="bg-blue-600 dark:bg-blue-500 h-2.5 rounded-full transition-all duration-300 ease-out"
            style={{ width: `${stage.progress}%` }}
            role="progressbar"
            aria-valuenow={stage.progress}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        </div>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
        {stage.stage === 'loading_model' &&
          'The model is cached after first use'}
        {stage.stage === 'parsing' &&
          'Extracting text from your document...'}
        {stage.stage === 'detecting' &&
          'Scanning for sensitive information...'}
      </p>
    </div>
  );
}
