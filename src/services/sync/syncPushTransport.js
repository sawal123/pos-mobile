import { apiRequest } from '@/services/cloud/apiClient'

/**
 * Pure HTTP transport for pushing sync outbox payloads to Laravel v1 /api/sync/push.
 *
 * @param {object} options
 * @param {string} options.token Bearer token (retrieved securely, never logged)
 * @param {object} options.body Request body matching Laravel Push contract
 * @returns {Promise<{ ok: boolean, status: number, data: any, error: any }>}
 */
export async function pushSyncRequest({ token, body }) {
  return apiRequest('/api/sync/push', {
    method: 'POST',
    token,
    body,
  })
}
