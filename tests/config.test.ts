import assert from 'node:assert/strict'
import { describe, test } from 'bun:test'
import {
  getConfig,
  initializeLocale,
  validateBooleanConfig,
  validateSpatialFrame,
  validateSpatialGeometry,
  validateSpatialPredicate,
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

  test('reads spatial controls from env', () => {
    const originalFrame = process.env.SPATIAL_FRAME
    const originalPredicate = process.env.SPATIAL_PREDICATE
    const originalGeometry = process.env.SPATIAL_GEOMETRY
    process.env.SPATIAL_FRAME = 'bbox'
    process.env.SPATIAL_PREDICATE = 'within'
    process.env.SPATIAL_GEOMETRY = 'clip-all'

    try {
      const config = getConfig()

      assert.equal(config.spatialFrame, 'bbox')
      assert.equal(config.spatialPredicate, 'within')
      assert.equal(config.spatialGeometry, 'clip-all')
    } finally {
      if (originalFrame === undefined) {
        delete process.env.SPATIAL_FRAME
      } else {
        process.env.SPATIAL_FRAME = originalFrame
      }

      if (originalPredicate === undefined) {
        delete process.env.SPATIAL_PREDICATE
      } else {
        process.env.SPATIAL_PREDICATE = originalPredicate
      }

      if (originalGeometry === undefined) {
        delete process.env.SPATIAL_GEOMETRY
      } else {
        process.env.SPATIAL_GEOMETRY = originalGeometry
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

describe('spatial validators', () => {
  test('accept supported spatial values', () => {
    assert.equal(validateSpatialFrame('bbox'), 'bbox')
    assert.equal(validateSpatialPredicate('within'), 'within')
    assert.equal(validateSpatialGeometry('clip-all'), 'clip-all')
  })

  test('fall back to defaults when values are omitted', () => {
    assert.equal(validateSpatialFrame(undefined), 'division')
    assert.equal(validateSpatialPredicate(undefined), 'intersects')
    assert.equal(validateSpatialGeometry(undefined), 'clip-smart')
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
