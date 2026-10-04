/**
 * Minimal API client for POS Mobile → Laravel communication.
 *
 * Rules:
 * - Always sends Accept: application/json
 * - Sends Content-Type: application/json when body is present
 * - Supports Bearer token via options.token
 * - Parses JSON response
 * - Returns clear error objects based on HTTP status
 * - Never logs the Bearer token
 * - No automatic retry
 * - No background requests
 * - No network polling
 */

export function resolveBaseUrl(customBase) {
  const raw = (
    customBase !== undefined ? customBase : (import.meta.env?.VITE_API_BASE_URL ?? '')
  ).trim()
  return raw.replace(/\/+$/, '').replace(/\/api$/, '')
}

export function buildApiUrl(path, customBase) {
  const base = resolveBaseUrl(customBase)
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${base}${normalizedPath}`
}

/**
 * @typedef {Object} ApiError
 * @property {number} status
 * @property {string} code
 * @property {string} message
 * @property {object|null} data
 */

/**
 * @param {Response} response
 * @returns {Promise<ApiError>}
 */
async function buildApiError(response) {
  let body = null

  try {
    body = await response.json()
  } catch {
    // non-JSON error body
  }

  return {
    status: response.status,
    code: body?.code ?? body?.error ?? `HTTP_${response.status}`,
    message: body?.message ?? response.statusText ?? 'Unknown error',
    data: body ?? null,
  }
}

/**
 * Core fetch wrapper.
 *
 * @param {string} path  API path starting with /
 * @param {object} [options]
 * @param {string} [options.method]
 * @param {object} [options.body]
 * @param {string} [options.token]  Bearer token – never logged
 * @returns {Promise<{ok: boolean, status: number, data: any, error: ApiError|null}>}
 */
export async function apiRequest(path, { method = 'GET', body, token } = {}) {
  const headers = {
    Accept: 'application/json',
  }

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  let response

  try {
    response = await fetch(buildApiUrl(path), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch (networkError) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: {
        status: 0,
        code: 'NETWORK_ERROR',
        message: networkError instanceof Error ? networkError.message : 'Network error',
        data: null,
      },
    }
  }

  if (!response.ok) {
    const error = await buildApiError(response)
    return { ok: false, status: response.status, data: null, error }
  }

  let data = null

  if (response.status !== 204) {
    try {
      data = await response.json()
    } catch {
      // empty / non-JSON success body
    }
  }

  return { ok: true, status: response.status, data, error: null }
}

/** Error codes emitted by {@link apiRawRequest}. */
export const API_RAW_ERROR = Object.freeze({
  TOO_LARGE: 'RAW_BODY_TOO_LARGE',
  DECODE_FAILED: 'RAW_BODY_DECODE_FAILED',
  READ_FAILED: 'RAW_BODY_READ_FAILED',
})

/**
 * Raw-bytes fetch wrapper for endpoints that stream an authoritative file
 * (Cloud Restore download). Unlike {@link apiRequest} it never parses JSON and
 * never re-serializes the body — callers receive the exact status, response
 * headers and body bytes so they can verify a checksum over the wire bytes.
 *
 * `maxBytes` is an optional pre-read guard: when a `Content-Length` is present
 * and already exceeds the limit the body is never read.
 *
 * Existing JSON requests are unaffected.
 *
 * @param {string} path  API path starting with /
 * @param {object} [options]
 * @param {string} [options.method]
 * @param {string} [options.token]  ****** – never logged
 * @param {number|null} [options.maxBytes]
 * @returns {Promise<{ok: boolean, status: number, headers?: Record<string,string>, bytes?: Uint8Array, text?: string, byteLength?: number, error?: ApiError}>}
 */
export async function apiRawRequest(path, { method = 'GET', token, maxBytes = null } = {}) {
  const headers = {
    Accept: 'application/octet-stream, application/json',
  }

  if (token) {
    headers['Authorization'] = 'Bearer ' + token
  }

  let response

  try {
    response = await fetch(buildApiUrl(path), { method, headers })
  } catch (networkError) {
    return {
      ok: false,
      status: 0,
      error: {
        status: 0,
        code: 'NETWORK_ERROR',
        message: networkError instanceof Error ? networkError.message : 'Network error',
        data: null,
      },
    }
  }

  if (!response.ok) {
    const error = await buildApiError(response)
    return { ok: false, status: response.status, error }
  }

  const contentLengthHeader = response.headers.get('Content-Length')
  const contentLength = contentLengthHeader === null ? NaN : Number(contentLengthHeader)

  if (Number.isFinite(maxBytes) && Number.isFinite(contentLength) && contentLength > maxBytes) {
    try {
      await response.body?.cancel()
    } catch {
      // Body already closed — nothing to release.
    }
    return {
      ok: false,
      status: response.status,
      error: {
        status: response.status,
        code: API_RAW_ERROR.TOO_LARGE,
        message: 'Raw response exceeds the allowed size.',
        data: null,
      },
    }
  }

  let buffer

  try {
    buffer = await response.arrayBuffer()
  } catch (readError) {
    return {
      ok: false,
      status: response.status,
      error: {
        status: response.status,
        code: API_RAW_ERROR.READ_FAILED,
        message: readError instanceof Error ? readError.message : 'Raw response read failed.',
        data: null,
      },
    }
  }

  const bytes = new Uint8Array(buffer)

  if (Number.isFinite(maxBytes) && bytes.byteLength > maxBytes) {
    return {
      ok: false,
      status: response.status,
      error: {
        status: response.status,
        code: API_RAW_ERROR.TOO_LARGE,
        message: 'Raw response exceeds the allowed size.',
        data: null,
      },
    }
  }

  let text

  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return {
      ok: false,
      status: response.status,
      error: {
        status: response.status,
        code: API_RAW_ERROR.DECODE_FAILED,
        message: 'Raw response is not valid UTF-8.',
        data: null,
      },
    }
  }

  const headerEntries = {}
  response.headers.forEach((value, key) => {
    headerEntries[key.toLowerCase()] = value
  })

  return {
    ok: true,
    status: response.status,
    headers: headerEntries,
    bytes,
    text,
    byteLength: bytes.byteLength,
  }
}
