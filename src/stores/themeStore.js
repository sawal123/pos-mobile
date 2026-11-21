import { defineStore } from 'pinia'

export const THEME_STORAGE_KEY = 'nexapos-theme'

function readStoredTheme() {
  if (typeof window === 'undefined') {
    return 'light'
  }

  try {
    const saved = window.localStorage?.getItem(THEME_STORAGE_KEY)
    if (saved === 'dark' || saved === 'light') {
      return saved
    }
  } catch {
    // Ignore storage read errors in restricted WebViews / private mode
  }

  return 'light'
}

export async function syncNativeStatusBar(isDark) {
  try {
    const { Capacitor } = await import('@capacitor/core')
    if (!Capacitor.isNativePlatform()) {
      return
    }

    const { StatusBar, Style } = await import('@capacitor/status-bar')
    // Style.Dark: light text/icons for dark status bar background
    // Style.Light: dark text/icons for light status bar background
    await StatusBar.setStyle({ style: isDark ? Style.Dark : Style.Light })
    await StatusBar.setBackgroundColor({ color: isDark ? '#111625' : '#FFFFFF' })
  } catch {
    // Non-blocking in environments without native status-bar support
  }
}

export function applyThemeClass(mode, doc = typeof document !== 'undefined' ? document : null) {
  if (!doc?.documentElement) {
    return
  }

  const isDark = mode === 'dark'
  doc.documentElement.classList.toggle('dark', isDark)
  doc.documentElement.dataset.theme = isDark ? 'dark' : 'light'
  doc.documentElement.style.colorScheme = isDark ? 'dark' : 'light'

  const metaThemeColor = doc.querySelector('meta[name="theme-color"]')
  if (metaThemeColor) {
    metaThemeColor.setAttribute('content', isDark ? '#0F131F' : '#4945D6')
  }

  void syncNativeStatusBar(isDark)
}

export const useThemeStore = defineStore('theme', {
  state: () => ({
    theme: readStoredTheme(),
  }),

  getters: {
    isDark: (state) => state.theme === 'dark',
  },

  actions: {
    setTheme(mode) {
      const normalized = mode === 'dark' ? 'dark' : 'light'
      this.theme = normalized

      if (typeof window !== 'undefined') {
        try {
          window.localStorage?.setItem(THEME_STORAGE_KEY, normalized)
        } catch {
          // Ignore storage write errors
        }
      }

      applyThemeClass(normalized)
    },

    toggleTheme() {
      this.setTheme(this.isDark ? 'light' : 'dark')
    },

    initTheme() {
      const stored = readStoredTheme()
      this.theme = stored
      applyThemeClass(stored)
    },
  },
})

