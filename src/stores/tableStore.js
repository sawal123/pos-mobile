import { defineStore } from 'pinia'

export const useTableStore = defineStore('table', {
  state: () => ({
    tables: [],
  }),
  getters: {
    availableTables: (state) =>
      state.tables
        .filter((t) => t.status !== 'deleted' && t.status !== 'inactive')
        .sort(
          (a, b) =>
            Number(a.sort_order ?? a.sortOrder ?? 0) - Number(b.sort_order ?? b.sortOrder ?? 0) ||
            (a.name || '').localeCompare(b.name || ''),
        ),
    getTableById: (state) => (id) =>
      state.tables.find((t) => String(t.id).toLowerCase() === String(id).toLowerCase()),
  },
  actions: {
    setTables(tables) {
      this.tables = Array.isArray(tables) ? [...tables] : []
    },
    addTable(table) {
      if (!table || !table.id) return
      const idx = this.tables.findIndex(
        (t) => String(t.id).toLowerCase() === String(table.id).toLowerCase(),
      )
      if (idx !== -1) {
        this.tables[idx] = { ...this.tables[idx], ...table }
      } else {
        this.tables.push({ ...table })
      }
    },
    updateTable(table) {
      if (!table || !table.id) return
      const idx = this.tables.findIndex(
        (t) => String(t.id).toLowerCase() === String(table.id).toLowerCase(),
      )
      if (idx !== -1) {
        this.tables[idx] = { ...this.tables[idx], ...table }
      }
    },
    removeTable(id) {
      this.tables = this.tables.filter(
        (t) => String(t.id).toLowerCase() !== String(id).toLowerCase(),
      )
    },
    clearTables() {
      this.tables = []
    },
  },
})
