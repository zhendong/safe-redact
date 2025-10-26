interface MobileViewSwitcherProps {
  viewMode: 'document' | 'entities';
  onViewModeChange: (mode: 'document' | 'entities') => void;
  entityCount: number;
}

export function MobileViewSwitcher({ viewMode, onViewModeChange, entityCount }: MobileViewSwitcherProps) {
  return (
    <div className="lg:hidden bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
      <div className="flex">
        <button
          onClick={() => onViewModeChange('document')}
          className={`
            flex-1 py-3 px-4 text-sm font-medium border-b-2 transition-colors
            ${
              viewMode === 'document'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }
          `}
        >
          <div className="flex items-center justify-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
            <span>Document</span>
          </div>
        </button>

        <button
          onClick={() => onViewModeChange('entities')}
          className={`
            flex-1 py-3 px-4 text-sm font-medium border-b-2 transition-colors relative
            ${
              viewMode === 'entities'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }
          `}
        >
          <div className="flex items-center justify-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M4 10h16M4 14h16M4 18h16"
              />
            </svg>
            <span>Entities</span>
            {entityCount > 0 && (
              <span className="ml-1 px-1.5 py-0.5 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded-full">
                {entityCount}
              </span>
            )}
          </div>
        </button>
      </div>
    </div>
  );
}
