import { defineStore } from 'pinia'

export const useVariantStore = defineStore('variant', {
  state: () => ({
    groups: [],
  }),
  getters: {
    activeGroups: (state) => state.groups.filter((g) => g.status !== 'deleted'),
    getProductVariantGroups: (state) => (product) => {
      if (!product) return []
      const groupIds = Array.isArray(product.variantGroupIds)
        ? product.variantGroupIds
        : (Array.isArray(product.variant_group_ids) ? product.variant_group_ids : [])

      const idsSet = new Set(groupIds.map((id) => String(id).toLowerCase()))
      if (idsSet.size === 0) return []

      return state.groups
        .filter(
          (g) =>
            g.status !== 'deleted' &&
            (idsSet.has(String(g.id).toLowerCase()) || idsSet.has(String(g.syncId).toLowerCase())),
        )
        .sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0))
    },
    hasVariants: (state) => (product) => {
      if (!product) return false
      const groupIds = Array.isArray(product.variantGroupIds)
        ? product.variantGroupIds
        : (Array.isArray(product.variant_group_ids) ? product.variant_group_ids : [])

      const idsSet = new Set(groupIds.map((id) => String(id).toLowerCase()))
      if (idsSet.size === 0) return false

      return state.groups.some(
        (g) =>
          g.status !== 'deleted' &&
          (idsSet.has(String(g.id).toLowerCase()) || idsSet.has(String(g.syncId).toLowerCase())),
      )
    },
  },
  actions: {
    setGroups(groupsList) {
      this.groups = Array.isArray(groupsList) ? groupsList : []
    },
    upsertGroup(group) {
      const idx = this.groups.findIndex(
        (g) =>
          String(g.id).toLowerCase() === String(group.id).toLowerCase() ||
          (g.syncId && group.syncId && String(g.syncId).toLowerCase() === String(group.syncId).toLowerCase()),
      )
      if (idx !== -1) {
        this.groups[idx] = { ...this.groups[idx], ...group }
      } else {
        this.groups.push(group)
      }
    },
    removeGroup(id) {
      const target = String(id).toLowerCase()
      this.groups = this.groups.filter(
        (g) => String(g.id).toLowerCase() !== target && String(g.syncId).toLowerCase() !== target,
      )
    },
  },
})
