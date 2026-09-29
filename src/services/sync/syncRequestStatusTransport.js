import { apiRequest } from '@/services/cloud/apiClient'

/**
 * Server-side outcome values for a previously submitted sync request.
 * Backend contract (INT-03): `GET /api/sync/requests/{request_id}/status`.
 */
export const SYNC_REQUEST_STATUS_COMMITTED = 'committed'
export const SYNC_REQUEST_STATUS_NOT_FOUND = 'not_found'

/**
 * Pure HTTP transport for reading the final server outcome of a sync request
 * whose response was lost / uncertain.
 *
 * Rules:
 * - Bearer token is sent in the Authorization header via apiRequest and is
 *   never placed in the query string, persisted, or logged.
 * - No auto-retry, no background request, no polling.
 *
 * @param {object} params
 * @param {string} params.token Bearer token (retrieved securely, never logged)
 * @param {string} params.requestId Original request_id
 * @param {number|string} params.businessId
 * @param {string} params.deviceIdentifier
 * @returns {Promise<{ok: boolean, status: number, data: any, error: any}>}
 */
export async function fetchSyncRequestStatus({ token, requestId, businessId, deviceIdentifier }) {
  const query = new URLSearchParams()

  if (businessId !== undefined && businessId !== null) {
    query.set('business_id', String(businessId))
  }
  if (deviceIdentifier !== undefined && deviceIdentifier !== null) {
    query.set('device_identifier', String(deviceIdentifier))
  }

  const encodedId = encodeURIComponent(String(requestId))
  const path = `/api/sync/requests/${encodedId}/status?${query.toString()}`

  return apiRequest(path, {
    method: 'GET',
    token,
  })
}
