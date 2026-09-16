// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

// Static regression guard for the native plugin lifecycle. There is no Java test
// framework in this project, so the source contract is asserted here instead.
const PLUGIN_PATH = fileURLToPath(
  new URL(
    '../../android/app/src/main/java/com/posoffline/app/BluetoothPrinterPlugin.java',
    import.meta.url,
  ),
)

const pluginSource = readFileSync(PLUGIN_PATH, 'utf8')

function extractMethod(source, signature) {
  const start = source.indexOf(signature)

  if (start === -1) {
    return ''
  }

  const rest = source.slice(start + signature.length)
  const nextMethod = rest.search(/\n {4}(?:@|private|public|static|void|int|long|boolean)/)

  return nextMethod === -1 ? rest : rest.slice(0, nextMethod)
}

const startPrintBody = extractMethod(pluginSource, 'private void startPrint(PluginCall call)')

describe('P33 BluetoothPrinterPlugin source contract', () => {
  it('printRaw tidak memakai keepAlive (one-shot call)', () => {
    // Guard against a vacuous read: the source and the extracted worker must be real.
    expect(pluginSource).toContain('class BluetoothPrinterPlugin')
    expect(pluginSource.length).toBeGreaterThan(2000)
    expect(startPrintBody.length).toBeGreaterThan(200)

    expect(pluginSource).not.toContain('setKeepAlive')
    expect(pluginSource).not.toMatch(/\.release\(/)
  })

  it('printRaw tidak memakai listener atau menyimpan PluginCall', () => {
    expect(startPrintBody).not.toContain('addListener')
    expect(startPrintBody).not.toContain('setKeepAlive')

    // No static/global PluginCall field is retained for async callbacks.
    expect(pluginSource).not.toMatch(/(?:static\s+)?PluginCall\s+\w+\s*=\s*null\s*;/)
  })

  it('settlement dijaga AtomicBoolean dan hanya lewat helper settle', () => {
    expect(pluginSource).toContain('new AtomicBoolean(false)')
    expect(pluginSource).toContain('settled.compareAndSet(false, true)')

    // The async worker must never settle the call directly.
    expect(startPrintBody).toContain('settleResolve(call, settled)')
    expect(startPrintBody).toContain('settleReject(call, settled,')
    expect(startPrintBody).not.toContain('call.resolve(')
    expect(startPrintBody).not.toContain('call.reject(')
  })

  it('semua reject memakai helper terpusat', () => {
    const rejectCalls = pluginSource.match(/call\.reject\(/g) ?? []

    expect(rejectCalls).toHaveLength(1)
    expect(pluginSource).toContain('private void reject(PluginCall call, String code)')
  })

  it('socket selalu ditutup di finally dan I/O tetap di background executor', () => {
    expect(startPrintBody).toContain('finally')
    expect(startPrintBody).toContain('closeQuietly(socket)')
    expect(startPrintBody).toContain('printExecutor.execute(')
    // connect() is never invoked on the calling (main) thread.
    expect(startPrintBody).not.toContain('socket.connect()')
  })

  it('timeout dibaca dari nilai Number mentah agar integer JS terbaca', () => {
    // PluginCall.getLong() only accepts Long, while org.json parses integral JS
    // numbers as Integer, so the raw Number must be coerced.
    expect(startPrintBody).toContain('resolveTimeoutMs(call.getData().opt("timeoutMs"))')
    expect(startPrintBody).not.toContain('call.getLong("timeoutMs")')
    expect(pluginSource).toContain('rawTimeout instanceof Number')
    expect(pluginSource).toContain('Math.min(timeoutMs, MAX_TIMEOUT_MS)')
    expect(pluginSource).toContain('DEFAULT_TIMEOUT_MS = 10000L')
    expect(pluginSource).toContain('MAX_TIMEOUT_MS = 60000L')
  })

  it('error contract dan permission tetap sesuai', () => {
    for (const code of [
      'BLUETOOTH_UNSUPPORTED',
      'BLUETOOTH_DISABLED',
      'BLUETOOTH_PERMISSION_DENIED',
      'PRINTER_NOT_PAIRED',
      'INVALID_PRINTER_ADDRESS',
      'PRINTER_CONNECT_TIMEOUT',
      'PRINTER_CONNECT_FAILED',
      'PRINTER_WRITE_FAILED',
    ]) {
      expect(pluginSource).toContain(code)
    }

    expect(pluginSource).toContain('BLUETOOTH_CONNECT')
    expect(pluginSource).not.toContain('BLUETOOTH_SCAN')
  })
})
