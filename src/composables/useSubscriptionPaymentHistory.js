import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { getToken } from '@/services/cloud/tokenRepository'
import {
  cancelSubscriptionPayment,
  listSubscriptionPayments,
} from '@/services/premium/subscriptionCheckoutService'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { usePremiumCheckoutStore } from '@/stores/premiumCheckoutStore'

export function useSubscriptionPaymentHistory() {
  const cloud = useCloudSessionStore()
  const checkout = usePremiumCheckoutStore()
  const history = ref([])
  const historyLoading = ref(false)
  const historyError = ref('')
  const cancellationError = ref('')
  const cancellingId = ref(null)
  const offline = ref(typeof navigator !== 'undefined' && navigator.onLine === false)
  const updateConnection = () => {
    offline.value = navigator.onLine === false
  }
  const scope = computed(
    () =>
      `${cloud.user?.id ?? ''}:${cloud.selectedBusiness?.id ?? ''}:${cloud.isAuthenticated}:${cloud.isLinked}`,
  )
  let epoch = 0
  let loadId = 0
  let disposed = false
  const current = (version) => !disposed && version === epoch
  const available = () =>
    cloud.isAuthenticated && cloud.isLinked && cloud.selectedBusiness?.id != null

  async function loadPaymentHistory() {
    const version = epoch
    const requestId = ++loadId
    const businessId = cloud.selectedBusiness?.id
    if (!available()) {
      history.value = []
      return { ok: false, code: 'NO_LINKED_BUSINESS' }
    }
    historyLoading.value = true
    historyError.value = ''
    try {
      const token = await getToken().catch(() => null)
      if (!current(version) || requestId !== loadId) return { ok: false, code: 'STALE' }
      const result = token
        ? await listSubscriptionPayments({ token, businessId })
        : { ok: false, code: 'UNAUTHENTICATED' }
      if (!current(version) || requestId !== loadId) return { ok: false, code: 'STALE' }
      if (result.ok) history.value = result.payments.slice(0, 20)
      else {
        history.value = []
        historyError.value =
          result.code === 'UNAUTHENTICATED'
            ? 'Sesi Cloud tidak valid. Silakan masuk kembali.'
            : Number(result.status) === 403
              ? 'Akses riwayat pembayaran ditolak.'
              : result.code === 'NETWORK_ERROR'
                ? 'Status belum diperiksa ulang.'
                : 'Riwayat pembayaran tidak dapat dimuat.'
        if (result.code === 'UNAUTHENTICATED') await cloud.invalidateCloudSession()
      }
      return result
    } finally {
      if (current(version) && requestId === loadId) historyLoading.value = false
    }
  }

  async function cancelPayment(payment) {
    if (
      offline.value ||
      cancellingId.value !== null ||
      payment.status !== 'pending' ||
      !payment.canCancel ||
      !available()
    )
      return { ok: false }
    const version = epoch
    const businessId = cloud.selectedBusiness.id
    cancellingId.value = payment.id
    cancellationError.value = ''
    try {
      const token = await getToken().catch(() => null)
      if (!current(version)) return { ok: false }
      const result = token
        ? await cancelSubscriptionPayment({ token, paymentId: payment.id })
        : { ok: false, code: 'UNAUTHENTICATED' }
      if (!current(version)) return { ok: false }
      if (result.ok) {
        history.value = history.value.map((item) =>
          String(item.id) === String(payment.id) ? result.payment : item,
        )
        await checkout.acceptHistoryPayment(result.payment, businessId)
      } else {
        cancellationError.value =
          result.code === 'PAYMENT_NOT_PENDING'
            ? 'Status transaksi sudah berubah. Transaksi ini tidak dapat dibatalkan.'
            : result.code === 'UNAUTHENTICATED'
              ? 'Sesi Cloud tidak valid. Silakan masuk kembali.'
              : result.status === 403
                ? 'Anda tidak memiliki izin untuk membatalkan pembayaran.'
                : 'Pembatalan belum dikonfirmasi. Perbarui status lalu coba lagi.'
        if (result.code === 'UNAUTHENTICATED') await cloud.invalidateCloudSession()
      }
      if (current(version)) await loadPaymentHistory()
      // A paid/cancel race must also refresh the active checkout and subscription.
      if (current(version) && !result.ok && result.code === 'PAYMENT_NOT_PENDING') {
        await checkout.refreshStatus()
        if (current(version)) await cloud.refreshContext()
      }
      return result
    } finally {
      if (current(version)) cancellingId.value = null
    }
  }

  watch(
    scope,
    () => {
      epoch += 1
      history.value = []
      historyError.value = ''
      cancellationError.value = ''
      historyLoading.value = false
      cancellingId.value = null
      void loadPaymentHistory()
    },
    { flush: 'sync' },
  )
  onMounted(() => {
    window.addEventListener('online', updateConnection)
    window.addEventListener('offline', updateConnection)
  })
  onBeforeUnmount(() => {
    disposed = true
    epoch += 1
    window.removeEventListener('online', updateConnection)
    window.removeEventListener('offline', updateConnection)
  })
  return {
    history,
    historyLoading,
    historyError,
    cancellationError,
    cancellingId,
    offline,
    loadPaymentHistory,
    cancelPayment,
  }
}
