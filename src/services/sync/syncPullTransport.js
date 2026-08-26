import { apiRequest } from '../cloud/apiClient'

/**
 * Pure HTTP transport for pulling sync changes from Laravel /api/sync/pull.
 *
 * Rules:
 * - Always sends Bearer token in Authorization header via apiRequest (NEVER in query params)
 * - Uses URLSearchParams to build query string safely
 * - Default limit = 200
 * - Default after = 0
 * - Returns { ok, status, data, error }
 * - No auto-retry, no background requests, no polling
 *
 * @param {object} params
 * @param {string} params.token Bearer token
 * @param {number|string} params.businessId
 * @param {string} params.deviceIdentifier
 * @param {number} [params.after=0]
 * @param {number} [params.limit=200]
 * @returns {Promise<{ok: boolean, status: number, data: any, error: any}>}
 */
export async function pullSyncChanges({
  token,
  businessId,
  deviceIdentifier,
  after = 0,
  limit = 200,
}) {
  const query = new URLSearchParams()

  if (businessId !== undefined && businessId !== null) {
    query.set('business_id', String(businessId))
  }
  if (deviceIdentifier !== undefined && deviceIdentifier !== null) {
    query.set('device_identifier', String(deviceIdentifier))
  }
  query.set('after', String(after ?? 0))
  query.set('limit', String(limit ?? 200))

  const path = `/api/sync/pull?${query.toString()}`

  return apiRequest(path, {
    method: 'GET',
    token,
  })
}
