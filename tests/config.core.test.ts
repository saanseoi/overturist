import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, mock, test } from 'bun:test'
import type { CliArgs, Config, Division } from '../libs/core'

const abs = (relativePath: string) => new URL(relativePath, import.meta.url).pathname

const bailMock = mock((msg?: string) => {
  throw new Error(msg ?? 'bail')
})
const extractBoundsFromDivisionGeometryMock = mock(async () => ({
  bbox: { xmin: 1, ymin: 2, xmax: 3, ymax: 4 },
  geometry: 'division-geometry',
}))
const logState = {
  info: mock(() => {}),
  warn: mock(() => {}),
}

const ENV_KEYS = [
  'FILTER_MODE',
  'TARGET',
  'LOCALE',
  'BBOX_XMIN',
  'BBOX_YMIN',
  'BBOX_XMAX',
  'BBOX_YMAX',
  'DIVISION_ID',
  'SPATIAL_FRAME',
  'SPATIAL_PREDICATE',
  'SPATIAL_GEOMETRY',
  'FEATURE_TYPES',
  'CONFIRM_FEATURE_SELECTION',
  'ON_FILE_EXISTS',
] as const

function restoreEnv(
  snapshot: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>,
) {
  for (const key of ENV_KEYS) {
    const value = snapshot[key]
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

function createConfig(overrides: Partial<Config> = {}): Config {
  return {
    locale: 'en',
    outputDir: './data',
    releaseFn: 'releases.json',
    releaseUrl: 'https://docs.overturemaps.org/release-calendar/',
    target: 'division',
    confirmFeatureSelection: true,
    spatialFrame: 'division',
    spatialPredicate: 'intersects',
    spatialGeometry: 'clip-smart',
    ...overrides,
  }
}

function createCliArgs(overrides: Partial<CliArgs> = {}): CliArgs {
  return {
    ...overrides,
  }
}

function createDivision(overrides: Partial<Division> = {}): Division {
  return {
    id: 'division-1',
    country: 'HK',
    subtype: 'locality',
    names: { primary: 'Central', common: [] },
    hierarchies: [],
    ...overrides,
  }
}

async function loadConfigModule() {
  mock.module(abs('../libs/workflows/processing.ts'), () => ({
    extractBoundsFromDivisionGeometry: extractBoundsFromDivisionGeometryMock,
  }))
  mock.module(abs('../libs/workflows/processing'), () => ({
    extractBoundsFromDivisionGeometry: extractBoundsFromDivisionGeometryMock,
  }))
  mock.module(abs('../libs/core/utils.ts'), () => ({
    bail: bailMock,
  }))
  mock.module(abs('../libs/core/utils'), () => ({
    bail: bailMock,
  }))
  mock.module('@clack/prompts', () => ({
    log: logState,
  }))

  return await import('../libs/core/config.ts')
}

const envSnapshot = Object.fromEntries(
  ENV_KEYS.map(key => [key, process.env[key]]),
) as Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>

beforeEach(() => {
  bailMock.mockClear()
  extractBoundsFromDivisionGeometryMock.mockClear()
  extractBoundsFromDivisionGeometryMock.mockImplementation(async () => ({
    bbox: { xmin: 1, ymin: 2, xmax: 3, ymax: 4 },
    geometry: 'division-geometry',
  }))
  logState.info.mockClear()
  logState.warn.mockClear()
  restoreEnv(envSnapshot)
})

afterEach(() => {
  restoreEnv(envSnapshot)
  mock.restore()
})

describe('config env loading', () => {
  test('reads supported environment variables into config', async () => {
    process.env.FILTER_MODE = 'bbox'
    process.env.LOCALE = 'zh-hk'
    process.env.BBOX_XMIN = '114.1'
    process.env.BBOX_YMIN = '22.2'
    process.env.BBOX_XMAX = '114.3'
    process.env.BBOX_YMAX = '22.4'
    process.env.DIVISION_ID = 'division-123'
    process.env.SPATIAL_FRAME = 'bbox'
    process.env.SPATIAL_PREDICATE = 'within'
    process.env.SPATIAL_GEOMETRY = 'clip-all'
    process.env.FEATURE_TYPES = 'building,address'
    process.env.CONFIRM_FEATURE_SELECTION = 'false'
    process.env.ON_FILE_EXISTS = 'replace'

    const { getConfig } = await loadConfigModule()
    const config = getConfig()

    assert.equal(config.target, 'bbox')
    assert.equal(config.locale, 'zh-hk')
    assert.deepEqual(config.bbox, {
      xmin: 114.1,
      ymin: 22.2,
      xmax: 114.3,
      ymax: 22.4,
    })
    assert.equal(config.divisionId, 'division-123')
    assert.equal(config.spatialFrame, 'bbox')
    assert.equal(config.spatialPredicate, 'within')
    assert.equal(config.spatialGeometry, 'clip-all')
    assert.deepEqual(config.featureTypes, ['building', 'address'])
    assert.equal(config.confirmFeatureSelection, false)
    assert.equal(config.onFileExists, 'replace')
  })

  test('does not set bbox when only part of the env bbox is defined', async () => {
    process.env.BBOX_XMIN = '114.1'
    process.env.BBOX_YMIN = '22.2'
    process.env.BBOX_XMAX = '114.3'

    const { getConfig } = await loadConfigModule()
    const config = getConfig()

    assert.equal(config.bbox, undefined)
  })

  test('reloadConfig restores defaults while ignoring env', async () => {
    process.env.LOCALE = 'fr'
    process.env.SPATIAL_GEOMETRY = 'preserve'

    const { reloadConfig } = await loadConfigModule()
    const config = createConfig({ locale: 'zh-hk', spatialGeometry: 'clip-all' })

    reloadConfig(config)

    assert.equal(config.locale, 'en')
    assert.equal(config.spatialFrame, 'division')
    assert.equal(config.spatialPredicate, 'intersects')
    assert.equal(config.spatialGeometry, 'clip-smart')
    assert.equal(config.confirmFeatureSelection, true)
  })
})

describe('config validators', () => {
  test('accept valid targets, file handling actions, and spatial values', async () => {
    const {
      validateOnFileExists,
      validateSpatialFrame,
      validateSpatialGeometry,
      validateSpatialPredicate,
      validateTarget,
    } = await loadConfigModule()

    assert.equal(validateTarget('world'), 'world')
    assert.equal(validateOnFileExists('abort'), 'abort')
    assert.equal(validateSpatialFrame('bbox'), 'bbox')
    assert.equal(validateSpatialPredicate('within'), 'within')
    assert.equal(validateSpatialGeometry('clip-all'), 'clip-all')
  })

  test('reject invalid spatial values', async () => {
    const { validateSpatialFrame, validateSpatialGeometry, validateSpatialPredicate } =
      await loadConfigModule()

    assert.throws(() => validateSpatialFrame('planet'), /Invalid SPATIAL_FRAME/)
    assert.throws(
      () => validateSpatialPredicate('contains'),
      /Invalid SPATIAL_PREDICATE/,
    )
    assert.throws(() => validateSpatialGeometry('crop'), /Invalid SPATIAL_GEOMETRY/)
  })
})

describe('initializeTarget', () => {
  test('prefers interactive target over cli and config', async () => {
    const { initializeTarget } = await loadConfigModule()

    const result = initializeTarget(
      createConfig({ target: 'world' }),
      createCliArgs({ bbox: { xmin: 1, ymin: 2, xmax: 3, ymax: 4 } }),
      { target: 'division' },
    )

    assert.equal(result.target, 'division')
  })

  test('resolves bbox target from bbox frame when bbox input is available', async () => {
    const { initializeTarget } = await loadConfigModule()

    const result = initializeTarget(
      createConfig({
        spatialFrame: 'bbox',
        bbox: { xmin: 1, ymin: 2, xmax: 3, ymax: 4 },
      }),
      createCliArgs(),
      false,
    )

    assert.equal(result.target, 'bbox')
  })
})

describe('initializeBounds', () => {
  test('returns a world extraction context with spatial defaults and no geometry', async () => {
    const { initializeBounds } = await loadConfigModule()

    const result = await initializeBounds(
      createConfig(),
      createCliArgs(),
      'world',
      null,
      null,
      '2026-03-18.0',
    )

    assert.deepEqual(result, {
      bbox: null,
      geometry: null,
      spatialFrame: 'division',
      spatialPredicate: 'intersects',
      spatialGeometry: 'clip-smart',
    })
  })

  test('builds bbox frame contexts from bbox inputs', async () => {
    const { initializeBounds } = await loadConfigModule()
    const bbox = { xmin: 10, ymin: 11, xmax: 12, ymax: 13 }

    const result = await initializeBounds(
      createConfig({ spatialFrame: 'bbox' }),
      createCliArgs({
        bbox,
        frame: 'bbox',
        predicate: 'within',
        geometry: 'preserve',
      }),
      'bbox',
      null,
      null,
      '2026-03-18.0',
    )

    assert.deepEqual(result, {
      bbox,
      geometry: null,
      spatialFrame: 'bbox',
      spatialPredicate: 'within',
      spatialGeometry: 'preserve',
    })
  })

  test('reuses division bbox when frame=bbox is requested without explicit bbox input', async () => {
    const { initializeBounds } = await loadConfigModule()
    const division = createDivision()

    const result = await initializeBounds(
      createConfig(),
      createCliArgs({
        frame: 'bbox',
        predicate: 'within',
        geometry: 'preserve',
      }),
      'division',
      division,
      division.id,
      '2026-03-18.0',
    )

    assert.deepEqual(result, {
      bbox: { xmin: 1, ymin: 2, xmax: 3, ymax: 4 },
      geometry: null,
      spatialFrame: 'bbox',
      spatialPredicate: 'within',
      spatialGeometry: 'preserve',
    })
  })

  test('extracts bounds from division geometry when using division frame', async () => {
    const { initializeBounds } = await loadConfigModule()
    const division = createDivision()

    const result = await initializeBounds(
      createConfig(),
      createCliArgs({ geometry: 'clip-all' }),
      'division',
      division,
      division.id,
      '2026-03-18.0',
    )

    assert.deepEqual(result, {
      bbox: { xmin: 1, ymin: 2, xmax: 3, ymax: 4 },
      geometry: 'division-geometry',
      spatialFrame: 'division',
      spatialPredicate: 'intersects',
      spatialGeometry: 'clip-all',
    })
  })
})
