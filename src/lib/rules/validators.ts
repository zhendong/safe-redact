/**
 * Built-in validators that rules reference by name ("validator": "luhn").
 * They run on the main thread; validators shipped in a pack's code run in the sandbox.
 */

import { isValidBitcoinAddress } from '@/utils/crypto-address';

/**
 * Luhn algorithm for credit card validation
 */
function validateLuhn(cardNumber: string): boolean {
  const digits = cardNumber.replace(/\D/g, '');

  if (digits.length < 13 || digits.length > 19) {
    return false;
  }

  let sum = 0;
  let isEven = false;

  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = parseInt(digits[i], 10);

    if (isEven) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }

    sum += digit;
    isEven = !isEven;
  }

  return sum % 10 === 0;
}

/**
 * Validate a card number matched by the generic card pattern.
 * A grouped 4-4-4-4-3 match may be a 16-digit card followed by a 3-digit CVV,
 * so also accept it when the first 16 digits pass Luhn.
 */
function validateCardNumber(cardNumber: string): boolean {
  if (validateLuhn(cardNumber)) return true;
  const digits = cardNumber.replace(/\D/g, '');
  return digits.length === 19 && /[- ]/.test(cardNumber) && validateLuhn(digits.slice(0, 16));
}

/**
 * Validate SSN format (US Social Security Number)
 * Post-2011 randomization rules: allows 900-999 area numbers
 */
function validateSSN(ssn: string): boolean {
  const digits = ssn.replace(/\D/g, '');

  if (digits.length !== 9) {
    return false;
  }

  const area = parseInt(digits.substring(0, 3));
  const group = parseInt(digits.substring(3, 5));
  const serial = parseInt(digits.substring(5, 9));

  // Post-2011 rules (SSN randomization)
  // Area cannot be 000 or 666
  if (area === 0 || area === 666) {
    return false;
  }

  // Group cannot be 00
  if (group === 0) {
    return false;
  }

  // Serial cannot be 0000
  if (serial === 0) {
    return false;
  }

  return true;
}

/**
 * Validate Chinese National ID (18-digit format)
 * Validates check digit using ISO 7064:1983.MOD 11-2
 */
function validateChineseID(idNumber: string): boolean {
  // Strip 6-8-4 grouping separators (e.g. "110105 19491231 002X")
  const id = idNumber.replace(/[\s-]/g, '').toUpperCase();

  if (id.length !== 18) {
    return false;
  }

  // Validate date portion (positions 6-13: YYYYMMDD)
  const year = parseInt(id.substring(6, 10));
  const month = parseInt(id.substring(10, 12));
  const day = parseInt(id.substring(12, 14));

  if (year < 1900 || year > 2100) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;

  // Validate check digit (position 17, last character)
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const checkCodes = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];

  let sum = 0;
  for (let i = 0; i < 17; i++) {
    sum += parseInt(id[i]) * weights[i];
  }

  const expectedCheck = checkCodes[sum % 11];
  const actualCheck = id[17];

  return expectedCheck === actualCheck;
}

/**
 * Validate US Phone Number
 * Excludes invalid area codes and exchanges
 */
function validateUSPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, '');

  // Extract area code and exchange (remove country code if present)
  const offset = digits.length === 11 ? 1 : 0;
  const areaCode = digits.substring(offset, offset + 3);
  const exchange = digits.substring(offset + 3, offset + 6);
  const line = digits.substring(offset + 6);

  // Area codes never start with 0 or 1
  if (areaCode[0] === '0' || areaCode[0] === '1') return false;

  // Exchanges never start with 0 or 1 either
  if (exchange[0] === '0' || exchange[0] === '1') return false;

  // NXX-555-0100 through 0199 is reserved for fictional use
  if (exchange === '555' && line.startsWith('01')) return false;

  // Valid format check
  if (digits.length !== 10 && digits.length !== 11) return false;

  return true;
}

/**
 * Validate International Phone Number
 * Ensures minimum digit count
 */
function validateInternationalPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, '');

  // Must have between 8 and 15 digits (excluding country code +)
  return digits.length >= 8 && digits.length <= 15;
}

/**
 * Validate China Mobile Number
 * Checks valid mobile prefixes
 */
function validateChinaMobile(phone: string): boolean {
  const digits = phone.replace(/\D/g, '');

  if (digits.length !== 11) return false;

  // Valid mobile prefixes (as of 2024)
  const validPrefixes = /^1(3\d|4[5-9]|5[0-35-9]|6[2567]|7[0-8]|8\d|9[0-35-9])/;
  return validPrefixes.test(digits);
}

export const BUILTIN_VALIDATORS: Record<string, (text: string) => boolean> = {
  'luhn': validateLuhn,
  'credit-card': validateCardNumber,
  'us-ssn': validateSSN,
  'cn-id': validateChineseID,
  'us-phone': validateUSPhone,
  'intl-phone': validateInternationalPhone,
  'cn-mobile': validateChinaMobile,
  'bitcoin': isValidBitcoinAddress,
};
