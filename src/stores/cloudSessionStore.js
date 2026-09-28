import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

import { cloudLogin, fetchMobileContext, registerDevice, cloudLogout } from '@/services/cloud/authService'
import { saveToken, getToken, removeToken } from '@/services/cloud/tokenRepository'
import {
  ROLE_CASHIER,
  isPushEnabled,
  normalizeRole,
  resolveSyncPushPolicy,
} from '@/services/sync/syncCapabilityPolicy'

/**
 * Normalise a raw `/api/mobile/context` business entry. `role` and
 * `sync_capabilities` are additive INT-01 fields: legacy backends simply omit
 * them and the resolver falls back to legacy owner/member behaviour.
 *
 * @param {object} b
 * @returns {object}
 */
function mapBusinessEntry(b) {
  return {
    id: b.id,
    name: b.name,
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
  const selectedBusiness = ref(null) // { id, name }

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

  /** List of businesses from context (drives selection UI) */
  const businesses = ref([])

  /** Tracks whether the business context list has been resolved from the API in this session */
  const hasResolvedBusinessContext = ref(false)

  /** Tracks whether the account has confirmed zero business from /api/mobile/context (persisted across restart) */
  const hasResolvedZeroBusiness = ref(false)

  /** True while a cloud operation is in flight */
  const loading = ref(false)

  /** Last cloud error string – cleared on each new operation */
  const error = ref(null)

  /** Reference to persistence adapter */
  let _adapter = null

  // ── Computed ───────────────────────────────────────────────────────────────

  const isAuthenticated = computed(() => user.value !== null)

  const hasCloudAccess = computed(() => isAuthenticated.value && cloudAccess.value === true)

  const isDeviceRegistered = computed(() => registeredDeviceId.value !== null)

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
    () => capabilityState.value === 'verified' && isPushEnabled(pushPolicy.value),
  )

  const isCashierContext = computed(
    () => capabilityState.value === 'verified' && pushPolicy.value.role === ROLE_CASHIER,
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

  function setPersistenceAdapter(adapter) {
    _adapter = adapter
  }

  function clearSession() {
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
    businesses.value = []
    hasResolvedBusinessContext.value = false
    hasResolvedZeroBusiness.value = false
    error.value = null
    // deviceIdentifier is intentionally NOT cleared on logout
  }

  /**
   * Persist non-sensitive cloud context to adapter.
   * Minimal context: user, selectedBusiness, selectedOutlet, cloudAccess, registeredDeviceId.
   * Token is NEVER included.
   */
  async function persistCloudContext(adapter = _adapter) {
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
        // INT-02: non-sensitive capability context. Never includes a token.
        role: role.value ?? null,
        syncCapabilities: syncCapabilities.value ?? null,
        deviceContext: deviceContext.value ?? null,
        capabilityState: capabilityState.value,
      })
    } catch (err) {
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
  async function login(email, password) {
    loading.value = true
    error.value = null

    try {
      const loginResult = await cloudLogin(email, password)

      if (!loginResult.ok) {
        error.value = loginResult.error?.message ?? 'Login gagal'
        return { ok: false, error: loginResult.error }
      }

      // Token is only persisted after confirmed success
      await saveToken(loginResult.token)

      user.value = loginResult.user
        ? {
            id: loginResult.user.id,
            name: loginResult.user.name,
            email: loginResult.user.email,
          }
        : null

      // Fetch context immediately after login
      const contextResult = await fetchMobileContext(loginResult.token)

      if (!contextResult.ok) {
        // Rollback token – context is required
        await removeToken()
        user.value = null
        error.value = contextResult.error?.message ?? 'Gagal mengambil context'
        return { ok: false, error: contextResult.error }
      }

      businesses.value = (contextResult.data?.businesses ?? []).map(mapBusinessEntry)
      hasResolvedBusinessContext.value = true
      hasResolvedZeroBusiness.value = businesses.value.length === 0

      // INT-02: a fresh context response is authoritative for this session.
      capabilityState.value = 'verified'
      capabilitiesVerifiedAt.value = new Date().toISOString()

      // Persist cloud context on successful login + context
      await persistCloudContext()

      return { ok: true, businesses: businesses.value }
    } finally {
      loading.value = false
    }
  }

  /**
   * Select a business from the context list.
   * Business MUST be sourced from businesses state – no arbitrary IDs.
   * Persists cloud context on change.
   */
  async function selectBusiness(businessId) {
    const match = businesses.value.find((b) => b.id === businessId)

    if (!match) {
      error.value = 'Business tidak ditemukan dalam context'
      return { ok: false }
    }

    selectedBusiness.value = { id: match.id, name: match.name }
    cloudAccess.value = match.cloud_access === true
    selectedOutlet.value = null
    registeredDeviceId.value = null
    hasResolvedZeroBusiness.value = false

    // INT-02: role and capabilities follow the business that is really selected.
    applyBusinessContext(match)

    await persistCloudContext()

    return { ok: true, business: match }
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

    // INT-02: a cashier cannot register a device; the owner pre-registers it in
    // the Dashboard, so we only *resolve* the existing device_context here.
    const deviceResolution = resolveDeviceFromContext()

    await persistCloudContext()

    return { ok: true, outlet: match, device: deviceResolution }
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
    loading.value = true
    error.value = null

    try {
      const token = await getToken()

      if (token) {
        // Best-effort server notification – network failure is acceptable
        await cloudLogout(token).catch(() => {})
      }

      await removeToken()

      if (_adapter) {
        try {
          await _adapter.clearCloudContext()
        } catch (err) {
          console.error('Failed to clear cloud context from adapter.', err)
        }
      }

      clearSession()

      return { ok: true }
    } finally {
      loading.value = false
    }
  }

  /**
   * Hydrate session from secure storage (app restart).
   * Restores token + context without triggering any sync or network call.
   * Called from bootstrapApp after persistence is ready.
   */
  async function hydrateFromStorage(adapter) {
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
    }

    // Check if there's a valid token in secure storage
    try {
      const token = await getToken()

      if (!token) {
        // FREE mode – POS continues offline
        return { ok: true, authenticated: false }
      }

      // Restore stored cloud context (non-sensitive)
      if (targetAdapter) {
        try {
          const ctx = await targetAdapter.loadCloudContext()

          if (ctx) {
            user.value = ctx.user ?? null
            selectedBusiness.value = ctx.selectedBusiness ?? null
            selectedOutlet.value = ctx.selectedOutlet ?? null
            cloudAccess.value = ctx.cloudAccess === true
            registeredDeviceId.value = ctx.registeredDeviceId ?? null
            hasResolvedZeroBusiness.value = ctx.hasResolvedZeroBusiness === true
            role.value = normalizeRole(ctx.role ?? null)
            syncCapabilities.value = ctx.syncCapabilities ?? null
            deviceContext.value = ctx.deviceContext ?? null

            // INT-02: a restored cache is never an authorization. It is either
            // a genuine pre-INT-02 legacy cache, or an unverified snapshot that
            // must be re-confirmed online before any cloud mutation.
            capabilityState.value =
              role.value || syncCapabilities.value ? 'unverified' : 'legacy'
            capabilitiesVerifiedAt.value = null
          }
        } catch {
          // non-blocking – POS still starts
        }
      }

      return { ok: true, authenticated: user.value !== null }
    } catch {
      // token read failure → still allow POS to start
      return { ok: true, authenticated: false }
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
    const business =
      businesses.value.find((b) => b.id === selectedBusiness.value?.id) ?? null
    const context = business?.device_context ?? deviceContext.value ?? null

    const notRegistered = {
      ok: false,
      code: 'DEVICE_NOT_REGISTERED',
      message:
        'Perangkat ini belum terdaftar. Minta pemilik mendaftarkannya melalui Dashboard.',
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

    let token = null
    try {
      token = await getToken()
    } catch {
      token = null
    }

    if (!token) {
      return { ok: false, code: 'NO_TOKEN' }
    }

    loading.value = true

    try {
      const deviceIdUsed = deviceIdentifierOverride ?? deviceIdentifier.value
      const result = await fetchMobileContext(token, { deviceIdentifier: deviceIdUsed })

      if (!result.ok) {
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

      businesses.value = (result.data?.businesses ?? []).map(mapBusinessEntry)
      hasResolvedBusinessContext.value = true
      hasResolvedZeroBusiness.value = businesses.value.length === 0

      const match =
        businesses.value.find((b) => b.id === selectedBusiness.value?.id) ?? null

      let deviceResolution = null

      if (match) {
        selectedBusiness.value = { id: match.id, name: match.name }
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
      }

      capabilityState.value = 'verified'
      capabilitiesVerifiedAt.value = new Date().toISOString()
      error.value = null

      await persistCloudContext()

      return {
        ok: true,
        businesses: businesses.value,
        role: role.value,
        syncCapabilities: syncCapabilities.value,
        capabilityState: capabilityState.value,
        device: deviceResolution,
      }
    } finally {
      loading.value = false
    }
  }

  return {
    // state
    user,
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
    businesses,
    hasResolvedBusinessContext,
    hasResolvedZeroBusiness,
    loading,
    error,
    // computed
    isAuthenticated,
    hasCloudAccess,
    isDeviceRegistered,
    pushPolicy,
    canPerformCloudPush,
    isCashierContext,
    syncCapabilitySummary,
    // actions
    setPersistenceAdapter,
    login,
    selectBusiness,
    selectOutlet,
    doRegisterDevice,
    logout,
    hydrateFromStorage,
    refreshContext,
    resolveDeviceFromContext,
    persistCloudContext,
    clearSession,
  }
})
