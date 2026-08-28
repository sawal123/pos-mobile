import { Capacitor } from '@capacitor/core'
import { Network } from '@capacitor/network'
import { App } from '@capacitor/app'

function createFailClosedSnapshot(native = false) {
  return {
    initialized: true,
    native: Boolean(native),
    online: false,
    foreground: false,
    connectionType: 'unknown',
    source: native ? 'native' : 'web',
  }
}

function createUninitializedSnapshot() {
  return {
    initialized: false,
    native: false,
    online: false,
    foreground: false,
    connectionType: 'unknown',
    source: 'unavailable',
  }
}

export function createRuntimeSignalService({
  capacitor = Capacitor,
  network = Network,
  app = App,
  windowRef = typeof window !== 'undefined' ? window : null,
  documentRef = typeof document !== 'undefined' ? document : null,
  navigatorRef = typeof navigator !== 'undefined' ? navigator : null,
} = {}) {
  let currentSnapshot = createUninitializedSnapshot()
  let isStarted = false
  let startPromise = null
  let nativeHandles = []
  let webCleaners = []
  const subscribers = new Set()

  function getSnapshot() {
    return { ...currentSnapshot }
  }

  function subscribe(callback) {
    if (typeof callback !== 'function') {
      return () => {}
    }
    subscribers.add(callback)
    return () => {
      subscribers.delete(callback)
    }
  }

  function emit(type, transition, snapshot) {
    const event = {
      type,
      transition,
      snapshot: { ...snapshot },
    }
    for (const callback of subscribers) {
      try {
        callback(event)
      } catch {
        // Isolated error handling: other subscribers must still receive the event
      }
    }
  }

  function handleNativeNetworkChange(status) {
    if (!isStarted) return
    const newConnected = status?.connected === true
    const newConnectionType =
      typeof status?.connectionType === 'string' ? status.connectionType : 'unknown'

    const prevConnected = currentSnapshot.online
    const prevConnectionType = currentSnapshot.connectionType

    let transition = null
    if (!prevConnected && newConnected) {
      transition = 'online'
    } else if (prevConnected && !newConnected) {
      transition = 'offline'
    }

    const connectionTypeChanged = prevConnectionType !== newConnectionType
    const connectedChanged = prevConnected !== newConnected

    if (connectedChanged || connectionTypeChanged) {
      currentSnapshot = {
        ...currentSnapshot,
        online: newConnected,
        connectionType: newConnectionType,
      }
      emit('network', transition, currentSnapshot)
    }
  }

  function handleNativeAppStateChange(state) {
    if (!isStarted) return
    const newForeground = state?.isActive === true
    const prevForeground = currentSnapshot.foreground

    if (prevForeground === newForeground) {
      return
    }

    const transition = newForeground ? 'resume' : 'pause'
    currentSnapshot = {
      ...currentSnapshot,
      foreground: newForeground,
    }
    emit('app-state', transition, currentSnapshot)
  }

  function handleWebOnline() {
    if (!isStarted) return
    const prevConnected = currentSnapshot.online
    if (prevConnected) return

    currentSnapshot = {
      ...currentSnapshot,
      online: true,
    }
    emit('network', 'online', currentSnapshot)
  }

  function handleWebOffline() {
    if (!isStarted) return
    const prevConnected = currentSnapshot.online
    if (!prevConnected) return

    currentSnapshot = {
      ...currentSnapshot,
      online: false,
    }
    emit('network', 'offline', currentSnapshot)
  }

  function handleWebVisibilityChange() {
    if (!isStarted) return
    const newForeground = documentRef ? documentRef.visibilityState === 'visible' : false
    const prevForeground = currentSnapshot.foreground

    if (prevForeground === newForeground) return

    const transition = newForeground ? 'resume' : 'pause'
    currentSnapshot = {
      ...currentSnapshot,
      foreground: newForeground,
    }
    emit('app-state', transition, currentSnapshot)
  }

  async function cleanupNativeHandles() {
    for (const h of nativeHandles) {
      try {
        if (h && typeof h.remove === 'function') {
          await h.remove()
        }
      } catch {
        // Ignore removal error
      }
    }
    nativeHandles = []
  }

  function cleanupWebCleaners() {
    for (const clean of webCleaners) {
      try {
        clean()
      } catch {
        // Ignore
      }
    }
    webCleaners = []
  }

  async function start() {
    if (isStarted) {
      return {
        ok: true,
        code: 'RUNTIME_SIGNAL_ALREADY_STARTED',
        snapshot: getSnapshot(),
      }
    }

    if (startPromise) {
      return startPromise
    }

    startPromise = (async () => {
      try {
        const isNative = Boolean(
          capacitor &&
            typeof capacitor.isNativePlatform === 'function' &&
            capacitor.isNativePlatform(),
        )

        if (isNative) {
          if (
            !network ||
            !app ||
            typeof network.getStatus !== 'function' ||
            typeof app.getState !== 'function' ||
            typeof network.addListener !== 'function' ||
            typeof app.addListener !== 'function'
          ) {
            currentSnapshot = createFailClosedSnapshot(true)
            isStarted = true
            return {
              ok: false,
              code: 'RUNTIME_SIGNAL_INIT_FAILED',
              snapshot: getSnapshot(),
            }
          }

          let networkStatus
          let appState

          try {
            const [netRes, appRes] = await Promise.all([
              network.getStatus(),
              app.getState(),
            ])
            networkStatus = netRes
            appState = appRes
          } catch {
            currentSnapshot = createFailClosedSnapshot(true)
            isStarted = true
            return {
              ok: false,
              code: 'RUNTIME_SIGNAL_INIT_FAILED',
              snapshot: getSnapshot(),
            }
          }

          const online = networkStatus?.connected === true
          const connectionType =
            typeof networkStatus?.connectionType === 'string'
              ? networkStatus.connectionType
              : 'unknown'
          const foreground = appState?.isActive === true

          currentSnapshot = {
            initialized: true,
            native: true,
            online,
            foreground,
            connectionType,
            source: 'native',
          }

          const handles = []
          try {
            const netHandle = await network.addListener(
              'networkStatusChange',
              (status) => {
                handleNativeNetworkChange(status)
              },
            )
            handles.push(netHandle)

            const appHandle = await app.addListener(
              'appStateChange',
              (state) => {
                handleNativeAppStateChange(state)
              },
            )
            handles.push(appHandle)
          } catch {
            for (const h of handles) {
              try {
                if (h && typeof h.remove === 'function') {
                  await h.remove()
                }
              } catch {
                // Ignore
              }
            }
            currentSnapshot = createFailClosedSnapshot(true)
            isStarted = true
            return {
              ok: false,
              code: 'RUNTIME_SIGNAL_INIT_FAILED',
              snapshot: getSnapshot(),
            }
          }

          nativeHandles = handles
          isStarted = true

          emit('initialized', null, currentSnapshot)
          return {
            ok: true,
            code: 'RUNTIME_SIGNAL_INITIALIZED',
            snapshot: getSnapshot(),
          }
        } else {
          // Web fallback path
          const online = navigatorRef ? navigatorRef.onLine === true : false
          const foreground =
            documentRef ? documentRef.visibilityState === 'visible' : false

          currentSnapshot = {
            initialized: true,
            native: false,
            online,
            foreground,
            connectionType: 'unknown',
            source: 'web',
          }

          const cleaners = []
          if (windowRef && typeof windowRef.addEventListener === 'function') {
            const onOnline = () => handleWebOnline()
            const onOffline = () => handleWebOffline()

            windowRef.addEventListener('online', onOnline)
            windowRef.addEventListener('offline', onOffline)

            cleaners.push(() => {
              windowRef.removeEventListener('online', onOnline)
              windowRef.removeEventListener('offline', onOffline)
            })
          }

          if (documentRef && typeof documentRef.addEventListener === 'function') {
            const onVisibilityChange = () => handleWebVisibilityChange()
            documentRef.addEventListener('visibilitychange', onVisibilityChange)
            cleaners.push(() => {
              documentRef.removeEventListener(
                'visibilitychange',
                onVisibilityChange,
              )
            })
          }

          webCleaners = cleaners
          isStarted = true

          emit('initialized', null, currentSnapshot)
          return {
            ok: true,
            code: 'RUNTIME_SIGNAL_INITIALIZED',
            snapshot: getSnapshot(),
          }
        }
      } finally {
        startPromise = null
      }
    })()

    return startPromise
  }

  async function stop() {
    await cleanupNativeHandles()
    cleanupWebCleaners()
    isStarted = false
    currentSnapshot = createUninitializedSnapshot()
    return {
      ok: true,
      code: 'RUNTIME_SIGNAL_STOPPED',
      snapshot: getSnapshot(),
    }
  }

  return {
    start,
    stop,
    getSnapshot,
    subscribe,
    getIsStarted: () => isStarted,
  }
}
