import { defineStore } from 'pinia'

function createCustomerId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID()
  }

  return `customer-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function normalizeText(value) {
  return `${value ?? ''}`.trim()
}

function validateCustomerInput(payload) {
  const name = normalizeText(payload.name)
  const phone = normalizeText(payload.phone)
  const email = normalizeText(payload.email)
  const errors = {}

  if (!name) {
    errors.name = 'Nama pelanggan wajib diisi.'
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
    values: {
      name,
      phone,
      email,
    },
  }
}

export const useCustomerStore = defineStore('customer', {
  state: () => ({
    customers: [],
  }),
  actions: {
    getCustomerById(id) {
      return this.customers.find((customer) => String(customer.id) === String(id)) ?? null
    },
    findByPhone(phone) {
      const cleanPhone = normalizeText(phone)
      if (!cleanPhone) return null
      return this.customers.find((customer) => normalizeText(customer.phone) === cleanPhone) ?? null
    },
    findOrCreateCustomer(payload) {
      const phone = normalizeText(payload?.phone)
      const name = normalizeText(payload?.name)
      const existing = this.findByPhone(phone)

      if (existing) {
        if (name && !existing.name) {
          existing.name = name
        }
        return {
          success: true,
          customer: existing,
          isNew: false,
          errors: {},
        }
      }

      const result = this.createCustomer(payload)
      return {
        ...result,
        isNew: Boolean(result.customer),
      }
    },
    createCustomer(payload) {
      const { isValid, errors, values } = validateCustomerInput(payload)

      if (!isValid) {
        return {
          success: false,
          errors,
        }
      }

      const customer = {
        id: createCustomerId(),
        ...values,
      }

      this.customers.push(customer)

      return {
        success: true,
        customer,
        errors: {},
      }
    },
    updateCustomer(id, payload) {
      const customer = this.getCustomerById(id)

      if (!customer) {
        return {
          success: false,
          errors: {
            form: 'Pelanggan tidak ditemukan.',
          },
        }
      }

      const { isValid, errors, values } = validateCustomerInput(payload)

      if (!isValid) {
        return {
          success: false,
          errors,
        }
      }

      customer.name = values.name
      customer.phone = values.phone
      customer.email = values.email

      return {
        success: true,
        customer,
        errors: {},
      }
    },
    deleteCustomer(id) {
      const initialLength = this.customers.length
      this.customers = this.customers.filter((customer) => String(customer.id) !== String(id))

      return this.customers.length !== initialLength
    },
  },
})
