import { defineStore } from 'pinia'
import { ref } from 'vue'

import { useBusinessStore } from '@/stores/businessStore'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { useSyncPushStore } from '@/stores/syncPushStore'
import { useSyncStatusStore } from '@/stores/syncStatusStore'

export const useNotificationStore = defineStore('notification', () => {
  const isOpen = ref(false)
  const type = ref('success')
  const title = ref('')
  const message = ref('')

  let _autoCloseTimer = null

  function clearTimer() {
    if (_autoCloseTimer) {
      clearTimeout(_autoCloseTimer)
      _autoCloseTimer = null
    }
  }

  function close() {
    clearTimer()
    isOpen.value = false
  }

  function showNotification({
    type: nextType = 'success',
    title: nextTitle = 'Berhasil',
    message: nextMessage = '',
    duration = 1800,
  } = {}) {
    clearTimer()
    type.value = nextType
    title.value = nextTitle
    message.value = nextMessage
    isOpen.value = true

    if (duration > 0 && !import.meta.env?.VITEST) {
      _autoCloseTimer = setTimeout(() => {
        isOpen.value = false
        _autoCloseTimer = null
      }, duration)
    }
  }

  /**
   * Show a clean Create/Update success modal immediately, and when the device is
   * online in Cloud mode, silently push pending local mutations in the background
   * so changes reach Cloud without triggering an offline sync prompt.
   */
  function notifySuccessAndSync({
    title: nextTitle = 'Berhasil',
    message: nextMessage = 'Data berhasil disimpan.',
    duration = 1800,
  } = {}) {
    showNotification({
      type: 'success',
      title: nextTitle,
      message: nextMessage,
      duration,
    })

    try {
      const syncPushStore = useSyncPushStore()
      void syncPushStore.pushIfOnline({ delay: 60 })
    } catch {
      // Safe no-op in isolated component tests without sync stores initialized
    }
  }

  function notifyError({ title = 'Terjadi Kesalahan', message = '', duration = 2500 } = {}) {
    showNotification({
      type: 'error',
      title,
      message,
      duration,
    })
  }

  function notifySuccess({ title = 'Berhasil', message = '', duration = 1800 } = {}) {
    showNotification({
      type: 'success',
      title,
      message,
      duration,
    })
  }

  return {
    isOpen,
    type,
    title,
    message,
    showNotification,
    notifySuccessAndSync,
    notifyError,
    notifySuccess,
    close,
  }
})
