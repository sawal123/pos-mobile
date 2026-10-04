/**
 * PREM-M06B3 — Cloud Restore payload verification (pure, non-destructive).
 *
 * Turns the exact downloaded wire bytes into a verified backup payload that is
 * safe to hand to `restoreSafetyEngine`. Nothing here mutates local state; the
 * engine remains the single destructive path.
 *
 * Order is strict and fails closed:
 *
 *   raw bytes → size guard → header checksum → metadata/checksum chain
 *             → header schema → JSON.parse → payload schema chain
 *             → validateBackupPayload → same/cross-device mode
 *             → cross-device classifier
 *
 * The body is NEVER parsed or normalized before its checksum is verified, and
 * the payload string is never re-serialized.
 */

import {
  SUPPORTED_BACKUP_VERSIONS,
  classifyCrossDeviceRestoreSafety,
  validateBackupPayload,
} from '@/services/backupService'
import {
  MAX_CLOUD_BACKUP_BYTES,
  computeSha256HexFromBytes,
} from '@/services/cloud/cloudBackupPayload'
import { RESTORE_MODE } from '@/services/restoreSafetyEngine'

export const CLOUD_RESTORE_ERROR = Object.freeze({
  DOWNLOAD_TOO_LARGE: 'RESTORE_DOWNLOAD_TOO_LARGE',
  CHECKSUM_HEADER_MISSING: 'RESTORE_CHECKSUM_HEADER_MISSING',
  CHECKSUM_INVALID: 'RESTORE_CHECKSUM_INVALID',
  CHECKSUM_MISMATCH: 'RESTORE_CHECKSUM_MISMATCH',
  SCHEMA_MISMATCH: 'RESTORE_SCHEMA_MISMATCH',
  SCHEMA_UNSUPPORTED: 'RESTORE_SCHEMA_UNSUPPORTED',
  PAYLOAD_INVALID: 'RESTORE_PAYLOAD_INVALID',
  CROSS_DEVICE_UNSAFE: 'RESTORE_BLOCKED_CROSS_DEVICE_UNSAFE',
})

export const CLOUD_RESTORE_CHECKSUM_HEADER = 'X-Checksum-Sha256'
export const CLOUD_RESTORE_SCHEMA_HEADER = 'X-Backup-Schema-Version'

const CHECKSUM_PATTERN = /^[a-f0-9]{64}$/

/**
 * Case-insensitive header lookup that tolerates both a plain object (as
 * returned by `apiRawRequest`) and a `Headers` instance.
 *
 * @param {object|Headers|null} headers
 * @param {string} name
 * @returns {string|null}
 */
function readHeader(headers, name) {
  if (!headers || typeof headers !== 'object') return null

  if (typeof headers.get === 'function') {
    const value = headers.get(name)
    return typeof value === 'string' ? value : null
  }

  const target = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (String(key).toLowerCase() !== target) continue
    if (value === null || value === undefined) return null
    return String(value)
  }

  return null
}

function fail(code, reason) {
  return { ok: false, code, reason }
}

/**
 * Verify a downloaded Cloud backup and derive its restore mode.
 *
 * @param {object} params
 * @param {Uint8Array} params.bytes       exact downloaded wire bytes
 * @param {string} params.text            UTF-8 decode of `bytes` (unmodified)
 * @param {object|Headers} params.headers response headers
 * @param {object|null} params.metadata   server metadata (checksum + schema + device)
 * @param {string|null} params.deviceIdentifier current device identifier
 * @param {number} [params.maxBytes]
 * @returns {Promise<{ok: boolean, code?: string, reason?: string, payload?: object, mode?: string, schemaVersion?: number, checksumSha256?: string, sizeBytes?: number}>}
 */
export async function verifyCloudRestorePayload({
  bytes,
  text,
  headers,
  metadata = null,
  deviceIdentifier = null,
  maxBytes = MAX_CLOUD_BACKUP_BYTES,
} = {}) {
  const byteLength = bytes?.byteLength ?? (typeof text === 'string' ? text.length : 0)

  if (byteLength <= 0) {
    return fail(CLOUD_RESTORE_ERROR.PAYLOAD_INVALID, 'Cloud backup kosong.')
  }

  if (byteLength > maxBytes) {
    return fail(CLOUD_RESTORE_ERROR.DOWNLOAD_TOO_LARGE, 'Ukuran backup melebihi batas Cloud 25 MB.')
  }

  // ── Checksum chain: metadata ↔ header ↔ calculated bytes ───────────────────
  const headerChecksumRaw = readHeader(headers, CLOUD_RESTORE_CHECKSUM_HEADER)
  if (headerChecksumRaw === null || headerChecksumRaw.trim().length === 0) {
    return fail(
      CLOUD_RESTORE_ERROR.CHECKSUM_HEADER_MISSING,
      'Checksum backup tidak tersedia pada respons.',
    )
  }

  const headerChecksum = headerChecksumRaw.trim().toLowerCase()
  if (!CHECKSUM_PATTERN.test(headerChecksum)) {
    return fail(CLOUD_RESTORE_ERROR.CHECKSUM_INVALID, 'Checksum pada respons tidak valid.')
  }

  const metadataChecksum =
    typeof metadata?.checksumSha256 === 'string' ? metadata.checksumSha256.trim().toLowerCase() : ''
  if (metadataChecksum.length > 0 && !CHECKSUM_PATTERN.test(metadataChecksum)) {
    return fail(CLOUD_RESTORE_ERROR.CHECKSUM_INVALID, 'Checksum metadata tidak valid.')
  }
  if (metadataChecksum.length > 0 && metadataChecksum !== headerChecksum) {
    return fail(
      CLOUD_RESTORE_ERROR.CHECKSUM_MISMATCH,
      'Checksum metadata tidak cocok dengan checksum respons.',
    )
  }

  let calculatedChecksum
  try {
    calculatedChecksum = await computeSha256HexFromBytes(bytes)
  } catch {
    return fail(CLOUD_RESTORE_ERROR.CHECKSUM_INVALID, 'Checksum backup tidak dapat dihitung.')
  }

  if (calculatedChecksum !== headerChecksum) {
    return fail(CLOUD_RESTORE_ERROR.CHECKSUM_MISMATCH, 'Isi backup tidak cocok dengan checksum.')
  }
  if (metadataChecksum.length > 0 && metadataChecksum !== calculatedChecksum) {
    return fail(CLOUD_RESTORE_ERROR.CHECKSUM_MISMATCH, 'Checksum metadata tidak cocok.')
  }

  // ── Schema chain (metadata ↔ header) ───────────────────────────────────────
  const headerSchemaRaw = readHeader(headers, CLOUD_RESTORE_SCHEMA_HEADER)
  const headerSchema = headerSchemaRaw === null ? NaN : Number(headerSchemaRaw.trim())
  if (!Number.isInteger(headerSchema) || headerSchema < 1) {
    return fail(CLOUD_RESTORE_ERROR.SCHEMA_MISMATCH, 'Versi schema backup tidak tersedia.')
  }

  const metadataSchema = Number(metadata?.schemaVersion)
  if (Number.isInteger(metadataSchema) && metadataSchema !== headerSchema) {
    return fail(
      CLOUD_RESTORE_ERROR.SCHEMA_MISMATCH,
      'Versi schema metadata tidak cocok dengan respons.',
    )
  }

  // ── Parse only after integrity is proven ───────────────────────────────────
  let payload
  try {
    payload = JSON.parse(text)
  } catch {
    return fail(CLOUD_RESTORE_ERROR.PAYLOAD_INVALID, 'Isi backup tidak dapat dibaca.')
  }

  const payloadVersion = Number(payload?.version)
  if (!Number.isInteger(payloadVersion)) {
    return fail(CLOUD_RESTORE_ERROR.PAYLOAD_INVALID, 'Versi backup tidak valid.')
  }
  if (payloadVersion !== headerSchema) {
    return fail(
      CLOUD_RESTORE_ERROR.SCHEMA_MISMATCH,
      'Versi backup tidak cocok dengan versi schema respons.',
    )
  }
  if (!SUPPORTED_BACKUP_VERSIONS.includes(payloadVersion)) {
    return fail(CLOUD_RESTORE_ERROR.SCHEMA_UNSUPPORTED, 'Versi backup tidak didukung.')
  }

  const validation = validateBackupPayload(payload)
  if (!validation.valid) {
    return fail(CLOUD_RESTORE_ERROR.PAYLOAD_INVALID, validation.error)
  }

  // ── Same-device vs cross-device ────────────────────────────────────────────
  const originIdentifier =
    typeof metadata?.device?.identifier === 'string' ? metadata.device.identifier.trim() : ''
  const currentIdentifier = typeof deviceIdentifier === 'string' ? deviceIdentifier.trim() : ''

  const mode =
    originIdentifier.length > 0 &&
    currentIdentifier.length > 0 &&
    originIdentifier === currentIdentifier
      ? RESTORE_MODE.SAME_DEVICE
      : RESTORE_MODE.CROSS_DEVICE

  if (mode === RESTORE_MODE.CROSS_DEVICE) {
    const safety = classifyCrossDeviceRestoreSafety(payload)
    if (!safety.safeForCrossDeviceRestore) {
      return fail(CLOUD_RESTORE_ERROR.CROSS_DEVICE_UNSAFE, safety.reason)
    }
  }

  return {
    ok: true,
    payload,
    mode,
    schemaVersion: payloadVersion,
    checksumSha256: calculatedChecksum,
    sizeBytes: byteLength,
  }
}
