// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { DB_VERSION } from '@/services/database/schema'

// Static guard for the Android release configuration: version wiring, package
// continuity, database version and signing-secret hygiene. None of it is
// reachable from a runtime test, so the files are asserted directly.
const read = (relativePath) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')

const packageJson = JSON.parse(read('../../package.json'))
const packageLock = JSON.parse(read('../../package-lock.json'))
const capacitorConfig = JSON.parse(read('../../capacitor.config.json'))
const appBuildGradle = read('../../android/app/build.gradle')
const androidGitignore = read('../../android/.gitignore')
const keystoreExample = read('../../android/keystore.properties.example')

const RELEASE_VERSION_NAME = '1.0.0'
const RELEASE_VERSION_CODE = 10000
const APPLICATION_ID = 'com.posoffline.app'

// Source selection lives between the header comment and the android block.
const signingSection = appBuildGradle.slice(
  appBuildGradle.indexOf('// Release signing configuration'),
  appBuildGradle.indexOf('android {'),
)

function sliceDeclaration(source, marker) {
  const start = source.indexOf(marker)

  if (start === -1) {
    return ''
  }

  const end = source.indexOf('\n]', start)

  return end === -1 ? source.slice(start) : source.slice(start, end + 2)
}

const envSigningBlock = sliceDeclaration(signingSection, 'def envReleaseSigning')
const propertySigningBlock = sliceDeclaration(signingSection, 'def propertyReleaseSigning')

describe('P35 Android release configuration', () => {
  it('package.json dan package-lock.json sepakat pada versi rilis', () => {
    expect(packageJson.version).toBe(RELEASE_VERSION_NAME)
    expect(packageLock.version).toBe(RELEASE_VERSION_NAME)
    expect(packageLock.packages[''].version).toBe(RELEASE_VERSION_NAME)
  })

  it('versionName/versionCode Android mengikuti policy versi', () => {
    // Anti-vacuum: the Gradle file and the version entries must really be there.
    expect(appBuildGradle.length).toBeGreaterThan(1000)
    expect(appBuildGradle).toContain(`versionName "${RELEASE_VERSION_NAME}"`)
    expect(appBuildGradle).toContain(`versionCode ${RELEASE_VERSION_CODE}`)

    const [major, minor, patch] = RELEASE_VERSION_NAME.split('.').map(Number)

    expect(RELEASE_VERSION_CODE).toBe(major * 10000 + minor * 100 + patch)
  })

  it('applicationId dan Capacitor appId tetap com.posoffline.app', () => {
    expect(appBuildGradle).toContain(`applicationId "${APPLICATION_ID}"`)
    expect(capacitorConfig.appId).toBe(APPLICATION_ID)
  })

  it('DB_VERSION tetap 4', () => {
    expect(DB_VERSION).toBe(4)
  })

  it('kredensial signing hanya dibaca dari env var atau keystore.properties', () => {
    expect(appBuildGradle).toContain("System.getenv('POS_RELEASE_STORE_PASSWORD')")
    expect(appBuildGradle).toContain("rootProject.file('keystore.properties')")
    expect(appBuildGradle).toMatch(/rootProject\.file\(releaseSigningValues\.storeFile\)/)

    expect(appBuildGradle).not.toMatch(/storePassword\s+["'][^"']+["']/)
    expect(appBuildGradle).not.toMatch(/keyPassword\s+["'][^"']+["']/)
  })

  it('keystore.properties.example hanya berisi placeholder', () => {
    expect(keystoreExample).toContain('storeFile=signing/pos-mobile-release.jks')
    expect(keystoreExample).toContain('storePassword=CHANGE_ME')
    expect(keystoreExample).toContain('keyAlias=CHANGE_ME')
    expect(keystoreExample).toContain('keyPassword=CHANGE_ME')

    expect(keystoreExample).not.toMatch(/storePassword=(?!CHANGE_ME)\S+/)
    expect(keystoreExample).not.toMatch(/keyPassword=(?!CHANGE_ME)\S+/)
  })

  it('env dan properties adalah dua source terpisah tanpa fallback per-key', () => {
    // Anti-vacuum: both source declarations must really exist.
    expect(envSigningBlock).toContain('POS_RELEASE_STORE_PASSWORD')
    expect(propertySigningBlock.length).toBeGreaterThan(100)

    // Each source is built only from itself: env never reads the properties file.
    expect(envSigningBlock).not.toContain('keystoreProperties')
    expect(envSigningBlock).not.toContain('getProperty')

    // The properties source reads all four keys from keystore.properties and
    // never from the environment.
    for (const key of ['storeFile', 'storePassword', 'keyAlias', 'keyPassword']) {
      expect(propertySigningBlock).toContain(`keystoreProperties.getProperty('${key}')`)
    }

    expect(propertySigningBlock).not.toContain('envReleaseSigning')
    expect(propertySigningBlock).not.toContain('System.getenv')

    // The old per-key env -> property fallback must never come back.
    expect(signingSection).not.toMatch(/value\s*=\s*envReleaseSigning\[key\]/)
    expect(signingSection).not.toMatch(/value\s*=\s*keystoreProperties\.getProperty\(key\)/)
    expect(signingSection).not.toMatch(/releaseSigningValues\[key\]/)
  })

  it('menghitung hasAny/hasComplete untuk kedua source', () => {
    for (const flag of [
      'hasAnyEnvSigning',
      'hasCompleteEnvSigning',
      'hasAnyPropertySigning',
      'hasCompletePropertySigning',
    ]) {
      expect(signingSection).toContain(`def ${flag} = `)
    }

    // The selected source is a whole map, never a key-by-key mixture.
    expect(signingSection).toMatch(
      /def releaseSigningValues = hasCompleteEnvSigning[\s\S]{0,120}normalizedPropertySigning\s*:\s*null\)/,
    )
  })

  it('partial env selalu gagal dan diputuskan sebelum cabang properties', () => {
    const envGuardIndex = signingSection.indexOf('hasAnyEnvSigning && !hasCompleteEnvSigning')
    const propertyGuardIndex = signingSection.indexOf(
      '!hasAnyEnvSigning && hasAnyPropertySigning && !hasCompletePropertySigning',
    )

    expect(envGuardIndex).toBeGreaterThan(-1)
    expect(propertyGuardIndex).toBeGreaterThan(envGuardIndex)

    // The properties branch is only reachable when the environment is empty,
    // so a partial environment can never be completed from properties.
    expect(signingSection).toContain("incompleteSigningError('environment', normalizedEnvSigning)")
    expect(signingSection).toContain("incompleteSigningError('properties', normalizedPropertySigning)")
    expect(signingSection).toContain(
      'Incomplete Android release signing ${sourceLabel} configuration. Missing: ${missingKeys.join(\', \')}.',
    )

    // Two separate throws, one per source.
    expect(signingSection.match(/throw new GradleException\(incompleteSigningError\(/g)).toHaveLength(2)
  })

  it('gitignore menutup keystore/signing namun tetap meloloskan file contoh', () => {
    for (const pattern of [
      '*.jks',
      '*.keystore',
      'keystore.properties',
      'signing/',
      '!keystore.properties.example',
    ]) {
      expect(androidGitignore).toContain(pattern)
    }
  })
})
