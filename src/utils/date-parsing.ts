/**
 * Date parsing utilities for DOCX and PDF documents
 */

/**
 * Pad number with leading zeros
 */
export function padNumber(n: number, width: number = 2): string {
  return String(n).padStart(width, '0');
}

/**
 * Calculate local timezone offset in ISO format
 */
export function getLocalTimezoneOffset(date: Date): string {
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const hours = Math.floor(Math.abs(offset) / 60);
  const minutes = Math.abs(offset) % 60;
  return `${sign}${padNumber(hours)}:${padNumber(minutes)}`;
}

/**
 * Parse and validate ISO date string with timezone preservation
 * DOCX dates: 2000-01-01T00:00:00Z
 * Returns ISO string with original timezone preserved, null otherwise
 */
export function parseDocxDateToIso(dateString: string): string | null {
  if (!dateString) return null;

  try {
    const trimmed = dateString.trim();
    const date = new Date(trimmed);

    // Check if date is valid
    if (isNaN(date.getTime())) {
      return null;
    }

    // Check if original string has timezone info (Z or ±HH:mm)
    const hasTimezone = /[Zz]$|[+-]\d{2}:\d{2}$/.test(trimmed);

    if (hasTimezone) {
      // Return original format with timezone preserved
      // Normalize to ISO 8601 format if needed
      return trimmed;
    } else {
      // No timezone info - add local timezone offset
      const offset = -date.getTimezoneOffset();
      const offsetSign = offset >= 0 ? '+' : '-';
      const offsetHours = Math.floor(Math.abs(offset) / 60);
      const offsetMinutes = Math.abs(offset) % 60;

      const year = date.getFullYear();
      const month = date.getMonth() + 1;
      const day = date.getDate();
      const hour = date.getHours();
      const minute = date.getMinutes();
      const second = date.getSeconds();

      return `${year}-${padNumber(month)}-${padNumber(day)}T${padNumber(hour)}:${padNumber(minute)}:${padNumber(second)}${offsetSign}${padNumber(offsetHours)}:${padNumber(offsetMinutes)}`;
    }
  } catch (e) {
    return null;
  }
}

/**
 * Parse PDF date format to ISO string with timezone preservation
 * PDF dates: D:YYYYMMDDHHmmSSOHH'mm' or D:YYYYMMDDHHmmSS+HH'mm'
 * Returns ISO 8601 format with timezone: YYYY-MM-DDTHH:mm:ss±HH:mm or YYYY-MM-DDTHH:mm:ssZ
 */
export function parsePdfDateToIso(dateString: string): string | null {
  if (!dateString) return null;

  try {
    // Remove 'D:' prefix if present
    let str = dateString.startsWith('D:') ? dateString.substring(2) : dateString;

    // Extract date/time components
    const year = parseInt(str.substring(0, 4));
    const month = parseInt(str.substring(4, 6));
    const day = parseInt(str.substring(6, 8));
    const hour = parseInt(str.substring(8, 10)) || 0;
    const minute = parseInt(str.substring(10, 12)) || 0;
    const second = parseInt(str.substring(12, 14)) || 0;

    // Validate date components
    if (isNaN(year) || isNaN(month) || isNaN(day)) {
      return null;
    }

    // Handle timezone
    const tzMatch = str.match(/([Z+-])(\d{2})'?(\d{2})?'?$/);

    if (tzMatch) {
      const [, sign, tzHours, tzMinutes = '0'] = tzMatch;

      if (sign === 'Z') {
        // UTC timezone
        return `${year}-${padNumber(month)}-${padNumber(day)}T${padNumber(hour)}:${padNumber(minute)}:${padNumber(second)}Z`;
      } else {
        // Offset timezone - preserve original offset in ISO format
        return `${year}-${padNumber(month)}-${padNumber(day)}T${padNumber(hour)}:${padNumber(minute)}:${padNumber(second)}${sign}${padNumber(parseInt(tzHours))}:${padNumber(parseInt(tzMinutes))}`;
      }
    } else {
      // No timezone info - use local timezone offset
      const date = new Date(year, month - 1, day, hour, minute, second);
      if (isNaN(date.getTime())) return null;

      // Get local timezone offset and format as ISO with offset
      const offset = -date.getTimezoneOffset();
      const offsetSign = offset >= 0 ? '+' : '-';
      const offsetHours = Math.floor(Math.abs(offset) / 60);
      const offsetMinutes = Math.abs(offset) % 60;

      return `${year}-${padNumber(month)}-${padNumber(day)}T${padNumber(hour)}:${padNumber(minute)}:${padNumber(second)}${offsetSign}${padNumber(offsetHours)}:${padNumber(offsetMinutes)}`;
    }
  } catch (e) {
    return null;
  }
}
