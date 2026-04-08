import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, mock, test } from 'bun:test'
import type {
  CliArgs,
  Config,
  ReleaseData,
  ThemeDifferences,
  ThemeMapping,
} from '../../libs/core'

const abs = (relativePath: string) => new URL(relativePath, import.meta.url).pathname

const cacheThemeMappingMock = mock(async () => {})
const getCachedThemeMappingMock = mock(
  async (_version: string) => null as ThemeMapping | null,
)
const getPrecedingReleaseVersionMock = mock(
  (_version: string, _releaseData: ReleaseData) => '2025-12-22.0',
)
const getFeatureTypesForVersionMock = mock(async (_version: string) => ({
  buildings: ['building'],
  transportation: ['segment'],
}))
const promptUserForThemeActionMock = mock(
  async (_differences: ThemeDifferences) => 'update' as const,
)
const selectFeatureTypesInteractivelyMock = mock(
  async (_themeMapping: ThemeMapping, featureTypes?: string[]) =>
    featureTypes ?? ['building', 'segment'],
)
const bailMock = mock((msg?: string) => {
  throw new Error(msg ?? 'bail')
})
const failedExitMock = mock((msg?: string) => {
  throw new Error(msg ?? 'failed')
})
const compareThemeMappingsMock = mock(
  (_current: ThemeMapping, _preceding: ThemeMapping): ThemeDifferences => ({
    missingFromCurrent: [],
    missingFromPreceding: [],
    changedThemes: [],
    hasDifferences: false,
  }),
)
const logState = {
  info: mock(() => {}),
  warn: mock(() => {}),
  success: mock(() => {}),
  error: mock(() => {}),
  message: mock(() => {}),
}
const spinnerState = {
  start: mock(() => {}),
  stop: mock(() => {}),
  message: mock(() => {}),
}

async function loadThemesModule() {
  mock.module(abs('../../libs/data/cache.ts'), () => ({
    cacheThemeMapping: cacheThemeMappingMock,
    getCachedThemeMapping: getCachedThemeMappingMock,
  }))
  mock.module(abs('../../libs/data/releases.ts'), () => ({
    getPrecedingReleaseVersion: getPrecedingReleaseVersionMock,
  }))
  mock.module(abs('../../libs/data/s3.ts'), () => ({
    getFeatureTypesForVersion: getFeatureTypesForVersionMock,
  }))
  mock.module(abs('../../libs/ui'), () => ({
    promptUserForThemeAction: promptUserForThemeActionMock,
    selectFeatureTypesInteractively: selectFeatureTypesInteractivelyMock,
  }))
  mock.module(abs('../../libs/core/utils.ts'), () => ({
    bail: bailMock,
    failedExit: failedExitMock,
  }))
  mock.module(abs('../../libs/core/utils'), () => ({
    bail: bailMock,
    failedExit: failedExitMock,
  }))
  mock.module(abs('../../libs/core/validation.ts'), () => ({
    compareThemeMappings: compareThemeMappingsMock,
  }))
  mock.module('@clack/prompts', () => ({
    log: logState,
    spinner: () => spinnerState,
  }))

  return await import(`../../libs/workflows/themes.ts`)
}

function createConfig(overrides: Partial<Config> = {}): Config {
  return {
    locale: 'en',
    outputDir: './data',
    releaseFn: 'releases.json',
    releaseUrl: 'https://example.com/releases',
    target: 'division',
    confirmFeatureSelection: true,
    ...overrides,
  }
}

function createCliArgs(overrides: Partial<CliArgs> = {}): CliArgs {
  return {
    ...overrides,
  }
}

function createReleaseData(): ReleaseData {
  return {
    lastUpdated: '2026-04-06T00:00:00.000Z',
    lastChecked: '2026-04-06T00:00:00.000Z',
    source: 'test',
    latest: '2026-03-18.0',
    totalReleases: 2,
    releases: [
      {
        version: '2026-03-18.0',
        date: '2026-03-18',
        schema: '2',
        isReleased: true,
        isAvailableOnS3: true,
      },
      {
        version: '2025-12-22.0',
        date: '2025-12-22',
        schema: '1',
        isReleased: true,
        isAvailableOnS3: true,
      },
    ],
  }
}

beforeEach(() => {
  cacheThemeMappingMock.mockClear()
  getCachedThemeMappingMock.mockClear()
  getPrecedingReleaseVersionMock.mockClear()
  getFeatureTypesForVersionMock.mockClear()
  promptUserForThemeActionMock.mockClear()
  selectFeatureTypesInteractivelyMock.mockClear()
  bailMock.mockClear()
  failedExitMock.mockClear()
  compareThemeMappingsMock.mockClear()
  logState.info.mockClear()
  logState.warn.mockClear()
  logState.success.mockClear()
  logState.error.mockClear()
  logState.message.mockClear()
  spinnerState.start.mockClear()
  spinnerState.stop.mockClear()
  spinnerState.message.mockClear()

  cacheThemeMappingMock.mockImplementation(async () => {})
  getCachedThemeMappingMock.mockImplementation(
    async (_version: string) => null as ThemeMapping | null,
  )
  getPrecedingReleaseVersionMock.mockImplementation(
    (_version: string, _releaseData: ReleaseData) => '2025-12-22.0',
  )
  getFeatureTypesForVersionMock.mockImplementation(async (_version: string) => ({
    buildings: ['building'],
    transportation: ['segment'],
  }))
  promptUserForThemeActionMock.mockImplementation(
    async (_differences: ThemeDifferences) => 'update' as const,
  )
  selectFeatureTypesInteractivelyMock.mockImplementation(
    async (_themeMapping: ThemeMapping, featureTypes?: string[]) =>
      featureTypes ?? ['building', 'segment'],
  )
  bailMock.mockImplementation((msg?: string) => {
    throw new Error(msg ?? 'bail')
  })
  failedExitMock.mockImplementation((msg?: string) => {
    throw new Error(msg ?? 'failed')
  })
  compareThemeMappingsMock.mockImplementation(
    (_current: ThemeMapping, _preceding: ThemeMapping): ThemeDifferences => ({
      missingFromCurrent: [],
      missingFromPreceding: [],
      changedThemes: [],
      hasDifferences: false,
    }),
  )
})

afterEach(() => {
  mock.restore()
})

describe('initializeThemeMapping', () => {
  test('reuses a cached mapping and applies CLI feature selection without prompting', async () => {
    const { initializeThemeMapping } = await loadThemesModule()
    getCachedThemeMappingMock.mockImplementationOnce(
      async () =>
        ({
          building: 'buildings',
          segment: 'transportation',
        }) as ThemeMapping,
    )

    const result = await initializeThemeMapping(
      '2026-03-18.0',
      createReleaseData(),
      createConfig({ featureTypes: ['segment'] }),
      createCliArgs({ types: ['building'] }),
      false,
    )

    assert.deepEqual(result, {
      themeMapping: {
        building: 'buildings',
        segment: 'transportation',
      },
      featureTypes: ['building'],
    })
    assert.equal(getFeatureTypesForVersionMock.mock.calls.length, 0)
    assert.equal(selectFeatureTypesInteractivelyMock.mock.calls.length, 0)
  })

  test('creates and caches a new mapping when validation finds no differences', async () => {
    const { initializeThemeMapping } = await loadThemesModule()
    getCachedThemeMappingMock.mockImplementation(async (version: string) => {
      if (version === '2025-12-22.0') {
        return {
          building: 'buildings',
          segment: 'transportation',
        }
      }

      return null
    })

    const result = await initializeThemeMapping(
      '2026-03-18.0',
      createReleaseData(),
      createConfig(),
      createCliArgs(),
      false,
    )

    assert.deepEqual(result.featureTypes, ['building', 'segment'])
    assert.equal(compareThemeMappingsMock.mock.calls.length, 1)
    assert.equal(cacheThemeMappingMock.mock.calls.length, 1)
    assert.deepEqual(cacheThemeMappingMock.mock.calls[0], [
      '2026-03-18.0',
      {
        building: 'buildings',
        segment: 'transportation',
      },
    ])
  })

  test('prompts on theme differences and supports interactive confirmation of preselected types', async () => {
    const { initializeThemeMapping } = await loadThemesModule()
    compareThemeMappingsMock.mockImplementationOnce(
      (_current: ThemeMapping, _preceding: ThemeMapping): ThemeDifferences => ({
        missingFromCurrent: ['address'],
        missingFromPreceding: [],
        changedThemes: [],
        hasDifferences: true,
      }),
    )
    getCachedThemeMappingMock.mockImplementation(async (version: string) => {
      if (version === '2025-12-22.0') {
        return { building: 'buildings', segment: 'transportation' }
      }

      return null
    })

    const result = await initializeThemeMapping(
      '2026-03-18.0',
      createReleaseData(),
      createConfig(),
      createCliArgs({ themes: ['buildings'] }),
      { target: 'division' },
    )

    assert.deepEqual(result.featureTypes, ['building'])
    assert.equal(promptUserForThemeActionMock.mock.calls.length, 1)
    assert.equal(selectFeatureTypesInteractivelyMock.mock.calls.length, 1)
    assert.deepEqual(selectFeatureTypesInteractivelyMock.mock.calls[0], [
      {
        building: 'buildings',
        segment: 'transportation',
      },
      ['building'],
    ])
  })

  test('falls back to all feature types in non-interactive mode when nothing is selected', async () => {
    const { initializeThemeMapping } = await loadThemesModule()
    getCachedThemeMappingMock.mockImplementationOnce(
      async () =>
        ({ building: 'buildings', segment: 'transportation' }) as ThemeMapping,
    )

    const result = await initializeThemeMapping(
      '2026-03-18.0',
      createReleaseData(),
      createConfig(),
      createCliArgs(),
      false,
    )

    assert.deepEqual(result.featureTypes, ['building', 'segment'])
    assert.equal(logState.info.mock.calls.length, 1)
  })

  test('uses env feature types in non-interactive mode when CLI input is absent', async () => {
    const { initializeThemeMapping } = await loadThemesModule()
    getCachedThemeMappingMock.mockImplementationOnce(
      async () =>
        ({ building: 'buildings', segment: 'transportation' }) as ThemeMapping,
    )

    const result = await initializeThemeMapping(
      '2026-03-18.0',
      createReleaseData(),
      createConfig({ featureTypes: ['segment'] }),
      createCliArgs(),
      false,
    )

    assert.deepEqual(result.featureTypes, ['segment'])
    assert.equal(selectFeatureTypesInteractivelyMock.mock.calls.length, 0)
  })

  test('bails on invalid feature types from CLI input', async () => {
    const { initializeThemeMapping } = await loadThemesModule()
    getCachedThemeMappingMock.mockImplementationOnce(
      async () => ({ building: 'buildings' }) as ThemeMapping,
    )

    await assert.rejects(
      initializeThemeMapping(
        '2026-03-18.0',
        createReleaseData(),
        createConfig(),
        createCliArgs({ types: ['invalid'] }),
        false,
      ),
      /Invalid feature types/,
    )
  })

  test('bails on invalid theme names from CLI input', async () => {
    const { initializeThemeMapping } = await loadThemesModule()
    getCachedThemeMappingMock.mockImplementationOnce(
      async () =>
        ({
          building: 'buildings',
          segment: 'transportation',
        }) as ThemeMapping,
    )

    await assert.rejects(
      initializeThemeMapping(
        '2026-03-18.0',
        createReleaseData(),
        createConfig(),
        createCliArgs({ themes: ['invalid-theme'] }),
        false,
      ),
      /Invalid themes/,
    )
  })
})

describe('handleThemeAction', () => {
  test('caches the mapping on update', async () => {
    const { handleThemeAction } = await loadThemesModule()
    const themeMapping = { building: 'buildings' }

    const result = await handleThemeAction('update', '2026-03-18.0', themeMapping)

    assert.deepEqual(result, themeMapping)
    assert.deepEqual(cacheThemeMappingMock.mock.calls[0], [
      '2026-03-18.0',
      themeMapping,
    ])
    assert.equal(logState.success.mock.calls.length, 1)
  })

  test('exits on cancel', async () => {
    const { handleThemeAction } = await loadThemesModule()
    await assert.rejects(handleThemeAction('cancel', '2026-03-18.0'), /User said no/)
    assert.equal(failedExitMock.mock.calls.length, 1)
  })
})
