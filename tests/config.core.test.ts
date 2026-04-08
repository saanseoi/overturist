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
  'SKIP_BOUNDARY_CLIP',
  'CLIP_MODE',
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
    clipMode: 'smart',
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
    process.env.SKIP_BOUNDARY_CLIP = '1'
    process.env.CLIP_MODE = 'smart'
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
    assert.equal(config.skipBoundaryClip, true)
    assert.equal(config.clipMode, 'smart')
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

  test('ignores env values when requested explicitly', async () => {
    process.env.LOCALE = 'fr'
    process.env.FILTER_MODE = 'world'

    const { getConfig } = await loadConfigModule()
    const config = getConfig(true)

    assert.equal(config.locale, 'en')
    assert.equal(config.target, 'division')
  })

  test('reloadConfig restores defaults while ignoring env', async () => {
    process.env.LOCALE = 'fr'
    process.env.FILTER_MODE = 'world'

    const { reloadConfig } = await loadConfigModule()
    const config = createConfig({ locale: 'zh-hk', target: 'bbox' })

    reloadConfig(config)

    assert.equal(config.locale, 'en')
    assert.equal(config.target, 'division')
    assert.equal(config.clipMode, 'smart')
    assert.equal(config.confirmFeatureSelection, true)
  })
})

describe('config validators', () => {
  test('accept valid targets, file handling actions, and clip modes', async () => {
    const { validateClipMode, validateOnFileExists, validateTarget } =
      await loadConfigModule()

    assert.equal(validateTarget('world'), 'world')
    assert.equal(validateOnFileExists('abort'), 'abort')
    assert.equal(validateClipMode('all'), 'all')
  })

  test('reject invalid target values', async () => {
    const { validateTarget } = await loadConfigModule()

    assert.throws(() => validateTarget('planet'), /Invalid target/)
  })

  test('reject invalid file handling values', async () => {
    const { validateOnFileExists } = await loadConfigModule()

    assert.throws(() => validateOnFileExists('overwrite'), /Invalid OnFileExists/)
  })

  test('reject invalid clip mode values', async () => {
    const { validateClipMode } = await loadConfigModule()

    assert.throws(() => validateClipMode('none'), /Invalid CLIP_MODE/)
  })
})

describe('initializeTarget', () => {
  test('prefers interactive target over cli and config', async () => {
    const { initializeTarget } = await loadConfigModule()

    const result = initializeTarget(
      createConfig({ target: 'division' }),
      createCliArgs({ target: 'bbox' }),
      { target: 'world' } as never,
    )

    assert.equal(result.target, 'world')
  })

  test('falls back from cli to config when interactive target is absent', async () => {
    const { initializeTarget } = await loadConfigModule()

    assert.equal(
      initializeTarget(
        createConfig({ target: 'division' }),
        createCliArgs({ target: 'bbox' }),
      ).target,
      'bbox',
    )
    assert.equal(
      initializeTarget(createConfig({ target: 'world' }), createCliArgs()).target,
      'world',
    )
  })

  test('infers division target from division and osm relation flags', async () => {
    const { initializeTarget } = await loadConfigModule()

    assert.equal(
      initializeTarget(
        createConfig({ target: 'world' }),
        createCliArgs({ divisionRequested: true }),
      ).target,
      'division',
    )
    assert.equal(
      initializeTarget(
        createConfig({ target: 'world' }),
        createCliArgs({ osmIdRequested: true }),
      ).target,
      'division',
    )
  })

  test('infers bbox and world targets from explicit flags', async () => {
    const { initializeTarget } = await loadConfigModule()

    assert.equal(
      initializeTarget(
        createConfig({ target: 'division' }),
        createCliArgs({ bboxRequested: true }),
      ).target,
      'bbox',
    )
    assert.equal(
      initializeTarget(
        createConfig({ target: 'division' }),
        createCliArgs({ world: true }),
      ).target,
      'world',
    )
  })
})

describe('validateTargetConfig', () => {
  test('prefers division over world when a division id is present and logs the override', async () => {
    const { validateTargetConfig } = await loadConfigModule()

    const result = validateTargetConfig(
      createConfig({ target: 'world', divisionId: 'division-1' }),
      createCliArgs(),
      'world',
    )

    assert.equal(result, 'division')
    assert.equal(logState.warn.mock.calls.length, 1)
    assert.equal(logState.info.mock.calls.length, 1)
  })

  test('prefers bbox over world when a bbox is present and no division id exists', async () => {
    const { validateTargetConfig } = await loadConfigModule()

    const result = validateTargetConfig(
      createConfig({
        target: 'world',
        bbox: { xmin: 1, ymin: 2, xmax: 3, ymax: 4 },
      }),
      createCliArgs(),
      'world',
    )

    assert.equal(result, 'bbox')
    assert.equal(logState.warn.mock.calls.length, 1)
    assert.equal(logState.info.mock.calls.length, 1)
  })
})

describe('initializeBounds', () => {
  test('returns a world extraction context without geometry filtering', async () => {
    const { initializeBounds } = await loadConfigModule()

    const result = await initializeBounds(
      createConfig({ clipMode: 'all' }),
      createCliArgs(),
      'world',
      null,
      null,
      '2026-03-18.0',
    )

    assert.deepEqual(result, {
      bbox: null,
      skipBoundaryClip: true,
      clipMode: 'all',
      geometry: null,
    })
    assert.equal(extractBoundsFromDivisionGeometryMock.mock.calls.length, 0)
  })

  test('requires a bbox for bbox target', async () => {
    const { initializeBounds } = await loadConfigModule()

    await assert.rejects(
      () =>
        initializeBounds(
          createConfig(),
          createCliArgs(),
          'bbox',
          null,
          null,
          '2026-03-18.0',
        ),
      /You must provide a bounding box/,
    )
  })

  test('uses bbox target inputs and forces boundary clipping off', async () => {
    const { initializeBounds } = await loadConfigModule()
    const bbox = { xmin: 10, ymin: 11, xmax: 12, ymax: 13 }

    const result = await initializeBounds(
      createConfig({ clipMode: 'all' }),
      createCliArgs({ bbox, skipBoundaryClip: false }),
      'bbox',
      null,
      null,
      '2026-03-18.0',
    )

    assert.deepEqual(result, {
      bbox,
      skipBoundaryClip: true,
      clipMode: 'all',
      geometry: null,
    })
  })

  test('requires a division for division target', async () => {
    const { initializeBounds } = await loadConfigModule()

    await assert.rejects(
      () =>
        initializeBounds(
          createConfig(),
          createCliArgs(),
          'division',
          null,
          null,
          '2026-03-18.0',
        ),
      /You must provide a DivisionId/,
    )
  })

  test('extracts bounds from division geometry when using a division target', async () => {
    const { initializeBounds } = await loadConfigModule()
    const division = createDivision({
      hierarchies: [[{ division_id: 'id', subtype: 'country', name: 'HK' }]],
    })

    const result = await initializeBounds(
      createConfig({ clipMode: 'smart' }),
      createCliArgs(),
      'division',
      division,
      division.id,
      '2026-03-18.0',
    )

    assert.deepEqual(result, {
      bbox: { xmin: 1, ymin: 2, xmax: 3, ymax: 4 },
      geometry: 'division-geometry',
      skipBoundaryClip: false,
      clipMode: 'smart',
    })
    assert.deepEqual(extractBoundsFromDivisionGeometryMock.mock.calls[0], [
      '2026-03-18.0',
      division,
      'division-1',
    ])
  })

  test('prefers explicit bbox over extracted division bounds', async () => {
    const { initializeBounds } = await loadConfigModule()
    const explicitBbox = { xmin: 20, ymin: 21, xmax: 22, ymax: 23 }

    const result = await initializeBounds(
      createConfig(),
      createCliArgs({ bbox: explicitBbox }),
      'division',
      createDivision(),
      'division-1',
      '2026-03-18.0',
    )

    assert.deepEqual(result.bbox, explicitBbox)
  })

  test('uses config clip mode when the CLI does not provide one', async () => {
    const { initializeBounds } = await loadConfigModule()

    const result = await initializeBounds(
      createConfig({ clipMode: 'all' }),
      createCliArgs(),
      'world',
      null,
      null,
      '2026-03-18.0',
    )

    assert.equal(result.clipMode, 'all')
  })

  test('prefers CLI clip mode over config clip mode', async () => {
    const { initializeBounds } = await loadConfigModule()

    const result = await initializeBounds(
      createConfig({ clipMode: 'preserve' }),
      createCliArgs({ clipMode: 'all' }),
      'world',
      null,
      null,
      '2026-03-18.0',
    )

    assert.equal(result.clipMode, 'all')
  })

  test('drops geometry when boundary clipping is skipped', async () => {
    const { initializeBounds } = await loadConfigModule()

    const result = await initializeBounds(
      createConfig({ skipBoundaryClip: true }),
      createCliArgs(),
      'division',
      createDivision(),
      'division-1',
      '2026-03-18.0',
    )

    assert.equal(result.geometry, null)
    assert.equal(result.skipBoundaryClip, true)
  })
})
