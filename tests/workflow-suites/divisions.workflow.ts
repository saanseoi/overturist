import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, mock, test } from 'bun:test'
import type { CliArgs, Config, Division } from '../../libs/core'

const abs = (relativePath: string) => new URL(relativePath, import.meta.url).pathname

const getCachedDivisionMock = mock(async () => null as Division | null)
const getAdminLevelsMock = mock(() => ({
  1: { subtypes: ['country', 'dependency'] },
  2: { subtypes: ['region'] },
}))
const getDivisionsByIdsMock = mock(async () => [createDivision('division-from-id')])
const getDivisionsBySourceRecordIdMock = mock(async () => [
  createDivision('division-from-osm'),
])
const localizeDivisionHierarchiesForReleaseMock = mock(
  async (_releaseVersion: string, divisions: Division[], _locale: string) => divisions,
)
const normalizeOsmRelationRecordIdMock = mock((_value: string) => null as string | null)
const searchDivisionsMock = mock(async () => ({
  results: [createDivision('division-search-result')],
  totalCount: 1,
}))
const displaySelectedDivisionMock = mock(() => {})
const promptForAdministrativeLevelMock = mock(async () => 2)
const promptForAreaNameMock = mock(async () => 'central')
const promptForDivisionSelectionMock = mock(
  async (searchResult: { results: Division[] }) => searchResult.results[0],
)
const promptForOsmRelationIdMock = mock(async () => '12345')
const bailMock = mock((msg?: string) => {
  throw new Error(msg ?? 'bail')
})
const bailFromSpinnerMock = mock(
  (_spinner: unknown, _spinnerMsg: string, msg?: string) => {
    throw new Error(msg ?? 'bail')
  },
)
const formatElapsedTimeMock = mock((elapsedMs: number) => `${elapsedMs}ms`)
const spinnerState = {
  start: mock(() => {}),
  stop: mock(() => {}),
  message: mock(() => {}),
}
const originalDateNow = Date.now

async function loadDivisionsModule() {
  mock.module('@clack/prompts', () => ({
    spinner: () => spinnerState,
  }))
  mock.module(abs('../../libs/data/cache.ts'), () => ({
    getCachedDivision: getCachedDivisionMock,
  }))
  mock.module(abs('../../libs/core/constants.ts'), () => ({
    ALL_DIVISION_SUBTYPES: ['country', 'dependency', 'region', 'locality'],
  }))
  mock.module(abs('../../libs/workflows/processing.ts'), () => ({
    searchDivisions: searchDivisionsMock,
  }))
  mock.module(abs('../../libs/data/queries.ts'), () => ({
    getDivisionsByIds: getDivisionsByIdsMock,
    getDivisionsBySourceRecordId: getDivisionsBySourceRecordIdMock,
    localizeDivisionHierarchiesForRelease: localizeDivisionHierarchiesForReleaseMock,
    normalizeOsmRelationRecordId: normalizeOsmRelationRecordIdMock,
  }))
  mock.module(abs('../../libs/data/releases.ts'), () => ({
    getAdminLevels: getAdminLevelsMock,
  }))
  mock.module(abs('../../libs/ui'), () => ({
    displaySelectedDivision: displaySelectedDivisionMock,
    promptForAdministrativeLevel: promptForAdministrativeLevelMock,
    promptForAreaName: promptForAreaNameMock,
    promptForDivisionSelection: promptForDivisionSelectionMock,
    promptForOsmRelationId: promptForOsmRelationIdMock,
  }))
  mock.module(abs('../../libs/core/utils.ts'), () => ({
    bail: bailMock,
    bailFromSpinner: bailFromSpinnerMock,
    formatElapsedTime: formatElapsedTimeMock,
  }))
  mock.module(abs('../../libs/core/utils'), () => ({
    bail: bailMock,
    bailFromSpinner: bailFromSpinnerMock,
    formatElapsedTime: formatElapsedTimeMock,
  }))

  return await import(`../../libs/workflows/divisions.ts`)
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

beforeEach(() => {
  let now = 1_000
  Date.now = () => {
    now += 4_200
    return now
  }

  getCachedDivisionMock.mockClear()
  getAdminLevelsMock.mockClear()
  getDivisionsByIdsMock.mockClear()
  getDivisionsBySourceRecordIdMock.mockClear()
  localizeDivisionHierarchiesForReleaseMock.mockClear()
  normalizeOsmRelationRecordIdMock.mockClear()
  searchDivisionsMock.mockClear()
  displaySelectedDivisionMock.mockClear()
  promptForAdministrativeLevelMock.mockClear()
  promptForAreaNameMock.mockClear()
  promptForDivisionSelectionMock.mockClear()
  promptForOsmRelationIdMock.mockClear()
  bailMock.mockClear()
  bailFromSpinnerMock.mockClear()
  formatElapsedTimeMock.mockClear()
  spinnerState.start.mockClear()
  spinnerState.stop.mockClear()
  spinnerState.message.mockClear()

  getCachedDivisionMock.mockImplementation(async () => null as Division | null)
  getAdminLevelsMock.mockImplementation(() => ({
    1: { subtypes: ['country', 'dependency'] },
    2: { subtypes: ['region'] },
  }))
  getDivisionsByIdsMock.mockImplementation(async () => [
    createDivision('division-from-id'),
  ])
  getDivisionsBySourceRecordIdMock.mockImplementation(async () => [
    createDivision('division-from-osm'),
  ])
  localizeDivisionHierarchiesForReleaseMock.mockImplementation(
    async (_releaseVersion: string, divisions: Division[], _locale: string) =>
      divisions,
  )
  normalizeOsmRelationRecordIdMock.mockImplementation(
    (_value: string) => null as string | null,
  )
  searchDivisionsMock.mockImplementation(async () => ({
    results: [createDivision('division-search-result')],
    totalCount: 1,
  }))
  displaySelectedDivisionMock.mockImplementation(() => {})
  promptForAdministrativeLevelMock.mockImplementation(async () => 2)
  promptForAreaNameMock.mockImplementation(async () => 'central')
  promptForDivisionSelectionMock.mockImplementation(
    async (searchResult: { results: Division[] }) => searchResult.results[0],
  )
  promptForOsmRelationIdMock.mockImplementation(async () => '12345')
  bailMock.mockImplementation((msg?: string) => {
    throw new Error(msg ?? 'bail')
  })
  bailFromSpinnerMock.mockImplementation(
    (_spinner: unknown, _spinnerMsg: string, msg?: string) => {
      throw new Error(msg ?? 'bail')
    },
  )
  formatElapsedTimeMock.mockImplementation((elapsedMs: number) => `${elapsedMs}ms`)
})

afterEach(() => {
  Date.now = originalDateNow
  mock.restore()
})

describe('getPreselectedDivision', () => {
  test('does not reuse config.selectedDivision during interactive new-search flows', async () => {
    const { getPreselectedDivision } = await loadDivisionsModule()
    const config = createConfig({
      selectedDivision: createDivision('persisted-division'),
    })

    const result = getPreselectedDivision(
      { target: 'division' },
      config,
      createCliArgs(),
    )

    assert.equal(result, undefined)
  })

  test('reuses config.selectedDivision for non-interactive runs when compatible', async () => {
    const { getPreselectedDivision } = await loadDivisionsModule()
    const division = createDivision('persisted-division')

    const result = getPreselectedDivision(
      false,
      createConfig({ selectedDivision: division }),
      createCliArgs(),
    )

    assert.equal(result?.id, division.id)
  })
})

describe('initializeDivision', () => {
  test('returns null division context for world downloads', async () => {
    const { initializeDivision } = await loadDivisionsModule()
    const result = await initializeDivision(
      '2026-03-18.0',
      'en',
      createConfig(),
      createCliArgs(),
      'world',
      false,
    )

    assert.deepEqual(result, { divisionId: null, division: null })
  })

  test('returns null division context for bbox downloads', async () => {
    const { initializeDivision } = await loadDivisionsModule()
    const result = await initializeDivision(
      '2026-03-18.0',
      'en',
      createConfig(),
      createCliArgs(),
      'bbox',
      false,
    )

    assert.deepEqual(result, { divisionId: null, division: null })
  })

  test('prefers an explicit CLI division id over config defaults', async () => {
    const { initializeDivision } = await loadDivisionsModule()
    const localizedDivision = createDivision('cli-division')
    getDivisionsByIdsMock.mockImplementationOnce(async () => [localizedDivision])

    const result = await initializeDivision(
      '2026-03-18.0',
      'en',
      createConfig({ divisionId: 'env-division' }),
      createCliArgs({ divisionId: 'cli-division' }),
      'division',
      false,
    )

    assert.equal(result.divisionId, 'cli-division')
    assert.equal(getDivisionsByIdsMock.mock.calls.length, 1)
    assert.deepEqual(getDivisionsByIdsMock.mock.calls[0], [
      '2026-03-18.0',
      ['cli-division'],
      true,
      'en',
    ])
    assert.equal(spinnerState.start.mock.calls.length, 1)
    assert.match(
      String(spinnerState.start.mock.calls[0]?.[0] ?? ''),
      /Searching for the division matching the Overture Division Id/,
    )
    assert.match(String(spinnerState.stop.mock.calls[0]?.[0] ?? ''), /4200ms/)
  })

  test('resolves a CLI OSM relation id through source-record lookup', async () => {
    const { initializeDivision } = await loadDivisionsModule()
    normalizeOsmRelationRecordIdMock.mockImplementationOnce(() => 'r12345@%')

    const result = await initializeDivision(
      '2026-03-18.0',
      'en',
      createConfig({ divisionId: 'env-division' }),
      createCliArgs({ osmId: '12345' }),
      'division',
      false,
    )

    assert.equal(result.divisionId, 'division-from-osm')
    assert.equal(getDivisionsBySourceRecordIdMock.mock.calls.length, 1)
    assert.deepEqual(getDivisionsBySourceRecordIdMock.mock.calls[0], [
      '2026-03-18.0',
      'r12345@%',
      [],
      'en',
    ])
    assert.equal(spinnerState.start.mock.calls.length, 1)
    assert.match(
      String(spinnerState.start.mock.calls[0]?.[0] ?? ''),
      /Searching for the division matching the OSM Relation Id/,
    )
    assert.match(String(spinnerState.stop.mock.calls[0]?.[0] ?? ''), /4200ms/)
  })

  test('uses the configured division id when CLI input is absent', async () => {
    const { initializeDivision } = await loadDivisionsModule()
    const result = await initializeDivision(
      '2026-03-18.0',
      'en',
      createConfig({ divisionId: 'env-division' }),
      createCliArgs(),
      'division',
      false,
    )

    assert.equal(result.divisionId, 'division-from-id')
    assert.equal(getDivisionsByIdsMock.mock.calls.length, 1)
    assert.equal(spinnerState.start.mock.calls.length, 1)
    assert.match(
      String(spinnerState.start.mock.calls[0]?.[0] ?? ''),
      /Searching for the division matching the Overture Division Id/,
    )
    assert.match(String(spinnerState.stop.mock.calls[0]?.[0] ?? ''), /4200ms/)
  })

  test('bails in non-interactive mode when no division id is available', async () => {
    const { initializeDivision } = await loadDivisionsModule()
    await assert.rejects(
      initializeDivision(
        '2026-03-18.0',
        'en',
        createConfig(),
        createCliArgs(),
        'division',
        false,
      ),
      /No divisionId provided/,
    )
  })

  test('routes OSM lookup mode through the OSM prompt workflow', async () => {
    const { initializeDivision } = await loadDivisionsModule()
    searchDivisionsMock.mockImplementationOnce(async () => ({
      results: [createDivision('osm-division')],
      totalCount: 1,
    }))

    const result = await initializeDivision(
      '2026-03-18.0',
      'en',
      createConfig(),
      createCliArgs(),
      'division',
      { divisionLookupMode: 'osm' },
    )

    assert.equal(promptForOsmRelationIdMock.mock.calls.length, 1)
    assert.equal(result.divisionId, 'osm-division')
    assert.deepEqual(searchDivisionsMock.mock.calls[0], [
      '2026-03-18.0',
      '12345',
      [],
      99,
      'en',
    ])
    assert.equal(displaySelectedDivisionMock.mock.calls.length, 1)
  })

  test('fails when an OSM source record matches multiple divisions', async () => {
    const { initializeDivision } = await loadDivisionsModule()
    getDivisionsBySourceRecordIdMock.mockImplementationOnce(async () => [
      createDivision('division-1'),
      createDivision('division-2'),
    ])
    normalizeOsmRelationRecordIdMock.mockImplementationOnce(() => 'r12345@%')

    await assert.rejects(
      async () =>
        await initializeDivision(
          '2026-03-18.0',
          'en',
          createConfig(),
          createCliArgs({ osmId: '12345' }),
          'division',
          false,
        ),
      /matched multiple divisions/,
    )
  })

  test('fails when an OSM source record matches no divisions', async () => {
    const { initializeDivision } = await loadDivisionsModule()
    getDivisionsBySourceRecordIdMock.mockImplementationOnce(async () => [])
    normalizeOsmRelationRecordIdMock.mockImplementationOnce(() => 'r12345@%')

    await assert.rejects(
      async () =>
        await initializeDivision(
          '2026-03-18.0',
          'en',
          createConfig(),
          createCliArgs({ osmId: '12345' }),
          'division',
          false,
        ),
      /not found/,
    )
  })
})

describe('interactive selection flows', () => {
  test('searches by administrative level and prompts for a selected division', async () => {
    const { handleDivisionSelection } = await loadDivisionsModule()
    const result = await handleDivisionSelection('2026-03-18.0', 'en')

    assert.deepEqual(searchDivisionsMock.mock.calls[0], [
      '2026-03-18.0',
      'central',
      ['region'],
      2,
      'en',
    ])
    assert.equal(result.divisionId, 'division-search-result')
    assert.equal(promptForDivisionSelectionMock.mock.calls.length, 1)
    assert.equal(displaySelectedDivisionMock.mock.calls.length, 1)
    assert.match(String(spinnerState.stop.mock.calls[0]?.[0] ?? ''), /4200ms/)
  })

  test('searches all subtypes when the user selects the any-level option', async () => {
    const { handleDivisionSelection } = await loadDivisionsModule()
    promptForAdministrativeLevelMock.mockImplementationOnce(async () => 99)

    await handleDivisionSelection('2026-03-18.0', 'en')

    assert.deepEqual(searchDivisionsMock.mock.calls[0], [
      '2026-03-18.0',
      'central',
      ['country', 'dependency', 'region', 'locality'],
      99,
      'en',
    ])
  })

  test('bails when an interactive search returns no results', async () => {
    const { handleDivisionSelection } = await loadDivisionsModule()
    searchDivisionsMock.mockImplementationOnce(async () => ({
      results: [],
      totalCount: 0,
    }))

    await assert.rejects(
      handleDivisionSelection('2026-03-18.0', 'en'),
      /No region found/,
    )
  })

  test('handles OSM lookups through the shared search workflow', async () => {
    const { handleOsmDivisionSelection } = await loadDivisionsModule()
    searchDivisionsMock.mockImplementationOnce(async () => ({
      results: [createDivision('osm-division')],
      totalCount: 1,
    }))

    const result = await handleOsmDivisionSelection('2026-03-18.0', 'en')

    assert.equal(result.divisionId, 'osm-division')
    assert.deepEqual(searchDivisionsMock.mock.calls[0], [
      '2026-03-18.0',
      '12345',
      [],
      99,
      'en',
    ])
    assert.equal(promptForOsmRelationIdMock.mock.calls.length, 1)
    assert.match(
      String(spinnerState.start.mock.calls[0]?.[0] ?? ''),
      /Searching for the division matching the OSM Relation Id/,
    )
    assert.match(String(spinnerState.stop.mock.calls[0]?.[0] ?? ''), /4200ms/)
  })
})
