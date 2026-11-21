import { defineStore } from 'pinia'

import { normalizeBusinessType } from '@/data/businessTemplates'

export const useBusinessStore = defineStore('business', {
  state: () => ({
    name: '',
    type: '',
    owner: '',
    phone: '',
    outlet: 'Outlet Utama',
    mode: 'free',
    table_management_enabled: false,
  }),
  getters: {
    isSetup: (state) => Boolean(state.name) && Boolean(state.type),
    normalizedType: (state) => normalizeBusinessType(state.type),
    tableManagementEnabled: (state) => Boolean(state.table_management_enabled),
  },
  actions: {
    setBusiness(data) {
      this.name = data.name ?? this.name
      this.type = normalizeBusinessType(data.type)
      this.owner = data.owner ?? this.owner
      this.phone = data.phone ?? this.phone
      this.outlet = data.outlet ?? this.outlet
      this.mode = data.mode ?? this.mode
      if (data.table_management_enabled !== undefined) {
        this.table_management_enabled = Boolean(data.table_management_enabled)
      } else if (data.tableManagementEnabled !== undefined) {
        this.table_management_enabled = Boolean(data.tableManagementEnabled)
      }
    },
    setTableManagementEnabled(enabled) {
      this.table_management_enabled = Boolean(enabled)
    },
  },
})
