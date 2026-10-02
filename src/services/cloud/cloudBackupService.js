/**
 * PREM-M06A — Cloud Backup API adapter (isolated).
 *
 * The single module that knows the PREM-D03 mobile contract:
 *
 *   POST /api/mobile/backups
 *     body { business_id, device_identifier, schema_version, app_version?,
 *            checksum_sha256, size_bytes, payload, idempotency_key? }
 *     -> 201 (created) / 200 (idempotent duplicate)
 *        { data: { id, uuid, created_at, schema_version, app_version,
 *                  size_bytes, checksum_sha256, status, device {…}, duplicate } }
 *
 *   GET  /api/mobile/backups?business_id=&limit=
 *     -> 200 { data: [ {…metadata…} ] }   (newest first, server-ordered)
 *
 *   GET  /api/mobile/backups/{uuid}?business_id=
 *     -> 200 { data: {…metadata…} }
 *
 * Rules enforced here:
 * - the client never invents fields; only the exact contract fields are sent.
 * - `business_id` must come from the linked Cloud business (checked by caller).
 * - a malformed response (missing uuid, invalid status, bad checksum/size)
 *   fails closed — no snapshot object is synthesised.
 * - an upload response whose checksum/size disagrees with the attempt fails
 *   closed; the server metadata is never trusted over the attempt.
 * - no token or payload is ever logged.
 *
 * RESTORE IS OUT OF SCOPE FOR M06A — download is intentionally not exposed here.
 */

import { apiRequest } from '@/services/cloud/apiClient'

export const CLOUD_BACKUPS_PATH_ENV = 'VITE_CLOUD_BACKUPS_PATH'
export const DEFAULT_CLOUD_BACKUPS_PATH = '/api/mobile/backups'

/** Maximum list size accepted by the backend contract. */
export const CLOUD_BACKUP_LIST_LIMIT = 10

export const CLOUD_BACKUP_STATUS = Object.freeze({
  READY: 'ready',
  PROCESSING: 'processing',
  FAILED: 'failed',
})

const VALID_STATUSES = new Set(Object.values(CLOUD_BACKUP_STATUS))

const CHECKSUM_PATTERN = /^[a-f0-9]{64}$/

export const CLOUD_BACKUP_ERROR = Object.freeze({
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  MOBILE_TOKEN_REQUIRED: 'MOBILE_TOKEN_REQUIRED',
  BUSINESS_ACCESS_DENIED: 'BUSINESS_ACCESS_DENIED',
  MOBILE_ROLE_NOT_SUPPORTED: 'MOBILE_ROLE_NOT_SUPPORTED',
  CLOUD_SUBSCRIPTION_REQUIRED: 'CLOUD_SUBSCRIPTION_REQUIRED',
  DEVICE_NOT_FOUND: 'DEVICE_NOT_FOUND',
  DEVICE_INACTIVE: 'DEVICE_INACTIVE',
  BACKUP_TOO_LARGE: 'BACKUP_TOO_LARGE',
  BACKUP_SIZE_MISMATCH: 'BACKUP_SIZE_MISMATCH',
  BACKUP_CHECKSUM_MISMATCH: 'BACKUP_CHECKSUM_MISMATCH',
  BACKUP_STORAGE_FAILED: 'BACKUP_STORAGE_FAILED',
  BACKUP_NOT_FOUND: 'BACKUP_NOT_FOUND',
  MALFORMED_RESPONSE: 'MALFORMED_RESPONSE',
  NETWORK_ERROR: 'NETWORK_ERROR',
  REQUEST_FAILED: 'REQUEST_FAILED',
})

const KNOWN_CODES = new Set(Object.values(CLOUD_BACKUP_ERROR))

export function resolveCloudBackupsPath(env = import.meta.env) {
  const raw = env?.[CLOUD_BACKUPS_PATH_ENV]
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : DEFAULT_CLOUD_BACKUPS_PATH
}

function toIsoOrNull(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return null
  return value
}

function normalizeDevice(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { id: null, identifier: null, name: null, platform: null }
  }

  return {
    id: raw.id ?? null,
    identifier: typeof raw.identifier === 'string' ? raw.identifier : null,
    name: typeof raw.name === 'string' ? raw.name : null,
    platform: typeof raw.platform === 'string' ? raw.platform : null,
  }
}

/**
 * Normalise a backup metadata record. Returns `null` when the record is not a
 * usable snapshot, so the caller can fail closed.
 *
 * @param {*} raw
 * @returns {object|null}
 */
export function normalizeCloudBackupRecord(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null

  const uuid = typeof raw.uuid === 'string' ? raw.uuid.trim() : ''
  if (uuid.length === 0) return null

  const checksumSha256 =
    typeof raw.checksum_sha256 === 'string' ? raw.checksum_sha256.trim().toLowerCase() : ''
  if (!CHECKSUM_PATTERN.test(checksumSha256)) return null

  const status = typeof raw.status === 'string' ? raw.status.trim().toLowerCase() : ''
  if (!VALID_STATUSES.has(status)) return null

  const sizeBytes = Number(raw.size_bytes)
  if (!Number.isInteger(sizeBytes) || sizeBytes < 0) return null

  const schemaVersion = Number(raw.schema_version)
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1) return null

  const createdAt = toIsoOrNull(raw.created_at)
  if (createdAt === null || Number.isNaN(new Date(createdAt).getTime())) return null

  return {
    id: raw.id ?? null,
    uuid,
    createdAt,
    schemaVersion,
    appVersion: typeof raw.app_version === 'string' ? raw.app_version : null,
    sizeBytes,
    checksumSha256,
    status,
    device: normalizeDevice(raw.device),
    duplicate: raw.duplicate === true,
  }
}

function mapError(result) {
  const status = Number(result?.status) || 0
  const backendCode = result?.error?.code

  if (status === 0 || backendCode === 'NETWORK_ERROR') {
    return { code: CLOUD_BACKUP_ERROR.NETWORK_ERROR, status }
  }
  if (status === 401) {
    return { code: CLOUD_BACKUP_ERROR.UNAUTHENTICATED, status }
  }
  if (typeof backendCode === 'string' && KNOWN_CODES.has(backendCode)) {
    return { code: backendCode, status }
  }
  return { code: CLOUD_BACKUP_ERROR.REQUEST_FAILED, status }
}

/**
 * Upload a serialized snapshot. The exact `payload` string, `checksumSha256`
 * and `sizeBytes` are sent verbatim — the server re-verifies them.
 *
 * @param {object} params
 * @param {string|null} params.token
 * @param {number|string} params.businessId
 * @param {string} params.deviceIdentifier
 * @param {number} params.schemaVersion
 * @param {string|null} [params.appVersion]
 * @param {string} params.payload
 * @param {string} params.checksumSha256
 * @param {number} params.sizeBytes
 * @param {string|null} [params.idempotencyKey]
 * @param {string} [params.path]
 * @returns {Promise<{ok: boolean, backup?: object, code?: string, status?: number}>}
 */
export async function createCloudBackup({
  token = null,
  businessId,
  deviceIdentifier,
  schemaVersion,
  appVersion = null,
  payload,
  checksumSha256,
  sizeBytes,
  idempotencyKey = null,
  path = resolveCloudBackupsPath(),
} = {}) {
  const body = {
    business_id: businessId,
    device_identifier: deviceIdentifier,
    schema_version: schemaVersion,
    checksum_sha256: checksumSha256,
    size_bytes: sizeBytes,
    payload,
  }

  if (typeof appVersion === 'string' && appVersion.trim().length > 0) {
    body.app_version = appVersion.trim()
  }

  if (typeof idempotencyKey === 'string' && idempotencyKey.trim().length > 0) {
    body.idempotency_key = idempotencyKey.trim()
  }

  let result
  try {
    result = await apiRequest(path, { method: 'POST', body, token })
  } catch (err) {
    return { ok: false, code: CLOUD_BACKUP_ERROR.NETWORK_ERROR, status: 0, error: err }
  }

  if (!result?.ok) {
    return { ok: false, ...mapError(result), error: result?.error ?? null }
  }

  const record = normalizeCloudBackupRecord(result.data?.data ?? null)
  if (record === null) {
    return { ok: false, code: CLOUD_BACKUP_ERROR.MALFORMED_RESPONSE, status: result.status }
  }

  // The server echoes the verified snapshot metadata; a disagreement with the
  // attempt we sent is a hard fail-closed condition.
  if (record.checksumSha256 !== String(checksumSha256).trim().toLowerCase()) {
    return { ok: false, code: CLOUD_BACKUP_ERROR.BACKUP_CHECKSUM_MISMATCH, status: result.status }
  }
  if (record.sizeBytes !== Number(sizeBytes)) {
    return { ok: false, code: CLOUD_BACKUP_ERROR.BACKUP_SIZE_MISMATCH, status: result.status }
  }

  return { ok: true, backup: record, status: result.status }
}

/**
 * List the business' Cloud backups (newest first, server ordering preserved).
 *
 * @param {object} params
 * @param {string|null} params.token
 * @param {number|string} params.businessId
 * @param {number} [params.limit]
 * @param {string} [params.path]
 * @returns {Promise<{ok: boolean, backups?: object[], code?: string, status?: number}>}
 */
export async function listCloudBackups({
  token = null,
  businessId,
  limit = CLOUD_BACKUP_LIST_LIMIT,
  path = resolveCloudBackupsPath(),
} = {}) {
  const base = String(path).replace(/\/+$/, '')
  const safeLimit = Math.min(
    Math.max(1, Number.isInteger(limit) ? limit : CLOUD_BACKUP_LIST_LIMIT),
    CLOUD_BACKUP_LIST_LIMIT,
  )
  const requestPath = `${base}?business_id=${encodeURIComponent(String(businessId))}&limit=${safeLimit}`

  let result
  try {
    result = await apiRequest(requestPath, { token })
  } catch (err) {
    return { ok: false, code: CLOUD_BACKUP_ERROR.NETWORK_ERROR, status: 0, error: err }
  }

  if (!result?.ok) {
    return { ok: false, ...mapError(result), error: result?.error ?? null }
  }

  const data = result.data?.data
  if (!Array.isArray(data)) {
    return { ok: false, code: CLOUD_BACKUP_ERROR.MALFORMED_RESPONSE, status: result.status }
  }

  const backups = data.map((item) => normalizeCloudBackupRecord(item))
  if (backups.some((item) => item === null)) {
    return { ok: false, code: CLOUD_BACKUP_ERROR.MALFORMED_RESPONSE, status: result.status }
  }

  return { ok: true, backups }
}

/**
 * Fetch one snapshot's metadata.
 *
 * @param {object} params
 * @param {string|null} params.token
 * @param {number|string} params.businessId
 * @param {string} params.backupUuid
 * @param {string} [params.path]
 * @returns {Promise<{ok: boolean, backup?: object, code?: string, status?: number}>}
 */
export async function getCloudBackup({
  token = null,
  businessId,
  backupUuid,
  path = resolveCloudBackupsPath(),
} = {}) {
  if (typeof backupUuid !== 'string' || backupUuid.trim().length === 0) {
    return { ok: false, code: CLOUD_BACKUP_ERROR.MALFORMED_RESPONSE, status: 0 }
  }

  const base = String(path).replace(/\/+$/, '')
  const requestPath = `${base}/${encodeURIComponent(backupUuid.trim())}?business_id=${encodeURIComponent(String(businessId))}`

  let result
  try {
    result = await apiRequest(requestPath, { token })
  } catch (err) {
    return { ok: false, code: CLOUD_BACKUP_ERROR.NETWORK_ERROR, status: 0, error: err }
  }

  if (!result?.ok) {
    return { ok: false, ...mapError(result), error: result?.error ?? null }
  }

  const record = normalizeCloudBackupRecord(result.data?.data ?? null)
  if (record === null) {
    return { ok: false, code: CLOUD_BACKUP_ERROR.MALFORMED_RESPONSE, status: result.status }
  }

  return { ok: true, backup: record }
}
