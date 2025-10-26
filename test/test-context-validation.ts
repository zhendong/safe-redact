/**
 * Test suite for context-aware confidence boosting
 * Demonstrates how confidence levels change based on surrounding keywords
 */

import { getContextConfidenceBoost } from '../src/utils/regex-patterns';

console.log('\n' + '='.repeat(80));
console.log('CONTEXT-AWARE VALIDATION TEST');
console.log('='.repeat(80) + '\n');

// Test 1: SSN with context keywords
console.log('Test 1: SSN Detection with Context Keywords');
console.log('-'.repeat(80));

const text1 = 'My SSN is 123-45-6789 and my account number is 987654321';
const ssnMatch = '123-45-6789';
const ssnIndex = text1.indexOf(ssnMatch);
const ssnKeywords = ['ssn', 'social security', 'social security number'];

const ssnBoost = getContextConfidenceBoost(text1, ssnIndex, ssnMatch.length, ssnKeywords);
console.log(`Text: "${text1}"`);
console.log(`Match: "${ssnMatch}" at index ${ssnIndex}`);
console.log(`Keywords: ${ssnKeywords.join(', ')}`);
console.log(`Confidence boost: ${ssnBoost}x (${ssnBoost === 1.2 ? '✓ BOOSTED' : '✗ NO BOOST'})`);
console.log(`Base confidence: 0.85 → Adjusted: ${(0.85 * ssnBoost).toFixed(2)}\n`);

// Test 2: SSN without context keywords
console.log('Test 2: SSN Detection WITHOUT Context Keywords');
console.log('-'.repeat(80));

const text2 = 'The number is 123-45-6789 for reference';
const ssnMatch2 = '123-45-6789';
const ssnIndex2 = text2.indexOf(ssnMatch2);

const ssnBoost2 = getContextConfidenceBoost(text2, ssnIndex2, ssnMatch2.length, ssnKeywords);
console.log(`Text: "${text2}"`);
console.log(`Match: "${ssnMatch2}" at index ${ssnIndex2}`);
console.log(`Keywords: ${ssnKeywords.join(', ')}`);
console.log(`Confidence boost: ${ssnBoost2}x (${ssnBoost2 === 1.2 ? '✓ BOOSTED' : '✗ NO BOOST'})`);
console.log(`Base confidence: 0.85 → Adjusted: ${(0.85 * ssnBoost2).toFixed(2)}\n`);

// Test 3: US Passport with context
console.log('Test 3: US Passport with Context Keywords');
console.log('-'.repeat(80));

const text3 = 'US Passport Number: C12345678';
const passportMatch = 'C12345678';
const passportIndex = text3.indexOf(passportMatch);
const passportKeywords = ['passport', 'passport number', 'us passport'];

const passportBoost = getContextConfidenceBoost(text3, passportIndex, passportMatch.length, passportKeywords);
console.log(`Text: "${text3}"`);
console.log(`Match: "${passportMatch}" at index ${passportIndex}`);
console.log(`Keywords: ${passportKeywords.join(', ')}`);
console.log(`Confidence boost: ${passportBoost}x (${passportBoost === 1.2 ? '✓ BOOSTED' : '✗ NO BOOST'})`);
console.log(`Base confidence: 0.40 → Adjusted: ${(0.40 * passportBoost).toFixed(2)}\n`);

// Test 4: US Passport without context (high false positive risk)
console.log('Test 4: US Passport WITHOUT Context Keywords (Likely False Positive)');
console.log('-'.repeat(80));

const text4 = 'Product code M12345678 is in stock';
const productMatch = 'M12345678';
const productIndex = text4.indexOf(productMatch);

const productBoost = getContextConfidenceBoost(text4, productIndex, productMatch.length, passportKeywords);
console.log(`Text: "${text4}"`);
console.log(`Match: "${productMatch}" at index ${productIndex}`);
console.log(`Keywords: ${passportKeywords.join(', ')}`);
console.log(`Confidence boost: ${productBoost}x (${productBoost === 1.2 ? '✓ BOOSTED' : '✗ NO BOOST'})`);
console.log(`Base confidence: 0.40 → Adjusted: ${(0.40 * productBoost).toFixed(2)}`);
console.log(`Note: Low confidence without context indicates likely false positive\n`);

// Test 5: Phone number with Chinese context
console.log('Test 5: Phone Number with Chinese Context Keywords');
console.log('-'.repeat(80));

const text5 = '联系电话：138-0013-8000';
const phoneMatch = '138-0013-8000';
const phoneIndex = text5.indexOf(phoneMatch);
const phoneKeywords = ['电话', '手机', '联系', 'phone', 'mobile', 'tel', 'contact'];

const phoneBoost = getContextConfidenceBoost(text5, phoneIndex, phoneMatch.length, phoneKeywords);
console.log(`Text: "${text5}"`);
console.log(`Match: "${phoneMatch}" at index ${phoneIndex}`);
console.log(`Keywords: ${phoneKeywords.join(', ')}`);
console.log(`Confidence boost: ${phoneBoost}x (${phoneBoost === 1.2 ? '✓ BOOSTED' : '✗ NO BOOST'})`);
console.log(`Base confidence: 0.90 → Adjusted: ${Math.min(1.0, 0.90 * phoneBoost).toFixed(2)} (capped at 1.0)\n`);

// Test 6: Credit card with context
console.log('Test 6: Credit Card with Context Keywords');
console.log('-'.repeat(80));

const text6 = 'Credit card number: 4111-1111-1111-1111';
const cardMatch = '4111-1111-1111-1111';
const cardIndex = text6.indexOf(cardMatch);
const cardKeywords = ['card', 'credit', 'debit', 'visa', 'payment', 'cc'];

const cardBoost = getContextConfidenceBoost(text6, cardIndex, cardMatch.length, cardKeywords);
console.log(`Text: "${text6}"`);
console.log(`Match: "${cardMatch}" at index ${cardIndex}`);
console.log(`Keywords: ${cardKeywords.join(', ')}`);
console.log(`Confidence boost: ${cardBoost}x (${cardBoost === 1.2 ? '✓ BOOSTED' : '✗ NO BOOST'})`);
console.log(`Base confidence: 0.35 → Adjusted: ${(0.35 * cardBoost).toFixed(2)}\n`);

// Summary
console.log('='.repeat(80));
console.log('SUMMARY');
console.log('='.repeat(80));
console.log('Context-aware validation provides a 20% confidence boost when relevant');
console.log('keywords are found within 50 characters of the match.');
console.log('');
console.log('Benefits:');
console.log('  • Higher confidence for genuine matches with context');
console.log('  • Lower confidence for likely false positives without context');
console.log('  • Helps distinguish between sensitive data and similar patterns');
console.log('  • Supports multilingual keywords (English, Chinese, etc.)');
console.log('='.repeat(80) + '\n');
