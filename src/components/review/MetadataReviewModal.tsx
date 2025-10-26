import { useEffect, useState } from 'react';
import type { HiddenContentReport, ExtractedImage } from '@/lib/types';

interface DocumentMetadata {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
  creator?: string;
  producer?: string;
  creationDate?: string;
  modificationDate?: string;
  images?: ExtractedImage[];
  [key: string]: string | ExtractedImage[] | undefined;
}

/**
 * Format ISO date string for display
 * Dates are stored in ISO 8601 format with timezone by the parsers
 * Simply returns the ISO string as-is to preserve timezone information
 */
function formatDate(isoDateString: string): string {
  // Return the ISO date string directly - it already contains all timezone info
  return isoDateString || '';
}

interface MetadataReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  metadata?: DocumentMetadata;
  hiddenContentReport?: HiddenContentReport;
  fileType: 'pdf' | 'docx';
}

export function MetadataReviewModal({
  isOpen,
  onClose,
  metadata = {},
  hiddenContentReport,
  fileType,
}: MetadataReviewModalProps) {
  const [imagePreviews, setImagePreviews] = useState<Map<string, string>>(new Map());

  // Separate images from other metadata
  const images = metadata.images;
  const hasImages = images && images.length > 0;

  // Generate preview URLs for images
  useEffect(() => {
    if (!images || images.length === 0) {
      setImagePreviews(new Map());
      return;
    }

    const previewMap = new Map<string, string>();
    const urlsToRevoke: string[] = [];

    images.forEach((image) => {
      const url = URL.createObjectURL(image.data);
      previewMap.set(image.id, url);
      urlsToRevoke.push(url);
    });

    setImagePreviews(previewMap);

    // Cleanup function to revoke URLs when component unmounts or images change
    return () => {
      urlsToRevoke.forEach(url => URL.revokeObjectURL(url));
    };
  }, [images]);

  if (!isOpen) return null;

  // Filter out images from metadata entries for display (only string values)
  const metadataEntries = Object.entries(metadata)
    .filter(([key, value]) => value && key !== 'images' && typeof value === 'string') as [string, string][];
  const hasMetadata = metadataEntries.length > 0;
  const hasHiddenContent = hiddenContentReport?.hasHiddenContent;

  // Function to download a single image
  const downloadImage = (image: ExtractedImage) => {
    const url = URL.createObjectURL(image.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = image.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Function to download all images as a zip (simple approach: download one by one)
  const downloadAllImages = () => {
    if (!images) return;
    images.forEach((image, index) => {
      setTimeout(() => downloadImage(image), index * 100); // Stagger downloads
    });
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-4xl w-full max-h-[80vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
            Document Metadata & Hidden Content
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            aria-label="Close modal"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Metadata Section */}
          <section>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
              <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
              Document Metadata
            </h3>

            {hasMetadata ? (
              <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-100 dark:bg-gray-800">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-gray-300">Property</th>
                      <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-gray-300">Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {metadataEntries.map(([key, value]) => {
                      // Format dates for display
                      const isDateField = key.toLowerCase().includes('date');
                      const displayValue: string = isDateField && value ? formatDate(value) : value;

                      return (
                        <tr key={key} className="hover:bg-gray-100 dark:hover:bg-gray-800/50">
                          <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100 capitalize">
                            {key.replace(/([A-Z])/g, ' $1').trim()}
                          </td>
                          <td className="px-4 py-3 text-gray-600 dark:text-gray-400 break-all">
                            {displayValue}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                <p className="text-sm text-gray-600 dark:text-gray-400 flex items-center gap-2">
                  <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  No metadata found in this document
                </p>
              </div>
            )}
          </section>

          {/* Hidden Content Section */}
          <section>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
              <svg className="w-5 h-5 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
              </svg>
              Hidden Content Analysis
            </h3>

            {hasHiddenContent ? (
              <div className="space-y-3">
                <div className={`rounded-lg border p-4 ${
                  hiddenContentReport.warnings.some(w => w.severity === 'high')
                    ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
                    : 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800'
                }`}>
                  <p className="text-sm font-medium text-gray-900 dark:text-white mb-2">
                    {hiddenContentReport.summary}
                  </p>
                </div>

                {hiddenContentReport.warnings.map((warning, index) => (
                  <div
                    key={index}
                    className={`rounded-lg border p-4 ${
                      warning.severity === 'high'
                        ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
                        : warning.severity === 'medium'
                        ? 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800'
                        : 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`flex-shrink-0 mt-0.5 ${
                        warning.severity === 'high'
                          ? 'text-red-600 dark:text-red-400'
                          : warning.severity === 'medium'
                          ? 'text-yellow-600 dark:text-yellow-400'
                          : 'text-blue-600 dark:text-blue-400'
                      }`}>
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className={`text-sm font-semibold mb-1 ${
                          warning.severity === 'high'
                            ? 'text-red-900 dark:text-red-200'
                            : warning.severity === 'medium'
                            ? 'text-yellow-900 dark:text-yellow-200'
                            : 'text-blue-900 dark:text-blue-200'
                        }`}>
                          {warning.description}
                          {warning.count && ` (${warning.count})`}
                        </div>
                        {warning.details && (
                          <p className={`text-xs mt-1 ${
                            warning.severity === 'high'
                              ? 'text-red-700 dark:text-red-300'
                              : warning.severity === 'medium'
                              ? 'text-yellow-700 dark:text-yellow-300'
                              : 'text-blue-700 dark:text-blue-300'
                          }`}>
                            {warning.details}
                          </p>
                        )}
                        {warning.pageNumbers && warning.pageNumbers.length > 0 && (
                          <p className={`text-xs mt-1 ${
                            warning.severity === 'high'
                              ? 'text-red-700 dark:text-red-300'
                              : warning.severity === 'medium'
                              ? 'text-yellow-700 dark:text-yellow-300'
                              : 'text-blue-700 dark:text-blue-300'
                          }`}>
                            Pages: {warning.pageNumbers.join(', ')}
                          </p>
                        )}
                      </div>
                      <span className={`flex-shrink-0 text-xs font-semibold px-2 py-1 rounded ${
                        warning.severity === 'high'
                          ? 'bg-red-200 dark:bg-red-900/50 text-red-900 dark:text-red-200'
                          : warning.severity === 'medium'
                          ? 'bg-yellow-200 dark:bg-yellow-900/50 text-yellow-900 dark:text-yellow-200'
                          : 'bg-blue-200 dark:bg-blue-900/50 text-blue-900 dark:text-blue-200'
                      }`}>
                        {warning.severity.toUpperCase()}
                      </span>
                    </div>
                  </div>
                ))}

                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <svg className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div className="text-sm text-blue-800 dark:text-blue-200">
                      <strong>Recommendation:</strong> Enable "Sanitize Document" in Settings to automatically remove metadata and hidden content when applying redactions.
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                <p className="text-sm text-gray-600 dark:text-gray-400 flex items-center gap-2">
                  <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  No hidden content detected in this document
                </p>
              </div>
            )}
          </section>

          {/* Images Section */}
          <section>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
              <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              Document Images
            </h3>

            {hasImages ? (
              <div className="space-y-3">
                <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <svg className="w-5 h-5 text-purple-600 dark:text-purple-400 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                    </svg>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-purple-900 dark:text-purple-100">
                        Found {images!.length} image{images!.length !== 1 ? 's' : ''} in this document
                      </p>
                      <p className="text-xs mt-1 text-purple-700 dark:text-purple-300">
                        Images may contain sensitive information or metadata. Review carefully before sharing.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-semibold text-gray-900 dark:text-white">
                      Extracted Images
                    </h4>
                    {images!.length > 1 && (
                      <button
                        onClick={downloadAllImages}
                        className="text-xs px-3 py-1 bg-purple-600 text-white rounded hover:bg-purple-700 transition-colors flex items-center gap-1"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        Download All
                      </button>
                    )}
                  </div>

                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {images!.map((image) => {
                      const previewUrl = imagePreviews.get(image.id);
                      return (
                        <div
                          key={image.id}
                          className="flex items-center justify-between p-2 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750"
                        >
                          <div className="flex items-center gap-3 flex-1 min-w-0">
                            {previewUrl ? (
                              <img
                                src={previewUrl}
                                alt={image.filename}
                                className="w-12 h-12 object-cover rounded border border-gray-300 dark:border-gray-600 flex-shrink-0"
                                loading="lazy"
                              />
                            ) : (
                              <div className="w-12 h-12 flex items-center justify-center bg-gray-100 dark:bg-gray-700 rounded border border-gray-300 dark:border-gray-600 flex-shrink-0">
                                <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                </svg>
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                                {image.filename}
                              </p>
                              <p className="text-xs text-gray-500 dark:text-gray-400">
                                {image.mimeType}
                                {image.width && image.height && ` • ${image.width}x${image.height}`}
                                {image.pageNumber && ` • Page ${image.pageNumber}`}
                              </p>
                            </div>
                          </div>
                          <button
                            onClick={() => downloadImage(image)}
                            className="ml-2 px-2 py-1 text-xs bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors flex items-center gap-1 flex-shrink-0"
                            title="Download image"
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                            </svg>
                            Download
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                <p className="text-sm text-gray-600 dark:text-gray-400 flex items-center gap-2">
                  <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  No images found in this document
                </p>
              </div>
            )}
          </section>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 font-medium rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
