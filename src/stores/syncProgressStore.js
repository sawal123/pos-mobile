import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

export const useSyncProgressStore = defineStore('syncProgress', () => {
  const isOpen = ref(false)
  const title = ref('Sinkronisasi Data')
  const description = ref('Sedang memproses sinkronisasi data dengan server...')
  const progress = ref(0) // 0 to 100
  const status = ref('idle') // 'idle' | 'running' | 'success' | 'error'
  const operationType = ref('sync') // 'sync' | 'pull' | 'reload'
  const errorMessage = ref('')
  let _timer = null

  const isRunning = computed(() => isOpen.value && status.value === 'running')

  function start({ type = 'sync', title: customTitle, description: customDesc } = {}) {
    operationType.value = type
    isOpen.value = true
    status.value = 'running'
    progress.value = 8
    errorMessage.value = ''

    if (customTitle) {
      title.value = customTitle
    } else if (type === 'pull') {
      title.value = 'Menarik Data Cloud'
    } else if (type === 'reload') {
      title.value = 'Memuat Ulang Data Cloud'
    } else {
      title.value = 'Sinkronisasi Data'
    }

    if (customDesc) {
      description.value = customDesc
    } else if (type === 'pull') {
      description.value = 'Sedang mengunduh dan menyelaraskan katalog data dari cloud...'
    } else if (type === 'reload') {
      description.value = 'Sedang menyiapkan cadangan lokal dan memuat ulang data dari cloud...'
    } else {
      description.value =
        'Sedang mengirim antrean transaksi dan menyinkronkan data dengan server...'
    }

    if (_timer) clearInterval(_timer)

    // Smoothly increment progress up to 22% while connecting / waiting for real progress
    _timer = setInterval(() => {
      if (progress.value < 22) {
        const step = Math.floor(Math.random() * 3) + 1
        progress.value = Math.min(22, progress.value + step)
      }
    }, 300)
  }

  function setProgress(val, message) {
    progress.value = Math.min(100, Math.max(0, val))
    if (message) description.value = message
  }

  async function finishSuccess(message) {
    if (_timer) clearInterval(_timer)
    progress.value = 100
    status.value = 'success'
    if (message) {
      description.value = message
    } else if (operationType.value === 'pull') {
      description.value = 'Data Cloud berhasil ditarik dan disimpan di SQLite!'
    } else if (operationType.value === 'reload') {
      description.value = 'Data Cloud berhasil dimuat ulang dan diselaraskan!'
    } else {
      description.value = 'Sinkronisasi data berhasil diselesaikan!'
    }

    // Keep visible briefly so user sees the 100% completion state
    await new Promise((resolve) => setTimeout(resolve, 850))
    isOpen.value = false
    status.value = 'idle'
  }

  function finishError(error = 'Gagal memproses sinkronisasi') {
    if (_timer) clearInterval(_timer)
    status.value = 'error'
    errorMessage.value = error
    description.value = error
  }

  function close() {
    if (_timer) clearInterval(_timer)
    isOpen.value = false
    status.value = 'idle'
    progress.value = 0
    errorMessage.value = ''
  }

  /**
   * Helper that wraps any async sync/pull/reload operation with the progress modal!
   */
  async function runWithProgress({ type = 'sync', title, description }, asyncFn) {
    start({ type, title, description })
    try {
      const result = await asyncFn((p, msg) => setProgress(p, msg))
      if (result && result.ok === false) {
        finishError(result.message || 'Operasi sinkronisasi gagal.')
        return result
      }
      await finishSuccess()
      return result
    } catch (err) {
      finishError(err?.message || 'Terjadi kesalahan sistem saat sinkronisasi.')
      throw err
    }
  }

  return {
    isOpen,
    title,
    description,
    progress,
    status,
    operationType,
    errorMessage,
    isRunning,
    start,
    setProgress,
    finishSuccess,
    finishError,
    close,
    runWithProgress,
  }
})
