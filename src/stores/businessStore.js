import { defineStore } from 'pinia'

export const useBusinessStore = defineStore('business', {
  state: () => ({
    name: '',
    type: '',
    owner: '',
    phone: '',
    outlet: 'Outlet Utama',
    mode: 'free',
  }),
  getters: {
    isSetup: (state) => Boolean(state.name) && Boolean(state.type),
  },
  actions: {
    setBusiness(data) {
      this.name = data.name
      this.type = data.type
      this.owner = data.owner
      this.phone = data.phone
      this.outlet = data.outlet ?? this.outlet
      this.mode = data.mode ?? this.mode
    },
  },
})
