import { defineStore } from 'pinia'
import { createSyncConflictService } from '@/services/sync/syncConflictService'

export const useSyncConflictStore = defineStore('syncConflict', {
  state: () => ({
    conflicts: [],
    loading: false,
    lastError: null,
    _conflictService: null,
    _adapter: null,
  }),

  getters: {
    openConflicts(state) {
      return state.conflicts.filter((c) => c.status === 'open')
    },
    openConflictCount(state) {
      return state.conflicts.filter((c) => c.status === 'open').length
    },
  },

  actions: {
    init({ conflictService = null, adapter = null } = {}) {
      if (conflictService) {
        this._conflictService = conflictService
      }
      if (adapter) {
        this._adapter = adapter
      }
      if (!this._conflictService && this._adapter) {
        this._conflictService = createSyncConflictService({ adapter: this._adapter })
      }
    },

    async loadConflicts() {
      this.loading = true
      this.lastError = null

      try {
        if (this._conflictService) {
          const res = await this._conflictService.listConflicts()
          this.conflicts = Array.isArray(res.conflicts) ? res.conflicts : []
        } else if (this._adapter && typeof this._adapter.loadSyncConflicts === 'function') {
          const state = await this._adapter.loadSyncConflicts()
          this.conflicts = Array.isArray(state?.conflicts) ? state.conflicts : []
        } else {
          this.conflicts = []
        }
      } catch (err) {
        this.lastError = err?.message || 'Failed to load sync conflicts'
      } finally {
        this.loading = false
      }
    },

    async useServer(conflictId) {
      if (!this._conflictService) {
        if (this._adapter) {
          this._conflictService = createSyncConflictService({ adapter: this._adapter })
        } else {
          return { ok: false, code: 'SERVICE_NOT_INITIALIZED', message: 'Conflict service not initialized' }
        }
      }

      this.loading = true
      this.lastError = null

      try {
        const result = await this._conflictService.useServer(conflictId)
        await this.loadConflicts()
        return result
      } catch (err) {
        this.lastError = err?.message || 'Failed to resolve conflict with server version'
        return { ok: false, code: 'CONFLICT_RESOLUTION_ERROR', message: this.lastError }
      } finally {
        this.loading = false
      }
    },

    async keepLocal(conflictId) {
      if (!this._conflictService) {
        if (this._adapter) {
          this._conflictService = createSyncConflictService({ adapter: this._adapter })
        } else {
          return { ok: false, code: 'SERVICE_NOT_INITIALIZED', message: 'Conflict service not initialized' }
        }
      }

      this.loading = true
      this.lastError = null

      try {
        const result = await this._conflictService.keepLocal(conflictId)
        await this.loadConflicts()
        return result
      } catch (err) {
        this.lastError = err?.message || 'Failed to resolve conflict with local version'
        return { ok: false, code: 'CONFLICT_RESOLUTION_ERROR', message: this.lastError }
      } finally {
        this.loading = false
      }
    },
  },
})
