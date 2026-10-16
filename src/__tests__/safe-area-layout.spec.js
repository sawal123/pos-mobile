import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const readProjectFile = (path) => readFileSync(resolve(projectRoot, path), 'utf8')

describe('Android safe-area layout contract', () => {
  it('uses Capacitor 8 SystemBars CSS handling with visible, dark-on-light icons', () => {
    const config = JSON.parse(readProjectFile('capacitor.config.json'))

    expect(config.plugins.SystemBars).toEqual({
      insetsHandling: 'css',
      style: 'LIGHT',
      hidden: false,
    })
  })

  it('keeps browser insets at zero and applies the top inset only to the header', () => {
    const css = readProjectFile('src/assets/css/main.css')
    const header = readProjectFile('src/components/layout/AppHeader.vue')

    expect(css).toContain('--safe-area-inset-top: 0px')
    expect(css).toContain('.safe-area-top')
    expect(css).toContain('padding-top: var(--app-safe-area-top)')
    expect(header).toContain('safe-area-top')
    expect(header).toContain('safe-area-inline')
  })

  it('preserves the existing bottom-navigation safe-area padding', () => {
    const bottomNavigation = readProjectFile('src/components/layout/BottomNavigation.vue')

    expect(bottomNavigation).toContain('env(safe-area-inset-bottom)')
  })
})
