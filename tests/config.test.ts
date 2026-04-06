import assert from 'node:assert/strict'
import { describe, test } from 'bun:test'
import {
  getConfig,
  initializeLocale,
  validateClipMode,
  validateBooleanConfig,
  validateTargetConfig,
} from '../libs/core'
import type { CliArgs, Config } from '../libs/core'

function createConfig(overrides: Partial<Config> = {}): Config {
  return {
    locale: 'en',
    outputDir: './data',
    releaseFn: 'releases.json',
    releaseUrl: 'https://docs.overturemaps.org/release-calendar/',
    target: 'division',
    confirmFeatureSelection: true,
    ...overrides,
  }
}

function createCliArgs(overrides: Partial<CliArgs> = {}): CliArgs {
  return {
    onFileExists: 'skip',
    ...overrides,
  }
}

describe('initializeLocale', () => {
  test('prefers the CLI locale over config locale', () => {
    const result = initializeLocale(
      createConfig({ locale: 'en' }),
      createCliArgs({ locale: 'zh-hk' }),
    )

    assert.equal(result.locale, 'zh-hk')
  })

  test('falls back to config locale when CLI locale is not set', () => {
    const result = initializeLocale(createConfig({ locale: 'fr' }), createCliArgs())

    assert.equal(result.locale, 'fr')
  })
})

describe('getConfig', () => {
  test('defaults to confirming feature selection', () => {
    const originalValue = process.env.CONFIRM_FEATURE_SELECTION
    delete process.env.CONFIRM_FEATURE_SELECTION

    try {
      const config = getConfig()

      assert.equal(config.confirmFeatureSelection, true)
    } finally {
      if (originalValue === undefined) {
        delete process.env.CONFIRM_FEATURE_SELECTION
      } else {
        process.env.CONFIRM_FEATURE_SELECTION = originalValue
      }
    }
  })

  test('reads CONFIRM_FEATURE_SELECTION from env', () => {
    const originalValue = process.env.CONFIRM_FEATURE_SELECTION
    process.env.CONFIRM_FEATURE_SELECTION = 'false'

    try {
      const config = getConfig()

      assert.equal(config.confirmFeatureSelection, false)
    } finally {
      if (originalValue === undefined) {
        delete process.env.CONFIRM_FEATURE_SELECTION
      } else {
        process.env.CONFIRM_FEATURE_SELECTION = originalValue
      }
    }
  })

  test('reads CLIP_MODE and SKIP_BOUNDARY_CLIP from env', () => {
    const originalClipMode = process.env.CLIP_MODE
    const originalSkipBoundaryClip = process.env.SKIP_BOUNDARY_CLIP
    process.env.CLIP_MODE = 'smart'
    process.env.SKIP_BOUNDARY_CLIP = '1'

    try {
      const config = getConfig()

      assert.equal(config.clipMode, 'smart')
      assert.equal(config.skipBoundaryClip, true)
    } finally {
      if (originalClipMode === undefined) {
        delete process.env.CLIP_MODE
      } else {
        process.env.CLIP_MODE = originalClipMode
      }

      if (originalSkipBoundaryClip === undefined) {
        delete process.env.SKIP_BOUNDARY_CLIP
      } else {
        process.env.SKIP_BOUNDARY_CLIP = originalSkipBoundaryClip
      }
    }
  })
})

describe('validateBooleanConfig', () => {
  test('accepts true/false values', () => {
    assert.equal(validateBooleanConfig('true', 'TEST_FLAG'), true)
    assert.equal(validateBooleanConfig('false', 'TEST_FLAG'), false)
  })

  test('accepts 1/0 values', () => {
    assert.equal(validateBooleanConfig('1', 'TEST_FLAG'), true)
    assert.equal(validateBooleanConfig('0', 'TEST_FLAG'), false)
  })
})

describe('validateClipMode', () => {
  test('accepts supported clip modes', () => {
    assert.equal(validateClipMode('preserve'), 'preserve')
    assert.equal(validateClipMode('smart'), 'smart')
    assert.equal(validateClipMode('all'), 'all')
  })

  test('falls back to preserve when clip mode is omitted', () => {
    assert.equal(validateClipMode(undefined), 'preserve')
  })
})

describe('validateTargetConfig', () => {
  test('prefers division over world when a division id is present', () => {
    const result = validateTargetConfig(
      createConfig({ target: 'world', divisionId: 'division-1' }),
      createCliArgs(),
      'world',
    )

    assert.equal(result, 'division')
  })

  test('prefers bbox over world when a bbox is present', () => {
    const result = validateTargetConfig(
      createConfig({
        target: 'world',
        bbox: { xmin: 1, ymin: 2, xmax: 3, ymax: 4 },
      }),
      createCliArgs(),
      'world',
    )

    assert.equal(result, 'bbox')
  })
})
