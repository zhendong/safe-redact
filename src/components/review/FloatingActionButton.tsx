interface FloatingActionButtonProps {
  entityCount: number;
  selectedCount: number;
  onClick: () => void;
}

export function FloatingActionButton({ entityCount, selectedCount, onClick }: FloatingActionButtonProps) {
  return (
    <button
      onClick={onClick}
      className="fixed bottom-6 right-6 z-30 lg:hidden w-14 h-14 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg hover:shadow-xl transition-all flex items-center justify-center group"
      aria-label="View entities"
    >
      {/* Badge with count */}
      {entityCount > 0 && (
        <div className="absolute -top-1 -right-1 bg-red-600 text-white text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center border-2 border-white dark:border-gray-900">
          {entityCount > 99 ? '99+' : entityCount}
        </div>
      )}

      {/* Selected count indicator */}
      {selectedCount > 0 && (
        <div className="absolute -bottom-1 -left-1 bg-green-600 text-white text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center border-2 border-white dark:border-gray-900">
          {selectedCount > 99 ? '99+' : selectedCount}
        </div>
      )}

      {/* Icon */}
      <svg
        className="w-6 h-6"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
        />
      </svg>

      {/* Tooltip */}
      <span className="absolute bottom-full mb-2 right-0 bg-gray-900 text-white text-xs py-1 px-2 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        View Entities
      </span>
    </button>
  );
}
