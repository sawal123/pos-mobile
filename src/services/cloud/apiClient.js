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
  const raw = (customBase !== undefined ? customBase : (import.meta.env?.VITE_API_BASE_URL ?? '')).trim()
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
