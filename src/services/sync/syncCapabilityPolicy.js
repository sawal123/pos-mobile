/**
 * INT-02 — Sync capability policy (`cashier_sync_v1`).
 *
 * Pure, side-effect-free derivation of POS Mobile cloud-push permissions from
 * the backend `role` + `sync_capabilities` contract returned by
 * `GET /api/mobile/context`.
 *
 * Backend contract reference: `docs/sync/INT01_CASHIER_SYNC_V1.md`
 * (repository `pos_dashboard`, branch `main`).
 *
 * Design rules
 * ------------
 * - Deny by default. An unknown role or an unrecognised capability contract
 *   never grants cloud mutation.
 * - Restricted data is preserved. This module only *classifies* outbox
 *   entries; it never mutates or deletes them.
 * - Never infer a sale relation from a human-readable reference string. Only
 *   the canonical `transactionId` linkage is trusted.
 * - No I/O, no Pinia, no network access: fully unit-testable.
 */

import { SYNC_ENTITY_TYPES, SYNC_OPERATIONS } from './syncConstants'

// ── Push modes ──────────────────────────────────────────────────────────────

export const SYNC_PUSH_MODE_FULL = 'full'
export const SYNC_PUSH_MODE_CASHIER_SAFE = 'cashier_safe'
export const SYNC_PUSH_MODE_NONE = 'none'

export const SYNC_PUSH_MODES = Object.freeze([
  SYNC_PUSH_MODE_FULL,
  SYNC_PUSH_MODE_CASHIER_SAFE,
  SYNC_PUSH_MODE_NONE,
])

// ── Contract version ────────────────────────────────────────────────────────

export const CASHIER_SYNC_CONTRACT_VERSION = 'cashier_sync_v1'

/** Contract versions this build understands. Anything else is fail-closed. */
export const KNOWN_CONTRACT_VERSIONS = Object.freeze([CASHIER_SYNC_CONTRACT_VERSION])

// ── Roles ───────────────────────────────────────────────────────────────────

export const ROLE_OWNER = 'owner'
export const ROLE_MEMBER = 'member'
export const ROLE_CASHIER = 'cashier'

/** Roles that keep the existing full owner/member push contract. */
export const FULL_PUSH_ROLES = Object.freeze([ROLE_OWNER, ROLE_MEMBER])

/** Roles that map to `cashier_safe` when capabilities are not supplied. */
export const CASHIER_PUSH_ROLES = Object.freeze([ROLE_CASHIER])

// ── Policy provenance ───────────────────────────────────────────────────────

/** Capabilities came from a validated `sync_capabilities` object. */
export const CAPABILITY_SOURCE_CAPABILITIES = 'capabilities'
/** Capabilities were derived from an authoritative role value. */
export const CAPABILITY_SOURCE_ROLE = 'role'
/** No role and no capabilities: legacy (pre INT-01) owner/member session. */
export const CAPABILITY_SOURCE_LEGACY = 'legacy'
/** Role present but not recognised. */
export const CAPABILITY_SOURCE_UNKNOWN = 'unknown'
/** Capabilities present but malformed / unrecognised contract version. */
export const CAPABILITY_SOURCE_INVALID = 'invalid'

// ── Outbox classification ───────────────────────────────────────────────────

/** Entry may be included in the next push envelope. */
export const OUTBOX_ACTION_ALLOW = 'allow'
/** Entry is permanently unsendable for the current role. */
export const OUTBOX_ACTION_RESTRICT = 'restrict'
/** Entry is temporarily unsendable until its dependency exists server-side. */
export const OUTBOX_ACTION_DEFER = 'defer'

export const RESTRICTION_CATEGORY_ROLE = 'role_restricted'
export const RESTRICTION_CATEGORY_DEPENDENCY = 'dependency_blocked'
export const RESTRICTION_CATEGORY_INVALID = 'invalid'

// ── Server entity names (exactly as the backend contract spells them) ────────

export const SERVER_ENTITY = Object.freeze({
  CATEGORIES: 'categories',
  PRODUCTS: 'products',
  CUSTOMERS: 'customers',
  SHIFTS: 'shifts',
  SALES: 'sales',
  SALE_ITEMS: 'sale_items',
  CASH_LEDGER: 'cash_ledger',
  STOCK_MOVEMENTS: 'stock_movements',
  EXPENSES: 'expenses',
  DELETIONS: 'deletions',
})

/**
 * Cashier allowlist, verbatim from the INT-01 push matrix.
 * Anything not listed here is denied for `cashier_safe`.
 */
export const CASHIER_ALLOWED_ENTITIES = Object.freeze({
  customers: Object.freeze(['upsert']),
  shifts: Object.freeze(['upsert']),
  sales: Object.freeze(['upsert']),
  sale_items: Object.freeze(['upsert']),
  cash_ledger: Object.freeze(['sale_payment']),
  stock_movements: Object.freeze(['sale']),
})

export const CASHIER_DENIED_ENTITIES = Object.freeze([
  'categories',
  'products',
  'expenses',
  'deletions',
])

const LOCAL_TO_SERVER_ENTITY = Object.freeze({
  [SYNC_ENTITY_TYPES.CATEGORY]: SERVER_ENTITY.CATEGORIES,
  [SYNC_ENTITY_TYPES.PRODUCT]: SERVER_ENTITY.PRODUCTS,
  [SYNC_ENTITY_TYPES.CUSTOMER]: SERVER_ENTITY.CUSTOMERS,
  [SYNC_ENTITY_TYPES.EXPENSE]: SERVER_ENTITY.EXPENSES,
  [SYNC_ENTITY_TYPES.TRANSACTION]: SERVER_ENTITY.SALES,
  [SYNC_ENTITY_TYPES.SHIFT]: SERVER_ENTITY.SHIFTS,
  [SYNC_ENTITY_TYPES.CASH_ENTRY]: SERVER_ENTITY.CASH_LEDGER,
  [SYNC_ENTITY_TYPES.STOCK_MOVEMENT]: SERVER_ENTITY.STOCK_MOVEMENTS,
})

/** Entities a cashier can never send, by local outbox entity type. */
const CASHIER_DENIED_LOCAL_ENTITIES = Object.freeze([
  SYNC_ENTITY_TYPES.BUSINESS,
  SYNC_ENTITY_TYPES.CATEGORY,
  SYNC_ENTITY_TYPES.PRODUCT,
  SYNC_ENTITY_TYPES.EXPENSE,
])

/** Case-insensitive cash payment method markers accepted by the backend. */
const CASH_PAYMENT_METHODS = Object.freeze(['cash', 'tunai'])

// ── Small pure helpers ──────────────────────────────────────────────────────

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function normalizeString(value) {
  return isNonEmptyString(value) ? value.trim() : null
}

/**
 * Map a local outbox entity type to its server entity name.
 *
 * @param {string} entityType
 * @returns {string|null}
 */
export function localEntityToServerEntity(entityType) {
  return LOCAL_TO_SERVER_ENTITY[entityType] ?? null
}

/**
 * Normalise a raw role string. Returns `null` when absent.
 *
 * @param {*} role
 * @returns {string|null}
 */
export function normalizeRole(role) {
  const value = normalizeString(role)
  return value ? value.toLowerCase() : null
}

/**
 * Structural + semantic validation of a raw `sync_capabilities` object.
 *
 * Fail-closed behaviour:
 * - a contract version outside {@link KNOWN_CONTRACT_VERSIONS} is rejected,
 * - an unknown/missing `push_mode` is rejected.
 *
 * @param {*} raw
 * @returns {{present: boolean, ok: boolean, reason: string|null, contractVersion: string|null,
 *   pushMode: string, pull: boolean, allowedEntities: object, deniedEntities: string[]}}
 */
export function normalizeSyncCapabilities(raw) {
  if (!isPlainObject(raw)) {
    return {
      present: false,
      ok: false,
      reason: 'MISSING_CAPABILITIES',
      contractVersion: null,
      pushMode: SYNC_PUSH_MODE_NONE,
      pull: false,
      allowedEntities: {},
      deniedEntities: [],
    }
  }

  const contractVersion = normalizeString(raw.contract_version)
  if (contractVersion && !KNOWN_CONTRACT_VERSIONS.includes(contractVersion)) {
    return {
      present: true,
      ok: false,
      reason: 'UNKNOWN_CONTRACT_VERSION',
      contractVersion,
      pushMode: SYNC_PUSH_MODE_NONE,
      pull: false,
      allowedEntities: {},
      deniedEntities: [],
    }
  }

  const pushMode = normalizeString(raw.push_mode)
  if (!pushMode || !SYNC_PUSH_MODES.includes(pushMode)) {
    return {
      present: true,
      ok: false,
      reason: 'INVALID_PUSH_MODE',
      contractVersion,
      pushMode: SYNC_PUSH_MODE_NONE,
      pull: false,
      allowedEntities: {},
      deniedEntities: [],
    }
  }

  const allowedEntities = isPlainObject(raw.allowed_entities) ? raw.allowed_entities : {}
  const deniedEntities = Array.isArray(raw.denied_entities)
    ? raw.denied_entities.filter((item) => typeof item === 'string')
    : []

  return {
    present: true,
    ok: true,
    reason: null,
    contractVersion,
    pushMode,
    pull: raw.pull === true,
    allowedEntities,
    deniedEntities,
  }
}

/**
 * Resolve the effective push policy from a cloud context snapshot.
 *
 * Resolution order (first match wins):
 * 1. `sync_capabilities` present and valid -> capability contract.
 * 2. `sync_capabilities` present but invalid -> fail-closed (`none`).
 * 3. `role` present -> owner/member = full, cashier = cashier_safe,
 *    anything else = fail-closed (`none`).
 * 4. neither present -> legacy owner/member session = full.
 *
 * Step 4 exists purely for backward compatibility with pre INT-01 backends and
 * direct service callers: before INT-01 a cloud sync was only ever possible for
 * owner/member membership. The app-level authorization boundary
 * (`cloudSessionStore`) additionally requires *verified* capabilities, so a
 * legacy persisted cache never authorises a cloud mutation on its own.
 *
 * @param {object} [context]
 * @param {string|null} [context.role]
 * @param {object|null} [context.syncCapabilities]
 * @param {string|null} [context.capabilityState] `verified|unverified|legacy|unknown`
 * @returns {object} Normalised policy.
 */
export function resolveSyncPushPolicy(context = {}) {
  const rawCapabilities = context?.syncCapabilities ?? null
  const capabilities = normalizeSyncCapabilities(rawCapabilities)
  const role = normalizeRole(context?.role)
  const declaredState = normalizeString(context?.capabilityState)

  // 1. Explicit, authoritative capability contract.
  if (capabilities.present) {
    if (!capabilities.ok) {
      return {
        source: CAPABILITY_SOURCE_INVALID,
        role,
        contractVersion: capabilities.contractVersion,
        pushMode: SYNC_PUSH_MODE_NONE,
        pull: false,
        allowedEntities: {},
        deniedEntities: [],
        failClosed: true,
        reason: capabilities.reason,
      }
    }

    return {
      source: CAPABILITY_SOURCE_CAPABILITIES,
      role,
      contractVersion: capabilities.contractVersion,
      pushMode: capabilities.pushMode,
      pull: capabilities.pull,
      allowedEntities: capabilities.allowedEntities,
      deniedEntities: capabilities.deniedEntities,
      failClosed: capabilities.pushMode === SYNC_PUSH_MODE_NONE,
      reason: null,
    }
  }

  // 3. Role-only resolution.
  if (role) {
    if (FULL_PUSH_ROLES.includes(role)) {
      return {
        source: CAPABILITY_SOURCE_ROLE,
        role,
        contractVersion: null,
        pushMode: SYNC_PUSH_MODE_FULL,
        pull: true,
        allowedEntities: {},
        deniedEntities: [],
        failClosed: false,
        reason: null,
      }
    }

    if (CASHIER_PUSH_ROLES.includes(role)) {
      return {
        source: CAPABILITY_SOURCE_ROLE,
        role,
        contractVersion: null,
        pushMode: SYNC_PUSH_MODE_CASHIER_SAFE,
        pull: true,
        allowedEntities: CASHIER_ALLOWED_ENTITIES,
        deniedEntities: CASHIER_DENIED_ENTITIES,
        failClosed: false,
        reason: null,
      }
    }

    // Unknown role: deny by default.
    return {
      source: CAPABILITY_SOURCE_UNKNOWN,
      role,
      contractVersion: null,
      pushMode: SYNC_PUSH_MODE_NONE,
      pull: false,
      allowedEntities: {},
      deniedEntities: [],
      failClosed: true,
      reason: 'UNKNOWN_ROLE',
    }
  }

  // 2b. A caller may explicitly declare the context as unverified (a cache
  // written after INT-02 whose role/capabilities have not been re-confirmed
  // online yet) or revoked (the selected business is no longer reachable).
  // Fail closed for mutation in both cases until the context is refreshed.
  if (declaredState === 'unverified' || declaredState === 'revoked') {
    return {
      source: CAPABILITY_SOURCE_INVALID,
      role: null,
      contractVersion: null,
      pushMode: SYNC_PUSH_MODE_NONE,
      pull: true,
      allowedEntities: {},
      deniedEntities: [],
      failClosed: true,
      reason: declaredState === 'revoked' ? 'MEMBERSHIP_REVOKED' : 'CAPABILITY_UNVERIFIED',
    }
  }

  // 4. Legacy owner/member session (pre INT-01 backend, or a cache written
  // before INT-01). Cashier cloud sync did not exist before INT-01, so such a
  // context can only ever have been an owner/member membership. This keeps the
  // existing full contract working; the app still surfaces the unverified state
  // and re-confirms it online at the next opportunity.
  return {
    source: CAPABILITY_SOURCE_LEGACY,
    role: null,
    contractVersion: null,
    pushMode: SYNC_PUSH_MODE_FULL,
    pull: true,
    allowedEntities: {},
    deniedEntities: [],
    failClosed: false,
    reason: null,
  }
}

/**
 * Whether the policy permits any cloud push at all.
 *
 * @param {object} policy
 * @returns {boolean}
 */
export function isPushEnabled(policy) {
  return Boolean(policy) && policy.failClosed !== true && policy.pushMode !== SYNC_PUSH_MODE_NONE
}

/**
 * Whether a given cashier-allowed server entity permits an operation.
 *
 * @param {string} serverEntity
 * @param {string} operation
 * @returns {boolean}
 */
export function isCashierEntityOperationAllowed(serverEntity, operation) {
  const allowed = CASHIER_ALLOWED_ENTITIES[serverEntity]
  if (!allowed) return false
  return allowed.includes(operation)
}

function isCashMethod(value) {
  const method = normalizeString(value)
  return method !== null && CASH_PAYMENT_METHODS.includes(method.toLowerCase())
}

function isPaidStatus(value) {
  return normalizeString(value)?.toLowerCase() === 'paid'
}

function isSaleLikeServerKnown(serverVersions, saleSyncId) {
  if (!saleSyncId || !isPlainObject(serverVersions)) return false
  const key = `${SERVER_ENTITY.SALES}:${String(saleSyncId).toLowerCase()}`
  return serverVersions[key] !== undefined && serverVersions[key] !== null
}

function isProductServerKnown(serverVersions, productSyncId) {
  if (!productSyncId || !isPlainObject(serverVersions)) return false
  const key = `${SERVER_ENTITY.PRODUCTS}:${String(productSyncId).toLowerCase()}`
  return serverVersions[key] !== undefined && serverVersions[key] !== null
}

/**
 * Public identity check: is this product sync id already known to the server?
 *
 * Backed by the `sync_server_versions_v1` metadata written by both push and
 * pull, so a product that exists server-side is recognised even when it also
 * has a pending local outbox row (a cashier product mutation is always
 * restricted, yet the existing server product may still be used by sales).
 *
 * @param {object} serverVersions
 * @param {string|null|undefined} productSyncId
 * @returns {boolean}
 */
export function isProductKnownOnServer(serverVersions, productSyncId) {
  return isProductServerKnown(serverVersions, productSyncId)
}

function restriction(category, code, message) {
  return { action: OUTBOX_ACTION_RESTRICT, category, code, message }
}

function deferral(code, message, missing = []) {
  return {
    action: OUTBOX_ACTION_DEFER,
    category: RESTRICTION_CATEGORY_DEPENDENCY,
    code,
    message,
    missing,
  }
}

function allow() {
  return { action: OUTBOX_ACTION_ALLOW }
}

/**
 * Classify a single outbox entry against the resolved policy.
 *
 * This is the *role* layer: it decides whether the entry is admissible at all
 * for the active push mode. Dependency checks that need cross-entry or
 * server-version knowledge are applied separately by the push service.
 *
 * @param {{entityType: string, operation: string, payload: object|null}} entry
 * @param {object} policy Resolved policy from {@link resolveSyncPushPolicy}.
 * @returns {object} One of `allow` / `restrict` / `defer` descriptors.
 */
export function classifyOutboxEntryForPolicy(entry, policy) {
  if (!entry || !policy) return allow()

  if (policy.failClosed === true || policy.pushMode === SYNC_PUSH_MODE_NONE) {
    return restriction(
      RESTRICTION_CATEGORY_ROLE,
      'SYNC_ROLE_NOT_PERMITTED',
      'Peran pengguna ini tidak diizinkan mengirim perubahan ke cloud.',
    )
  }

  if (policy.pushMode === SYNC_PUSH_MODE_FULL) {
    return allow()
  }

  // ── cashier_safe ────────────────────────────────────────────────────────
  const { entityType, payload } = entry

  if (entry.operation === SYNC_OPERATIONS.DELETE) {
    return restriction(
      RESTRICTION_CATEGORY_ROLE,
      'CASHIER_DELETIONS_DENIED',
      'Penghapusan data tidak diizinkan untuk peran kasir.',
    )
  }

  if (entry.operation !== SYNC_OPERATIONS.UPSERT) {
    return restriction(
      RESTRICTION_CATEGORY_ROLE,
      'CASHIER_OPERATION_DENIED',
      'Operasi ini tidak diizinkan untuk peran kasir.',
    )
  }

  if (CASHIER_DENIED_LOCAL_ENTITIES.includes(entityType)) {
    return restriction(
      RESTRICTION_CATEGORY_ROLE,
      'CASHIER_ENTITY_DENIED',
      'Data master (kategori/produk/bisnis) atau beban tidak diizinkan untuk peran kasir.',
    )
  }

  if (
    entityType === SYNC_ENTITY_TYPES.CUSTOMER ||
    entityType === SYNC_ENTITY_TYPES.SHIFT ||
    entityType === SYNC_ENTITY_TYPES.TRANSACTION
  ) {
    return allow()
  }

  if (entityType === SYNC_ENTITY_TYPES.CASH_ENTRY) {
    // Manual cash movements are owner-only. A sale payment must carry the
    // canonical `transactionId`; a human reference string is never trusted.
    if (!isNonEmptyString(payload?.transactionId)) {
      return restriction(
        RESTRICTION_CATEGORY_ROLE,
        'CASHIER_MANUAL_CASH_DENIED',
        'Kas masuk/keluar manual tidak diizinkan untuk peran kasir.',
      )
    }
    return allow()
  }

  if (entityType === SYNC_ENTITY_TYPES.STOCK_MOVEMENT) {
    const movementType = normalizeString(payload?.movementType ?? payload?.type)
    const quantityChange = Number(payload?.quantityChange)
    const isSaleMovement = movementType?.toLowerCase() === 'sale'
    const isDeduction = Number.isFinite(quantityChange) && quantityChange < 0

    if (!isSaleMovement || !isNonEmptyString(payload?.transactionId) || !isDeduction) {
      return restriction(
        RESTRICTION_CATEGORY_ROLE,
        'CASHIER_MANUAL_STOCK_DENIED',
        'Penyesuaian stok manual tidak diizinkan untuk peran kasir.',
      )
    }
    return allow()
  }

  // Unknown local entity type: deny by default.
  return restriction(
    RESTRICTION_CATEGORY_ROLE,
    'CASHIER_ENTITY_DENIED',
    'Jenis data ini tidak diizinkan untuk peran kasir.',
  )
}

/**
 * Dependency gate for `cashier_safe` push candidates.
 *
 * Enforces the transaction dependency chains from the INT-02 spec:
 *   sale -> customer (handled by the existing pending-parent deferral),
 *   sale_item -> sale + product,
 *   cash payment -> sale (cash + paid),
 *   stock movement -> sale + product.
 *
 * The caller supplies the resolved sync ids and the canonical relation lookup
 * so this stays free of registry/store I/O.
 *
 * @param {object} params
 * @param {{entityType: string, operation: string, payload: object|null}} params.entry
 * @param {object} params.policy
 * @param {object} params.serverVersions `loadSyncServerVersions()` snapshot.
 * @param {Array<{productSyncId: string|null}>} [params.itemProductSyncIds]
 * @param {boolean} [params.saleInEnvelope] Whether the linked sale travels in this envelope.
 * @param {object|null} [params.linkedTransaction] Canonical local transaction snapshot.
 * @param {string|null} [params.linkedSaleSyncId]
 * @param {string|null} [params.linkedProductSyncId]
 * @returns {object} `allow` / `defer` descriptor.
 */
export function evaluateCashierDependency({
  entry,
  policy,
  serverVersions = {},
  itemProductSyncIds = [],
  saleInEnvelope = false,
  linkedTransaction = null,
  linkedSaleSyncId = null,
  linkedProductSyncId = null,
} = {}) {
  if (!entry || !policy || policy.pushMode !== SYNC_PUSH_MODE_CASHIER_SAFE) {
    return allow()
  }

  if (entry.entityType === SYNC_ENTITY_TYPES.TRANSACTION) {
    const unknown = []
    for (const productSyncId of itemProductSyncIds) {
      if (!productSyncId) {
        unknown.push(productSyncId ?? 'unknown')
        continue
      }
      if (!isProductServerKnown(serverVersions, productSyncId)) {
        unknown.push(productSyncId)
      }
    }
    if (unknown.length > 0) {
      return deferral(
        'SALE_PRODUCT_NOT_AVAILABLE_ON_SERVER',
        'Transaksi menunggu karena produk terkait belum tersedia di server.',
        unknown,
      )
    }
    return allow()
  }

  if (entry.entityType === SYNC_ENTITY_TYPES.CASH_ENTRY) {
    // Canonical sale relation is mandatory for a cashier cash row.
    if (!linkedSaleSyncId) {
      return deferral(
        'CASH_PAYMENT_SALE_UNRESOLVED',
        'Pembayaran kas menunggu karena transaksi terkait belum dapat dipetakan.',
        [],
      )
    }
    if (!saleInEnvelope && !isSaleLikeServerKnown(serverVersions, linkedSaleSyncId)) {
      return deferral(
        'CASH_PAYMENT_SALE_NOT_AVAILABLE_ON_SERVER',
        'Pembayaran kas menunggu sampai transaksi terkait tersinkronisasi.',
        [linkedSaleSyncId],
      )
    }
    // The linked sale must be a settled cash sale.
    if (!linkedTransaction) {
      return deferral(
        'CASH_PAYMENT_SALE_METADATA_MISSING',
        'Pembayaran kas menunggu karena detail transaksi terkait belum tersedia secara lokal.',
        [],
      )
    }
    const method = linkedTransaction.paymentMethod ?? linkedTransaction.payment_method
    const paid =
      isPaidStatus(linkedTransaction.paymentStatus ?? linkedTransaction.payment_status) ||
      isPaidStatus(linkedTransaction.status)
    if (!isCashMethod(method) || !paid) {
      return deferral(
        'CASH_PAYMENT_REQUIRES_SETTLED_CASH_SALE',
        'Pembayaran kas menunggu karena transaksi terkait bukan penjualan tunai yang sudah lunas.',
        [],
      )
    }
    return allow()
  }

  if (entry.entityType === SYNC_ENTITY_TYPES.STOCK_MOVEMENT) {
    if (!linkedSaleSyncId) {
      return deferral(
        'STOCK_MOVEMENT_SALE_UNRESOLVED',
        'Pergerakan stok menunggu karena transaksi terkait belum dapat dipetakan.',
        [],
      )
    }
    if (!linkedProductSyncId || !isProductServerKnown(serverVersions, linkedProductSyncId)) {
      return deferral(
        'STOCK_MOVEMENT_PRODUCT_NOT_AVAILABLE_ON_SERVER',
        'Pergerakan stok menunggu karena produk terkait belum tersedia di server.',
        linkedProductSyncId ? [linkedProductSyncId] : [],
      )
    }
    if (!saleInEnvelope && !isSaleLikeServerKnown(serverVersions, linkedSaleSyncId)) {
      return deferral(
        'STOCK_MOVEMENT_SALE_NOT_AVAILABLE_ON_SERVER',
        'Pergerakan stok menunggu sampai transaksi terkait tersinkronisasi.',
        [linkedSaleSyncId],
      )
    }
    return allow()
  }

  return allow()
}

/**
 * Extract the canonical product references from a transaction outbox payload.
 * Returns local product ids only; sync-id resolution stays with the caller.
 *
 * @param {object|null} payload
 * @returns {Array<string|null>}
 */
export function extractTransactionProductLocalIds(payload) {
  const items = Array.isArray(payload?.items) ? payload.items : []
  return items.map((item) => item?.id ?? item?.productId ?? item?.product_id ?? null)
}

/**
 * Human-readable description of a restriction category for the UI.
 *
 * @param {string} category
 * @returns {string}
 */
export function describeRestrictionCategory(category) {
  switch (category) {
    case RESTRICTION_CATEGORY_ROLE:
      return 'Tidak diizinkan oleh peran'
    case RESTRICTION_CATEGORY_DEPENDENCY:
      return 'Dependensi belum tersedia'
    case RESTRICTION_CATEGORY_INVALID:
      return 'Data tidak valid'
    default:
      return 'Perlu diperiksa'
  }
}
