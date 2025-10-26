import type { HiddenContentReport } from '@/lib/types';

interface HiddenContentWarningProps {
  report: HiddenContentReport;
  onDismiss?: () => void;
}

export function HiddenContentWarning({ report, onDismiss }: HiddenContentWarningProps) {
  if (!report.hasHiddenContent) return null;

  const highSeverityWarnings = report.warnings.filter(w => w.severity === 'high');
  const mediumSeverityWarnings = report.warnings.filter(w => w.severity === 'medium');
  const lowSeverityWarnings = report.warnings.filter(w => w.severity === 'low');

  const hasCriticalIssues = highSeverityWarnings.length > 0;

  return (
    <div className={`rounded-lg border p-4 ${
      hasCriticalIssues
        ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
        : 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800'
    }`}>
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className={`flex-shrink-0 mt-0.5 ${
          hasCriticalIssues ? 'text-red-600 dark:text-red-400' : 'text-yellow-600 dark:text-yellow-400'
        }`}>
          <svg
            className="w-5 h-5"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <h3 className={`text-sm font-semibold ${
            hasCriticalIssues ? 'text-red-900 dark:text-red-200' : 'text-yellow-900 dark:text-yellow-200'
          }`}>
            Hidden Content Detected
          </h3>
          <p className={`text-sm mt-1 ${
            hasCriticalIssues ? 'text-red-700 dark:text-red-300' : 'text-yellow-700 dark:text-yellow-300'
          }`}>
            {report.summary}
          </p>

          {/* Warning Details */}
          <div className="mt-3 space-y-2">
            {report.warnings.map((warning, index) => (
              <div
                key={index}
                className={`text-xs p-2 rounded ${
                  warning.severity === 'high'
                    ? 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200'
                    : warning.severity === 'medium'
                    ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200'
                    : 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200'
                }`}
              >
                <div className="font-medium">
                  {warning.description}
                  {warning.count && ` (${warning.count})`}
                </div>
                {warning.details && (
                  <div className="mt-1 opacity-90">
                    {warning.details}
                  </div>
                )}
                {warning.pageNumbers && warning.pageNumbers.length > 0 && (
                  <div className="mt-1 opacity-90">
                    Pages: {warning.pageNumbers.join(', ')}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Recommendation */}
          <div className={`mt-3 text-xs ${
            hasCriticalIssues ? 'text-red-800 dark:text-red-200' : 'text-yellow-800 dark:text-yellow-200'
          }`}>
            <strong>Recommendation:</strong> Enable "Sanitize Document" in Settings to remove hidden content when exporting.
          </div>
        </div>

        {/* Dismiss Button */}
        {onDismiss && (
          <button
            onClick={onDismiss}
            className={`flex-shrink-0 ${
              hasCriticalIssues ? 'text-red-400 hover:text-red-600 dark:hover:text-red-300' : 'text-yellow-400 hover:text-yellow-600 dark:hover:text-yellow-300'
            }`}
            aria-label="Dismiss warning"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
