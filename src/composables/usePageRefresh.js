import { inject, onMounted, onUnmounted } from 'vue'

export const PAGE_REFRESH_KEY = Symbol('pageRefresh')

/**
 * Composable allowing any view component to register a custom refresh handler
 * with the AppLayout pull-to-refresh mechanism.
 *
 * @param {() => Promise<any> | any} handler - Async or sync function called when user pulls to refresh
 */
export function usePageRefresh(handler) {
  const registerHandler = inject(PAGE_REFRESH_KEY, null)
  if (registerHandler && typeof handler === 'function') {
    onMounted(() => {
      registerHandler(handler)
    })
    onUnmounted(() => {
      registerHandler(null)
    })
  }
}
