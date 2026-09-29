import { getToken } from '@/services/cloud/tokenRepository'
import { createSyncQueueService } from './syncQueueService'
import { createSyncIdentityRegistry } from './syncIdentityRegistry'
import { applyCommittedAcknowledgment } from './syncCommittedAck'
import {
  SYNC_REQUEST_STATUS_COMMITTED,
  SYNC_REQUEST_STATUS_NOT_FOUND,
  fetchSyncRequestStatus,
} from './syncRequestStatusTransport'

/**
 * INT-04 — result codes for a reconciliation attempt.
 */
export const SYNC_RECONCILIATION_RESULTS = Object.freeze({
  COMMITTED: 'SYNC_RECONCILIATION_COMMITTED',
  NOT_FOUND: 'SYNC_RECONCILIATION_NOT_FOUND',
  ACCESS_DENIED: 'SYNC_RECONCILIATION_ACCESS_DENIED',
  UNREACHABLE: 'SYNC_RECONCILIATION_UNREACHABLE',
  CLEANUP_FAILED: 'SYNC_RECONCILIATION_CLEANUP_FAILED',
  NOT_REQUIRED: 'SYNC_RECONCILIATION_NOT_REQUIRED',
  IN_PROGRESS: 'SYNC_RECONCILIATION_IN_PROGRESS',
  PRECONDITION_FAILED: 'SYNC_RECONCILIATION_PRECONDITION_FAILED',
  CONTEXT_MISMATCH: 'SYNC_RECONCILIATION_CONTEXT_MISMATCH',
  GUARD_BLOCKED: 'SYNC_RECONCILIATION_GUARD_BLOCKED',
  READ_FAILED: 'SYNC_RECONCILIATION_READ_FAILED',
})

/** Human-readable classification of an access-denied status response. */
function classifyAccessDenied(code) {
  return {
    reason: code ?? 'SYNC_FORBIDDEN',
    deviceBlocked: code === 'DEVICE_INACTIVE' || code === 'SYNC_DEVICE_INVALID',
    revoked: code === 'BUSINESS_ACCESS_DENIED' || code === 'BUSINESS_ACCESS_REVOKED',
    subscriptionRequired: code === 'CLOUD_SUBSCRIPTION_REQUIRED',
  }
}

/**
 * Creates the INT-04 Mobile Sync Request Reconciliation Service.
 *
 * It reads the authoritative outcome of a previously submitted sync request
 * (`GET /api/sync/requests/{request_id}/status`) and recovers the durable
 * outbox safely:
 *  - `committed`  -> reuse the existing acknowledgment (CAS cleanup + version
 *                    metadata restore) and clear the envelope only when safe.
 *  - `not_found`  -> keep the entire durable outbox and envelope, never create
 *                    a new request_id, surface "waiting reconciliation" and
 *                    allow a controlled re-check (owner/support intervention).
 *  - errors       -> keep everything and report the specific reason.
 *
 * Never polls, never retries in a loop, never stores the token.
 *
 * @param {object} options
 * @param {object} options.adapter Persistence adapter
 * @param {object} [options.scheduler] Persistence serializer
 * @param {object} [options.queueService] SyncQueueService instance
 * @param {object} [options.registry] Durable sync identity registry
 * @param {Function} [options.tokenFetcher] Secure token reader
 * @param {Function} [options.statusTransport] Status transport (default HTTP)
 * @param {object} [options.contextGuardService] P23 context guard
 * @returns {object}
 */
export function createSyncReconciliationService({
  adapter,
  scheduler = null,
  queueService = null,
  registry = null,
  tokenFetcher = getToken,
  statusTransport = fetchSyncRequestStatus,
  contextGuardService = null,
} = {}) {
  const activeQueueService = queueService ?? createSyncQueueService({ adapter, scheduler })
  const activeRegistry = registry ?? createSyncIdentityRegistry({ adapter, scheduler })
  let isReconciling = false

  async function persistEnvelopeMarker(envelope, marker) {
    if (!adapter || typeof adapter.saveSyncPushInflight !== 'function') return
    try {
      await adapter.saveSyncPushInflight({
        ...envelope,
        ...marker,
        reconciledAt: new Date().toISOString(),
      })
    } catch {
      // Best effort: the returned result still describes the outcome.
    }
  }

  /**
   * Attempts a single, controlled reconciliation of the durable in-flight
   * envelope whose server acceptance is unknown.
   *
   * @param {object} [options]
   * @param {string} [options.token] Explicit token override
   * @param {object} [options.context] Explicit cloud context override
   * @returns {Promise<object>}
   */
  async function reconcile(options = {}) {
    if (isReconciling) {
      return {
        ok: false,
        code: SYNC_RECONCILIATION_RESULTS.IN_PROGRESS,
        message: 'Rekonsiliasi sinkronisasi sedang berjalan.',
        error: {
          code: SYNC_RECONCILIATION_RESULTS.IN_PROGRESS,
          message: 'Rekonsiliasi sinkronisasi sedang berjalan.',
        },
      }
    }

    if (!adapter || typeof adapter.loadSyncPushInflight !== 'function') {
      return {
        ok: false,
        code: SYNC_RECONCILIATION_RESULTS.PRECONDITION_FAILED,
        message: 'Adapter penyimpanan tidak tersedia untuk rekonsiliasi.',
        error: {
          code: SYNC_RECONCILIATION_RESULTS.PRECONDITION_FAILED,
          message: 'Adapter penyimpanan tidak tersedia untuk rekonsiliasi.',
        },
      }
    }

    isReconciling = true

    try {
      const context = options.context ?? {}
      const businessId = context.selectedBusiness?.id
      const outletId = context.selectedOutlet?.id
      const deviceIdentifier = context.deviceIdentifier
      const registeredDeviceId = context.registeredDeviceId

      let envelope
      try {
        envelope = await adapter.loadSyncPushInflight()
      } catch (err) {
        return {
          ok: false,
          code: SYNC_RECONCILIATION_RESULTS.READ_FAILED,
          message: err instanceof Error ? err.message : 'Gagal membaca envelope sinkronisasi.',
        }
      }

      // Nothing to reconcile: no retained envelope, or an envelope whose
      // acceptance a normal push retry already handles safely. The status
      // endpoint is consulted whenever the outcome is genuinely uncertain:
      //  - `reconciliationRequired` (e.g. a 403 on a retried unknown outcome);
      //  - `acceptanceUnknown` (a transport loss / malformed 2xx / 5xx leaves
      //    `acceptanceUnknown` on the envelope) so the user can check the
      //    request status immediately, without resending the push first;
      //  - `cleanup_failed` (server accepted, local cleanup did not finish).
      // The ordinary idempotent retry path stays available in all these cases.
      const needsReconciliation =
        envelope &&
        (envelope.reconciliationRequired === true ||
          envelope.acceptanceUnknown === true ||
          envelope.reconciliationOutcome === 'cleanup_failed')

      if (!needsReconciliation) {
        return {
          ok: true,
          code: SYNC_RECONCILIATION_RESULTS.NOT_REQUIRED,
          requestId: envelope?.requestId ?? null,
          message: 'Tidak ada pengiriman yang memerlukan rekonsiliasi.',
        }
      }

      // Context isolation: never resolve an envelope against a different
      // business/outlet/device than the one it was created under.
      const isContextMatch =
        Number(envelope.businessId) === Number(businessId) &&
        Number(envelope.outletId) === Number(outletId) &&
        String(envelope.deviceIdentifier) === String(deviceIdentifier) &&
        String(envelope.registeredDeviceId) === String(registeredDeviceId)

      if (!isContextMatch) {
        return {
          ok: false,
          code: SYNC_RECONCILIATION_RESULTS.CONTEXT_MISMATCH,
          requestId: envelope.requestId,
          message:
            'Pengiriman yang tertunda berasal dari konteks Business/Outlet/Perangkat yang berbeda.',
          error: {
            code: SYNC_RECONCILIATION_RESULTS.CONTEXT_MISMATCH,
            message: 'Konteks rekonsiliasi tidak cocok dengan pengiriman yang tertunda.',
          },
        }
      }

      if (contextGuardService && typeof contextGuardService.inspect === 'function') {
        const guard = await contextGuardService.inspect({
          context: {
            user: context.user ? { id: context.user.id } : null,
            selectedBusiness: businessId != null ? { id: businessId } : null,
            selectedOutlet: outletId != null ? { id: outletId } : null,
            cloudAccess: context.cloudAccess === true,
            deviceIdentifier: deviceIdentifier != null ? String(deviceIdentifier) : null,
            registeredDeviceId: registeredDeviceId != null ? registeredDeviceId : null,
          },
        })
        if (!guard.ok) {
          return {
            ok: false,
            code: SYNC_RECONCILIATION_RESULTS.GUARD_BLOCKED,
            requestId: envelope.requestId,
            contextGuardCode: guard.code,
            message: 'Rekonsiliasi diblokir oleh pemeriksaan konteks sinkronisasi.',
            error: {
              code: SYNC_RECONCILIATION_RESULTS.GUARD_BLOCKED,
              contextGuardCode: guard.code,
            },
          }
        }
      }

      const token = options.token ?? (await tokenFetcher())
      const hasToken = typeof token === 'string' && token.trim().length > 0

      if (!hasToken) {
        await persistEnvelopeMarker(envelope, {
          acceptance: envelope.acceptance ?? 'unknown',
          reconciliationRequired: true,
          reconciliationCode: 'SYNC_RECONCILIATION_UNREACHABLE',
          reconciliationOutcome: 'unreachable',
        })
        return {
          ok: false,
          code: SYNC_RECONCILIATION_RESULTS.UNREACHABLE,
          requestId: envelope.requestId,
          pendingConnection: true,
          message:
            'Tidak ada token cloud. Status pengiriman menunggu koneksi; data lokal tetap aman.',
          error: {
            code: SYNC_RECONCILIATION_RESULTS.UNREACHABLE,
            message: 'Status pengiriman menunggu koneksi.',
          },
        }
      }

      const response = await statusTransport({
        token,
        requestId: envelope.requestId,
        businessId: Number(envelope.businessId),
        deviceIdentifier,
      })

      const httpStatus = response?.status ?? response?.error?.status ?? 0
      const responseCode =
        response?.data?.code ??
        response?.data?.data?.code ??
        response?.error?.code ??
        response?.error?.data?.code ??
        null
      const body = response?.data?.data ?? response?.data ?? null

      // ── Transport / server failure: acceptance stays unknown ────────────────
      if (response?.ok !== true) {
        const isAccessDenied = httpStatus === 401 || httpStatus === 403
        const isNetwork = httpStatus === 0 || responseCode === 'NETWORK_ERROR'

        if (isAccessDenied) {
          const denied = classifyAccessDenied(responseCode)
          await persistEnvelopeMarker(envelope, {
            acceptance: envelope.acceptance ?? 'unknown',
            reconciliationRequired: true,
            reconciliationCode: 'SYNC_RECONCILIATION_ACCESS_DENIED',
            reconciliationOutcome: 'access_denied',
            ...denied,
          })
          return {
            ok: false,
            code: SYNC_RECONCILIATION_RESULTS.ACCESS_DENIED,
            requestId: envelope.requestId,
            acceptance: envelope.acceptance ?? 'unknown',
            reconciliationRequired: true,
            ...denied,
            message:
              'Akses cloud ditolak. Data lokal tetap aman; hubungi owner/support sebelum mencoba lagi.',
            error: {
              code: SYNC_RECONCILIATION_RESULTS.ACCESS_DENIED,
              reason: denied.reason,
            },
          }
        }

        await persistEnvelopeMarker(envelope, {
          acceptance: envelope.acceptance ?? 'unknown',
          reconciliationRequired: true,
          reconciliationCode: 'SYNC_RECONCILIATION_UNREACHABLE',
          reconciliationOutcome: 'unreachable',
        })
        return {
          ok: false,
          code: SYNC_RECONCILIATION_RESULTS.UNREACHABLE,
          requestId: envelope.requestId,
          acceptance: envelope.acceptance ?? 'unknown',
          reconciliationRequired: true,
          pendingConnection: isNetwork,
          message:
            'Status pengiriman belum dapat dipastikan (koneksi/server). Data lokal tetap aman dan menunggu pemeriksaan ulang.',
          error: {
            code: SYNC_RECONCILIATION_RESULTS.UNREACHABLE,
            status: httpStatus,
          },
        }
      }

      // ── committed: reuse the existing acknowledgment mechanism ──────────────
      if (body?.status === SYNC_REQUEST_STATUS_COMMITTED) {
        // INT-04 hardening: never trust a `committed` body on its own. The
        // backend must echo the original request_id; a missing or mismatched id
        // means this response cannot be proven to describe our request, so no
        // local cleanup is performed and the durable outbox is kept intact.
        const responseRequestId =
          body?.request_id ?? response?.data?.request_id ?? response?.error?.data?.request_id ?? null

        const isRequestIdValid =
          responseRequestId !== null &&
          responseRequestId !== undefined &&
          String(responseRequestId) === String(envelope.requestId)

        if (!isRequestIdValid) {
          const reason =
            responseRequestId === null || responseRequestId === undefined
              ? 'REQUEST_ID_MISSING'
              : 'REQUEST_ID_MISMATCH'

          await persistEnvelopeMarker(envelope, {
            acceptance: envelope.acceptance ?? 'unknown',
            reconciliationRequired: true,
            reconciliationCode: 'SYNC_RECONCILIATION_UNREACHABLE',
            reconciliationOutcome: 'unreachable',
          })

          return {
            ok: false,
            code: SYNC_RECONCILIATION_RESULTS.UNREACHABLE,
            requestId: envelope.requestId,
            acceptance: envelope.acceptance ?? 'unknown',
            reconciliationRequired: true,
            pendingConnection: false,
            message:
              'Respons status pengiriman tidak valid (request_id tidak cocok). Tidak ada pembersihan lokal yang dilakukan; data tetap aman.',
            error: {
              code: SYNC_RECONCILIATION_RESULTS.UNREACHABLE,
              reason,
            },
          }
        }

        const processedAt = body?.processed_at ?? null
        const {
          removedQueueIds,
          preservedQueueIds,
          cleanupFailedQueueIds,
          hasStorageError,
        } = await applyCommittedAcknowledgment({
          adapter,
          queueService: activeQueueService,
          registry: activeRegistry,
          envelope,
        })

        const remaining = await activeQueueService.countPending()

        if (hasStorageError) {
          // The server confirmed acceptance but local cleanup failed: keep the
          // envelope so a repeat reconciliation can finish idempotently.
          await persistEnvelopeMarker(envelope, {
            acceptance: 'accepted',
            reconciliationRequired: true,
            reconciliationCode: 'LOCAL_SYNC_CLEANUP_FAILED',
            reconciliationOutcome: 'cleanup_failed',
            processedAt,
          })
          return {
            ok: false,
            code: SYNC_RECONCILIATION_RESULTS.CLEANUP_FAILED,
            requestId: envelope.requestId,
            acceptance: 'accepted',
            reconciliationRequired: true,
            processedAt,
            removedQueueIds,
            preservedQueueIds,
            cleanupFailedQueueIds,
            remaining,
            message:
              'Server sudah menerima pengiriman, tetapi pembersihan antrean lokal gagal. Coba rekonsiliasi ulang.',
            error: {
              code: SYNC_RECONCILIATION_RESULTS.CLEANUP_FAILED,
              message: 'Pembersihan antrean lokal gagal setelah penerimaan server.',
            },
          }
        }

        return {
          ok: true,
          code: SYNC_RECONCILIATION_RESULTS.COMMITTED,
          requestId: envelope.requestId,
          acceptance: 'accepted',
          reconciliationRequired: false,
          processedAt,
          removedQueueIds,
          preservedQueueIds,
          cleanupFailedQueueIds: [],
          remaining,
          message: 'Pengiriman dikonfirmasi diterima server. Pembersihan lokal selesai.',
        }
      }

      // ── not_found: inconclusive, never assume failure, never re-plan ────────
      if (body?.status === SYNC_REQUEST_STATUS_NOT_FOUND) {
        await persistEnvelopeMarker(envelope, {
          acceptance: 'unknown',
          reconciliationRequired: true,
          reconciliationCode: 'SYNC_RECONCILIATION_NOT_FOUND',
          reconciliationOutcome: 'not_found',
          processedAt: null,
        })
        const remaining = await activeQueueService.countPending()
        return {
          ok: true,
          code: SYNC_RECONCILIATION_RESULTS.NOT_FOUND,
          requestId: envelope.requestId,
          acceptance: 'unknown',
          reconciliationRequired: true,
          outcome: 'not_found',
          resolved: false,
          recheckAvailable: true,
          interventionRequired: true,
          remaining,
          message:
            'Hasil akhir pengiriman belum dapat dipastikan. Data lokal tetap aman; minta bantuan owner/support dan lakukan pemeriksaan ulang terkontrol.',
        }
      }

      // ── Unrecognised 200 body: treat as unreachable, keep everything ────────
      await persistEnvelopeMarker(envelope, {
        acceptance: envelope.acceptance ?? 'unknown',
        reconciliationRequired: true,
        reconciliationCode: 'SYNC_RECONCILIATION_UNREACHABLE',
        reconciliationOutcome: 'unreachable',
      })
      return {
        ok: false,
        code: SYNC_RECONCILIATION_RESULTS.UNREACHABLE,
        requestId: envelope.requestId,
        acceptance: envelope.acceptance ?? 'unknown',
        reconciliationRequired: true,
        pendingConnection: false,
        message:
          'Respons status pengiriman tidak dikenali. Data lokal tetap aman dan menunggu pemeriksaan ulang.',
        error: {
          code: SYNC_RECONCILIATION_RESULTS.UNREACHABLE,
          reason: 'UNRECOGNISED_STATUS',
        },
      }
    } catch (err) {
      return {
        ok: false,
        code: SYNC_RECONCILIATION_RESULTS.UNREACHABLE,
        message: err instanceof Error ? err.message : 'Rekonsiliasi sinkronisasi gagal.',
        error: {
          code: SYNC_RECONCILIATION_RESULTS.UNREACHABLE,
          message: err instanceof Error ? err.message : String(err),
        },
      }
    } finally {
      isReconciling = false
    }
  }

  return {
    reconcile,
    queueService: activeQueueService,
    registry: activeRegistry,
    get isReconciling() {
      return isReconciling
    },
  }
}
