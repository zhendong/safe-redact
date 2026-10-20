/**
 * Checksum validation for cryptocurrency addresses.
 * Synchronous on purpose: regex validators run inline during detection,
 * and crypto.subtle.digest is async-only.
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function sha256(data: Uint8Array): Uint8Array {
  const length = data.length;
  const padded = new Uint8Array(Math.ceil((length + 9) / 64) * 64);
  padded.set(data);
  padded[length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 4, length * 8);
  view.setUint32(padded.length - 8, Math.floor(length / 0x20000000));

  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = w[i - 16] + s0 + w[i - 7] + s1;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i];
      const t2 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c));
      hh = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  h.forEach((word, i) => outView.setUint32(i * 4, word));
  return out;
}

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Legacy (1…) and P2SH (3…) addresses: Base58Check with a double SHA-256 checksum */
function isValidBase58Check(address: string): boolean {
  // Decode base58 into little-endian bytes, then add one zero byte per leading '1'
  const bytes: number[] = [];
  for (const char of address) {
    let carry = BASE58.indexOf(char);
    if (carry < 0) return false;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const char of address) {
    if (char !== '1') break;
    bytes.push(0);
  }
  bytes.reverse();
  if (bytes.length !== 25) return false;

  const payload = new Uint8Array(bytes.slice(0, 21));
  const checksum = sha256(sha256(payload));
  return checksum[0] === bytes[21] && checksum[1] === bytes[22] && checksum[2] === bytes[23] && checksum[3] === bytes[24];
}

const BECH32 = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

/** SegWit (bc1q…, bech32) and Taproot (bc1p…, bech32m) addresses */
function isValidBech32(address: string): boolean {
  const lower = address.toLowerCase();
  if (lower !== address && address.toUpperCase() !== address) return false;
  const separator = lower.lastIndexOf('1');
  const hrp = lower.slice(0, separator);
  const data = [...lower.slice(separator + 1)].map(char => BECH32.indexOf(char));
  if (hrp !== 'bc' || data.length < 7 || data.includes(-1)) return false;

  const generators = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let checksum = 1;
  const values = [...[...hrp].map(c => c.charCodeAt(0) >> 5), 0, ...[...hrp].map(c => c.charCodeAt(0) & 31), ...data];
  for (const value of values) {
    const top = checksum >>> 25;
    checksum = ((checksum & 0x1ffffff) << 5) ^ value;
    for (let i = 0; i < 5; i++) {
      if ((top >>> i) & 1) checksum ^= generators[i];
    }
  }
  // Witness version 0 uses bech32 (constant 1), later versions use bech32m
  const expected = data[0] === 0 ? 1 : 0x2bc830a3;
  return checksum >>> 0 === expected;
}

export function isValidBitcoinAddress(address: string): boolean {
  return /^bc1/i.test(address) ? isValidBech32(address) : isValidBase58Check(address);
}
