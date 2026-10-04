/**
 * PREM-M06A — canonical Cloud Backup payload codec.
 *
 * The backend (PREM-D03) verifies `strlen(payload)` and `sha256(payload)`
 * against the exact bytes it receives, so one upload attempt must produce ONE
 * canonical payload string. That string is:
 *
 *   snapshot object → serialize ONCE → payload string
 *                   → UTF-8 bytes  → exact byte length
 *                   → SHA-256 over those exact bytes
 *
 * The SAME string is then sent as the request `payload`. It is never
 * re-serialized, pretty-printed, re-ordered or whitespace-normalized after the
 * checksum is computed.
 *
 * UTF-8 byte length is authoritative — `payload.length` (UTF-16 code units)
 * under-counts emoji and non-ASCII text and must never be used as the size.
 */

/** Hard client limit mirroring the backend `premium.backup.max_bytes` (25 MB). */
export const MAX_CLOUD_BACKUP_BYTES = 25 * 1024 * 1024

/**
 * The single canonical serialization of a snapshot for Cloud transport.
 * Deterministic for a fresh `createBackupPayload` object (insertion order).
 *
 * @param {object} snapshot the existing local backup payload object
 * @returns {string}
 */
export function serializeCloudBackupPayload(snapshot) {
  return JSON.stringify(snapshot)
}

/**
 * Exact UTF-8 byte length of a string.
 *
 * Uses `TextEncoder` when available (browser, Capacitor WebView, jsdom/Node)
 * and a manual UTF-8 encoder otherwise. Never returns `String.length`.
 *
 * @param {string} value
 * @returns {number}
 */
export function getUtf8ByteLength(value) {
  const text = String(value)

  if (typeof TextEncoder === 'function') {
    return new TextEncoder().encode(text).length
  }

  let bytes = 0
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    if (code < 0x80) {
      bytes += 1
    } else if (code < 0x800) {
      bytes += 2
    } else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      const next = text.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4
        index += 1
      } else {
        bytes += 3
      }
    } else {
      bytes += 3
    }
  }

  return bytes
}

function bytesToHex(bytes) {
  let hex = ''
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0')
  }
  return hex
}

/** Loose runtime guard for a Web Crypto SHA-256 implementation. */
export function isSha256Available() {
  return typeof globalThis.crypto?.subtle?.digest === 'function'
}

/**
 * Lowercase 64-character hexadecimal SHA-256 of the exact UTF-8 bytes.
 *
 * @param {string} value
 * @returns {Promise<string>}
 */
export async function computeSha256Hex(value) {
  const bytes = new TextEncoder().encode(String(value))

  if (!isSha256Available()) {
    throw new Error('Web Crypto SHA-256 is unavailable in this runtime.')
  }

  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return bytesToHex(new Uint8Array(digest))
}

/**
 * Lowercase 64-character hexadecimal SHA-256 of exact raw bytes.
 *
 * Cloud Restore hashes the downloaded body byte-for-byte, so the digest is
 * computed directly over the received bytes with no decode/encode round trip.
 *
 * @param {Uint8Array|ArrayBuffer} bytes
 * @returns {Promise<string>}
 */
export async function computeSha256HexFromBytes(bytes) {
  if (!isSha256Available()) {
    throw new Error('Web Crypto SHA-256 is unavailable in this runtime.')
  }

  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', view)
  return bytesToHex(new Uint8Array(digest))
}

/**
 * Serialize once and derive the exact byte length + checksum for an attempt.
 *
 * @param {object} snapshot
 * @returns {Promise<{payload: string, sizeBytes: number, checksumSha256: string}>}
 */
export async function prepareCloudBackupPayload(snapshot) {
  const payload = serializeCloudBackupPayload(snapshot)
  const sizeBytes = getUtf8ByteLength(payload)
  const checksumSha256 = await computeSha256Hex(payload)

  return { payload, sizeBytes, checksumSha256 }
}
