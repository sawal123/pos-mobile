import { defineStore } from 'pinia'

import { transactions } from '@/data/transactions'
import { useCashStore } from '@/stores/cashStore'
import { usePaymentMethodStore } from '@/stores/paymentMethodStore'
import { useProductStore } from '@/stores/productStore'
import { toLocalDateString } from '@/utils/formatters'

function isCashPaymentMethod(method) {
  if (!method) return false
  const m = String(method).toLowerCase().trim()
  if (m === 'cash' || m === 'tunai') return true
  try {
    const paymentStore = usePaymentMethodStore()
    return paymentStore.isCashMethod(m)
  } catch {
    return false
  }
}

function createDefaultUiFilters() {
  const today = toLocalDateString(new Date())
  return {
    searchQuery: '',
    dateFilter: 'today',
    paymentFilter: 'all',
    sortOrder: 'newest',
    flickerDate: today,
    rangeStart: today,
    rangeEnd: today,
  }
}

export const ORDER_LIFECYCLE = ['Masuk', 'Diproses', 'Siap Diambil', 'Selesai']
export const POS_ORDER_STATUSES = ['Proses', 'Siap', 'Selesai', 'Batal']
export const ALL_ORDER_STATUSES = [...ORDER_LIFECYCLE, ...POS_ORDER_STATUSES]

export const NEXT_ORDER_STATUS = {
  Masuk: 'Diproses',
  Diproses: 'Siap Diambil',
  'Siap Diambil': 'Selesai',
}

export const ORDER_STATUS_ACTIONS = {
  Masuk: 'Mulai Proses',
  Diproses: 'Tandai Siap Diambil',
  'Siap Diambil': 'Tandai Selesai',
}

export function isPaidTransaction(transaction) {
  if (!transaction) return false
  if (transaction.paymentStatus) {
    return transaction.paymentStatus === 'paid'
  }
  return transaction.status === 'paid'
}

export function createLaundryOrderNumber(existingItems = [], date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const prefix = `LDR-${y}${m}${d}-`

  const existingNumbers = new Set(
    existingItems
      .map((item) => item.orderNumber || item.invoiceNumber || '')
      .filter((num) => typeof num === 'string' && num.startsWith(prefix)),
  )

  let counter = existingNumbers.size + 1
  let candidate = `${prefix}${String(counter).padStart(4, '0')}`

  while (existingNumbers.has(candidate)) {
    counter++
    candidate = `${prefix}${String(counter).padStart(4, '0')}`
  }

  return candidate
}

function createTransactionId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID()
  }

  return `trx-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function createInvoiceNumber() {
  const timestamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
  return `INV-${timestamp}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
}

function normalizeTransactionItem(item) {
  const qty = Number(item.qty ?? item.quantity) || 0
  const price = Number(item.price ?? item.unitPrice) || 0
  const hppSnapshot = Number(item.hppSnapshot ?? item.costSnapshot ?? item.cost) || 0
  const subtotal = item.subtotal != null ? Number(item.subtotal) : price * qty

  const rawProdId = item.productId ?? item.product_id ?? item.serviceId ?? item.id
  const cleanProdId =
    typeof rawProdId === 'string' && rawProdId.includes('::')
      ? rawProdId.split('::')[0]
      : rawProdId

  return {
    ...item,
    id: item.serviceId ?? item.id,
    serviceId: item.serviceId ?? cleanProdId,
    productId: cleanProdId,
    name: item.name ?? item.serviceName ?? '',
    serviceName: item.serviceName ?? item.name ?? '',
    variant_summary: item.variant_summary ?? item.variantSummary ?? '',
    variantSummary: item.variant_summary ?? item.variantSummary ?? '',
    variants_snapshot: item.variants_snapshot ?? item.variantsSnapshot ?? item.selectedOptions ?? [],
    variantsSnapshot: item.variants_snapshot ?? item.variantsSnapshot ?? item.selectedOptions ?? [],
    qty,
    quantity: qty,
    price,
    unitPrice: price,
    hppSnapshot,
    costSnapshot: hppSnapshot,
    unit: item.unit ?? item.pricingUnit ?? 'pcs',
    kind: item.kind ?? 'product',
    pricingUnit: item.pricingUnit ?? item.unit ?? 'pcs',
    subtotal,
    lineSubtotal: subtotal,
    lineCost: hppSnapshot * qty,
  }
}

function calculateGrossProfit(items) {
  return items.reduce((sum, item) => sum + ((item.price * item.qty) - (item.hppSnapshot * item.qty)), 0)
}

function normalizeCustomerSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    return null
  }

  return {
    id: snapshot.id ?? null,
    name: snapshot.name ?? '',
    phone: snapshot.phone != null ? String(snapshot.phone) : '',
    email: snapshot.email != null ? String(snapshot.email) : '',
  }
}

export const useTransactionStore = defineStore('transaction', {
  state: () => ({
    items: transactions,
    lastTransaction: null,
    uiFilters: createDefaultUiFilters(),
  }),
  actions: {
    addTransaction(transaction) {
      this.items = [transaction, ...this.items]
      this.lastTransaction = transaction
      return transaction
    },
    createTransaction(payload) {
      const items = payload.items.map(normalizeTransactionItem)
      const createdAt = payload.createdAt ?? new Date().toISOString()
      const isPaid = !(
        payload.paymentStatus === 'unpaid' ||
        payload.status === 'unpaid' ||
        payload.paymentMethod === 'unpaid'
      )
      const paymentStatus = payload.paymentStatus ?? (isPaid ? 'paid' : 'unpaid')
      const status = payload.status ?? (isPaid ? 'paid' : 'unpaid')
      const orderStatus = payload.orderStatus !== undefined ? payload.orderStatus : 'Proses'
      const paidAt = payload.paidAt ?? (isPaid ? createdAt : null)
      const isUnpaidMethod =
        payload.paymentMethod === 'unpaid' ||
        payload.paymentStatus === 'unpaid' ||
        payload.pay_later === true ||
        payload.payLater === true
      const cashReceived = isUnpaidMethod ? 0 : (payload.cashReceived ?? null)
      const changeAmount = isUnpaidMethod ? 0 : (payload.changeAmount ?? null)

      const customer = payload.customer ?? 'Walk-in Customer'
      const customerId = payload.customerId ?? null
      let customerSnapshot = normalizeCustomerSnapshot(payload.customerSnapshot)
      if (!customerSnapshot && customer && customer !== 'Walk-in Customer' && !customerId) {
        customerSnapshot = { id: null, name: customer, phone: '', email: '' }
      }
      const tableNumber = payload.tableNumber ?? payload.table_number ?? null

      const transaction = {
        id: payload.id ?? createTransactionId(),
        invoiceNumber: createInvoiceNumber(),
        customer,
        customerId,
        customerSnapshot,
        tableNumber,
        table_number: tableNumber,
        businessSnapshot: payload.businessSnapshot ? { ...payload.businessSnapshot } : null,
        status,
        orderStatus,
        paymentStatus,
        pay_later: isUnpaidMethod,
        payLater: isUnpaidMethod,
        items,
        itemCount: items.reduce((count, item) => count + item.qty, 0),
        subtotal: payload.subtotal,
        discount: Number(payload.discount ?? 0),
        discountLabel: payload.discountLabel ?? payload.appliedPromo?.name ?? null,
        promoSyncId: payload.promoSyncId ?? payload.appliedPromo?.sync_id ?? null,
        appliedPromo: payload.appliedPromo ? { ...payload.appliedPromo } : null,
        tax: payload.tax,
        taxEnabled: payload.taxEnabled ?? (Number(payload.tax) > 0),
        taxRate: payload.taxRate ?? null,
        total: payload.total,
        grossProfit: calculateGrossProfit(items),
        paymentMethod: payload.paymentMethod,
        cashReceived,
        changeAmount,
        paidAt,
        createdAt,
        updatedAt: payload.updatedAt ?? createdAt,
      }

      return this.addTransaction(transaction)
    },
    createLaundryOrder(payload) {
      const items = payload.items.map(normalizeTransactionItem)
      const createdAt = payload.createdAt ?? new Date().toISOString()
      const orderNumber = payload.orderNumber ?? createLaundryOrderNumber(this.items, new Date(createdAt))
      const paymentStatus = payload.paymentStatus ?? (payload.status === 'paid' ? 'paid' : 'unpaid')
      const isPaid = paymentStatus === 'paid'
      const subtotal = payload.subtotal != null ? Number(payload.subtotal) : items.reduce((sum, item) => sum + item.subtotal, 0)
      const tax = payload.tax != null ? Number(payload.tax) : 0
      const total = payload.total != null ? Number(payload.total) : subtotal + tax

      const customer = payload.customer ?? payload.customerSnapshot?.name ?? 'Pelanggan Laundry'
      const customerId = payload.customerId ?? null
      let customerSnapshot = normalizeCustomerSnapshot(payload.customerSnapshot)
      if (!customerSnapshot && customer && customer !== 'Pelanggan Laundry' && !customerId) {
        customerSnapshot = { id: null, name: customer, phone: '', email: '' }
      }
      const tableNumber = payload.tableNumber ?? payload.table_number ?? null

      const order = {
        id: payload.id ?? createTransactionId(),
        orderNumber,
        invoiceNumber: orderNumber,
        customer,
        customerId,
        customerSnapshot,
        tableNumber,
        table_number: tableNumber,
        businessSnapshot: payload.businessSnapshot ? { ...payload.businessSnapshot } : null,
        status: paymentStatus,
        orderStatus: payload.orderStatus ?? 'Masuk',
        paymentStatus,
        items,
        itemCount: items.reduce((count, item) => count + item.qty, 0),
        subtotal,
        discount: Number(payload.discount ?? 0),
        promoSyncId: payload.promoSyncId ?? payload.appliedPromo?.sync_id ?? null,
        appliedPromo: payload.appliedPromo ? { ...payload.appliedPromo } : null,
        tax,
        taxEnabled: payload.taxEnabled ?? (tax > 0),
        taxRate: payload.taxRate ?? null,
        total,
        grossProfit: calculateGrossProfit(items),
        paymentMethod: payload.paymentMethod ?? (paymentStatus === 'paid' ? 'cash' : ''),
        cashReceived: payload.cashReceived ?? null,
        changeAmount: payload.changeAmount ?? null,
        paidAt: payload.paidAt ?? (isPaid ? createdAt : null),
        estimatedCompletedAt: payload.estimatedCompletedAt ?? null,
        note: payload.note ?? '',
        createdAt,
        updatedAt: payload.updatedAt ?? createdAt,
      }

      return this.addTransaction(order)
    },
    updateOrderStatus(id, status) {
      const transaction =
        this.items.find((item) => String(item.id) === String(id)) ||
        (this.lastTransaction && String(this.lastTransaction.id) === String(id) ? this.lastTransaction : null)

      if (!transaction || !ALL_ORDER_STATUSES.includes(status)) {
        return false
      }

      // Linear lifecycle constraint only applies when BOTH statuses belong strictly to laundry ORDER_LIFECYCLE
      const isLaundryLifecycle =
        ORDER_LIFECYCLE.includes(transaction.orderStatus) && ORDER_LIFECYCLE.includes(status)

      if (isLaundryLifecycle) {
        const currentIndex = ORDER_LIFECYCLE.indexOf(transaction.orderStatus)
        const targetIndex = ORDER_LIFECYCLE.indexOf(status)

        if (currentIndex !== -1 && targetIndex !== -1) {
          if (currentIndex === targetIndex) {
            return true
          }
          if (targetIndex !== currentIndex + 1) {
            return false
          }
        }
      }

      transaction.orderStatus = status
      transaction.updatedAt = new Date().toISOString()

      if (this.lastTransaction && String(this.lastTransaction.id) === String(id)) {
        this.lastTransaction.orderStatus = status
        this.lastTransaction.updatedAt = transaction.updatedAt
      }

      return true
    },
    advanceOrderStatus(id) {
      const transaction = this.items.find((item) => item.id === id)
      if (!transaction) {
        return false
      }

      const nextStatus = NEXT_ORDER_STATUS[transaction.orderStatus]
      if (!nextStatus) {
        return false
      }

      return this.updateOrderStatus(id, nextStatus)
    },
    settleLaundryOrderPayment({
      orderId,
      paymentMethod = 'cash',
      cashReceived = null,
      changeAmount = null,
      cashStore = null,
    }) {
      const order = this.items.find((item) => item.id === orderId)
      if (!order) {
        return { success: false, error: 'Order tidak ditemukan' }
      }

      if (order.paymentStatus === 'paid') {
        return { success: true, order, transaction: order, duplicated: true }
      }

      const method = (paymentMethod || 'cash').toLowerCase()

      if (method === 'cash') {
        const received = cashReceived != null ? Number(cashReceived) : order.total
        if (Number.isNaN(received) || received < order.total) {
          return { success: false, error: 'Uang diterima kurang dari total pembayaran.' }
        }

        const calculatedChange = changeAmount != null
          ? Number(changeAmount)
          : Math.max(0, received - order.total)

        const activeCashStore = cashStore || useCashStore()
        if (!activeCashStore || typeof activeCashStore.recordSalePayment !== 'function') {
          return { success: false, error: 'Cash store tidak tersedia untuk mencatat pembayaran tunai.' }
        }

        const cashResult = activeCashStore.recordSalePayment({
          id: order.id,
          total: order.total,
          paymentMethod: 'cash',
          invoiceNumber: order.orderNumber || order.invoiceNumber || order.id,
          createdAt: new Date().toISOString(),
        })

        if (!cashResult || cashResult.success === false) {
          return {
            success: false,
            error: cashResult?.error || 'Gagal mencatat kas masuk untuk pembayaran tunai.',
          }
        }

        const paymentTimestamp = new Date().toISOString()
        order.paymentStatus = 'paid'
        order.status = 'paid'
        order.paymentMethod = 'cash'
        order.cashReceived = received
        order.changeAmount = calculatedChange
        order.paidAt = order.paidAt ?? paymentTimestamp
        order.updatedAt = paymentTimestamp

        if (this.lastTransaction?.id === order.id) {
          this.lastTransaction = order
        }

        return { success: true, order, transaction: order, duplicated: false }
      }

      const paymentTimestamp = new Date().toISOString()
      order.paymentStatus = 'paid'
      order.status = 'paid'
      order.paymentMethod = method
      order.cashReceived = null
      order.changeAmount = null
      order.paidAt = order.paidAt ?? paymentTimestamp
      order.updatedAt = paymentTimestamp

      if (this.lastTransaction?.id === order.id) {
        this.lastTransaction = order
      }

      return { success: true, order, transaction: order, duplicated: false }
    },
    payLaundryOrder(id, paymentPayload = {}) {
      return this.settleLaundryOrderPayment({
        orderId: id,
        paymentMethod: paymentPayload.paymentMethod ?? 'cash',
        cashReceived: paymentPayload.cashReceived ?? null,
        changeAmount: paymentPayload.changeAmount ?? null,
        cashStore: paymentPayload.cashStore ?? null,
      })
    },
    settleTransactionPayment({
      transactionId,
      paymentMethod = 'cash',
      cashReceived = null,
      changeAmount = null,
      cashStore = null,
    }) {
      const transaction = this.items.find((item) => String(item.id) === String(transactionId))
      if (!transaction) {
        return { success: false, error: 'Transaksi tidak ditemukan' }
      }

      if (transaction.paymentStatus === 'paid' && transaction.status === 'paid') {
        return { success: true, transaction, duplicated: true }
      }

      const method = (paymentMethod || 'cash').toLowerCase()
      const isCash = isCashPaymentMethod(method)

      if (isCash) {
        const received = cashReceived != null ? Number(cashReceived) : transaction.total
        if (Number.isNaN(received) || received < transaction.total) {
          return { success: false, error: 'Uang diterima kurang dari total tagihan.' }
        }
        const calcChange = changeAmount != null ? Number(changeAmount) : Math.max(0, received - transaction.total)

        const activeCashStore = cashStore || useCashStore()
        if (activeCashStore && typeof activeCashStore.recordSalePayment === 'function') {
          activeCashStore.recordSalePayment({
            id: transaction.id,
            total: transaction.total,
            paymentMethod: method,
            invoiceNumber: transaction.invoiceNumber,
            paidAt: new Date().toISOString(),
          })
        }

        const now = new Date().toISOString()
        transaction.paymentStatus = 'paid'
        transaction.status = 'paid'
        transaction.orderStatus = 'Siap'
        transaction.paymentMethod = method
        transaction.pay_later = false
        transaction.payLater = false
        transaction.cashReceived = received
        transaction.changeAmount = calcChange
        transaction.paidAt = transaction.paidAt || now
        transaction.updatedAt = now

        if (this.lastTransaction?.id === transaction.id) {
          this.lastTransaction = transaction
        }

        return { success: true, transaction, duplicated: false }
      }

      const now = new Date().toISOString()
      transaction.paymentStatus = 'paid'
      transaction.status = 'paid'
      transaction.orderStatus = 'Siap'
      transaction.paymentMethod = method
      transaction.pay_later = false
      transaction.payLater = false
      transaction.cashReceived = null
      transaction.changeAmount = null
      transaction.paidAt = transaction.paidAt || now
      transaction.updatedAt = now

      if (this.lastTransaction?.id === transaction.id) {
        this.lastTransaction = transaction
      }

      return { success: true, transaction, duplicated: false }
    },
    updateTransactionItems({
      transactionId,
      items = [],
      productStore = null,
      cashStore = null,
      discount = null,
      appliedPromo = undefined,
      tax = null,
      total = null,
      tableNumber = undefined,
      customerName = undefined,
      customerSnapshot = undefined,
    }) {
      const transaction = this.items.find((item) => String(item.id) === String(transactionId))
      if (!transaction) {
        return { success: false, error: 'Transaksi tidak ditemukan' }
      }

      const oldItems = transaction.items || []
      const newItems = items.map(normalizeTransactionItem)

      if (productStore && typeof productStore.adjustStock === 'function') {
        const oldQtyMap = new Map()
        for (const it of oldItems) {
          const pid = it.productId ?? it.id
          if (pid) {
            oldQtyMap.set(pid, (oldQtyMap.get(pid) || 0) + Number(it.qty || 1))
          }
        }

        const newQtyMap = new Map()
        for (const it of newItems) {
          const pid = it.productId ?? it.id
          if (pid) {
            newQtyMap.set(pid, (newQtyMap.get(pid) || 0) + Number(it.qty || 1))
          }
        }

        const allProductIds = new Set([...oldQtyMap.keys(), ...newQtyMap.keys()])
        for (const pid of allProductIds) {
          const oldQty = oldQtyMap.get(pid) || 0
          const newQty = newQtyMap.get(pid) || 0
          const diff = oldQty - newQty
          if (diff !== 0) {
            productStore.adjustStock(pid, {
              quantityChange: diff,
              type: 'adjustment',
              referenceId: transaction.id,
              transactionId: transaction.id,
              category: 'Penyesuaian Item',
              note: `Penyesuaian item transaksi ${transaction.invoiceNumber || transaction.id}`,
            })
          }
        }
      }

      const subtotal = newItems.reduce((sum, it) => sum + (Number(it.subtotal) || (Number(it.price) * Number(it.qty))), 0)
      const taxRate = transaction.taxRate || 0
      const calculatedTax = transaction.taxEnabled && taxRate > 0 ? Math.round((subtotal * taxRate) / 100) : (transaction.tax || 0)
      const finalTax = tax !== null ? Number(tax) : calculatedTax
      const finalDiscount = discount !== null ? Number(discount) : Number(transaction.discount || 0)
      const finalTotal = total !== null ? Number(total) : Math.max(0, subtotal - finalDiscount + finalTax)
      const itemCount = newItems.reduce((sum, it) => sum + Number(it.qty || 0), 0)
      const grossProfit = calculateGrossProfit(newItems)

      transaction.items = newItems
      transaction.itemCount = itemCount
      transaction.subtotal = subtotal
      transaction.discount = finalDiscount
      transaction.tax = finalTax
      transaction.total = finalTotal
      transaction.grossProfit = grossProfit
      transaction.updatedAt = new Date().toISOString()

      if (appliedPromo !== undefined) {
        transaction.appliedPromo = appliedPromo
        transaction.promoSyncId = appliedPromo?.sync_id ?? appliedPromo?.id ?? null
      }
      if (tableNumber !== undefined && tableNumber !== null) {
        transaction.tableNumber = tableNumber
        transaction.table_number = tableNumber
      }
      if (customerName !== undefined && customerName) {
        transaction.customer = customerName
      }
      if (customerSnapshot !== undefined && customerSnapshot) {
        transaction.customerSnapshot = customerSnapshot
      }

      if (this.lastTransaction?.id === transactionId) {
        this.lastTransaction = transaction
      }

      return { success: true, transaction }
    },
    updateTransactionPayment({
      transactionId,
      orderStatus = null,
      paymentStatus = null,
      paymentMethod = null,
      cashReceived = null,
      changeAmount = null,
      cashStore = null,
      productStore = null,
    }) {
      const transaction = this.items.find((item) => String(item.id) === String(transactionId))
      if (!transaction) {
        return { success: false, error: 'Transaksi tidak ditemukan' }
      }

      const now = new Date().toISOString()

      if (orderStatus && ['Proses', 'Siap', 'Batal'].includes(orderStatus)) {
        if (orderStatus === 'Batal' && transaction.orderStatus !== 'Batal') {
          if (productStore && typeof productStore.adjustStock === 'function') {
            for (const it of transaction.items || []) {
              const pid = it.productId ?? it.id
              if (pid) {
                productStore.adjustStock(pid, {
                  quantityChange: Number(it.qty || 1),
                  type: 'adjustment',
                  referenceId: transaction.id,
                  transactionId: transaction.id,
                  category: 'Pembatalan',
                  note: `Pembatalan pesanan ${transaction.invoiceNumber || transaction.id}`,
                })
              }
            }
          }
        }
        transaction.orderStatus = orderStatus
      }

      const oldPaymentStatus = String(transaction.paymentStatus || transaction.status || 'paid').toLowerCase()
      const oldPaymentMethod = String(transaction.paymentMethod || 'cash').toLowerCase()
      const isOldCash = isCashPaymentMethod(oldPaymentMethod)

      const targetStatus = (paymentStatus || oldPaymentStatus).toLowerCase()
      const targetMethod = (paymentMethod || oldPaymentMethod).toLowerCase()
      const isTargetCash = isCashPaymentMethod(targetMethod)

      if (targetStatus === 'unpaid') {
        transaction.paymentStatus = 'unpaid'
        transaction.status = 'unpaid'
        transaction.paymentMethod = targetMethod === 'cash' ? 'unpaid' : targetMethod
        transaction.pay_later = true
        transaction.payLater = true
        transaction.cashReceived = 0
        transaction.changeAmount = 0
        transaction.paidAt = null
      } else if (targetStatus === 'refund' || targetStatus === 'refunded') {
        transaction.paymentStatus = 'refund'
        transaction.status = 'refunded'
        transaction.pay_later = false
        transaction.payLater = false

        if (oldPaymentStatus === 'paid' && isOldCash && cashStore && typeof cashStore.recordEntry === 'function') {
          cashStore.recordEntry({
            type: 'out',
            amount: transaction.total,
            category: 'Refund Penjualan',
            note: `Refund transaksi ${transaction.invoiceNumber || transaction.id}`,
            referenceId: `refund-${transaction.id}-${Date.now()}`,
            transactionId: transaction.id,
          })
        }
      } else if (targetStatus === 'paid') {
        transaction.paymentStatus = 'paid'
        transaction.status = 'paid'
        transaction.pay_later = false
        transaction.payLater = false
        transaction.paidAt = transaction.paidAt || now

        if (isTargetCash) {
          const received = cashReceived != null ? Number(cashReceived) : transaction.total
          if (Number.isNaN(received) || received < transaction.total) {
            return { success: false, error: 'Uang diterima kurang dari total pembayaran.' }
          }
          const calcChange = changeAmount != null ? Number(changeAmount) : Math.max(0, received - transaction.total)

          if ((oldPaymentStatus !== 'paid' || !isOldCash) && cashStore && typeof cashStore.recordSalePayment === 'function') {
            cashStore.recordSalePayment({
              id: transaction.id,
              total: transaction.total,
              paymentMethod: targetMethod,
              invoiceNumber: transaction.invoiceNumber,
              paidAt: now,
            })
          }

          transaction.paymentMethod = targetMethod
          transaction.cashReceived = received
          transaction.changeAmount = calcChange
        } else {
          if (oldPaymentStatus === 'paid' && isOldCash && cashStore && typeof cashStore.recordEntry === 'function') {
            cashStore.recordEntry({
              type: 'out',
              amount: transaction.total,
              category: 'Penyesuaian Non-Tunai',
              note: `Peralihan dari Tunai ke ${targetMethod.toUpperCase()} (${transaction.invoiceNumber || transaction.id})`,
              referenceId: `cash-adj-${transaction.id}-${Date.now()}`,
              transactionId: transaction.id,
            })
          }

          transaction.paymentMethod = targetMethod
          transaction.cashReceived = null
          transaction.changeAmount = null
        }
      }

      transaction.updatedAt = now

      if (this.lastTransaction?.id === transactionId) {
        this.lastTransaction = transaction
      }

      return { success: true, transaction }
    },
    updatePaymentMethod(transactionId, newPaymentMethod) {
      const transaction = this.items.find((item) => String(item.id) === String(transactionId))
      if (!transaction) {
        return { success: false, error: 'Transaksi tidak ditemukan' }
      }

      const oldMethod = String(transaction.paymentMethod || 'cash').toLowerCase()
      const targetMethod = String(newPaymentMethod || 'cash').toLowerCase()
      const isPaid = isPaidTransaction(transaction)
      const isOldCash = isCashPaymentMethod(oldMethod)
      const isTargetCash = isCashPaymentMethod(targetMethod)
      const now = new Date().toISOString()

      let activeCashStore = null
      try {
        activeCashStore = useCashStore()
      } catch {
        activeCashStore = null
      }

      if (isPaid && isOldCash !== isTargetCash) {
        if (isOldCash) {
          if (activeCashStore && typeof activeCashStore.recordEntry === 'function') {
            activeCashStore.recordEntry({
              type: 'out',
              amount: transaction.total,
              category: 'Penyesuaian Non-Tunai',
              note: `Peralihan dari Tunai ke ${targetMethod.toUpperCase()} (${transaction.invoiceNumber || transaction.id})`,
              referenceId: `cash-adj-${transaction.id}-${Date.now()}`,
              transactionId: transaction.id,
            })
          }
          transaction.cashReceived = null
          transaction.changeAmount = null
        } else if (isTargetCash) {
          if (activeCashStore && typeof activeCashStore.recordSalePayment === 'function') {
            activeCashStore.recordSalePayment({
              id: transaction.id,
              total: transaction.total,
              paymentMethod: targetMethod,
              invoiceNumber: transaction.invoiceNumber,
              paidAt: transaction.paidAt || now,
            })
          }
          transaction.cashReceived = transaction.total
          transaction.changeAmount = 0
        }
      }

      transaction.paymentMethod = targetMethod
      transaction.updatedAt = now

      if (this.lastTransaction?.id === transactionId) {
        this.lastTransaction = transaction
      }

      return { success: true, transaction }
    },
    voidTransaction(transactionId, reason = '') {
      const transaction = this.items.find((item) => String(item.id) === String(transactionId))
      if (!transaction) {
        return { success: false, error: 'Transaksi tidak ditemukan' }
      }
      if (transaction.status === 'cancelled' || transaction.status === 'batal' || transaction.status === 'void') {
        return { success: false, error: 'Transaksi sudah dibatalkan' }
      }

      const now = new Date().toISOString()
      const oldMethod = String(transaction.paymentMethod || 'cash').toLowerCase()
      const isPaid = isPaidTransaction(transaction)

      transaction.status = 'cancelled'
      transaction.paymentStatus = 'cancelled'
      transaction.orderStatus = 'Batal'
      transaction.voidReason = String(reason || '').trim()
      transaction.cancelledAt = now
      transaction.updatedAt = now

      let activeProductStore = null
      try {
        activeProductStore = useProductStore()
      } catch {
        activeProductStore = null
      }
      if (activeProductStore && typeof activeProductStore.adjustStock === 'function') {
        for (const it of transaction.items || []) {
          const pid = it.productId ?? it.id
          if (pid) {
            activeProductStore.adjustStock(pid, {
              quantityChange: Number(it.qty || 1),
              type: 'adjustment',
              referenceId: transaction.id,
              transactionId: transaction.id,
              category: 'Pembatalan (Void)',
              note: `Void transaksi ${transaction.invoiceNumber || transaction.id}${reason ? ': ' + reason : ''}`,
            })
          }
        }
      }

      let activeCashStore = null
      try {
        activeCashStore = useCashStore()
      } catch {
        activeCashStore = null
      }
      if (isPaid && isCashPaymentMethod(oldMethod) && activeCashStore && typeof activeCashStore.recordEntry === 'function') {
        activeCashStore.recordEntry({
          type: 'out',
          amount: transaction.total,
          category: 'Void Penjualan',
          note: `Void transaksi ${transaction.invoiceNumber || transaction.id}${reason ? ': ' + reason : ''}`,
          referenceId: `void-${transaction.id}-${Date.now()}`,
          transactionId: transaction.id,
        })
      }

      if (this.lastTransaction?.id === transactionId) {
        this.lastTransaction = transaction
      }

      return { success: true, transaction }
    },
    clearLastTransaction() {
      this.lastTransaction = null
    },
    resetUiFilters() {
      this.uiFilters = createDefaultUiFilters()
    },
  },
})
