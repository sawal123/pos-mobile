import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

import { cloudLogin, fetchMobileContext, registerDevice, cloudLogout } from '@/services/cloud/authService'
import { saveToken, getToken, removeToken } from '@/services/cloud/tokenRepository'

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

  /** List of businesses from context (drives selection UI) */
  const businesses = ref([])

  /** Tracks whether the business context list has been resolved from the API in this session */
  const hasResolvedBusinessContext = ref(false)

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
    businesses.value = []
    hasResolvedBusinessContext.value = false
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

      businesses.value = (contextResult.data?.businesses ?? []).map((b) => ({
        id: b.id,
        name: b.name,
        cloud_access: b.cloud_access,
        subscription: b.subscription ?? null,
        outlets: (b.outlets ?? []).map((o) => ({
          id: o.id,
          name: o.name,
          status: o.status,
        })),
        device_context: b.device_context ?? null,
      }))
      hasResolvedBusinessContext.value = true

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

    await persistCloudContext()

    return { ok: true, outlet: match }
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

  return {
    // state
    user,
    selectedBusiness,
    selectedOutlet,
    deviceIdentifier,
    registeredDeviceId,
    cloudAccess,
    businesses,
    hasResolvedBusinessContext,
    loading,
    error,
    // computed
    isAuthenticated,
    hasCloudAccess,
    isDeviceRegistered,
    // actions
    setPersistenceAdapter,
    login,
    selectBusiness,
    selectOutlet,
    doRegisterDevice,
    logout,
    hydrateFromStorage,
    persistCloudContext,
    clearSession,
  }
})
