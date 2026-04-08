import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, mock, test } from 'bun:test'
import type {
  CliArgs,
  Config,
  ControlContext,
  Division,
  ReleaseContext,
} from '../../libs/core'

const abs = (relativePath: string) => new URL(relativePath, import.meta.url).pathname

const getCachedSearchResultsMock = mock(
  async () =>
    ({
      version: '2026-03-18.0',
      adminLevel: 2,
      term: 'central',
      totalCount: 1,
      results: [createDivision('division-1')],
      createdAt: '2026-04-06T00:00:00.000Z',
    }) as {
      version: string
      adminLevel: number
      term: string
      totalCount: number
      results: Division[]
      createdAt: string
    } | null,
)
const getCachedDivisionMock = mock(async () => null as Division | null)
const getVersionsInCacheMock = mock(async () => [] as string[])
const warmReleaseCacheForInteractiveStartupMock = mock(async () => {})
const executeDownloadWorkflowMock = mock(async () => {})
const resolveOptionsMock = mock(async () => createControlContext())
const infoCmdMock = mock(async () => {})
const persistAndDisplayDivisionInfoMock = mock(async () => {})
const resolveDivisionInfoContextMock = mock(async () => ({
  releaseVersion: '2026-03-18.0',
  releaseContext: createReleaseContext(),
  divisionId: 'division-1',
  division: createDivision('division-1'),
  outputDir: '/tmp/info-output',
}))
const initializeLocaleMock = mock(() => ({ locale: 'en' }))
const localizeDivisionHierarchiesForReleaseMock = mock(
  async (_version: string, divisions: Division[], _locale: string) => divisions,
)
const displayBannerMock = mock(() => {})
const promptForAreaSearchActionMock = mock(
  async (_label?: string) => 'new_search' as 'new_search' | 'repeat_search' | 'back',
)
const promptForDownloadActionMock = mock(
  async () =>
    'download_world' as 'search_area' | 'download_osm_id' | 'download_world' | 'back',
)
const promptForDivisionSelectionMock = mock(
  async (searchResult: { results: Division[] }) => searchResult.results[0],
)
const promptForMainActionMock = mock(
  async () =>
    null as 'download_data' | 'inspect_division' | 'manage_settings' | 'exit' | null,
)
const promptForSearchHistoryMock = mock(
  async () =>
    ({
      version: '2026-03-18.0',
      adminLevel: 2,
      term: 'central',
      totalCount: 1,
      results: [createDivision('division-1')],
      createdAt: '2026-04-06T00:00:00.000Z',
    }) as {
      version: string
      adminLevel: number
      term: string
      totalCount: number
      results: Division[]
      createdAt: string
    } | null,
)
const promptForSettingsActionMock = mock(
  async () =>
    'back' as
      | 'show_preferences'
      | 'reset_preferences'
      | 'show_cache_stats'
      | 'purge_cache'
      | 'back',
)
const outroMock = mock(() => {})
const showPreferencesMock = mock(async () => {})
const resetPreferencesMock = mock(async () => {})
const showCacheStatsMock = mock(async () => {})
const purgeCacheMock = mock(async () => {})
const noteMock = mock(() => {})

async function loadInteractiveModule() {
  mock.module(abs('../../libs/data/cache.ts'), () => ({
    getCachedDivision: getCachedDivisionMock,
    getCachedSearchResults: getCachedSearchResultsMock,
    getVersionsInCache: getVersionsInCacheMock,
  }))
  mock.module(abs('../../libs/data/releases.ts'), () => ({
    warmReleaseCacheForInteractiveStartup: warmReleaseCacheForInteractiveStartupMock,
  }))
  mock.module(abs('../../libs/data/releases'), () => ({
    warmReleaseCacheForInteractiveStartup: warmReleaseCacheForInteractiveStartupMock,
  }))
  mock.module(abs('../../libs/workflows/get.ts'), () => ({
    executeDownloadWorkflow: executeDownloadWorkflowMock,
    resolveOptions: resolveOptionsMock,
  }))
  mock.module(abs('../../libs/workflows/info.ts'), () => ({
    infoCmd: infoCmdMock,
    persistAndDisplayDivisionInfo: persistAndDisplayDivisionInfoMock,
    resolveDivisionInfoContext: resolveDivisionInfoContextMock,
  }))
  mock.module(abs('../../libs/core/config.ts'), () => ({
    initializeLocale: initializeLocaleMock,
  }))
  mock.module(abs('../../libs/data/queries.ts'), () => ({
    localizeDivisionHierarchiesForRelease: localizeDivisionHierarchiesForReleaseMock,
  }))
  const uiModule = {
    displayBanner: displayBannerMock,
    promptForAreaSearchAction: promptForAreaSearchActionMock,
    promptForDownloadAction: promptForDownloadActionMock,
    promptForDivisionSelection: promptForDivisionSelectionMock,
    promptForMainAction: promptForMainActionMock,
    promptForSearchHistory: promptForSearchHistoryMock,
    promptForSettingsAction: promptForSettingsActionMock,
  }
  mock.module(abs('../../libs/ui/index.ts'), () => uiModule)
  mock.module(abs('../../libs/ui/index'), () => uiModule)
  mock.module(abs('../../libs/ui.ts'), () => uiModule)
  mock.module(abs('../../libs/ui'), () => uiModule)
  mock.module('@clack/prompts', () => ({
    outro: outroMock,
  }))
  mock.module(abs('../../libs/workflows/settings.ts'), () => ({
    showPreferences: showPreferencesMock,
    resetPreferences: resetPreferencesMock,
    showCacheStats: showCacheStatsMock,
    purgeCache: purgeCacheMock,
  }))
  mock.module(abs('../../libs/workflows/settings'), () => ({
    showPreferences: showPreferencesMock,
    resetPreferences: resetPreferencesMock,
    showCacheStats: showCacheStatsMock,
    purgeCache: purgeCacheMock,
  }))
  mock.module(abs('../../libs/core/note.ts'), () => ({
    note: noteMock,
  }))
  mock.module(abs('../../libs/core/note'), () => ({
    note: noteMock,
  }))

  return await import(
    `../../libs/workflows/interactive.ts?test=${Date.now()}-${Math.random()}`
  )
}

function createDivision(id: string): Division {
  return {
    id,
    country: 'HK',
    subtype: 'locality',
    names: { primary: `Division ${id}`, common: [] },
    hierarchies: [],
  }
}

function createReleaseContext(): ReleaseContext {
  return {
    version: '2026-03-18.0',
    schema: '2',
    date: '2026-03-18',
    isNewSchema: false,
    isLatest: true,
    previousVersion: '2025-12-22.0',
    previousSchema: '1',
  }
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
    onFileExists: 'skip',
    ...overrides,
  }
}

function createControlContext(): ControlContext {
  const config = createConfig()
  const cliArgs = createCliArgs()
  const division = createDivision('division-1')

  return {
    releaseVersion: '2026-03-18.0',
    releaseContext: createReleaseContext(),
    themeMapping: { building: 'buildings' },
    target: 'world',
    divisionId: division.id,
    division,
    bbox: null,
    geometry: null,
    skipBoundaryClip: true,
    clipMode: 'preserve',
    featureTypes: ['building'],
    featureNameWidth: 12,
    indexWidth: 2,
    outputDir: '/tmp/output',
    onFileExists: 'skip',
    source: {
      env: config,
      cli: cliArgs,
      interactive: { target: 'world' },
    },
  }
}

beforeEach(() => {
  getCachedSearchResultsMock.mockClear()
  getCachedDivisionMock.mockClear()
  getVersionsInCacheMock.mockClear()
  warmReleaseCacheForInteractiveStartupMock.mockClear()
  executeDownloadWorkflowMock.mockClear()
  resolveOptionsMock.mockClear()
  infoCmdMock.mockClear()
  persistAndDisplayDivisionInfoMock.mockClear()
  resolveDivisionInfoContextMock.mockClear()
  initializeLocaleMock.mockClear()
  localizeDivisionHierarchiesForReleaseMock.mockClear()
  displayBannerMock.mockClear()
  promptForAreaSearchActionMock.mockClear()
  promptForDownloadActionMock.mockClear()
  promptForDivisionSelectionMock.mockClear()
  promptForMainActionMock.mockClear()
  promptForSearchHistoryMock.mockClear()
  promptForSettingsActionMock.mockClear()
  outroMock.mockClear()
  showPreferencesMock.mockClear()
  resetPreferencesMock.mockClear()
  showCacheStatsMock.mockClear()
  purgeCacheMock.mockClear()
  noteMock.mockClear()

  getCachedSearchResultsMock.mockImplementation(async () => ({
    version: '2026-03-18.0',
    adminLevel: 2,
    term: 'central',
    totalCount: 1,
    results: [createDivision('division-1')],
    createdAt: '2026-04-06T00:00:00.000Z',
  }))
  getCachedDivisionMock.mockImplementation(async () => null)
  getVersionsInCacheMock.mockImplementation(async () => [])
  warmReleaseCacheForInteractiveStartupMock.mockImplementation(async () => {})
  executeDownloadWorkflowMock.mockImplementation(async () => {})
  resolveOptionsMock.mockImplementation(async () => createControlContext())
  infoCmdMock.mockImplementation(async () => {})
  persistAndDisplayDivisionInfoMock.mockImplementation(async () => {})
  resolveDivisionInfoContextMock.mockImplementation(async () => ({
    releaseVersion: '2026-03-18.0',
    releaseContext: createReleaseContext(),
    divisionId: 'division-1',
    division: createDivision('division-1'),
    outputDir: '/tmp/info-output',
  }))
  initializeLocaleMock.mockImplementation(() => ({ locale: 'en' }))
  localizeDivisionHierarchiesForReleaseMock.mockImplementation(
    async (_version: string, divisions: Division[], _locale: string) => divisions,
  )
  displayBannerMock.mockImplementation(() => {})
  promptForAreaSearchActionMock.mockImplementation(
    async (_label?: string) => 'new_search',
  )
  promptForDownloadActionMock.mockImplementation(async () => 'download_world')
  promptForDivisionSelectionMock.mockImplementation(
    async (searchResult: { results: Division[] }) => searchResult.results[0],
  )
  promptForMainActionMock.mockImplementation(async () => null)
  promptForSearchHistoryMock.mockImplementation(async () => ({
    version: '2026-03-18.0',
    adminLevel: 2,
    term: 'central',
    totalCount: 1,
    results: [createDivision('division-1')],
    createdAt: '2026-04-06T00:00:00.000Z',
  }))
  promptForSettingsActionMock.mockImplementation(async () => 'back')
  outroMock.mockImplementation(() => {})
  showPreferencesMock.mockImplementation(async () => {})
  resetPreferencesMock.mockImplementation(async () => {})
  showCacheStatsMock.mockImplementation(async () => {})
  purgeCacheMock.mockImplementation(async () => {})
  noteMock.mockImplementation(() => {})
})

afterEach(() => {
  mock.restore()
})

describe('handleMainMenu', () => {
  test('routes the world download flow through resolveOptions and executeDownloadWorkflow', async () => {
    const { handleMainMenu } = await loadInteractiveModule()
    let call = 0
    promptForMainActionMock.mockImplementation(async () => {
      call += 1
      return call === 1 ? 'download_data' : null
    })

    await handleMainMenu(createConfig(), createCliArgs())

    assert.equal(displayBannerMock.mock.calls.length, 1)
    assert.deepEqual(resolveOptionsMock.mock.calls[0], [
      createConfig(),
      createCliArgs(),
      {
        releaseVersion: null,
        target: 'world',
      },
    ])
    assert.equal(executeDownloadWorkflowMock.mock.calls.length, 1)
    assert.equal(outroMock.mock.calls.length, 1)
  })

  test('routes a new division info search directly to infoCmd', async () => {
    const { handleMainMenu } = await loadInteractiveModule()
    let call = 0
    promptForMainActionMock.mockImplementation(async () => {
      call += 1
      return call === 1 ? 'inspect_division' : null
    })
    promptForAreaSearchActionMock.mockImplementation(async () => 'new_search')

    await handleMainMenu(createConfig(), createCliArgs())

    assert.equal(infoCmdMock.mock.calls.length, 1)
    assert.equal(
      promptForAreaSearchActionMock.mock.calls[0]?.[0],
      'Get division details:',
    )
  })

  test('reuses cached search results for repeat-download workflows and stores the selected division', async () => {
    const { handleMainMenu } = await loadInteractiveModule()
    let call = 0
    promptForMainActionMock.mockImplementation(async () => {
      call += 1
      return call === 1 ? 'download_data' : null
    })
    promptForDownloadActionMock.mockImplementation(async () => 'search_area')
    promptForAreaSearchActionMock.mockImplementation(async () => 'repeat_search')

    const config = createConfig()
    await handleMainMenu(config, createCliArgs())

    assert.equal(getCachedSearchResultsMock.mock.calls.length, 1)
    assert.equal(localizeDivisionHierarchiesForReleaseMock.mock.calls.length, 1)
    assert.equal(promptForDivisionSelectionMock.mock.calls.length, 1)
    assert.equal(config.divisionId, 'division-1')
    assert.equal(config.selectedDivision?.id, 'division-1')
    assert.deepEqual(resolveOptionsMock.mock.calls[0], [
      config,
      createCliArgs(),
      { releaseVersion: null },
    ])
    assert.equal(executeDownloadWorkflowMock.mock.calls.length, 1)
  })

  test('bypasses the main menu when a division is supplied on the CLI', async () => {
    const { handleMainMenu } = await loadInteractiveModule()

    await handleMainMenu(
      createConfig(),
      createCliArgs({
        divisionId: 'division-1',
        divisionRequested: true,
      }),
    )

    assert.equal(promptForMainActionMock.mock.calls.length, 0)
    assert.deepEqual(resolveOptionsMock.mock.calls[0], [
      createConfig(),
      createCliArgs({
        divisionId: 'division-1',
        divisionRequested: true,
      }),
      {
        releaseVersion: null,
        target: 'division',
      },
    ])
    assert.equal(executeDownloadWorkflowMock.mock.calls.length, 1)
    assert.equal(noteMock.mock.calls.length, 1)
  })

  test('reuses cached search results for repeat-info workflows without re-fetching the division', async () => {
    const { handleMainMenu } = await loadInteractiveModule()
    let call = 0
    promptForMainActionMock.mockImplementation(async () => {
      call += 1
      return call === 1 ? 'inspect_division' : null
    })
    promptForAreaSearchActionMock.mockImplementation(async () => 'repeat_search')

    await handleMainMenu(createConfig(), createCliArgs())

    assert.equal(resolveDivisionInfoContextMock.mock.calls.length, 1)
    assert.deepEqual(resolveDivisionInfoContextMock.mock.calls[0], [
      createConfig({
        divisionId: 'division-1',
        selectedDivision: createDivision('division-1'),
      }),
      createCliArgs(),
      { releaseVersion: null },
    ])
    assert.equal(persistAndDisplayDivisionInfoMock.mock.calls.length, 1)
  })

  test('dispatches settings actions through the lazily imported settings module', async () => {
    const { handleMainMenu } = await loadInteractiveModule()
    let call = 0
    promptForMainActionMock.mockImplementation(async () => {
      call += 1
      return call === 1 ? 'manage_settings' : null
    })
    promptForSettingsActionMock.mockImplementationOnce(async () => 'show_preferences')
    promptForSettingsActionMock.mockImplementationOnce(async () => 'back')

    await handleMainMenu(createConfig(), createCliArgs())

    assert.equal(showPreferencesMock.mock.calls.length, 1)
    assert.equal(resetPreferencesMock.mock.calls.length, 0)
  })
})
