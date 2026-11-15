import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useUnitStore, DEFAULT_UNITS } from '@/stores/unitStore'

describe('useUnitStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('loads default units when storage is empty', () => {
    const store = useUnitStore()
    expect(store.units).toEqual(DEFAULT_UNITS)
    expect(store.units).toContain('botol')
    expect(store.units).toContain('pcs')
    expect(store.units).toContain('ml')
    expect(store.units).toContain('gram')
  })

  it('adds a new unique unit in lowercase', () => {
    const store = useUnitStore()
    store.addUnit('Karton')
    expect(store.units).toContain('karton')

    const count = store.units.filter((u) => u === 'karton').length
    store.addUnit('KARTON')
    expect(store.units.filter((u) => u === 'karton').length).toBe(count)
  })

  it('merges new units from array or objects', () => {
    const store = useUnitStore()
    store.mergeUnits(['bungkus', { name: 'lusin' }])
    expect(store.units).toContain('bungkus')
    expect(store.units).toContain('lusin')
  })

  it('provides sorted units alphabetically', () => {
    const store = useUnitStore()
    const sorted = store.sortedUnits
    expect(sorted[0] <= sorted[1]).toBe(true)
  })

  it('supports full CRUD operations: create, read, update, delete', () => {
    const store = useUnitStore()

    // 1. Create (ml, gr, pcs already in default, add custom)
    const createRes = store.createUnit('slop')
    expect(createRes.success).toBe(true)
    expect(store.units).toContain('slop')

    // Duplicate create fails
    const dupRes = store.createUnit('SLOP')
    expect(dupRes.success).toBe(false)
    expect(dupRes.error).toContain('sudah terdaftar')

    // 2. Update / Rename
    const updateRes = store.updateUnit('slop', 'pak')
    expect(updateRes.success).toBe(true)
    expect(store.units).not.toContain('slop')
    expect(store.units).toContain('pak')

    // 3. Delete
    const deleteRes = store.deleteUnit('pak')
    expect(deleteRes.success).toBe(true)
    expect(store.units).not.toContain('pak')
  })
})

