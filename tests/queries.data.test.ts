import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, mock, test } from 'bun:test'
import type { Config, ControlContext, Division, ProgressUpdate } from '../libs/core'

const abs = (relativePath: string) => new URL(relativePath, import.meta.url).pathname

const runDuckDBQueryMock = mock(async () => ({
  stdout: '[]',
  stderr: '',
  exitCode: 0,
}))
const cacheDivisionsMock = mock(async () => {})
const getCachedDivisionMock = mock(async () => null as Division | null)
const getTempCachePathMock = mock(async () => '/tmp/overturist-bbox-cache.parquet')
const getOutputDirMock = mock(() => '/tmp/previous-release')
const isParquetExistsMock = mock(async () => false)
const bailMock = mock((msg?: string) => {
  throw new Error(msg ?? 'bail')
})

function createDivision(id: string, overrides: Partial<Division> = {}): Division {
  return {
    id,
    country: 'HK',
    subtype: 'locality',
    names: {
      primary: `Division ${id}`,
      common: [{ key: 'en', value: `Division ${id}` }],
    },
    hierarchies: [],
    ...overrides,
  }
}

function createCtx(overrides: Partial<ControlContext> = {}): ControlContext {
  return {
    target: 'division',
    source: {
      env: {
        locale: 'en',
        outputDir: './data',
        releaseFn: 'releases.json',
        releaseUrl: 'https://docs.overturemaps.org/release-calendar/',
        target: 'division',
        confirmFeatureSelection: true,
        clipMode: 'preserve',
      } satisfies Config,
      cliArgs: {
        onFileExists: 'skip',
      },
      interactiveOpts: false,
    },
    releaseVersion: '2026-03-18.0',
    releaseContext: {
      version: '2026-03-18.0',
      schema: '2',
      date: '2026-03-18',
      isNewSchema: false,
      isLatest: true,
      previousVersion: '2025-12-22.0',
      previousSchema: '1',
    },
    bbox: { xmin: 1, ymin: 2, xmax: 3, ymax: 4 },
    divisionId: 'gers:division',
    division: createDivision('gers:division'),
    featureTypes: ['building'],
    clipMode: 'preserve',
    onFileExists: 'skip',
    ...overrides,
  }
}

async function loadQueriesModule() {
  mock.module(abs('../libs/data/cache.ts'), () => ({
    cacheDivisions: cacheDivisionsMock,
    getCachedDivision: getCachedDivisionMock,
    getTempCachePath: getTempCachePathMock,
  }))
  mock.module(abs('../libs/data/cache'), () => ({
    cacheDivisions: cacheDivisionsMock,
    getCachedDivision: getCachedDivisionMock,
    getTempCachePath: getTempCachePathMock,
  }))
  mock.module(abs('../libs/data/db.ts'), () => ({
    runDuckDBQuery: runDuckDBQueryMock,
  }))
  mock.module(abs('../libs/data/db'), () => ({
    runDuckDBQuery: runDuckDBQueryMock,
  }))
  mock.module(abs('../libs/core/fs.ts'), () => ({
    getFeatureOutputFilename: (featureType: string, clipMode: string) =>
      clipMode === 'preserve'
        ? `${featureType}.preserveCrop.parquet`
        : clipMode === 'all'
          ? `${featureType}.containCrop.parquet`
          : `${featureType}.parquet`,
    getOutputDir: getOutputDirMock,
    isParquetExists: isParquetExistsMock,
  }))
  mock.module(abs('../libs/core/fs'), () => ({
    getFeatureOutputFilename: (featureType: string, clipMode: string) =>
      clipMode === 'preserve'
        ? `${featureType}.preserveCrop.parquet`
        : clipMode === 'all'
          ? `${featureType}.containCrop.parquet`
          : `${featureType}.parquet`,
    getOutputDir: getOutputDirMock,
    isParquetExists: isParquetExistsMock,
  }))
  mock.module(abs('../libs/core/utils.ts'), () => ({
    bail: bailMock,
  }))
  mock.module(abs('../libs/core/utils'), () => ({
    bail: bailMock,
  }))

  return await import(`../libs/data/queries.ts?test=${Date.now()}-${Math.random()}`)
}

function createConnection(counts: number[]) {
  const queries: string[] = []

  return {
    queries,
    async run(query: string) {
      queries.push(query)
    },
    async runAndReadAll(query: string) {
      queries.push(query)
      const count = counts.shift() ?? 0
      return {
        getRowObjectsJson: () => [{ count }],
      }
    },
  }
}

beforeEach(() => {
  runDuckDBQueryMock.mockClear()
  runDuckDBQueryMock.mockImplementation(async () => ({
    stdout: '[]',
    stderr: '',
    exitCode: 0,
  }))
  cacheDivisionsMock.mockClear()
  getCachedDivisionMock.mockClear()
  getCachedDivisionMock.mockImplementation(async () => null)
  getTempCachePathMock.mockClear()
  getTempCachePathMock.mockImplementation(
    async () => '/tmp/overturist-bbox-cache.parquet',
  )
  getOutputDirMock.mockClear()
  getOutputDirMock.mockImplementation(() => '/tmp/previous-release')
  isParquetExistsMock.mockClear()
  isParquetExistsMock.mockImplementation(async () => false)
  bailMock.mockClear()
})

afterEach(() => {
  mock.restore()
})

describe('normalizeOsmRelationRecordId', () => {
  test('accepts numeric and relation-prefixed references and rejects invalid values', async () => {
    const { normalizeOsmRelationRecordId } = await loadQueriesModule()

    assert.equal(normalizeOsmRelationRecordId('10268797'), 'r10268797@%')
    assert.equal(normalizeOsmRelationRecordId('r10268797'), 'r10268797@%')
    assert.equal(
      normalizeOsmRelationRecordId('r10268797@2026-01-01'),
      'r10268797@2026-01-01',
    )
    assert.equal(normalizeOsmRelationRecordId('way/123'), null)
  })
})

describe('localizeDivisionHierarchiesForRelease', () => {
  test('resolves hierarchy names from local divisions, cache, then remote fetch and caches fetched divisions', async () => {
    const { localizeDivisionHierarchiesForRelease } = await loadQueriesModule()
    const localDivision = createDivision('local-1', {
      names: {
        primary: 'Local Primary',
        common: [{ key: 'en', value: 'Local Name' }],
      },
      hierarchies: [
        [
          { division_id: 'local-1', subtype: 'locality', name: 'local-old' },
          { division_id: 'cached-1', subtype: 'region', name: 'cached-old' },
          { division_id: 'remote-1', subtype: 'country', name: 'remote-old' },
        ],
      ],
    })

    getCachedDivisionMock.mockImplementation(async (_version, id) => {
      if (id === 'cached-1') {
        return createDivision('cached-1', {
          subtype: 'region',
          names: {
            primary: 'Cached Primary',
            common: [{ key: 'en', value: 'Cached Name' }],
          },
        })
      }
      return null
    })
    runDuckDBQueryMock.mockImplementation(async () => ({
      stdout: JSON.stringify([
        createDivision('remote-1', {
          subtype: 'country',
          names: {
            primary: 'Remote Primary',
            common: [{ key: 'en', value: 'Remote Name' }],
          },
        }),
      ]),
      stderr: '',
      exitCode: 0,
    }))

    const [localized] = await localizeDivisionHierarchiesForRelease(
      '2026-03-18.0',
      [localDivision],
      'en',
    )

    assert.deepEqual(localized.hierarchies, [
      [
        { division_id: 'local-1', subtype: 'locality', name: 'Local Name' },
        { division_id: 'cached-1', subtype: 'region', name: 'Cached Name' },
        { division_id: 'remote-1', subtype: 'country', name: 'Remote Name' },
      ],
    ])
    assert.equal(cacheDivisionsMock.mock.calls.length, 1)
    assert.equal(cacheDivisionsMock.mock.calls[0]?.[1][0].id, 'remote-1')
  })
})

describe('count helpers', () => {
  test('parses count results from DuckDB', async () => {
    const { getCount } = await loadQueriesModule()
    runDuckDBQueryMock.mockImplementation(async () => ({
      stdout: JSON.stringify([{ count: 42 }]),
      stderr: '',
      exitCode: 0,
    }))

    assert.equal(await getCount('/tmp/output.parquet'), 42)
  })

  test('returns null when previous release context or files are unavailable', async () => {
    const { getLastReleaseCount } = await loadQueriesModule()

    assert.equal(
      await getLastReleaseCount(
        createCtx({
          releaseContext: {
            version: '2026-03-18.0',
            schema: '2',
            date: '2026-03-18',
            isNewSchema: false,
            isLatest: true,
            previousVersion: undefined,
            previousSchema: undefined,
          },
        }),
        'building',
      ),
      null,
    )

    isParquetExistsMock.mockImplementation(async () => false)
    assert.equal(await getLastReleaseCount(createCtx(), 'building'), null)

    isParquetExistsMock.mockImplementation(async () => true)
    runDuckDBQueryMock.mockImplementation(async () => {
      throw new Error('count failed')
    })
    assert.equal(await getLastReleaseCount(createCtx(), 'building'), null)
  })
})

describe('division search queries', () => {
  test('uses the country-code exact match path and caches results', async () => {
    const { getDivisionsByName } = await loadQueriesModule()
    runDuckDBQueryMock.mockImplementation(async () => ({
      stdout: JSON.stringify([createDivision('hk-country', { subtype: 'country' })]),
      stderr: '',
      exitCode: 0,
    }))

    const results = await getDivisionsByName('2026-03-18.0', 'HK', ['country'], 'en')

    assert.equal(results[0]?.id, 'hk-country')
    assert.match(
      String(runDuckDBQueryMock.mock.calls[0]?.[0] ?? ''),
      /WHERE matches_country/,
    )
    assert.equal(cacheDivisionsMock.mock.calls.length, 1)
  })

  test('escapes wildcard and quote characters in search terms', async () => {
    const { getDivisionsByName } = await loadQueriesModule()
    runDuckDBQueryMock.mockImplementation(async () => ({
      stdout: JSON.stringify([]),
      stderr: '',
      exitCode: 0,
    }))

    await getDivisionsByName('2026-03-18.0', "100%_O'Hare", ['locality'], 'en', false)

    const query = String(runDuckDBQueryMock.mock.calls[0]?.[0] ?? '')
    assert.match(query, /100\\%\\_O''Hare/)
  })

  test('returns early for empty id lookups and skips hierarchy localization when requested', async () => {
    const { getDivisionsByIds } = await loadQueriesModule()

    assert.deepEqual(await getDivisionsByIds('2026-03-18.0', []), [])

    runDuckDBQueryMock.mockImplementation(async () => ({
      stdout: JSON.stringify([
        createDivision('gers:1', {
          hierarchies: [[{ division_id: 'gers:1', subtype: 'locality', name: 'raw' }]],
        }),
      ]),
      stderr: '',
      exitCode: 0,
    }))

    const divisions = await getDivisionsByIds('2026-03-18.0', ['gers:1'], false, 'en')

    assert.equal(divisions[0]?.hierarchies[0]?.[0]?.name, 'raw')
    assert.equal(getCachedDivisionMock.mock.calls.length, 0)
  })

  test('returns no results for invalid relation references', async () => {
    const { getDivisionsBySourceRecordId } = await loadQueriesModule()

    assert.deepEqual(await getDivisionsBySourceRecordId('2026-03-18.0', 'way/123'), [])
    assert.equal(runDuckDBQueryMock.mock.calls.length, 0)
  })

  test('filters relation lookups by subtype and caches matched divisions', async () => {
    const { getDivisionsBySourceRecordId } = await loadQueriesModule()
    runDuckDBQueryMock.mockImplementation(async query => {
      if (query.includes('SELECT DISTINCT')) {
        return {
          stdout: JSON.stringify([
            { division_id: 'country-1' },
            { division_id: 'locality-1' },
          ]),
          stderr: '',
          exitCode: 0,
        }
      }

      return {
        stdout: JSON.stringify([
          createDivision('country-1', { subtype: 'country' }),
          createDivision('locality-1', { subtype: 'locality' }),
        ]),
        stderr: '',
        exitCode: 0,
      }
    })

    const results = await getDivisionsBySourceRecordId(
      '2026-03-18.0',
      '10268797',
      ['locality'],
      'en',
    )

    assert.deepEqual(
      results.map(result => result.id),
      ['locality-1'],
    )
    assert.equal(cacheDivisionsMock.mock.calls.length, 1)
  })
})

describe('feature extraction queries', () => {
  test('requires bbox for bbox filtering', async () => {
    const { getFeaturesForBbox } = await loadQueriesModule()

    await assert.rejects(
      getFeaturesForBbox(
        createCtx({ bbox: null }),
        'building',
        'buildings',
        '/tmp/out.parquet',
      ),
      /Bbox is required/,
    )
  })

  test('returns counts for bbox extraction success and failure states', async () => {
    const { getFeaturesForBbox } = await loadQueriesModule()
    const updates: ProgressUpdate[] = []
    runDuckDBQueryMock.mockImplementation(async () => ({
      stdout: JSON.stringify([{ count: 5 }]),
      stderr: '',
      exitCode: 0,
    }))

    assert.deepEqual(
      await getFeaturesForBbox(
        createCtx(),
        'building',
        'buildings',
        '/tmp/out.parquet',
        update => {
          updates.push(update)
        },
      ),
      { success: true, count: 5 },
    )
    assert.equal(updates.at(-1)?.count, 5)

    runDuckDBQueryMock.mockImplementation(async () => ({
      stdout: '',
      stderr: 'failed',
      exitCode: 1,
    }))
    assert.deepEqual(
      await getFeaturesForBbox(
        createCtx(),
        'building',
        'buildings',
        '/tmp/out.parquet',
      ),
      { success: false, count: 0 },
    )
  })

  test('returns counts for world extraction success and failure states', async () => {
    const { getFeaturesForWorld } = await loadQueriesModule()
    runDuckDBQueryMock.mockImplementation(async () => ({
      stdout: JSON.stringify([{ count: 12 }]),
      stderr: '',
      exitCode: 0,
    }))

    assert.deepEqual(
      await getFeaturesForWorld(
        'building',
        'buildings',
        '2026-03-18.0',
        '/tmp/world.parquet',
      ),
      { success: true, count: 12 },
    )

    runDuckDBQueryMock.mockImplementation(async () => ({
      stdout: '',
      stderr: 'failed',
      exitCode: 1,
    }))
    assert.deepEqual(
      await getFeaturesForWorld(
        'building',
        'buildings',
        '2026-03-18.0',
        '/tmp/world.parquet',
      ),
      { success: false, count: 0 },
    )
  })

  test('creates an empty output when the bbox pass finds no features', async () => {
    const { getFeaturesForGeomWithConnection } = await loadQueriesModule()
    const connection = createConnection([0])

    const result = await getFeaturesForGeomWithConnection(
      connection as never,
      createCtx(),
      'building',
      'buildings',
      '/tmp/final.parquet',
    )

    assert.deepEqual(result, { success: true, bboxCount: 0, finalCount: 0 })
    assert.equal(
      connection.queries.some(query => query.includes('LIMIT 0')),
      true,
    )
  })

  test('clips geometry for clipMode=all', async () => {
    const { getFeaturesForGeomWithConnection } = await loadQueriesModule()
    const connection = createConnection([3, 2])

    const result = await getFeaturesForGeomWithConnection(
      connection as never,
      createCtx({ clipMode: 'all' }),
      'building',
      'buildings',
      '/tmp/final.parquet',
    )

    assert.deepEqual(result, { success: true, bboxCount: 3, finalCount: 2 })
    assert.equal(
      connection.queries.some(query => query.includes('ST_Intersection')),
      true,
    )
  })

  test('clips only smart feature types for clipMode=smart', async () => {
    const { getFeaturesForGeomWithConnection } = await loadQueriesModule()
    const connection = createConnection([4, 3])

    await getFeaturesForGeomWithConnection(
      connection as never,
      createCtx({ clipMode: 'smart' }),
      'water',
      'base',
      '/tmp/final.parquet',
    )

    assert.equal(
      connection.queries.some(query => query.includes('ST_Intersection')),
      true,
    )
  })

  test('preserves geometry when clipping is disabled', async () => {
    const { getFeaturesForGeomWithConnection } = await loadQueriesModule()
    const connection = createConnection([4, 3])

    await getFeaturesForGeomWithConnection(
      connection as never,
      createCtx({ clipMode: 'preserve' }),
      'building',
      'buildings',
      '/tmp/final.parquet',
    )

    const finalQuery = connection.queries.at(-2) ?? ''
    assert.equal(finalQuery.includes('ST_Intersection(geometry'), false)
    assert.equal(finalQuery.includes('WHERE ST_INTERSECTS'), true)
  })
})

describe('extractBoundsFromDivision', () => {
  test('returns bbox and geometry when the query succeeds with valid bounds', async () => {
    const { extractBoundsFromDivision } = await loadQueriesModule()
    runDuckDBQueryMock.mockImplementation(async () => ({
      stdout: JSON.stringify([
        { xmin: 1, ymin: 2, xmax: 3, ymax: 4, geometry: 'ABCDEF' },
      ]),
      stderr: '',
      exitCode: 0,
    }))

    assert.deepEqual(await extractBoundsFromDivision('gers:1', '2026-03-18.0'), {
      bbox: { xmin: 1, ymin: 2, xmax: 3, ymax: 4 },
      geometry: 'ABCDEF',
    })
  })

  test('returns null when no rows, null bounds, or query errors occur', async () => {
    const { extractBoundsFromDivision } = await loadQueriesModule()

    runDuckDBQueryMock.mockImplementation(async () => ({
      stdout: JSON.stringify([]),
      stderr: '',
      exitCode: 0,
    }))
    assert.equal(await extractBoundsFromDivision('gers:1', '2026-03-18.0'), null)

    runDuckDBQueryMock.mockImplementation(async () => ({
      stdout: JSON.stringify([
        { xmin: null, ymin: 2, xmax: 3, ymax: 4, geometry: 'ABCDEF' },
      ]),
      stderr: '',
      exitCode: 0,
    }))
    assert.equal(await extractBoundsFromDivision('gers:1', '2026-03-18.0'), null)

    runDuckDBQueryMock.mockImplementation(async () => {
      throw new Error('query failed')
    })
    assert.equal(await extractBoundsFromDivision('gers:1', '2026-03-18.0'), null)
  })
})
