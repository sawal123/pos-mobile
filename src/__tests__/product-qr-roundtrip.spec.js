// @vitest-environment node
import { describe, expect, it } from 'vitest'
import QRCode from 'qrcode'
import {
  BinaryBitmap,
  HybridBinarizer,
  MultiFormatReader,
  RGBLuminanceSource,
} from '@zxing/library'

describe('bundled QR encoder and decoder interoperability', () => {
  it.each(['0012345678905', 'NXP-b2869d5a-0c84-4d41-9229-795a1e6b8a3c', 'SKU-Abc-01'])(
    'round-trips %s without a server or downloaded model',
    (code) => {
      const qr = QRCode.create(code, { errorCorrectionLevel: 'M' })
      const scale = 6
      const margin = 4
      const size = (qr.modules.size + margin * 2) * scale
      const luminance = new Uint8ClampedArray(size * size).fill(255)
      for (let y = 0; y < qr.modules.size; y++) {
        for (let x = 0; x < qr.modules.size; x++) {
          if (!qr.modules.get(y, x)) continue
          for (let dy = 0; dy < scale; dy++) {
            for (let dx = 0; dx < scale; dx++) {
              luminance[((y + margin) * scale + dy) * size + (x + margin) * scale + dx] = 0
            }
          }
        }
      }
      const reader = new MultiFormatReader()
      const bitmap = new BinaryBitmap(
        new HybridBinarizer(new RGBLuminanceSource(luminance, size, size)),
      )
      expect(reader.decode(bitmap).getText()).toBe(code)
      reader.reset()
    },
  )
})
