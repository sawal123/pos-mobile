// src/__tests__/helpers/syncScenarioServer.js

export function createFakeServer() {
  const db = {
    categories: [],
    products: [],
    customers: [],
    expenses: [],
    sales: [],
    sale_items: [],
    shifts: [],
  }

  let serverSequence = 0
  const processedRequests = new Map()
  const pushRequestLog = []
  const forceConflicts = new Map()
  let pushRequestCount = 0
  let pullRequestCount = 0
  let simulateNetworkError = false

  function getEntityList(entityType) {
    if (entityType === 'categories') return db.categories
    if (entityType === 'products') return db.products
    if (entityType === 'customers') return db.customers
    if (entityType === 'expenses') return db.expenses
    if (entityType === 'sales') return db.sales
    if (entityType === 'sale_items') return db.sale_items
    if (entityType === 'shifts') return db.shifts
    throw new Error(`Unknown entity type: ${entityType}`)
  }

  function handlePush(body) {
    pushRequestCount++
    if (simulateNetworkError) throw new Error('Simulated network error')

    const { request_id, business_id, device_identifier, changes } = body

    if (!request_id || typeof request_id !== 'string' || !request_id.trim()) {
      return { ok: false, status: 400, data: { code: 'INVALID_REQUEST', message: 'Missing or empty request_id' } }
    }
    if (!business_id || typeof business_id !== 'number' || !Number.isInteger(business_id) || business_id <= 0) {
      return { ok: false, status: 400, data: { code: 'INVALID_REQUEST', message: 'Missing or invalid business_id' } }
    }
    if (!device_identifier || typeof device_identifier !== 'string' || !device_identifier.trim()) {
      return { ok: false, status: 400, data: { code: 'INVALID_REQUEST', message: 'Missing or empty device_identifier' } }
    }
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
      return { ok: false, status: 400, data: { code: 'INVALID_REQUEST', message: 'Missing or invalid changes object' } }
    }

    pushRequestLog.push({ request_id, body: { ...body } })

    if (processedRequests.has(request_id)) {
      return { ok: true, status: 200, data: { data: { request_id, duplicate: true } } }
    }

    const conflicts = []
    const entityTypesToCheck = [
      { key: 'categories', type: 'categories' },
      { key: 'products', type: 'products' },
      { key: 'customers', type: 'customers' },
      { key: 'expenses', type: 'expenses' },
      { key: 'sales', type: 'sales' },
      { key: 'sale_items', type: 'sale_items' },
    ]

    for (const { key, type } of entityTypesToCheck) {
      const incomingList = changes[key] || []
      const serverList = getEntityList(type)
      for (const incoming of incomingList) {
        const syncId = incoming.sync_id
        const existing = serverList.find((x) => x.sync_id === syncId)
        if (existing) {
          const incomingBase = incoming.base_sync_version
          if (incomingBase !== undefined && existing.sync_version > incomingBase) {
            conflicts.push({ entity: type, sync_id: syncId, server_sync_version: existing.sync_version })
          }
        }
        const forceKey = `${type}:${syncId}`
        if (forceConflicts.has(forceKey)) {
          conflicts.push({ entity: type, sync_id: syncId, server_sync_version: forceConflicts.get(forceKey) || 2 })
        }
      }
    }

    if (conflicts.length > 0) {
      return { ok: false, status: 409, data: { code: 'SYNC_CONFLICT', message: 'Sync data conflict detected on server.', conflicts } }
    }

    for (const { key, type } of entityTypesToCheck) {
      const incomingList = changes[key] || []
      const serverList = getEntityList(type)
      for (const incoming of incomingList) {
        const syncId = incoming.sync_id
        const index = serverList.findIndex((x) => x.sync_id === syncId)
        serverSequence++
        const nextVersion = incoming.base_sync_version !== undefined ? incoming.base_sync_version + 1 : 1
        const updatedRecord = { ...incoming, business_id, sync_version: nextVersion, sync_sequence: serverSequence }
        if (index === -1) { serverList.push(updatedRecord) } else { serverList[index] = updatedRecord }
      }
    }

    const responseData = { ok: true, status: 200, data: { data: { request_id, duplicate: false } } }
    processedRequests.set(request_id, responseData)
    return responseData
  }

  function handlePull(query) {
    pullRequestCount++
    if (simulateNetworkError) throw new Error('Simulated network error')

    const businessId = Number(query.get('business_id'))
    const after = Number(query.get('after') || 0)
    const limit = Number(query.get('limit') || 200)

    if (!businessId || !Number.isInteger(businessId) || businessId <= 0) {
      return { ok: false, status: 400, data: { code: 'INVALID_REQUEST', message: 'Missing or invalid business_id' } }
    }
    if (!Number.isFinite(after) || after < 0 || !Number.isInteger(after)) {
      return { ok: false, status: 400, data: { code: 'INVALID_REQUEST', message: 'Invalid after cursor' } }
    }
    if (!Number.isFinite(limit) || limit <= 0 || !Number.isInteger(limit)) {
      return { ok: false, status: 400, data: { code: 'INVALID_REQUEST', message: 'Invalid limit' } }
    }

    const allRecords = []
    const entityTypes = [
      { key: 'categories', type: 'categories' },
      { key: 'products', type: 'products' },
      { key: 'customers', type: 'customers' },
      { key: 'expenses', type: 'expenses' },
      { key: 'sales', type: 'sales' },
      { key: 'sale_items', type: 'sale_items' },
      { key: 'shifts', type: 'shifts' },
    ]

    for (const { key, type } of entityTypes) {
      const list = getEntityList(type)
      for (const item of list) {
        if (Number(item.business_id) === businessId && item.sync_sequence > after) {
          allRecords.push({ entity: key, sync_sequence: item.sync_sequence, data: { ...item } })
        }
      }
    }

    allRecords.sort((a, b) => a.sync_sequence - b.sync_sequence)
    const paginated = allRecords.slice(0, limit)
    const hasMore = allRecords.length > limit
    const nextCursor = paginated.length > 0 ? paginated[paginated.length - 1].sync_sequence : after

    return {
      ok: true, status: 200,
      data: { data: { records: paginated, next_cursor: nextCursor, server_sequence: serverSequence, has_more: hasMore } },
    }
  }

  return {
    db,
    handleRequest(path, options) {
      if (simulateNetworkError) {
        return { ok: false, status: 0, data: null, error: { status: 0, code: 'NETWORK_ERROR', message: 'Simulated network failure', data: null } }
      }

      if (path === '/api/sync/push') {
        const res = handlePush(options.body)
        if (!res.ok) {
          return { ok: false, status: res.status, data: null, error: { status: res.status, code: res.data?.code || 'PUSH_FAILED', message: res.data?.message || 'Push failed', data: res.data } }
        }
        return res
      }

      if (path.startsWith('/api/sync/pull')) {
        const url = new URL(`http://localhost${path}`)
        const res = handlePull(url.searchParams)
        if (!res.ok) {
          return { ok: false, status: res.status, data: null, error: { status: res.status, code: res.data?.code || 'PULL_FAILED', message: res.data?.message || 'Pull failed', data: res.data } }
        }
        return res
      }

      return { ok: false, status: 404, data: null, error: { status: 404, code: 'NOT_FOUND', message: 'Unknown endpoint', data: null } }
    },
    forceConflict(entityType, syncId, serverVersion) {
      forceConflicts.set(`${entityType}:${syncId}`, serverVersion)
    },
    getPushRequestCount: () => pushRequestCount,
    getPullRequestCount: () => pullRequestCount,
    getPushRequests: () => [...pushRequestLog],
    getRecordsForBusiness(businessId) {
      const result = {}
      for (const [key, list] of Object.entries(db)) {
        result[key] = list.filter((r) => Number(r.business_id) === Number(businessId))
      }
      return result
    },
    setSimulateNetworkError(val) { simulateNetworkError = val },
    getServerSequence: () => serverSequence,
    setServerSequence(seq) { serverSequence = seq },
  }
}
