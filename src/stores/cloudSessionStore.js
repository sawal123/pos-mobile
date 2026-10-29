import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

import { normalizeCloudBusinessType } from '@/data/businessTemplates'
import { useBusinessStore } from '@/stores/businessStore'
import {
  cloudLogin,
  cloudGoogleLogin,
  cloudRegister,
  cloudVerifyOtp,
  cloudResendOtp,
  savePendingRegistrationMetadata,
  getPendingRegistrationMetadata,
  clearPendingRegistrationMetadata,
  fetchMobileContext,
  fetchMobileAuthMethods,
  cloudReauthenticateForGoogleLink,
  cloudLinkGoogleAccount,
  cloudForgotPassword,
  cloudResetPassword,
  cloudRequestEmailChange,
  cloudVerifyEmailChange,
  registerDevice,
  cloudLogout,
} from '@/services/cloud/authService'
import {
  saveToken,
  getToken,
  removeToken,
  removeTokenIfMatchesDetailed,
} from '@/services/cloud/tokenRepository'
import { resolveDeviceIdentifier } from '@/services/cloud/deviceIdentifier'
import {
  ROLE_CASHIER,
  isPushEnabled,
  normalizeRole,
  resolveSyncPushPolicy,
} from '@/services/sync/syncCapabilityPolicy'
import {
  buildBusinessSwitchConfirmation,
  inspectLocalBusinessWorkspace,
} from '@/services/cloud/businessContextActivation'
import {
  LOCAL_WORKSPACE_ID,
  WORKSPACE_SWITCH_RESULT,
  cloudWorkspaceId,
  readWorkspaceRegistryStrict,
  recoverPendingWorkspaceSwitch,
  resolveActiveWorkspaceId,
  switchOperationalWorkspace,
} from '@/services/cloud/businessWorkspaceService'

/**
 * Normalise a raw `/api/mobile/context` business entry. `role` and
 * `sync_capabilities` are additive INT-01 fields: legacy backends simply omit
 * them and the resolver falls back to legacy owner/member behaviour.
 *
 * @param {object} b
 * @returns {object}
 */
function mapBusinessEntry(b) {
  const businessType = normalizeCloudBusinessType(b.business_type)
  const hasBusinessType = Object.prototype.hasOwnProperty.call(b, 'business_type')

  return {
    id: b.id,
    name: b.name,
    // Canonical UI/business-store type. Unknown values stay null and are never
    // silently converted to Cafe.
    business_type: businessType,
    business_type_raw: typeof b.business_type === 'string' ? b.business_type : null,
    business_type_status: businessType ? 'valid' : (hasBusinessType ? 'unknown' : 'legacy'),
    role: normalizeRole(b.role ?? b.role_name ?? null),
    sync_capabilities: b.sync_capabilities ?? null,
    cloud_access: b.cloud_access,
    subscription: b.subscription ?? null,
    outlets: (b.outlets ?? []).map((o) => ({
      id: o.id,
      name: o.name,
      status: o.status,
    })),
    device_context: b.device_context ?? null,
  }
}

function isValidBusinessEntry(business) {
  if (!business || typeof business !== 'object' || Array.isArray(business)) return false
  if (business.id === null || business.id === undefined || String(business.id).trim() === '') {
    return false
  }
  if (typeof business.name !== 'string' || business.name.trim() === '') return false
  if (business.outlets !== undefined && !Array.isArray(business.outlets)) return false
  return (business.outlets ?? []).every(
    (outlet) =>
      outlet &&
      typeof outlet === 'object' &&
      outlet.id !== null &&
      outlet.id !== undefined &&
      typeof outlet.name === 'string' &&
      outlet.name.trim() !== '' &&
      typeof outlet.status === 'string',
  )
}

function isValidSessionUser(user) {
  return (
    user &&
    (typeof user.id === 'string' || typeof user.id === 'number') &&
    String(user.id).trim() !== '' &&
    typeof user.name === 'string' &&
    user.name.trim() !== '' &&
    typeof user.email === 'string' &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email)
  )
}

/**
 * PREM-M03: parse the `businesses` payload defensively. A malformed payload
 * (present but not an array) fails closed instead of throwing or granting
 * access.
 *
 * @param {object|null|undefined} data
 * @returns {{ok: boolean, businesses: object[]}}
 */
function extractBusinesses(data) {
  const raw = data?.businesses

  if (raw === undefined || raw === null) {
    return { ok: true, businesses: [] }
  }

  if (!Array.isArray(raw)) {
    return { ok: false, businesses: [] }
  }

  if (!raw.every(isValidBusinessEntry)) {
    return { ok: false, businesses: [] }
  }

  return { ok: true, businesses: raw.map(mapBusinessEntry) }
}

/**
 * PREM-M03: detect an invalid/expired Cloud token from an `apiClient` error.
 *
 * @param {object|null|undefined} error
 * @returns {boolean}
 */
function isUnauthorizedError(error) {
  const status = Number(error?.status) || 0
  const code = typeof error?.code === 'string' ? error.code : ''
  return (
    status === 401 || code === 'HTTP_401' || code === 'UNAUTHENTICATED' || code === 'TOKEN_INVALID'
  )
}

/**
 * Cloud session store — P10.
 *
 * Owns NON-SENSITIVE cloud context:
 *   - authenticated user (id, name, email)
 *   - selected business_id / name
 *   - selected outlet_id / name
 *   - device_identifier (stable UUID)
 *   - registered device server-id
 *   - cloud_access flag
 *
 * Bearer token lives exclusively in tokenRepository (secure storage).
 * This store is NOT included in P7 backup.
 * This store never calls /api/sync/push or /api/sync/pull.
 */
export const useCloudSessionStore = defineStore('cloudSession', () => {
  // ── State ──────────────────────────────────────────────────────────────────

  /** Authenticated user: { id, name, email } | null */
  const user = ref(null)

  /** Selected business from /api/mobile/context */
  const selectedBusiness = ref(null) // { id, name, business_type }

  /** Selected outlet */
  const selectedOutlet = ref(null) // { id, name }

  /** Stable device UUID – set from deviceIdentifier service */
  const deviceIdentifier = ref(null)

  /** Server-side device ID after registration */
  const registeredDeviceId = ref(null)

  /** cloud_access for the selected business */
  const cloudAccess = ref(false)

  /**
   * Membership role for the selected business (owner | member | cashier).
   * Authoritative only while `capabilityState === 'verified'`.
   */
  const role = ref(null)

  /** Raw INT-01 `sync_capabilities` for the selected business. */
  const syncCapabilities = ref(null)

  /** `device_context` reported by /api/mobile/context for the selected outlet. */
  const deviceContext = ref(null)

  /**
   * Verification state of the capability contract.
   * - `verified`   : fetched from the server in this session.
   * - `unverified` : restored from the persisted cache, not yet re-confirmed.
   * - `legacy`     : cache predating INT-02 (no role and no capabilities).
   * - `unknown`    : nothing known yet.
   */
  const capabilityState = ref('unknown')

  /** Timestamp of the last successful capability refresh. */
  const capabilitiesVerifiedAt = ref(null)

  /**
   * PREM-M03: last time the server context was checked, kept across restarts
   * for display only. Unlike `capabilitiesVerifiedAt` it never authorizes.
   */
  const contextCheckedAt = ref(null)

  /** PREM-M03: when this POS was explicitly linked to a Cloud business. */
  const linkedAt = ref(null)

  /** PREM-M03: true when the stored Cloud token was rejected (needs re-login). */
  const sessionInvalid = ref(false)

  /** List of businesses from context (drives selection UI) */
  const businesses = ref([])

  /** Tracks whether the business context list has been resolved from the API in this session */
  const hasResolvedBusinessContext = ref(false)

  /** Tracks whether the account has confirmed zero business from /api/mobile/context (persisted across restart) */
  const hasResolvedZeroBusiness = ref(false)

  /**
   * Durable link between this singleton local workspace and a Cloud business.
   * It prevents a legacy Cloud selection from being mistaken for a safe local
   * business activation after a restart.
   */
  const operationalContext = ref(null)

  /**
   * Confirmation snapshot for a required Cloud→local workspace switch. Set when
   * the selected Cloud business differs from the active local workspace. It is a
   * confirmation prompt, never an error: the Cloud link itself is already valid.
   * Shape: { localBusiness, cloudBusiness, localWorkspaceId, targetWorkspaceId, confirmation }.
   */
  const pendingSwitch = ref(null)

  /** Workspace id currently materialised in the singleton local database. */
  const activeWorkspaceId = ref(LOCAL_WORKSPACE_ID)

  /** Registry of known local/Cloud workspaces (display + isolation bookkeeping). */
  const workspaceRegistry = ref(null)

  /**
   * True when the workspace registry exists but could not be read/parsed.
   * Treated as fail-closed: the device must not be assumed empty.
   */
  const workspaceRegistryUnreadable = ref(false)

  /**
   * True when a workspace switch could not be rolled back automatically and a
   * manual recovery is required. While set, tenant data access and Cloud Sync
   * stay blocked so a mixed/inconsistent workspace is never used.
   */
  const workspaceRecoveryRequired = ref(false)

  /** True while a cloud operation is in flight */
  const loading = ref(false)

  /** Last cloud error string – cleared on each new operation */
  const error = ref(null)

  /** Logical session state derived from the authoritative store facts below. */
  const pendingAuthState = ref(null)

  /** One ownership record for restore/auth/context operations. */
  const activeSessionOperation = ref(null)
  let sessionOperationSequence = 0
  let googleLinkGrant = null
  let googleLinkGrantExpiresAt = 0
  let googleLinkToken = null
  let googleLinkUserId = null
  let googleLinkOperation = null
  let emailChangePendingId = null
  let emailChangeToken = null
  let emailChangeUserId = null
  let emailChangeOperation = null
  let emailChangeSequence = 0

  function beginSessionOperation(kind, { replace = false } = {}) {
    if (activeSessionOperation.value && !replace) return null
    const operation = { id: ++sessionOperationSequence, kind }
    activeSessionOperation.value = operation
    return operation
  }

  function isCurrentSessionOperation(operation) {
    return Boolean(
      operation &&
        activeSessionOperation.value &&
        activeSessionOperation.value.id === operation.id,
    )
  }

  function finishSessionOperation(operation) {
    if (isCurrentSessionOperation(operation)) activeSessionOperation.value = null
  }

  function staleSessionResult(message = 'Operasi sesi Cloud sudah tidak berlaku.') {
    return {
      ok: false,
      state: 'stale_operation',
      error: {
        status: 0,
        code: 'STALE_SESSION_OPERATION',
        message,
        data: null,
      },
    }
  }

  /** Reference to persistence adapter */
  let _adapter = null

  /** Reference to the persistence service (flush/rehydrate) */
  let _scheduler = null

  // ── Computed ───────────────────────────────────────────────────────────────

  const isAuthenticated = computed(() => user.value !== null)

  const sessionState = computed(() => {
    if (sessionInvalid.value) return 'session_invalid'
    if (pendingAuthState.value === 'pending_email') return 'pending_email'
    if (pendingAuthState.value === 'pending_two_factor') return 'pending_two_factor'
    if (
      activeSessionOperation.value?.kind === 'restore' ||
      activeSessionOperation.value?.kind === 'manual_login' ||
      activeSessionOperation.value?.kind === 'google_login' ||
      activeSessionOperation.value?.kind === 'google_link'
    ) {
      return 'authenticating'
    }
    if (!isAuthenticated.value) return 'unauthenticated'
    if (!selectedBusiness.value) return 'authenticated_unlinked'
    if (
      capabilityState.value !== 'verified' ||
      !isOperationalCloudAccess.value ||
      pendingSwitch.value ||
      workspaceRecoveryRequired.value
    ) {
      return 'linked_unverified'
    }
    return 'linked_ready'
  })

  /** PREM-M03: a Cloud business is explicitly linked to this POS. */
  const isLinked = computed(() => isAuthenticated.value && selectedBusiness.value !== null)

  const hasCloudAccess = computed(() => isAuthenticated.value && cloudAccess.value === true)

  const isDeviceRegistered = computed(() => registeredDeviceId.value !== null)

  const isOperationalContextActive = computed(
    () =>
      operationalContext.value?.status === 'active' &&
      operationalContext.value?.cloudBusinessId === selectedBusiness.value?.id,
  )

  /**
   * The active local workspace matches the selected Cloud business/outlet, so
   * tenant data may be served for it.
   *
   * A Cloud link may be perfectly valid (server entitlement intact) while the
   * local workspace still belongs to a different business, or while the backend
   * reports an explicit unknown business type. In both cases tenant data access
   * and Cloud Sync must stay blocked — but the server entitlement itself is
   * never altered (see `cloudAccess`).
   */
  const isWorkspaceAligned = computed(() => {
    const business = selectedBusiness.value
    if (!business) return false

    const context = operationalContext.value
    // No operational context yet: preserve the pre-existing tolerant behaviour
    // so a legacy session that never wrote one keeps working.
    if (!context) return true

    if (context.status === 'unknown_type') {
      // Only an EXPLICITLY unknown business type fails closed for tenant
      // operations. A legacy backend that simply omitted `business_type` (or a
      // restored cache predating it) keeps the pre-existing tolerant behaviour.
      // Either way the server entitlement is never touched.
      return business.business_type_status !== 'unknown'
    }

    if (context.status !== 'active') return false
    if (context.cloudBusinessId !== business.id) return false
    if (context.outletId && selectedOutlet.value && context.outletId !== selectedOutlet.value.id) {
      return false
    }
    return true
  })

  /** True when a safe workspace switch awaits explicit user confirmation. */
  const requiresBusinessSwitch = computed(() => pendingSwitch.value !== null)

  /**
   * Server entitlement is kept separately in `cloudAccess`; this flag is the
   * only one that tenant-data access and sync callers may use. It requires both
   * the server entitlement AND an aligned operational workspace, so a laundry
   * local workspace can never receive Café transactions (or vice versa).
   */
  const isOperationalCloudAccess = computed(
    () =>
      cloudAccess.value === true &&
      isWorkspaceAligned.value &&
      workspaceRecoveryRequired.value !== true &&
      sessionInvalid.value !== true &&
      activeSessionOperation.value?.kind !== 'logout',
  )

  /**
   * Effective INT-02 push policy for the selected business.
   * Never mutated by cache contents: recomputed from role + capabilities.
   */
  const pushPolicy = computed(() =>
    resolveSyncPushPolicy({
      role: role.value,
      syncCapabilities: syncCapabilities.value,
      capabilityState: capabilityState.value,
    }),
  )

  /**
   * Cloud mutation is only authorised with a *verified* capability contract.
   * A cached (unverified/legacy) context must fail closed for mutation while
   * still allowing Free offline mode to run normally.
   */
  const canPerformCloudPush = computed(
    () =>
      capabilityState.value === 'verified' &&
      sessionInvalid.value !== true &&
      activeSessionOperation.value?.kind !== 'logout' &&
      isPushEnabled(pushPolicy.value),
  )

  const isCashierContext = computed(
    () =>
      capabilityState.value === 'verified' &&
      sessionInvalid.value !== true &&
      activeSessionOperation.value?.kind !== 'logout' &&
      pushPolicy.value.role === ROLE_CASHIER,
  )

  /** Compact capability summary for the Sync Status UI. */
  const syncCapabilitySummary = computed(() => ({
    role: pushPolicy.value.role,
    pushMode: pushPolicy.value.pushMode,
    source: pushPolicy.value.source,
    contractVersion: pushPolicy.value.contractVersion,
    verified: capabilityState.value === 'verified',
    failClosed: pushPolicy.value.failClosed === true,
    canPush: canPerformCloudPush.value,
  }))

  // ── Helpers ────────────────────────────────────────────────────────────────

  function setPersistenceAdapter(adapter, scheduler = null) {
    _adapter = adapter
    if (scheduler) {
      _scheduler = scheduler
    }
  }

  function getPersistenceAdapter() {
    return _adapter
  }

  function getPersistenceScheduler() {
    return _scheduler
  }

  function toSelectedBusiness(business) {
    return {
      id: business.id,
      name: business.name,
      business_type: business.business_type ?? null,
      business_type_raw: business.business_type_raw ?? null,
      business_type_status: business.business_type_status ?? 'legacy',
      subscription: business.subscription ?? null,
    }
  }

  function readRuntimeBusiness() {
    try {
      const businessStore = useBusinessStore()
      return {
        name: businessStore.name,
        type: businessStore.type,
        outlet: businessStore.outlet,
      }
    } catch {
      return null
    }
  }

  async function inspectWorkspace() {
    return inspectLocalBusinessWorkspace({
      adapter: _adapter,
      runtime: { business: readRuntimeBusiness() },
    })
  }

  async function loadWorkspaceState() {
    if (!_adapter) return
    const strict = await readWorkspaceRegistryStrict(_adapter)
    if (strict.ok) {
      workspaceRegistry.value = strict.registry
      activeWorkspaceId.value = strict.registry.activeWorkspaceId ?? LOCAL_WORKSPACE_ID
      workspaceRegistryUnreadable.value = false
    } else {
      // Never assume an unreadable registry means "empty device": that would let
      // a switch overwrite a healthy workspace snapshot.
      workspaceRegistryUnreadable.value = true
    }
  }

  /**
   * Read-only decision about whether activating the selected Cloud business (and
   * optional outlet) requires switching the active local workspace, and whether
   * that switch needs explicit confirmation from the user.
   */
  async function evaluateWorkspaceSwitch({ business, outlet = null }) {
    const targetWorkspaceId = outlet ? cloudWorkspaceId(business.id, outlet.id) : null
    const currentActiveId = activeWorkspaceId.value ?? (await resolveActiveWorkspaceId(_adapter))
    const workspace = await inspectWorkspace()
    const occupied = workspace.ok ? workspace.occupied === true : true

    const sameWorkspace = Boolean(targetWorkspaceId) && currentActiveId === targetWorkspaceId
    const freshLocal = currentActiveId === LOCAL_WORKSPACE_ID && !occupied

    return {
      targetWorkspaceId,
      currentActiveId,
      workspace,
      localBusiness: workspace.localBusiness,
      occupied,
      sameWorkspace,
      freshLocal,
      // The target must always be materialised through the durable switching
      // protocol whenever it is not already the active workspace — including on
      // a fresh device. This keeps the registry write inside the journaled,
      // rollback-capable path instead of a separate non-atomic "adopt" write.
      needsMaterialise: !sameWorkspace,
      // Confirmation is only required when there is real data to preserve.
      requiresConfirmation: !sameWorkspace && !freshLocal && occupied,
    }
  }

  function setPendingSwitch({
    localBusiness,
    cloudBusiness,
    targetWorkspaceId = null,
    currentActiveId = null,
  }) {
    pendingSwitch.value = {
      localBusiness,
      cloudBusiness: {
        id: cloudBusiness?.id ?? null,
        name: cloudBusiness?.name ?? '',
        business_type: cloudBusiness?.business_type ?? null,
      },
      localWorkspaceId: currentActiveId,
      targetWorkspaceId,
      confirmation: buildBusinessSwitchConfirmation({ localBusiness, cloudBusiness }),
      detectedAt: new Date().toISOString(),
    }
    operationalContext.value = {
      status: 'switch_pending',
      cloudBusinessId: cloudBusiness?.id ?? null,
      code: 'BUSINESS_SWITCH_CONFIRMATION_REQUIRED',
      localBusiness,
      detectedAt: new Date().toISOString(),
    }
  }

  /**
   * Re-evaluate the operational workspace for the selected Cloud business.
   *
   * NEVER rejects a valid Cloud link. A differing local workspace only produces
   * a `switch_pending` confirmation state, so tenant data access and Cloud Sync
   * stay blocked until the user confirms a safe switch — while the account stays
   * fully logged in and the business stays linked.
   */
  async function validateOperationalContext() {
    const business = selectedBusiness.value
    if (!business) return { ok: true, code: 'NO_CLOUD_BUSINESS_SELECTED' }

    if (!business.business_type) {
      operationalContext.value = {
        status: 'unknown_type',
        cloudBusinessId: business.id,
        code: 'CLOUD_BUSINESS_TYPE_UNKNOWN',
        detectedAt: new Date().toISOString(),
      }
      error.value = 'Jenis bisnis dari Cloud tidak tersedia atau tidak dikenali. Aktivasi kasir diblokir.'
      // An unknown business type blocks cashier activation and tenant/sync
      // operations (via `isWorkspaceAligned`), but it must NEVER alter the
      // server-provided entitlement: `cloudAccess` keeps reflecting the backend.
      return { ok: true, code: 'CLOUD_BUSINESS_TYPE_UNKNOWN', message: error.value }
    }

    const context = operationalContext.value
    if (context?.status === 'active' && context.cloudBusinessId === business.id) {
      const workspace = await inspectWorkspace()
      const local = workspace.localBusiness
      const sameIdentity =
        workspace.ok &&
        local.name === business.name &&
        normalizeCloudBusinessType(local.type) === business.business_type &&
        (!context.outletName || local.outlet === context.outletName)

      if (sameIdentity) {
        return { ok: true, code: 'OPERATIONAL_CONTEXT_ACTIVE' }
      }

      // The materialised workspace drifted from the linked business: require a
      // switch instead of silently treating the link as active.
      setPendingSwitch({
        localBusiness: local,
        cloudBusiness: business,
        currentActiveId: activeWorkspaceId.value,
      })
      return { ok: true, code: 'BUSINESS_SWITCH_CONFIRMATION_REQUIRED' }
    }

    const switchInfo = await evaluateWorkspaceSwitch({ business })

    if (switchInfo.requiresConfirmation) {
      setPendingSwitch({
        localBusiness: switchInfo.localBusiness,
        cloudBusiness: business,
        currentActiveId: switchInfo.currentActiveId,
      })
      return { ok: true, code: 'BUSINESS_SWITCH_CONFIRMATION_REQUIRED' }
    }

    operationalContext.value = {
      status: 'pending_outlet',
      cloudBusinessId: business.id,
      code: 'OUTLET_SELECTION_REQUIRED',
      detectedAt: new Date().toISOString(),
    }
    return { ok: true, code: 'OUTLET_SELECTION_REQUIRED' }
  }

  /**
   * INT-02: guarantee a stable device identifier is available before talking to
   * the backend, so `GET /api/mobile/context` can carry `device_identifier`.
   *
   * @returns {Promise<string|null>}
   */
  async function ensureDeviceIdentifier() {
    if (typeof deviceIdentifier.value === 'string' && deviceIdentifier.value.trim().length > 0) {
      return deviceIdentifier.value.trim()
    }

    if (!_adapter) {
      return null
    }

    try {
      const stored = await _adapter.loadDeviceIdentifier()
      if (typeof stored === 'string' && stored.trim().length > 0) {
        deviceIdentifier.value = stored.trim()
        return deviceIdentifier.value
      }
    } catch {
      // fall through to creation
    }

    try {
      const created = await resolveDeviceIdentifier(_adapter)
      if (typeof created === 'string' && created.trim().length > 0) {
        deviceIdentifier.value = created.trim()
        return deviceIdentifier.value
      }
    } catch {
      // non-blocking: context is simply requested without an identifier
    }

    return null
  }

  /**
   * PREM-M03: the backend rejected the stored token (401). Drop the invalid
   * Cloud session, the linked association and the cached context, then surface
   * a "login again" state. Local POS data is never touched and there is no
   * retry loop (apiClient never retries).
   */
  async function handleInvalidToken({ token = null, operation = null } = {}) {
    if (operation && !isCurrentSessionOperation(operation)) {
      return { ok: false, code: 'STALE_SESSION_OPERATION', stale: true }
    }

    let removalState
    try {
      if (token) {
        const removal = await removeTokenIfMatchesDetailed(token)
        removalState = removal.state
      } else {
        await removeToken()
        removalState = 'removed'
      }
    } catch {
      removalState = 'storage_failure'
    }

    if (operation && !isCurrentSessionOperation(operation)) {
      return { ok: false, code: 'STALE_SESSION_OPERATION', stale: true }
    }

    if (removalState === 'ownership_mismatch') {
      return { ok: false, code: 'TOKEN_OWNERSHIP_CHANGED' }
    }

    if (_adapter) {
      try {
        await _adapter.clearCloudContext()
      } catch {
        // ignore – local POS data is untouched either way
      }
    }

    if (operation && !isCurrentSessionOperation(operation)) {
      return { ok: false, code: 'STALE_SESSION_OPERATION', stale: true }
    }

    clearSession()
    sessionInvalid.value = true
    error.value = removalState === 'removed' || removalState === 'missing'
      ? 'Sesi Cloud tidak valid. Silakan masuk kembali untuk menghubungkan ulang.'
      : 'Sesi Cloud belum dapat dicabut dengan aman. Silakan coba lagi.'
    return {
      ok: false,
      code: removalState === 'removed' || removalState === 'missing'
        ? 'TOKEN_INVALID'
        : 'TOKEN_REMOVAL_FAILED',
      storageFailure: removalState === 'storage_failure',
    }
  }

  function clearSession() {
    clearGoogleLinkState()
    clearEmailChangeState()
    user.value = null
    selectedBusiness.value = null
    selectedOutlet.value = null
    cloudAccess.value = false
    registeredDeviceId.value = null
    role.value = null
    syncCapabilities.value = null
    deviceContext.value = null
    capabilityState.value = 'unknown'
    capabilitiesVerifiedAt.value = null
    contextCheckedAt.value = null
    linkedAt.value = null
    sessionInvalid.value = false
    businesses.value = []
    hasResolvedBusinessContext.value = false
    hasResolvedZeroBusiness.value = false
    operationalContext.value = null
    pendingSwitch.value = null
    pendingAuthState.value = null
    error.value = null
    // deviceIdentifier, activeWorkspaceId and workspaceRegistry are device-local
    // and intentionally NOT cleared on logout — the active local workspace keeps
    // its own isolated identity and data.
  }

  /**
   * Persist non-sensitive cloud context to adapter.
   * Minimal context: user, selectedBusiness, selectedOutlet, cloudAccess, registeredDeviceId.
   * Token is NEVER included.
   */
  async function persistCloudContext(adapter = _adapter, { throwOnError = false } = {}) {
    const targetAdapter = adapter ?? _adapter
    if (!targetAdapter) return

    try {
      await targetAdapter.saveCloudContext({
        user: user.value
          ? {
              id: user.value.id,
              name: user.value.name,
              email: user.value.email,
            }
          : null,
        selectedBusiness: selectedBusiness.value
          ? {
              id: selectedBusiness.value.id,
              name: selectedBusiness.value.name,
              business_type: selectedBusiness.value.business_type ?? null,
              business_type_raw: selectedBusiness.value.business_type_raw ?? null,
              business_type_status: selectedBusiness.value.business_type_status ?? 'unknown',
              // PREM-M01: server-provided subscription snapshot so the Settings
              // screen can show the last known plan across an app restart. It is
              // display data only and never authorizes access.
              subscription: selectedBusiness.value.subscription ?? null,
            }
          : null,
        selectedOutlet: selectedOutlet.value
          ? {
              id: selectedOutlet.value.id,
              name: selectedOutlet.value.name,
            }
          : null,
        cloudAccess: cloudAccess.value === true,
        registeredDeviceId: registeredDeviceId.value ?? null,
        hasResolvedZeroBusiness: hasResolvedZeroBusiness.value === true,
        // PREM-M03: link metadata + last context check, display data only.
        linkedAt: linkedAt.value ?? null,
        contextCheckedAt: contextCheckedAt.value ?? null,
        // INT-02: non-sensitive capability context. Never includes a token.
        role: role.value ?? null,
        syncCapabilities: syncCapabilities.value ?? null,
        deviceContext: deviceContext.value ?? null,
        capabilityState: capabilityState.value,
        operationalContext: operationalContext.value ?? null,
      })
    } catch (err) {
      if (throwOnError) {
        throw err
      }
      console.error('Failed to persist cloud context.', err)
    }
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  /**
   * Login flow:
   * 1. Authenticate with /api/auth/login
   * 2. Save token to secure storage
   * 3. Fetch /api/mobile/context
   * 4. Store context in state
   * 5. Persist initial cloud context
   *
   * Returns { ok, businesses, error }.
   */
  async function rollbackStaleSession(savedToken, operation = null) {
    // Logout owns final session cleanup while it is waiting for server
    // revocation. A stale login must not remove its token ahead of logout.
    if (activeSessionOperation.value?.kind === 'logout') {
      return staleSessionResult('Logout sedang menyelesaikan pencabutan sesi.')
    }

    let removalState
    try {
      const removal = await removeTokenIfMatchesDetailed(savedToken)
      removalState = removal.state
    } catch {
      if (operation && !isCurrentSessionOperation(operation)) {
        return staleSessionResult()
      }

      // Storage removal failure is fail-closed only for the operation that
      // still owns the session. A stale operation must not clear a newer one.
      clearSession()
      sessionInvalid.value = true
      error.value = 'Sesi Cloud belum dapat dicabut dengan aman. Silakan coba lagi.'
      return { ok: false, code: 'TOKEN_REMOVAL_FAILED' }
    }

    if (operation && !isCurrentSessionOperation(operation)) {
      return staleSessionResult()
    }

    // Never clear a newer account's in-memory session when ownership changed.
    if (removalState === 'ownership_mismatch') {
      return { ok: false, code: 'TOKEN_OWNERSHIP_CHANGED' }
    }

    if (_adapter) {
      try {
        await _adapter.clearCloudContext()
      } catch {
        // Local POS data is intentionally untouched.
      }
    }

    if (operation && !isCurrentSessionOperation(operation)) {
      return staleSessionResult()
    }

    clearSession()
    if (removalState === 'missing') {
      sessionInvalid.value = true
      error.value = 'Sesi Cloud belum dapat diverifikasi. Silakan masuk kembali.'
      return { ok: false, code: 'TOKEN_INVALID' }
    }
    return { ok: true }
  }

  async function finalizeAuthenticatedLogin(
    loginResult,
    { isActive = () => true, operation = null, rollbackOnStale = false } = {},
  ) {
    const stale = () =>
      (operation && !isCurrentSessionOperation(operation)) ||
      (rollbackOnStale && !isActive())

    if (stale()) return staleSessionResult()

      if (loginResult.state === 'two_factor_required') {
        pendingAuthState.value = 'pending_two_factor'
        error.value = 'Verifikasi dua faktor tambahan diperlukan. Selesaikan melalui alur AUTH-M08.'
        return {
          ok: false,
          state: 'two_factor_required',
          challenge: loginResult.challenge,
          error: loginResult.error,
        }
      }

      if (!loginResult.ok) {
        pendingAuthState.value = null
        error.value = loginResult.error?.message ?? 'Login gagal'
        return { ok: false, error: loginResult.error }
      }

      if (stale()) return staleSessionResult()

      pendingAuthState.value = null

      // Token is only persisted after confirmed success
      await saveToken(loginResult.token)

      if (stale()) {
        await rollbackStaleSession(loginResult.token, operation)
        return staleSessionResult()
      }

      user.value = loginResult.user
        ? {
            id: loginResult.user.id,
            name: loginResult.user.name,
            email: loginResult.user.email,
          }
        : null

      if (stale()) {
        await rollbackStaleSession(loginResult.token, operation)
        return staleSessionResult()
      }

      // INT-02: the context request must carry this device's stable identifier
      // so the backend can return the owner-pre-registered `device_context`.
      const contextDeviceId = await ensureDeviceIdentifier()
      if (stale()) {
        await rollbackStaleSession(loginResult.token, operation)
        return staleSessionResult()
      }
      const contextResult = await fetchMobileContext(loginResult.token, {
        deviceIdentifier: contextDeviceId,
      })

      if (stale()) {
        await rollbackStaleSession(loginResult.token, operation)
        return staleSessionResult()
      }

      if (!contextResult.ok) {
        if (isUnauthorizedError(contextResult.error)) {
          const invalidation = await handleInvalidToken({ token: loginResult.token, operation })
          if (invalidation.stale) return staleSessionResult()
          return {
            ok: false,
            error: {
              ...contextResult.error,
              code: invalidation.code === 'TOKEN_REMOVAL_FAILED'
                ? 'TOKEN_REMOVAL_FAILED'
                : 'TOKEN_INVALID',
            },
          }
        }

        // Rollback token – context is required
        await removeToken()
        user.value = null
        error.value = contextResult.error?.message ?? 'Gagal mengambil context'
        return { ok: false, error: contextResult.error }
      }

      const parsed = extractBusinesses(contextResult.data)

      if (stale()) {
        await rollbackStaleSession(loginResult.token, operation)
        return staleSessionResult()
      }

      if (!parsed.ok) {
        // Fail closed: a malformed context must not grant any Cloud access.
        await removeToken()
        user.value = null
        error.value = 'Context cloud dari server tidak valid.'
        return {
          ok: false,
          error: { status: 0, code: 'MALFORMED_CONTEXT', message: error.value, data: null },
        }
      }

      businesses.value = parsed.businesses
      hasResolvedBusinessContext.value = true
      hasResolvedZeroBusiness.value = businesses.value.length === 0
      sessionInvalid.value = false

      // INT-02: a fresh context response is authoritative for this session.
      capabilityState.value = 'verified'
      capabilitiesVerifiedAt.value = new Date().toISOString()
      contextCheckedAt.value = capabilitiesVerifiedAt.value

      // Persist cloud context on successful login + context
      await persistCloudContext(_adapter, { throwOnError: true })

      if (stale()) {
        await rollbackStaleSession(loginResult.token, operation)
        return staleSessionResult()
      }

      return { ok: true, businesses: businesses.value }
  }

  /** Login with email/password through the shared authenticated session path. */
  async function login(email, password) {
    if (loading.value) return { ok: false, error: { status: 0, code: 'REQUEST_IN_PROGRESS' } }
    const operation = beginSessionOperation('manual_login')
    if (!operation) return { ok: false, error: { status: 0, code: 'REQUEST_IN_PROGRESS' } }
    loading.value = true
    error.value = null
    pendingAuthState.value = null
    let loginResult = null

    try {
      loginResult = await cloudLogin(email, password)
      if (!isCurrentSessionOperation(operation)) return staleSessionResult()
      return await finalizeAuthenticatedLogin(loginResult, {
        operation,
        rollbackOnStale: true,
      })
    } catch (exception) {
      if (loginResult?.ok) await rollbackStaleSession(loginResult.token, operation)
      if (!isCurrentSessionOperation(operation)) return staleSessionResult()
      const message = exception?.message ?? 'Login gagal. Coba lagi.'
      error.value = message
      return { ok: false, error: { status: 0, code: 'LOGIN_FAILED', message, data: null } }
    } finally {
      const ownsLoading = isCurrentSessionOperation(operation)
      finishSessionOperation(operation)
      if (ownsLoading) loading.value = false
    }
  }

  /** Exchange a fresh native Google assertion through the same session path. */
  async function loginWithGoogle(idToken, platform = 'android', { isActive = () => true } = {}) {
    if (loading.value) return { ok: false, error: { status: 0, code: 'REQUEST_IN_PROGRESS' } }
    if (!isActive()) return staleSessionResult('Login Google dibatalkan karena halaman sudah tidak aktif.')
    if (isAuthenticated.value) {
      return {
        ok: false,
        error: {
          status: 409,
          code: 'SESSION_ALREADY_ACTIVE',
          message: 'Sesi Cloud yang aktif tidak dapat diganti diam-diam.',
          data: null,
        },
      }
    }

    const operation = beginSessionOperation('google_login')
    if (!operation) return { ok: false, error: { status: 0, code: 'REQUEST_IN_PROGRESS' } }
    loading.value = true
    error.value = null
    pendingAuthState.value = null
    let loginResult = null
    try {
      loginResult = await cloudGoogleLogin(idToken, platform)
      if (!isCurrentSessionOperation(operation) || !isActive()) return staleSessionResult()
      return await finalizeAuthenticatedLogin(loginResult, {
        isActive,
        operation,
        rollbackOnStale: true,
      })
    } catch (exception) {
      if (loginResult?.ok) await rollbackStaleSession(loginResult.token, operation)
      if (!isCurrentSessionOperation(operation) || !isActive()) return staleSessionResult()

      const message = exception?.message ?? 'Login Google gagal. Coba lagi dengan akun Google.'
      error.value = message
      return {
        ok: false,
        error: { status: 0, code: 'GOOGLE_LOGIN_FAILED', message, data: null },
      }
    } finally {
      const ownsLoading = isCurrentSessionOperation(operation)
      finishSessionOperation(operation)
      if (ownsLoading) loading.value = false
    }
  }

  function clearGoogleLinkGrant() {
    googleLinkGrant = null
    googleLinkGrantExpiresAt = 0
    googleLinkToken = null
    googleLinkUserId = null
  }

  function clearGoogleLinkState(operation = null) {
    if (operation && googleLinkOperation !== operation) return
    clearGoogleLinkGrant()
    googleLinkOperation = null
  }

  function googleLinkError(code, message) {
    return {
      ok: false,
      error: { status: 0, code, message, data: null },
    }
  }

  async function readAuthenticationMethods(token, expectedUserId) {
    const result = await fetchMobileAuthMethods(token)
    if (!result.ok) return result

    if (String(result.user.id) !== String(expectedUserId)) {
      return googleLinkError(
        'SESSION_CHANGED',
        'Sesi Cloud berubah. Status metode autentikasi belum dapat dipastikan.',
      )
    }

    return result
  }

  /** Refresh v2 authentication methods without changing Cloud/business state. */
  async function refreshAuthenticationMethods() {
    if (!isAuthenticated.value || user.value?.id === null || user.value?.id === undefined) {
      return googleLinkError('UNAUTHENTICATED', 'Sesi Cloud belum aktif.')
    }

    const operation = beginSessionOperation('auth_methods_refresh')
    if (!operation) return googleLinkError('REQUEST_IN_PROGRESS', 'Operasi Cloud masih berjalan.')

    loading.value = true
    try {
      const token = await getToken()
      if (!isCurrentSessionOperation(operation)) return staleSessionResult()
      if (typeof token !== 'string' || token.trim() === '') {
        return googleLinkError('TOKEN_INVALID', 'Sesi Cloud belum dapat diverifikasi.')
      }

      const result = await readAuthenticationMethods(token, user.value.id)
      if (!isCurrentSessionOperation(operation)) return staleSessionResult()
      return result
    } catch {
      if (!isCurrentSessionOperation(operation)) return staleSessionResult()
      return googleLinkError('AUTH_METHODS_UNVERIFIED', 'Metode autentikasi belum dapat diverifikasi.')
    } finally {
      const ownsLoading = isCurrentSessionOperation(operation)
      finishSessionOperation(operation)
      if (ownsLoading) loading.value = false
    }
  }

  /**
   * Start or continue the explicit password/TOTP proof for Google linking.
   * The raw grant stays in this closure and is never exposed as store state.
   */
  async function reauthenticateForGoogleLink(password, totpCode = null) {
    if (!isAuthenticated.value || user.value?.id === null || user.value?.id === undefined) {
      return googleLinkError('UNAUTHENTICATED', 'Sesi Cloud belum aktif.')
    }
    if (typeof password !== 'string' || password.trim() === '') {
      return googleLinkError('INVALID_CREDENTIALS', 'Password saat ini wajib diisi.')
    }

    const operation = googleLinkOperation && isCurrentSessionOperation(googleLinkOperation)
      ? googleLinkOperation
      : beginSessionOperation('google_link')
    if (!operation) return googleLinkError('REQUEST_IN_PROGRESS', 'Operasi Cloud masih berjalan.')

    googleLinkOperation = operation
    clearGoogleLinkGrant()
    googleLinkToken = null
    googleLinkUserId = String(user.value.id)
    loading.value = true
    error.value = null
    let retainOperation = true

    try {
      const token = await getToken()
      if (!isCurrentSessionOperation(operation)) return staleSessionResult()
      if (typeof token !== 'string' || token.trim() === '') {
        retainOperation = false
        return googleLinkError('TOKEN_INVALID', 'Sesi Cloud belum dapat diverifikasi.')
      }

      googleLinkToken = token
      const result = await cloudReauthenticateForGoogleLink(token, password, totpCode)
      if (!isCurrentSessionOperation(operation)) return staleSessionResult()
      if (!result.ok) {
        // The user may explicitly correct the password or add the requested TOTP.
        return result
      }

      googleLinkGrant = result.reauthenticationToken
      googleLinkGrantExpiresAt = result.expiresAt
      return { ok: true, expiresAt: result.expiresAt }
    } catch {
      retainOperation = false
      return googleLinkError('REAUTHENTICATION_FAILED', 'Verifikasi ulang belum dapat diproses.')
    } finally {
      const ownsOperation = isCurrentSessionOperation(operation)
      if (!retainOperation && ownsOperation) {
        clearGoogleLinkState(operation)
        finishSessionOperation(operation)
      }
      if (ownsOperation) loading.value = false
    }
  }

  /**
   * Submit one fresh Google assertion using the currently owned reauth grant.
   * A link result is followed by one authentication-method refresh only; no
   * grant or assertion is replayed automatically.
   */
  async function linkGoogleAccount(idToken, platform = 'android') {
    const operation = googleLinkOperation
    if (!operation || !isCurrentSessionOperation(operation)) {
      clearGoogleLinkGrant()
      return googleLinkError('REAUTHENTICATION_REQUIRED', 'Mulai verifikasi ulang terlebih dahulu.')
    }
    if (
      typeof googleLinkGrant !== 'string' ||
      googleLinkGrant.trim() === '' ||
      !Number.isFinite(googleLinkGrantExpiresAt) ||
      Date.now() >= googleLinkGrantExpiresAt
    ) {
      clearGoogleLinkState(operation)
      finishSessionOperation(operation)
      return googleLinkError('REAUTHENTICATION_EXPIRED', 'Sesi verifikasi ulang sudah kedaluwarsa.')
    }
    if (typeof idToken !== 'string' || idToken.trim() === '') {
      return googleLinkError('GOOGLE_ID_TOKEN_MISSING', 'Kredensial Google tidak tersedia.')
    }

    loading.value = true
    let linkAttempted = false
    try {
      const currentToken = await getToken()
      if (!isCurrentSessionOperation(operation)) return staleSessionResult()
      if (currentToken !== googleLinkToken || String(user.value?.id) !== googleLinkUserId) {
        return staleSessionResult('Sesi Cloud berubah. Penghubungan dibatalkan.')
      }

      const result = await cloudLinkGoogleAccount(
        currentToken,
        googleLinkGrant,
        idToken,
        platform,
      )
      linkAttempted = true
      if (!isCurrentSessionOperation(operation)) return staleSessionResult()

      // A grant is never retained after a link attempt, including uncertain
      // network outcomes. The server status check below is not a replay.
      googleLinkGrant = null
      googleLinkGrantExpiresAt = 0

      if (!result.ok) {
        const uncertain = Number(result.error?.status) === 0 || result.error?.code === 'NETWORK_ERROR'
        if (!uncertain) {
          return {
            ...result,
            linkAttempted: true,
            linkLifecycle: 'rejected',
          }
        }

        const verified = await readAuthenticationMethods(currentToken, googleLinkUserId)
        if (!isCurrentSessionOperation(operation)) return staleSessionResult()
        if (verified.ok && verified.authenticationMethods.includes('google')) {
          return {
            ok: true,
            linked: false,
            methodsVerified: true,
            authenticationMethods: verified.authenticationMethods,
            statusRecovered: true,
            linkAttempted: true,
            linkLifecycle: 'linked_verified',
          }
        }
        return {
          ok: false,
          code: 'LINK_STATUS_UNVERIFIED',
          uncertain: true,
          linkAttempted: true,
          linkLifecycle: 'uncertain',
          error: verified.error ?? result.error,
        }
      }

      const methods = await readAuthenticationMethods(currentToken, googleLinkUserId)
      if (!isCurrentSessionOperation(operation)) return staleSessionResult()
      if (!methods.ok) {
        return {
          ok: true,
          linked: result.linked,
          methodsVerified: false,
          code: 'LINK_STATUS_UNVERIFIED',
          linkAttempted: true,
          linkLifecycle: 'linked_unverified',
          error: methods.error,
        }
      }
      if (!methods.authenticationMethods.includes('google')) {
        return {
          ok: true,
          linked: result.linked,
          methodsVerified: false,
          code: 'LINK_STATUS_UNVERIFIED',
          linkAttempted: true,
          linkLifecycle: 'linked_unverified',
          error: googleLinkError(
            'LINK_STATUS_UNVERIFIED',
            'Link berhasil, tetapi status metode autentikasi belum dapat dipastikan.',
          ).error,
        }
      }

      return {
        ok: true,
        linked: result.linked,
        methodsVerified: true,
        authenticationMethods: methods.authenticationMethods,
        linkAttempted: true,
        linkLifecycle: 'linked_verified',
      }
    } catch {
      return {
        ok: false,
        code: 'LINK_STATUS_UNVERIFIED',
        uncertain: true,
        linkAttempted,
        linkLifecycle: linkAttempted ? 'uncertain' : 'not_attempted',
        error: { status: 0, code: 'NETWORK_ERROR', message: 'Status link belum dapat dipastikan.', data: null },
      }
    } finally {
      const ownsOperation = isCurrentSessionOperation(operation)
      if (ownsOperation) {
        clearGoogleLinkState(operation)
        finishSessionOperation(operation)
        loading.value = false
      }
    }
  }

  function cancelGoogleAccountLinking() {
    const operation = googleLinkOperation
    clearGoogleLinkState()
    if (operation && isCurrentSessionOperation(operation)) {
      finishSessionOperation(operation)
      loading.value = false
    }
    return { ok: true, state: 'cancelled' }
  }

  function clearEmailChangeState() {
    emailChangeSequence += 1
    emailChangePendingId = null
    emailChangeToken = null
    emailChangeUserId = null
    emailChangeOperation = null
  }

  /**
   * Request password recovery instructions. Never creates a session, never
   * saves the email as authenticated identity, and never discloses whether an
   * account exists.
   */
  async function forgotPassword(email) {
    const result = await cloudForgotPassword(email)
    return result
  }

  /**
   * Complete password reset using a valid server reset token.
   * Never creates a session or saves a bearer token. If the currently active
   * local session belongs to the same email, invalidates it in an ownership-aware
   * manner while preserving any other account's session and all offline POS data.
   */
  async function resetPassword({ email, token, password, password_confirmation } = {}) {
    const result = await cloudResetPassword({
      email,
      token,
      password,
      password_confirmation,
    })

    if (!result.ok) {
      return result
    }

    const normalizedTargetEmail = String(email ?? '').trim().toLowerCase()
    const currentSessionEmail = String(user.value?.email ?? '').trim().toLowerCase()
    let sessionInvalidated = false

    if (
      isAuthenticated.value &&
      normalizedTargetEmail &&
      currentSessionEmail === normalizedTargetEmail
    ) {
      let currentToken
      try {
        currentToken = await getToken()
      } catch {
        currentToken = null
      }

      if (
        isAuthenticated.value &&
        String(user.value?.email ?? '').trim().toLowerCase() === normalizedTargetEmail
      ) {
        await handleInvalidToken({ token: currentToken })
        sessionInvalidated = true
      }
    }

    return {
      ok: true,
      message: result.message,
      sessionInvalidated,
    }
  }

  /**
   * Initiate an authenticated email change request.
   * Never mutates `user.email` on HTTP 202 and distinguishes `INVALID_CREDENTIALS`
   * (401) from a revoked Sanctum session.
   */
  async function requestEmailChange({
    newEmail,
    currentPassword = null,
    totpCode = null,
    idToken = null,
    clientPlatform = null,
  } = {}) {
    if (!isAuthenticated.value || user.value?.id === null || user.value?.id === undefined) {
      return googleLinkError('UNAUTHENTICATED', 'Sesi Cloud belum aktif.')
    }

    const operation = beginSessionOperation('email_change')
    if (!operation) {
      return googleLinkError('REQUEST_IN_PROGRESS', 'Operasi Cloud masih berjalan.')
    }

    emailChangeOperation = operation
    const requestSequence = ++emailChangeSequence
    const requestUserId = String(user.value.id)
    loading.value = true
    error.value = null

    try {
      const token = await getToken()
      if (
        !isCurrentSessionOperation(operation) ||
        emailChangeSequence !== requestSequence ||
        String(user.value?.id) !== requestUserId
      ) {
        return staleSessionResult('Sesi Cloud berubah. Perubahan email dibatalkan.')
      }
      if (typeof token !== 'string' || token.trim() === '') {
        return googleLinkError('TOKEN_INVALID', 'Sesi Cloud belum dapat diverifikasi.')
      }

      const result = await cloudRequestEmailChange(token, {
        newEmail,
        currentPassword,
        totpCode,
        idToken,
        clientPlatform,
      })

      if (
        !isCurrentSessionOperation(operation) ||
        emailChangeSequence !== requestSequence ||
        String(user.value?.id) !== requestUserId
      ) {
        return staleSessionResult('Sesi Cloud berubah. Perubahan email dibatalkan.')
      }

      if (!result.ok) {
        const errorCode = String(result.error?.code ?? '').toUpperCase()
        // Distinguish explicit INVALID_CREDENTIALS (which may use HTTP 401)
        // from an unauthenticated / revoked Sanctum session.
        if (
          isUnauthorizedError(result.error) &&
          errorCode !== 'INVALID_CREDENTIALS'
        ) {
          clearEmailChangeState()
          await handleInvalidToken({ token, operation })
          return {
            ok: false,
            sessionInvalidated: true,
            error: result.error,
          }
        }
        return result
      }

      emailChangePendingId = result.changeId
      emailChangeToken = token
      emailChangeUserId = requestUserId

      return {
        ok: true,
        changeId: result.changeId,
        state: result.state,
        otpExpiresAt: result.otpExpiresAt,
        resendAvailableAt: result.resendAvailableAt,
      }
    } catch {
      return googleLinkError('EMAIL_CHANGE_REQUEST_FAILED', 'Permintaan perubahan email gagal.')
    } finally {
      const ownsOperation = isCurrentSessionOperation(operation)
      if (emailChangeOperation === operation) emailChangeOperation = null
      finishSessionOperation(operation)
      if (ownsOperation) loading.value = false
    }
  }

  /**
   * Verify the 6-digit OTP sent to the new email address using the exact
   * initiating session. On authoritative HTTP 200 verification, revokes the
   * local Cloud session in an ownership-aware manner without touching POS data.
   */
  async function verifyEmailChange({ changeId = null, code } = {}) {
    const targetChangeId = changeId || emailChangePendingId
    const expectedUserId = emailChangeUserId || (user.value?.id != null ? String(user.value.id) : null)
    const expectedToken = emailChangeToken
    const expectedSequence = emailChangeSequence

    if (!isAuthenticated.value || user.value?.id === null || user.value?.id === undefined) {
      clearEmailChangeState()
      return googleLinkError('UNAUTHENTICATED', 'Sesi Cloud belum aktif.')
    }

    if (expectedUserId && String(user.value.id) !== expectedUserId) {
      clearEmailChangeState()
      return staleSessionResult('Sesi Cloud berubah. Perubahan email dibatalkan.')
    }

    const operation = beginSessionOperation('email_change_verify')
    if (!operation) {
      return googleLinkError('REQUEST_IN_PROGRESS', 'Operasi Cloud masih berjalan.')
    }

    emailChangeOperation = operation
    loading.value = true

    try {
      const currentToken = await getToken()
      if (
        !isCurrentSessionOperation(operation) ||
        emailChangeSequence !== expectedSequence ||
        (expectedUserId && String(user.value?.id) !== expectedUserId)
      ) {
        return staleSessionResult('Sesi Cloud berubah. Perubahan email dibatalkan.')
      }

      if (typeof currentToken !== 'string' || currentToken.trim() === '') {
        return googleLinkError('UNAUTHENTICATED', 'Sesi Cloud belum aktif.')
      }

      if (expectedToken && currentToken !== expectedToken) {
        clearEmailChangeState()
        return staleSessionResult('Sesi Cloud berubah. Perubahan email dibatalkan.')
      }

      const result = await cloudVerifyEmailChange(currentToken, {
        changeId: targetChangeId,
        code,
      })

      if (
        !isCurrentSessionOperation(operation) ||
        emailChangeSequence !== expectedSequence ||
        (expectedUserId && String(user.value?.id) !== expectedUserId)
      ) {
        return staleSessionResult('Sesi Cloud berubah. Perubahan email dibatalkan.')
      }

      if (!result.ok) {
        const uncertain =
          Number(result.error?.status) === 0 || result.error?.code === 'NETWORK_ERROR'
        if (uncertain) {
          // Read-only session check to detect if server already revoked the token
          const check = await fetchMobileAuthMethods(currentToken).catch(() => ({
            ok: false,
            error: { status: 0, code: 'NETWORK_ERROR' },
          }))

          if (
            !isCurrentSessionOperation(operation) ||
            emailChangeSequence !== expectedSequence ||
            (expectedUserId && String(user.value?.id) !== expectedUserId)
          ) {
            return staleSessionResult('Sesi Cloud berubah. Perubahan email dibatalkan.')
          }

          if (!check.ok && isUnauthorizedError(check.error)) {
            clearEmailChangeState()
            await handleInvalidToken({ token: currentToken, operation })
            error.value =
              'Status verifikasi perubahan email belum dapat dipastikan dan sesi telah berakhir. Silakan masuk kembali.'
            return {
              ok: false,
              uncertain: true,
              sessionRevoked: true,
              code: 'EMAIL_CHANGE_UNCERTAIN',
              error: {
                status: 401,
                code: 'EMAIL_CHANGE_UNCERTAIN',
                message:
                  'Status verifikasi perubahan email belum dapat dipastikan dan sesi telah berakhir. Silakan masuk kembali.',
                data: null,
              },
            }
          }

          return {
            ok: false,
            uncertain: true,
            code: 'EMAIL_CHANGE_UNCERTAIN',
            error: {
              status: 0,
              code: 'EMAIL_CHANGE_UNCERTAIN',
              message:
                'Status verifikasi perubahan email belum dapat dipastikan. Jangan mengulang otomatis; silakan periksa sesi atau masuk kembali.',
              data: null,
            },
          }
        }

        if (isUnauthorizedError(result.error)) {
          clearEmailChangeState()
          await handleInvalidToken({ token: currentToken, operation })
          return {
            ok: false,
            sessionInvalidated: true,
            error: result.error,
          }
        }

        return result
      }

      // Authoritative HTTP 200 verification: backend has revoked all Sanctum tokens.
      // Perform ownership-aware local session cleanup without calling API logout.
      clearEmailChangeState()

      let removalState
      try {
        const removal = await removeTokenIfMatchesDetailed(currentToken)
        removalState = removal.state
      } catch {
        removalState = 'storage_failure'
      }

      if (
        !isCurrentSessionOperation(operation) ||
        (expectedUserId && String(user.value?.id) !== expectedUserId) ||
        removalState === 'ownership_mismatch'
      ) {
        return staleSessionResult('Sesi Cloud berubah. Perubahan email dibatalkan.')
      }

      if (_adapter) {
        try {
          await _adapter.clearCloudContext()
        } catch {
          // Local POS data remains untouched
        }
      }

      clearSession()
      sessionInvalid.value = true
      if (removalState === 'storage_failure') {
        error.value = 'Sesi Cloud belum dapat dicabut dengan aman. Silakan coba lagi.'
      }

      try {
        const bStore = useBusinessStore()
        if (bStore.mode !== 'free') {
          bStore.mode = 'free'
          if (_adapter && typeof _adapter.saveBusiness === 'function') {
            void Promise.resolve(
              _adapter.saveBusiness({
                name: bStore.name,
                type: bStore.type,
                owner: bStore.owner,
                phone: bStore.phone,
                outlet: bStore.outlet,
                mode: 'free',
              }),
            ).catch(() => {})
          }
        }
      } catch {
        // Best effort only
      }

      return {
        ok: true,
        state: 'verified',
        reauthenticationRequired: true,
        sessionRevoked: true,
        storageFailure: removalState === 'storage_failure',
        message: 'Email berhasil diperbarui. Silakan masuk kembali.',
      }
    } catch {
      return {
        ok: false,
        uncertain: true,
        code: 'EMAIL_CHANGE_UNCERTAIN',
        error: {
          status: 0,
          code: 'EMAIL_CHANGE_UNCERTAIN',
          message:
            'Status verifikasi perubahan email belum dapat dipastikan. Jangan mengulang otomatis; silakan periksa sesi atau masuk kembali.',
          data: null,
        },
      }
    } finally {
      const ownsOperation = isCurrentSessionOperation(operation)
      if (emailChangeOperation === operation) emailChangeOperation = null
      finishSessionOperation(operation)
      if (ownsOperation) loading.value = false
    }
  }

  function cancelEmailChange() {
    const operation = emailChangeOperation
    clearEmailChangeState()
    if (operation && isCurrentSessionOperation(operation)) {
      finishSessionOperation(operation)
      loading.value = false
    }
    return { ok: true, state: 'cancelled' }
  }

  /**
   * Register flow intentionally stops at pending email verification. A pending
   * registration is not a Cloud session and cannot fetch context or save a token.
   */
  async function register(payload) {
    if (loading.value) return { ok: false, error: { status: 0, code: 'REQUEST_IN_PROGRESS' } }
    loading.value = true
    error.value = null
    pendingAuthState.value = null

    try {
      const regResult = await cloudRegister(payload)

      if (!regResult.ok) {
        error.value = regResult.error?.message ?? 'Registrasi gagal'
        return { ok: false, error: regResult.error }
      }

      savePendingRegistrationMetadata(regResult.registration)
      pendingAuthState.value = 'pending_email'
      return { ok: true, state: 'pending_email', registration: regResult.registration }
    } finally {
      loading.value = false
    }
  }

  async function verifyRegistrationOtp(registrationId, code) {
    if (loading.value) return { ok: false, error: { status: 0, code: 'REQUEST_IN_PROGRESS' } }
    loading.value = true
    error.value = null
    try {
      const result = await cloudVerifyOtp(registrationId, code)
      if (result.ok) {
        clearPendingRegistrationMetadata()
        pendingAuthState.value = null
      }
      else error.value = result.error?.message ?? 'Verifikasi email gagal.'
      return result
    } finally {
      loading.value = false
    }
  }

  async function resendRegistrationOtp(registrationId, email = '') {
    if (loading.value) return { ok: false, error: { status: 0, code: 'REQUEST_IN_PROGRESS' } }
    loading.value = true
    error.value = null
    pendingAuthState.value = 'pending_email'
    try {
      const result = await cloudResendOtp(registrationId, email)
      if (result.ok) savePendingRegistrationMetadata(result.registration)
      else error.value = result.error?.message ?? 'Kode OTP belum dapat dikirim ulang.'
      return result
    } finally {
      loading.value = false
    }
  }

  /**
   * Select a business from the context list.
   * Business MUST be sourced from businesses state – no arbitrary IDs.
   * Persists cloud context on change.
   *
   * Selecting a Cloud business is ALWAYS allowed for a valid membership, even
   * when the local workspace currently holds a different business. A differing
   * workspace only marks a pending switch that the user must confirm; it never
   * rejects the Cloud login or the business link.
   */
  async function selectBusiness(businessId) {
    const match = businesses.value.find((b) => b.id === businessId)

    if (!match) {
      error.value = 'Business tidak ditemukan dalam context'
      return { ok: false }
    }

    selectedBusiness.value = toSelectedBusiness(match)
    // PREM-M03: an explicit, user-confirmed link to this Cloud business.
    linkedAt.value = new Date().toISOString()
    sessionInvalid.value = false
    // Server entitlement only. A local workspace mismatch must never flip this.
    cloudAccess.value = match.cloud_access === true
    selectedOutlet.value = null
    registeredDeviceId.value = null
    hasResolvedZeroBusiness.value = false
    pendingSwitch.value = null

    // INT-02: role and capabilities follow the business that is really selected.
    applyBusinessContext(match)

    if (!match.business_type) {
      operationalContext.value = {
        status: 'unknown_type',
        cloudBusinessId: match.id,
        code: 'CLOUD_BUSINESS_TYPE_UNKNOWN',
        detectedAt: new Date().toISOString(),
      }
      error.value = 'Jenis bisnis dari Cloud tidak tersedia atau tidak dikenali. Aktivasi kasir diblokir.'
      // Entitlement comes from the backend context only: an unknown business
      // type blocks activation + tenant operations, but never rewrites
      // `cloudAccess`.
    } else {
      await loadWorkspaceState()
      const switchInfo = await evaluateWorkspaceSwitch({ business: match })

      if (switchInfo.requiresConfirmation) {
        // A confirmation is required, but the Cloud link stays valid and no
        // error is surfaced: the UI shows the "Beralih Bisnis?" modal instead.
        setPendingSwitch({
          localBusiness: switchInfo.localBusiness,
          cloudBusiness: match,
          currentActiveId: switchInfo.currentActiveId,
        })
        error.value = null
      } else {
        operationalContext.value = {
          status: 'pending_outlet',
          cloudBusinessId: match.id,
          code: 'OUTLET_SELECTION_REQUIRED',
          detectedAt: new Date().toISOString(),
        }
      }
    }

    await persistCloudContext()

    return {
      ok: true,
      business: match,
      switchRequired: pendingSwitch.value !== null,
      pendingSwitch: pendingSwitch.value,
    }
  }

  /**
   * Select an outlet. Only active outlets are eligible.
   * Persists cloud context on change.
   */
  async function selectOutlet(outletId) {
    const business = businesses.value.find((b) => b.id === selectedBusiness.value?.id)

    if (!business) {
      error.value = 'Business belum dipilih'
      return { ok: false }
    }

    const activeOutlets = (business.outlets ?? []).filter((o) => o.status === 'active')
    const match = activeOutlets.find((o) => o.id === outletId)

    if (!match) {
      error.value = 'Outlet tidak aktif atau tidak ditemukan'
      return { ok: false }
    }

    selectedOutlet.value = { id: match.id, name: match.name }
    registeredDeviceId.value = null

    // INT-02: a cashier cannot register a device. The owner pre-registers it in
    // the Dashboard, so right after an outlet is chosen we refresh the context
    // with this device's stable identifier and resolve the existing
    // `device_context` from the authoritative response. Owner/member keep the
    // existing registration flow, which runs after this selection.
    let deviceResolution = resolveDeviceFromContext()

    if (pushPolicy.value.role === ROLE_CASHIER) {
      deviceResolution = await resolveCashierDevice()
    }

    await persistCloudContext()

    return { ok: true, outlet: match, device: deviceResolution }
  }

  /**
   * Commit the selected Cloud business/outlet into the active operational
   * workspace.
   *
   * When the active local workspace belongs to a different business this first
   * requires an explicit confirmation and then performs a *safe* workspace
   * switch: the previous workspace is persisted and verified, the target
   * workspace is materialised, and tenant data + sync metadata stay fully
   * isolated. Nothing is deleted.
   *
   * @param {object} [options]
   * @param {boolean} [options.confirmed=false] The user confirmed the switch.
   */
  async function activateOperationalContext({ confirmed = false, autoSyncRunning = false } = {}) {
    const business = selectedBusiness.value
    const outlet = selectedOutlet.value

    if (!business || !outlet) {
      return { ok: false, code: 'ACTIVATION_CONTEXT_INCOMPLETE' }
    }
    if (!business.business_type) {
      error.value = 'Jenis bisnis dari Cloud tidak tersedia atau tidak dikenali. Aktivasi kasir diblokir.'
      return { ok: false, code: 'CLOUD_BUSINESS_TYPE_UNKNOWN', message: error.value }
    }
    if (!_adapter) {
      error.value = 'Ruang kerja lokal belum siap diperiksa. Aktivasi kasir diblokir.'
      return { ok: false, code: 'LOCAL_WORKSPACE_UNAVAILABLE', message: error.value }
    }
    if (workspaceRecoveryRequired.value) {
      error.value =
        'Pemulihan ruang kerja masih diperlukan. Aktivasi kasir diblokir sampai data dipastikan konsisten.'
      return { ok: false, code: WORKSPACE_SWITCH_RESULT.RECOVERY_REQUIRED, message: error.value }
    }

    const alreadyActive =
      operationalContext.value?.status === 'active' &&
      operationalContext.value?.cloudBusinessId === business.id &&
      operationalContext.value?.outletId === outlet.id
    if (alreadyActive) {
      try {
        const bStore = useBusinessStore()
        if (bStore.mode !== 'cloud') {
          bStore.mode = 'cloud'
          await _adapter?.saveBusiness({
            name: bStore.name,
            type: bStore.type,
            owner: bStore.owner,
            phone: bStore.phone,
            outlet: bStore.outlet,
            mode: 'cloud',
          })
        }
      } catch {
        // non-blocking
      }
      return { ok: true, code: 'OPERATIONAL_CONTEXT_ACTIVE' }
    }

    await loadWorkspaceState()
    if (workspaceRegistryUnreadable.value) {
      error.value =
        'Status ruang kerja lokal tidak dapat dibaca. Aktivasi kasir diblokir sampai data dipastikan aman.'
      return { ok: false, code: WORKSPACE_SWITCH_RESULT.REGISTRY_UNREADABLE, message: error.value }
    }
    const switchInfo = await evaluateWorkspaceSwitch({ business, outlet })

    if (switchInfo.requiresConfirmation && confirmed !== true) {
      setPendingSwitch({
        localBusiness: switchInfo.localBusiness,
        cloudBusiness: business,
        targetWorkspaceId: switchInfo.targetWorkspaceId,
        currentActiveId: switchInfo.currentActiveId,
      })
      error.value = null
      return {
        ok: false,
        code: 'BUSINESS_SWITCH_CONFIRMATION_REQUIRED',
        pendingSwitch: pendingSwitch.value,
      }
    }

    let businessStore
    try {
      businessStore = useBusinessStore()
    } catch {
      error.value = 'Konteks bisnis lokal tidak tersedia. Aktivasi kasir diblokir.'
      return { ok: false, code: 'LOCAL_BUSINESS_STORE_UNAVAILABLE', message: error.value }
    }

    const previousBusiness = {
      name: businessStore.name,
      type: businessStore.type,
      owner: businessStore.owner,
      phone: businessStore.phone,
      outlet: businessStore.outlet,
      mode: businessStore.mode,
    }
    const previousOperationalContext = operationalContext.value
    const previousPendingSwitch = pendingSwitch.value
    const nextBusiness = {
      ...previousBusiness,
      name: business.name,
      type: business.business_type,
      outlet: outlet.name,
      mode: 'cloud',
    }
    const targetMeta = {
      name: business.name,
      type: business.business_type,
      businessId: business.id,
      outletId: outlet.id,
    }
    const markActive = () => {
      operationalContext.value = {
        status: 'active',
        cloudBusinessId: business.id,
        businessType: business.business_type,
        outletId: outlet.id,
        outletName: outlet.name,
        activatedAt: new Date().toISOString(),
      }
      pendingSwitch.value = null
    }
    const restoreContext = async () => {
      operationalContext.value = previousOperationalContext
      pendingSwitch.value = previousPendingSwitch
      businessStore.setBusiness(previousBusiness)
      try {
        await persistCloudContext(_adapter)
      } catch {
        // best-effort: the workspace snapshot is already restored durably
      }
    }

    if (switchInfo.needsMaterialise) {
      const result = await switchOperationalWorkspace({
        adapter: _adapter,
        scheduler: _scheduler,
        targetWorkspaceId: switchInfo.targetWorkspaceId,
        targetMeta,
        autoSyncRunning,
        hooks: {
          // 6. update business identity (durably, before the registry commits).
          onTargetMaterialised: async () => {
            await _adapter.saveBusiness(nextBusiness)
            businessStore.setBusiness(nextBusiness)
          },
          // 7. persist Cloud context.
          onPersistCloudContext: async () => {
            markActive()
            await persistCloudContext(_adapter, { throwOnError: true })
          },
          restoreContext,
        },
      })

      if (!result.ok) {
        // A failed rollback is never treated as success: block risky operations.
        if (!result.rollback || result.rollback.ok !== true) {
          if (result.rollback) {
            workspaceRecoveryRequired.value = true
          }
        }
        error.value = result.message
        return result
      }

      activeWorkspaceId.value = result.activeWorkspaceId
      workspaceRegistry.value = result.registry
      error.value = null
      try {
        const { useCashierStore } = await import('@/stores/cashierStore')
        const cashierStore = useCashierStore()
        if (cashierStore?.activeCashier) {
          cashierStore.activeCashier.pinConfigured = true
        }
      } catch {
        // Best effort UI refresh; the workspace activation remains authoritative.
      }
      try {
        const { useProductStore } = await import('@/stores/productStore')
        const pStore = useProductStore()
        if (_adapter && typeof _adapter.loadProducts === 'function') {
          const loaded = await _adapter.loadProducts()
          pStore.$patch({
            products: loaded?.products ?? [],
            categories: loaded?.categories ?? [],
            stockMovements: loaded?.stockMovements ?? [],
          })
        }
      } catch {
        // Best effort UI refresh; the workspace activation remains authoritative.
      }
      return {
        ok: true,
        code: 'OPERATIONAL_CONTEXT_ACTIVATED',
        activeWorkspaceId: result.activeWorkspaceId,
      }
    }

    // The active workspace already IS the target (its data is materialised):
    // only the identity and Cloud context need to be recorded. No registry write
    // happens here — `activeWorkspaceId` already points at the target, so the
    // durable switching protocol above is intentionally not needed.
    try {
      await _adapter.saveBusiness(nextBusiness)
      businessStore.setBusiness(nextBusiness)
      markActive()
      await persistCloudContext(_adapter, { throwOnError: true })
      error.value = null
      try {
        const { useCashierStore } = await import('@/stores/cashierStore')
        const cashierStore = useCashierStore()
        if (cashierStore?.activeCashier) {
          cashierStore.activeCashier.pinConfigured = true
        }
      } catch {
        // Best effort UI refresh; the workspace activation remains authoritative.
      }
      return {
        ok: true,
        code: 'OPERATIONAL_CONTEXT_ACTIVATED',
        activeWorkspaceId: activeWorkspaceId.value,
      }
    } catch {
      await restoreContext()
      try {
        await _adapter.saveBusiness(previousBusiness)
      } catch {
        // The activation remains failed and Cloud mutation stays unavailable.
      }
      error.value = 'Aktivasi bisnis Cloud gagal. Data lokal tidak diubah.'
      return { ok: false, code: 'OPERATIONAL_CONTEXT_ACTIVATION_FAILED', message: error.value }
    }
  }

  /**
   * Run the crash-recovery pass for an interrupted workspace switch and expose
   * the outcome. Returns `ok: false` when a manual recovery is required.
   *
   * @param {object} [options]
   * @param {object} [options.hooks] Optional store-side context restore hook.
   */
  async function recoverInterruptedWorkspaceSwitch({ hooks = null } = {}) {
    const result = await recoverPendingWorkspaceSwitch({
      adapter: _adapter,
      scheduler: _scheduler,
      hooks,
    })
    workspaceRecoveryRequired.value = result.ok !== true
    await loadWorkspaceState()
    return result
  }

  /**
   * User confirmed the "Beralih Bisnis?" modal: perform the safe switch.
   */
  async function confirmBusinessSwitch(options = {}) {
    return activateOperationalContext({ confirmed: true, ...options })
  }

  /**
   * User cancelled the switch: keep the previous local workspace untouched and
   * keep the Cloud account linked (just not aligned to the active workspace).
   */
  function cancelBusinessSwitch() {
    const pending = pendingSwitch.value
    pendingSwitch.value = null
    if (operationalContext.value?.status === 'switch_pending') {
      operationalContext.value = {
        status: 'switch_declined',
        cloudBusinessId: operationalContext.value.cloudBusinessId,
        code: 'BUSINESS_SWITCH_DECLINED',
        localBusiness: pending?.localBusiness ?? null,
        detectedAt: new Date().toISOString(),
      }
    }
    error.value = null
    return { ok: true, code: 'BUSINESS_SWITCH_DECLINED' }
  }

  /**
   * Register or resolve device with the backend.
   * Preconditions: authenticated, business selected, cloud_access=true, outlet selected.
   * Persists cloud context on success.
   */
  async function doRegisterDevice({ platform = null, deviceName = 'POS Mobile' } = {}) {
    if (!isAuthenticated.value) {
      return { ok: false, error: { code: 'NOT_AUTHENTICATED' } }
    }

    // INT-02: `POST /api/mobile/devices` is owner/member only. A cashier must
    // never attempt auto-registration or QR pairing; the owner registers the
    // device in the Dashboard and the app resolves it from device_context.
    if (pushPolicy.value.role === ROLE_CASHIER) {
      error.value =
        'Peran kasir tidak dapat mendaftarkan perangkat. Minta pemilik mendaftarkannya melalui Dashboard.'
      return {
        ok: false,
        error: { code: 'CASHIER_DEVICE_REGISTRATION_FORBIDDEN', message: error.value },
      }
    }

    if (!selectedBusiness.value) {
      return { ok: false, error: { code: 'NO_BUSINESS_SELECTED' } }
    }

    if (!cloudAccess.value) {
      return { ok: false, error: { code: 'NO_CLOUD_ACCESS' } }
    }

    if (!selectedOutlet.value) {
      return { ok: false, error: { code: 'NO_OUTLET_SELECTED' } }
    }

    if (!deviceIdentifier.value) {
      return { ok: false, error: { code: 'NO_DEVICE_IDENTIFIER' } }
    }

    loading.value = true
    error.value = null

    try {
      const token = await getToken()

      const result = await registerDevice(token, {
        business_id: selectedBusiness.value.id,
        outlet_id: selectedOutlet.value.id,
        device_identifier: deviceIdentifier.value,
        name: deviceName,
        platform,
      })

      if (!result.ok) {
        error.value = result.error?.message ?? 'Device registration gagal'
        return { ok: false, error: result.error }
      }

      registeredDeviceId.value = result.device?.id ?? null

      // Persist updated context with registered device ID
      await persistCloudContext()

      return { ok: true, device: result.device }
    } finally {
      loading.value = false
    }
  }

  /**
   * Logout from cloud.
   * Always clears local session, token, and persisted cloud_context, even on network failure.
   * NEVER deletes POS data, sync_queue, backup, or device_identifier.
   */
  async function logout() {
    clearGoogleLinkState()
    clearEmailChangeState()
    const operation = beginSessionOperation('logout', { replace: true })
    loading.value = true
    error.value = null
    let token = null
    let tokenReadFailed = false
    let removalState
    let serverRevocation = 'not_attempted'

    try {
      try {
        token = await getToken()
      } catch {
        tokenReadFailed = true
      }

      if (!isCurrentSessionOperation(operation)) return staleSessionResult()

      if (token && !tokenReadFailed) {
        // Best-effort server notification – network failure is acceptable
        const revocation = await cloudLogout(token).catch(() => null)
        serverRevocation = revocation?.ok ? 'succeeded' : 'failed'
      }

      if (!isCurrentSessionOperation(operation)) return staleSessionResult()

      if (tokenReadFailed) {
        removalState = 'storage_failure'
      } else if (!token) {
        // A successful secure read with no token means the credential was
        // already removed by a serialized operation. Logout still owns local
        // cleanup; this is not a newer-session ownership mismatch.
        removalState = 'missing'
      } else {
        try {
          const removal = await removeTokenIfMatchesDetailed(token)
          removalState = removal.state
        } catch {
          removalState = 'storage_failure'
        }
      }

      if (!isCurrentSessionOperation(operation)) return staleSessionResult()

      if (removalState === 'ownership_mismatch') {
        return { ok: false, code: 'TOKEN_OWNERSHIP_CHANGED', serverRevocation }
      }

      if (_adapter) {
        try {
          await _adapter.clearCloudContext()
        } catch (err) {
          console.error('Failed to clear cloud context from adapter.', err)
        }
      }

      if (!isCurrentSessionOperation(operation)) return staleSessionResult()

      clearSession()
      if (removalState === 'storage_failure') {
        sessionInvalid.value = true
        error.value = 'Sesi Cloud belum dapat dicabut dengan aman. Silakan coba lagi.'
      }

      try {
        const bStore = useBusinessStore()
        if (bStore.mode !== 'free') {
          bStore.mode = 'free'
          if (_adapter && typeof _adapter.saveBusiness === 'function') {
            void Promise.resolve(_adapter.saveBusiness({
              name: bStore.name,
              type: bStore.type,
              owner: bStore.owner,
              phone: bStore.phone,
              outlet: bStore.outlet,
              mode: 'free',
            })).catch(() => {})
          }
        }
      } catch {
        // non-blocking
      }

      return {
        ok: removalState === 'removed' || removalState === 'missing',
        code: removalState === 'removed' || removalState === 'missing'
          ? 'LOGGED_OUT'
          : 'TOKEN_REMOVAL_FAILED',
        serverRevocation,
      }
    } finally {
      const ownsLoading = isCurrentSessionOperation(operation)
      finishSessionOperation(operation)
      if (ownsLoading) loading.value = false
    }
  }

  /**
   * Hydrate session from secure storage (app restart).
   * Restores token + context without triggering any sync or network call.
   * Called from bootstrapApp after persistence is ready.
   */
  async function hydrateFromStorage(adapter) {
    const operation = beginSessionOperation('restore', { replace: true })
    if (!operation) return { ok: false, code: 'REQUEST_IN_PROGRESS' }

    if (adapter) {
      setPersistenceAdapter(adapter)
    }

    hasResolvedBusinessContext.value = false
    const targetAdapter = adapter ?? _adapter

    // Restore device identifier (non-sensitive, from SQLite/memory adapter)
    if (targetAdapter) {
      try {
        const storedId = await targetAdapter.loadDeviceIdentifier()
        if (storedId) {
          deviceIdentifier.value = storedId
        }
      } catch {
        // non-blocking
      }

      // Restore the active workspace identity + registry (device-local).
      await loadWorkspaceState()
      if (!isCurrentSessionOperation(operation)) return staleSessionResult()
    }

    // Check if there's a valid token in secure storage
    try {
      const token = await getToken()

      if (!token) {
        // FREE mode – POS continues offline
        clearSession()
        try {
          await targetAdapter?.clearCloudContext?.()
        } catch {
          // Best effort; the in-memory session is already unauthenticated.
        }
        pendingAuthState.value = getPendingRegistrationMetadata() ? 'pending_email' : null
        finishSessionOperation(operation)
        return { ok: true, authenticated: false, state: sessionState.value }
      }

      if (!isCurrentSessionOperation(operation)) return staleSessionResult()

      // Restore stored cloud context (non-sensitive)
      if (targetAdapter) {
        try {
          const ctx = await targetAdapter.loadCloudContext()

          if (ctx) {
            if (!isCurrentSessionOperation(operation)) return staleSessionResult()
            if (!isValidSessionUser(ctx.user)) {
              clearSession()
              await targetAdapter.clearCloudContext()
              finishSessionOperation(operation)
              return { ok: true, authenticated: false, state: sessionState.value }
            }
            user.value = {
              id: ctx.user.id,
              name: ctx.user.name,
              email: ctx.user.email,
            }
            selectedBusiness.value = ctx.selectedBusiness
              ? toSelectedBusiness({
                  ...ctx.selectedBusiness,
                  business_type: normalizeCloudBusinessType(ctx.selectedBusiness.business_type),
                })
              : null
            selectedOutlet.value = ctx.selectedOutlet ?? null
            cloudAccess.value = ctx.cloudAccess === true
            registeredDeviceId.value = ctx.registeredDeviceId ?? null
            hasResolvedZeroBusiness.value = ctx.hasResolvedZeroBusiness === true
            linkedAt.value = ctx.linkedAt ?? null
            contextCheckedAt.value = ctx.contextCheckedAt ?? null
            role.value = normalizeRole(ctx.role ?? null)
            syncCapabilities.value = ctx.syncCapabilities ?? null
            deviceContext.value = ctx.deviceContext ?? null
            operationalContext.value = ctx.operationalContext ?? null

            // INT-02: a restored cache is never an authorization. It is either
            // a genuine pre-INT-02 legacy cache, or an unverified snapshot that
            // must be re-confirmed online before any cloud mutation.
            capabilityState.value = role.value || syncCapabilities.value ? 'unverified' : 'legacy'
            capabilitiesVerifiedAt.value = null

            // A cached Cloud selection alone is not proof that it owns the
            // singleton local database. Re-evaluate before any sync can run.
            const operationalResult = await validateOperationalContext()
            if (!isCurrentSessionOperation(operation)) return staleSessionResult()
            if (
              selectedBusiness.value &&
              operationalResult.code !== 'OPERATIONAL_CONTEXT_ACTIVE' &&
              operationalResult.code !== 'NO_CLOUD_BUSINESS_SELECTED'
            ) {
              await persistCloudContext()
            } else if (
              selectedBusiness.value &&
              operationalContext.value?.status === 'active'
            ) {
              try {
                const bStore = useBusinessStore()
                if (bStore.mode !== 'cloud') {
                  bStore.mode = 'cloud'
                  if (targetAdapter && typeof targetAdapter.saveBusiness === 'function') {
                    void targetAdapter.saveBusiness({
                      name: bStore.name,
                      type: bStore.type,
                      owner: bStore.owner,
                      phone: bStore.phone,
                      outlet: bStore.outlet,
                      mode: 'cloud',
                    })
                  }
                }
              } catch {
                // non-blocking
              }
            }
          }
        } catch {
          // non-blocking – POS still starts
        }
      }

      finishSessionOperation(operation)
      return { ok: true, authenticated: user.value !== null, state: sessionState.value }
    } catch {
      // token read failure → still allow POS to start
      clearSession()
      finishSessionOperation(operation)
      return { ok: true, authenticated: false, state: sessionState.value }
    }
  }

  /**
   * Apply per-business role / capability / device context to store state.
   * Authoritative only while `capabilityState === 'verified'`.
   */
  function applyBusinessContext(business) {
    role.value = normalizeRole(business?.role ?? null)
    syncCapabilities.value = business?.sync_capabilities ?? null
    deviceContext.value = business?.device_context ?? null
  }

  /**
   * INT-02: resolve the owner-pre-registered device for the selected
   * business/outlet from `device_context`. Never registers a device, never
   * creates a secret, never pairs a QR code.
   *
   * @returns {{ok: boolean, code?: string, message?: string, deviceId?: number|string}}
   */
  function resolveDeviceFromContext() {
    const business = businesses.value.find((b) => b.id === selectedBusiness.value?.id) ?? null
    const context = business?.device_context ?? deviceContext.value ?? null

    const notRegistered = {
      ok: false,
      code: 'DEVICE_NOT_REGISTERED',
      message: 'Perangkat ini belum terdaftar. Minta pemilik mendaftarkannya melalui Dashboard.',
    }

    if (!context || typeof context !== 'object' || Array.isArray(context)) {
      registeredDeviceId.value = null
      return notRegistered
    }

    const rawDeviceId = context.id ?? context.device_id ?? context.deviceId ?? null
    if (rawDeviceId === null || rawDeviceId === undefined || `${rawDeviceId}`.trim() === '') {
      registeredDeviceId.value = null
      return notRegistered
    }

    // Explicit inactivity always stops cloud sync.
    const status = typeof context.status === 'string' ? context.status.trim().toLowerCase() : null
    const hasActiveFlag =
      typeof context.active === 'boolean' || typeof context.is_active === 'boolean'
    const isActive = hasActiveFlag
      ? context.active === true || context.is_active === true
      : status === null || status === 'active'

    if (!isActive) {
      registeredDeviceId.value = null
      return {
        ok: false,
        code: 'DEVICE_INACTIVE',
        message: 'Perangkat ini dinonaktifkan. Hubungi pemilik untuk mengaktifkannya kembali.',
      }
    }

    // The resolved device must be *this* installation. A `device_context` that
    // belongs to a different stable identifier must never be bound to this
    // session, even when the outlet and status match.
    const rawIdentifier =
      context.identifier ?? context.device_identifier ?? context.deviceIdentifier ?? null
    if (
      typeof rawIdentifier === 'string' &&
      rawIdentifier.trim() !== '' &&
      typeof deviceIdentifier.value === 'string' &&
      deviceIdentifier.value.trim() !== '' &&
      rawIdentifier.trim() !== deviceIdentifier.value.trim()
    ) {
      registeredDeviceId.value = null
      return {
        ok: false,
        code: 'DEVICE_IDENTIFIER_MISMATCH',
        message:
          'Perangkat terdaftar tidak cocok dengan perangkat ini. Minta pemilik mendaftarkan ulang melalui Dashboard.',
      }
    }

    const rawOutletId = context.outlet_id ?? context.outletId ?? null
    if (
      rawOutletId !== null &&
      rawOutletId !== undefined &&
      selectedOutlet.value?.id !== undefined &&
      selectedOutlet.value?.id !== null &&
      Number(rawOutletId) !== Number(selectedOutlet.value.id)
    ) {
      registeredDeviceId.value = null
      return {
        ok: false,
        code: 'DEVICE_OUTLET_MISMATCH',
        message: 'Perangkat terdaftar pada outlet yang berbeda dari outlet terpilih.',
      }
    }

    const numericId = Number(rawDeviceId)
    registeredDeviceId.value = Number.isFinite(numericId) ? numericId : rawDeviceId
    return { ok: true, deviceId: registeredDeviceId.value }
  }

  /**
   * INT-02: refresh role + capabilities from `/api/mobile/context`.
   *
   * Called after login, before an authorization-sensitive sync, after the
   * server rejects access, and during session recovery. Never persists a
   * bearer token, and never deletes POS data on failure.
   *
   * @param {object} [options]
   * @param {string|null} [options.deviceIdentifierOverride]
   * @returns {Promise<object>}
   */
  async function refreshContext({ deviceIdentifierOverride = null } = {}) {
    if (!isAuthenticated.value) {
      return { ok: false, code: 'NOT_AUTHENTICATED' }
    }

    const operation = beginSessionOperation('context_refresh')
    if (!operation) return { ok: false, code: 'REQUEST_IN_PROGRESS' }

    let token = null
    try {
      token = await getToken()
    } catch {
      // ignore – treated as no token below
    }

    if (!token) {
      finishSessionOperation(operation)
      return { ok: false, code: 'NO_TOKEN' }
    }

    loading.value = true

    try {
      const deviceIdUsed = deviceIdentifierOverride ?? (await ensureDeviceIdentifier())
      const result = await fetchMobileContext(token, { deviceIdentifier: deviceIdUsed })

      if (!isCurrentSessionOperation(operation)) return staleSessionResult()

      if (!result.ok) {
        // PREM-M03: an invalid/expired token clears the Cloud session (but never
        // local POS data) and asks the user to sign in again.
        if (isUnauthorizedError(result.error)) {
          const invalidation = await handleInvalidToken({ token, operation })
          if (invalidation.stale) return staleSessionResult()
          return {
            ok: false,
            code: invalidation.code === 'TOKEN_REMOVAL_FAILED'
              ? 'TOKEN_REMOVAL_FAILED'
              : 'TOKEN_INVALID',
            message: error.value,
            error: result.error,
          }
        }

        // Network/authorization failure: keep the local context but never leave
        // the capability contract marked as verified.
        if (capabilityState.value === 'verified') {
          capabilityState.value = 'unverified'
        }
        capabilitiesVerifiedAt.value = null
        error.value = result.error?.message ?? 'Gagal memperbarui context cloud.'
        return {
          ok: false,
          code: result.error?.code ?? 'CONTEXT_REFRESH_FAILED',
          error: result.error,
        }
      }

      const parsed = extractBusinesses(result.data)

      if (!isCurrentSessionOperation(operation)) return staleSessionResult()

      if (!parsed.ok) {
        // Fail closed: keep the previous context but drop the verified stamp.
        if (capabilityState.value === 'verified') {
          capabilityState.value = 'unverified'
        }
        capabilitiesVerifiedAt.value = null
        error.value = 'Context cloud dari server tidak valid.'
        return { ok: false, code: 'MALFORMED_CONTEXT', message: error.value }
      }

      businesses.value = parsed.businesses
      hasResolvedBusinessContext.value = true
      hasResolvedZeroBusiness.value = businesses.value.length === 0
      sessionInvalid.value = false

      const previousBusinessId = selectedBusiness.value?.id ?? null
      const match = businesses.value.find((b) => b.id === previousBusinessId) ?? null

      if (previousBusinessId !== null && !match) {
        // INT-02: the refresh succeeded but the previously selected business is
        // gone (membership revoked or removed). Cancel the cloud context for
        // that business, revoke the device binding from the active session, and
        // NEVER mark the old permissions as verified. Every piece of local POS
        // data is preserved.
        selectedBusiness.value = null
        selectedOutlet.value = null
        registeredDeviceId.value = null
        role.value = null
        syncCapabilities.value = null
        deviceContext.value = null
        cloudAccess.value = false
        capabilityState.value = 'revoked'
        capabilitiesVerifiedAt.value = null
        error.value =
          'Akses cloud untuk bisnis ini sudah tidak tersedia. Pilih bisnis lain atau hubungi pemilik.'

        await persistCloudContext()

        return {
          ok: false,
          code: 'BUSINESS_ACCESS_REVOKED',
          message: error.value,
          businesses: businesses.value,
        }
      }

      let deviceResolution = null

      if (match) {
        selectedBusiness.value = toSelectedBusiness(match)
        cloudAccess.value = match.cloud_access === true
        applyBusinessContext(match)

        // Re-validate the selected outlet against the refreshed list.
        if (selectedOutlet.value) {
          const outlet = (match.outlets ?? []).find((o) => o.id === selectedOutlet.value.id)
          if (!outlet || outlet.status !== 'active') {
            selectedOutlet.value = null
            registeredDeviceId.value = null
          }
        }

        if (selectedOutlet.value) {
          deviceResolution = resolveDeviceFromContext()
        }

        const operationalResult = await validateOperationalContext()
        if (!isCurrentSessionOperation(operation)) return staleSessionResult()
        if (!operationalResult.ok) {
          await persistCloudContext()
          return {
            ok: false,
            code: operationalResult.code,
            message: operationalResult.message,
            businesses: businesses.value,
          }
        }
      }

      capabilityState.value = 'verified'
      capabilitiesVerifiedAt.value = new Date().toISOString()
      contextCheckedAt.value = capabilitiesVerifiedAt.value
      error.value = null

      await persistCloudContext()

      if (!isCurrentSessionOperation(operation)) return staleSessionResult()

      return {
        ok: true,
        businesses: businesses.value,
        role: role.value,
        syncCapabilities: syncCapabilities.value,
        capabilityState: capabilityState.value,
        device: deviceResolution,
      }
    } finally {
      const ownsLoading = isCurrentSessionOperation(operation)
      finishSessionOperation(operation)
      if (ownsLoading) loading.value = false
    }
  }

  /**
   * INT-02: resolve the owner-pre-registered device for a cashier.
   *
   * Refreshes `GET /api/mobile/context` with this device's stable identifier and
   * resolves `device_context` from the authoritative response. NEVER calls
   * `POST /api/mobile/devices` and never creates a device secret.
   *
   * @returns {Promise<{ok: boolean, code?: string, message?: string, deviceId?: number|string}>}
   */
  async function resolveCashierDevice() {
    if (pushPolicy.value.role !== ROLE_CASHIER) {
      return { ok: false, code: 'NOT_A_CASHIER_CONTEXT' }
    }

    const refreshed = await refreshContext()

    if (!refreshed.ok) {
      if (refreshed.code === 'BUSINESS_ACCESS_REVOKED') {
        return { ok: false, code: refreshed.code, message: refreshed.message }
      }

      const message = refreshed.error?.message ?? 'Gagal menyegarkan konteks cloud.'
      error.value = message
      return { ok: false, code: refreshed.code ?? 'CONTEXT_REFRESH_FAILED', message }
    }

    const device = refreshed.device ?? resolveDeviceFromContext()

    error.value = device.ok ? null : (device.message ?? 'Perangkat belum terdaftar.')

    return device
  }

  /**
   * INT-02: guarantee a *verified* capability contract before a cloud mutation.
   *
   * A cached contract (`legacy` / `unverified`) is never authoritative: it must
   * be re-confirmed online first. Free/local-only sessions are skipped — they
   * cannot push anyway. A failed re-confirmation never deletes any local data;
   * it only postpones the cloud mutation.
   *
   * @param {object} [options]
   * @param {boolean} [options.force=false]
   * @returns {Promise<{ok: boolean, code?: string, skipped?: boolean, cached?: boolean}>}
   */
  async function ensureVerifiedContext({ force = false } = {}) {
    if (!isAuthenticated.value) {
      return { ok: false, code: 'NOT_AUTHENTICATED', skipped: true }
    }

    // The verified snapshot is returned to every caller so an authorization
    // decision never depends on a stale caller-supplied context (the
    // orchestrator and auto-sync callers omit role/capabilities entirely).
    const snapshot = () => ({
      role: role.value,
      syncCapabilities: syncCapabilities.value,
      capabilityState: capabilityState.value,
    })

    if (!force && capabilityState.value === 'verified') {
      return { ok: true, cached: true, ...snapshot() }
    }

    // `unknown` means no capability information was ever obtained for this
    // session (for example a context that never returned a role). There is
    // nothing stale to distrust, so the legacy owner/member contract applies.
    // Only a genuinely cached (`legacy`), unre-verified (`unverified`) or
    // revoked contract forces an online re-confirmation.
    if (!force && capabilityState.value === 'unknown') {
      return { ok: true, cached: true, unknown: true, ...snapshot() }
    }

    const refreshed = await refreshContext()

    if (!refreshed.ok) {
      return {
        ok: false,
        code: refreshed.code ?? 'CONTEXT_REFRESH_FAILED',
        message:
          refreshed.message ??
          refreshed.error?.message ??
          'Izin sinkronisasi belum dapat diverifikasi.',
      }
    }

    return {
      ok: true,
      cached: false,
      role: refreshed.role ?? role.value,
      syncCapabilities: refreshed.syncCapabilities ?? syncCapabilities.value,
      capabilityState: refreshed.capabilityState ?? capabilityState.value,
    }
  }

  return {
    // state
    user,
    sessionState,
    selectedBusiness,
    selectedOutlet,
    deviceIdentifier,
    registeredDeviceId,
    cloudAccess,
    role,
    syncCapabilities,
    deviceContext,
    capabilityState,
    capabilitiesVerifiedAt,
    contextCheckedAt,
    linkedAt,
    sessionInvalid,
    businesses,
    hasResolvedBusinessContext,
    hasResolvedZeroBusiness,
    operationalContext,
    pendingSwitch,
    activeWorkspaceId,
    workspaceRegistry,
    workspaceRegistryUnreadable,
    workspaceRecoveryRequired,
    loading,
    error,
    // computed
    isAuthenticated,
    isLinked,
    hasCloudAccess,
    isDeviceRegistered,
    isOperationalContextActive,
    isOperationalCloudAccess,
    isWorkspaceAligned,
    requiresBusinessSwitch,
    pushPolicy,
    canPerformCloudPush,
    isCashierContext,
    syncCapabilitySummary,
    setPersistenceAdapter,
    getPersistenceAdapter,
    getPersistenceScheduler,
    adapter: computed(() => _adapter),
    scheduler: computed(() => _scheduler),
    invalidateCloudSession: handleInvalidToken,
    login,
    loginWithGoogle,
    refreshAuthenticationMethods,
    reauthenticateForGoogleLink,
    linkGoogleAccount,
    cancelGoogleAccountLinking,
    forgotPassword,
    resetPassword,
    requestEmailChange,
    verifyEmailChange,
    cancelEmailChange,
    register,
    verifyRegistrationOtp,
    resendRegistrationOtp,
    selectBusiness,
    selectOutlet,
    activateOperationalContext,
    confirmBusinessSwitch,
    cancelBusinessSwitch,
    recoverInterruptedWorkspaceSwitch,
    doRegisterDevice,
    logout,
    hydrateFromStorage,
    refreshContext,
    resolveDeviceFromContext,
    resolveCashierDevice,
    ensureVerifiedContext,
    persistCloudContext,
    clearSession,
  }
})
