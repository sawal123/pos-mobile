/**
 * Canonical Cloud sync precondition diagnostics.
 *
 * Sync push and sync pull both refuse to run until the same pieces of Cloud
 * context exist. That refusal is fail-closed by design, but a single opaque
 * sentence ("missing authentication, cloud context, or device registration")
 * makes it impossible for a cashier to know *which* piece is missing, and the
 * sync screen kept showing "Semua Tersinkron" while nothing could be sent or
 * downloaded.
 *
 * This module keeps the fail-closed contract and returns the exact list of
 * missing requirements (plus a short Indonesian explanation per requirement),
 * so every caller and the UI can report the real blocker.
 */

export const SYNC_REQUIREMENT = Object.freeze({
  AUTHENTICATION: 'authentication',
  CLOUD_ACCESS: 'cloud_access',
  BUSINESS: 'business',
  OUTLET: 'outlet',
  DEVICE_IDENTIFIER: 'device_identifier',
  DEVICE_REGISTRATION: 'device_registration',
})

/** Stable display order for readiness checklists. */
export const SYNC_REQUIREMENT_ORDER = Object.freeze([
  SYNC_REQUIREMENT.AUTHENTICATION,
  SYNC_REQUIREMENT.CLOUD_ACCESS,
  SYNC_REQUIREMENT.BUSINESS,
  SYNC_REQUIREMENT.OUTLET,
  SYNC_REQUIREMENT.DEVICE_IDENTIFIER,
  SYNC_REQUIREMENT.DEVICE_REGISTRATION,
])

export const SYNC_REQUIREMENT_LABELS = Object.freeze({
  [SYNC_REQUIREMENT.AUTHENTICATION]: 'Masuk akun Cloud',
  [SYNC_REQUIREMENT.CLOUD_ACCESS]: 'Akses Cloud aktif',
  [SYNC_REQUIREMENT.BUSINESS]: 'Bisnis Cloud dipilih',
  [SYNC_REQUIREMENT.OUTLET]: 'Outlet Cloud dipilih',
  [SYNC_REQUIREMENT.DEVICE_IDENTIFIER]: 'Identitas perangkat terbaca',
  [SYNC_REQUIREMENT.DEVICE_REGISTRATION]: 'Perangkat terdaftar di Dashboard',
})

export const SYNC_REQUIREMENT_HINTS = Object.freeze({
  [SYNC_REQUIREMENT.AUTHENTICATION]:
    'Masuk ke akun Cloud di Pengaturan → Akun Cloud, lalu coba tarik data lagi.',
  [SYNC_REQUIREMENT.CLOUD_ACCESS]:
    'Langganan/akses Cloud bisnis ini belum aktif, atau ruang kerja lokal belum sejalan dengan bisnis Cloud. Cek Pengaturan → Akun Cloud.',
  [SYNC_REQUIREMENT.BUSINESS]: 'Pilih bisnis Cloud pada Pengaturan → Akun Cloud.',
  [SYNC_REQUIREMENT.OUTLET]:
    'Pilih outlet aktif pada Pengaturan → Akun Cloud (Aksi Sinkronisasi wajib punya outlet).',
  [SYNC_REQUIREMENT.DEVICE_IDENTIFIER]:
    'Identitas perangkat belum terbentuk. Tutup lalu buka ulang aplikasi agar dibuat ulang.',
  [SYNC_REQUIREMENT.DEVICE_REGISTRATION]:
    'Minta kode pairing 4 digit dari pemilik (Dashboard → Perangkat → Kode Kasir), lalu masukkan di aplikasi. Kode berlaku 30 menit.',
})

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isPresentId(value) {
  if (value === null || value === undefined) return false
  return String(value).trim() !== ''
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== ''
}

/**
 * Lists the Cloud requirements that are still missing for a sync operation.
 *
 * @param {object} [context]
 * @param {string|null} [context.token] Bearer token, or any truthy marker for an authenticated session.
 * @param {object|null} [context.user]
 * @param {object|null} [context.selectedBusiness]
 * @param {object|null} [context.selectedOutlet]
 * @param {boolean} [context.cloudAccess] Operational Cloud access for the active workspace.
 * @param {string|null} [context.deviceIdentifier]
 * @param {number|string|null} [context.registeredDeviceId]
 * @returns {string[]} Missing requirement keys in canonical order.
 */
export function collectMissingSyncRequirements({
  token = null,
  user = null,
  selectedBusiness = null,
  selectedOutlet = null,
  cloudAccess = false,
  deviceIdentifier = null,
  registeredDeviceId = null,
  requireDeviceRegistration = true,
  role = null,
} = {}) {
  const missing = []

  if (!isNonEmptyString(token) || !isPlainObject(user)) {
    missing.push(SYNC_REQUIREMENT.AUTHENTICATION)
  }
  if (cloudAccess !== true || selectedOutlet?.cloud_access === false) {
    missing.push(SYNC_REQUIREMENT.CLOUD_ACCESS)
  }
  if (!isPresentId(selectedBusiness?.id)) {
    missing.push(SYNC_REQUIREMENT.BUSINESS)
  }
  if (!isPresentId(selectedOutlet?.id)) {
    missing.push(SYNC_REQUIREMENT.OUTLET)
  }
  if (!isNonEmptyString(deviceIdentifier)) {
    missing.push(SYNC_REQUIREMENT.DEVICE_IDENTIFIER)
  }
  // PAIR-01: pairing hanya wajib untuk role kasir. Perangkat owner/member
  // dikelola dari Dashboard dan di-bind otomatis oleh server saat sync pertama,
  // jadi bukan prasyarat yang perlu ditampilkan ke mereka.
  const resolvedRequireDevice =
    requireDeviceRegistration !== null && requireDeviceRegistration !== undefined
      ? requireDeviceRegistration
      : role ? role === 'cashier' : true

  if (resolvedRequireDevice && !isPresentId(registeredDeviceId)) {
    missing.push(SYNC_REQUIREMENT.DEVICE_REGISTRATION)
  }

  return missing
}

/**
 * Describes the current Cloud readiness for a sync operation.
 *
 * @param {object} [context] Same shape as {@link collectMissingSyncRequirements}.
 * @returns {{ok: boolean, missing: string[], labels: string[], hints: string[], message: string|null}}
 */
export function describeSyncPreconditions(context = {}) {
  const { requireDeviceRegistration = true, role = null, ...requirements } = context
  const missing = collectMissingSyncRequirements({
    ...requirements,
    requireDeviceRegistration,
    role,
  })
  const labels = missing.map((key) => SYNC_REQUIREMENT_LABELS[key] ?? key)
  const hints = missing.map((key) => SYNC_REQUIREMENT_HINTS[key] ?? '')

  return {
    ok: missing.length === 0,
    missing,
    labels,
    hints,
    message:
      missing.length === 0
        ? null
        : `Sinkronisasi Cloud belum bisa dijalankan. Belum lengkap: ${labels.join(', ')}.`,
  }
}

/**
 * Readiness snapshot for the sync UI, derived from the Cloud session store.
 *
 * @param {object} options
 * @param {boolean} options.authenticated
 * @param {object|null} options.user
 * @param {object|null} options.selectedBusiness
 * @param {object|null} options.selectedOutlet
 * @param {boolean} options.cloudAccess Operational Cloud access.
 * @param {string|null} options.deviceIdentifier
 * @param {number|string|null} options.registeredDeviceId
 * @returns {{ready: boolean, missing: string[], labels: string[], hints: string[]}}
 */
export function buildSyncReadiness({
  authenticated = false,
  user = null,
  selectedBusiness = null,
  selectedOutlet = null,
  cloudAccess = false,
  deviceIdentifier = null,
  registeredDeviceId = null,
  requireDeviceRegistration = null,
  role = null,
} = {}) {
  const described = describeSyncPreconditions({
    token: authenticated ? 'session' : null,
    user,
    selectedBusiness,
    selectedOutlet,
    cloudAccess,
    deviceIdentifier,
    registeredDeviceId,
    requireDeviceRegistration,
    role,
  })

  return {
    ready: described.ok,
    missing: described.missing,
    labels: described.labels,
    hints: described.hints,
  }
}
