/**
 * PDF-specific constants
 */

// PDF metadata keys
export const PDF_METADATA_KEYS = {
  TITLE: 'info:Title',
  AUTHOR: 'info:Author',
  SUBJECT: 'info:Subject',
  KEYWORDS: 'info:Keywords',
  CREATOR: 'info:Creator',
  PRODUCER: 'info:Producer',
  CREATION_DATE: 'info:CreationDate',
  MOD_DATE: 'info:ModDate',
} as const;

// Array of all PDF metadata keys for iteration
export const PDF_METADATA_KEYS_ARRAY = Object.values(PDF_METADATA_KEYS);
