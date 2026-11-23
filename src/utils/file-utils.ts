/**
 * File name manipulation utilities
 */

/**
 * Generate redacted filename with suffix
 */
export function generateRedactedFilename(
  originalFilename: string,
  suffix: string = '-REDACTED'
): string {
  const lastDot = originalFilename.lastIndexOf('.');

  if (lastDot === -1) {
    return `${originalFilename}${suffix}`;
  }

  const nameWithoutExt = originalFilename.substring(0, lastDot);
  const extension = originalFilename.substring(lastDot);

  return `${nameWithoutExt}${suffix}${extension}`;
}

/**
 * Remove file extension
 */
export function removeExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  return lastDot === -1 ? filename : filename.substring(0, lastDot);
}

/** Automatic record names fit the local store and keep Unicode characters intact. */
export function generateRecordName(filename: string): string {
  const name = removeExtension(filename).trim() || filename.trim() || 'DOCX';
  return name.slice(0, 200).replace(/[\uD800-\uDBFF]$/, '') || 'DOCX';
}

/**
 * Get file extension (with dot)
 */
export function getExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  return lastDot === -1 ? '' : filename.substring(lastDot);
}
