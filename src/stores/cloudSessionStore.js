import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

import {
  cloudLogin,
  fetchMobileContext,
  registerDevice,
  cloudLogout,
} from '@/services/cloud/authService'
import { saveToken, getToken, removeToken } from '@/services/cloud/tokenRepository'
import { resolveDeviceIdentifier } from '@/services/cloud/deviceIdentifier'
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

  /** True while a cloud operation is in flight */
  const loading = ref(false)

  /** Last cloud error string – cleared on each new operation */
  const error = ref(null)

  /** Reference to persistence adapter */
  let _adapter = null

  // ── Computed ───────────────────────────────────────────────────────────────

  const isAuthenticated = computed(() => user.value !== null)

  /** PREM-M03: a Cloud business is explicitly linked to this POS. */
  const isLinked = computed(() => isAuthenticated.value && selectedBusiness.value !== null)

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
  async function handleInvalidToken() {
    try {
      await removeToken()
    } catch {
      // ignore – the local Cloud session is cleared regardless
    }

    if (_adapter) {
      try {
        await _adapter.clearCloudContext()
      } catch {
        // ignore – local POS data is untouched either way
      }
    }

    clearSession()
    sessionInvalid.value = true
    error.value = 'Sesi Cloud tidak valid. Silakan masuk kembali untuk menghubungkan ulang.'
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
    contextCheckedAt.value = null
    linkedAt.value = null
    sessionInvalid.value = false
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

      // INT-02: the context request must carry this device's stable identifier
      // so the backend can return the owner-pre-registered `device_context`.
      const contextDeviceId = await ensureDeviceIdentifier()
      const contextResult = await fetchMobileContext(loginResult.token, {
        deviceIdentifier: contextDeviceId,
      })

      if (!contextResult.ok) {
        if (isUnauthorizedError(contextResult.error)) {
          await handleInvalidToken()
          return { ok: false, error: { ...contextResult.error, code: 'TOKEN_INVALID' } }
        }

        // Rollback token – context is required
        await removeToken()
        user.value = null
        error.value = contextResult.error?.message ?? 'Gagal mengambil context'
        return { ok: false, error: contextResult.error }
      }

      const parsed = extractBusinesses(contextResult.data)

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

    selectedBusiness.value = {
      id: match.id,
      name: match.name,
      subscription: match.subscription ?? null,
    }
    // PREM-M03: an explicit, user-confirmed link to this Cloud business.
    linkedAt.value = new Date().toISOString()
    sessionInvalid.value = false
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
            linkedAt.value = ctx.linkedAt ?? null
            contextCheckedAt.value = ctx.contextCheckedAt ?? null
            role.value = normalizeRole(ctx.role ?? null)
            syncCapabilities.value = ctx.syncCapabilities ?? null
            deviceContext.value = ctx.deviceContext ?? null

            // INT-02: a restored cache is never an authorization. It is either
            // a genuine pre-INT-02 legacy cache, or an unverified snapshot that
            // must be re-confirmed online before any cloud mutation.
            capabilityState.value = role.value || syncCapabilities.value ? 'unverified' : 'legacy'
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

    let token = null
    try {
      token = await getToken()
    } catch {
      // ignore – treated as no token below
    }

    if (!token) {
      return { ok: false, code: 'NO_TOKEN' }
    }

    loading.value = true

    try {
      const deviceIdUsed = deviceIdentifierOverride ?? (await ensureDeviceIdentifier())
      const result = await fetchMobileContext(token, { deviceIdentifier: deviceIdUsed })

      if (!result.ok) {
        // PREM-M03: an invalid/expired token clears the Cloud session (but never
        // local POS data) and asks the user to sign in again.
        if (isUnauthorizedError(result.error)) {
          await handleInvalidToken()
          return {
            ok: false,
            code: 'TOKEN_INVALID',
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
        selectedBusiness.value = {
          id: match.id,
          name: match.name,
          subscription: match.subscription ?? null,
        }
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
      contextCheckedAt.value = capabilitiesVerifiedAt.value
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
    loading,
    error,
    // computed
    isAuthenticated,
    isLinked,
    hasCloudAccess,
    isDeviceRegistered,
    pushPolicy,
    canPerformCloudPush,
    isCashierContext,
    syncCapabilitySummary,
    // actions
    setPersistenceAdapter,
    invalidateCloudSession: handleInvalidToken,
    login,
    selectBusiness,
    selectOutlet,
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
