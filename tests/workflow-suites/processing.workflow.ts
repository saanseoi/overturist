import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, mock, test } from 'bun:test'
import type {
  ControlContext,
  Division,
  ProgressUpdate,
  ReleaseContext,
} from '../../libs/core'

const abs = (relativePath: string) => new URL(relativePath, import.meta.url).pathname

const cacheDivisionsMock = mock(async () => {})
const cacheSearchResultsMock = mock(async () => {})
const getCachedDivisionMock = mock(async () => null as Division | null)
const getCachedSearchResultsMock = mock(
  async () =>
    false as
      | {
          results: Division[]
          totalCount: number
        }
      | false,
)

const connectionRunMock = mock(async () => {})
const dbCloseMock = mock(async () => {})

const fileExistsMock = mock(async () => false)
const extractBoundsFromDivisionMock = mock(
  async () =>
    null as {
      bbox: { xmin: number; ymin: number; xmax: number; ymax: number }
      geometry: string
    } | null,
)
const getDivisionsByIdsMock = mock(async () => [] as Division[])
const getDivisionsByNameMock = mock(async () => [] as Division[])
const getDivisionsBySourceRecordIdMock = mock(async () => [] as Division[])
const getFeaturesForBboxMock = mock(async () => ({ success: true, count: 3 }))
const getFeaturesForGeomWithConnectionMock = mock(async () => ({
  success: true,
  finalCount: 4,
}))
const getFeaturesForWorldMock = mock(async () => ({ success: true, count: 7 }))
const getLastReleaseCountMock = mock(async () => 2 as number | null)
const localizeDivisionHierarchiesForReleaseMock = mock(
  async (_releaseVersion: string, divisions: Division[], _locale: string) => divisions,
)
const normalizeOsmRelationRecordIdMock = mock((_value: string) => null as string | null)
const downloadParquetFilesMock = mock(async () => {})

const applyProgressUpdateMock = mock(() => {})
const finalizeProgressDisplayMock = mock(() => {})
const handleSkippedFeatureMock = mock(async () => {})
const updateProgressDisplayMock = mock(() => {})
const updateProgressStatusMock = mock(() => {})

const bailMock = mock((msg?: string) => {
  throw new Error(msg ?? 'bail')
})
const bailFromSpinnerMock = mock(
  (_spinner: unknown, _spinnerMsg: string, msg?: string) => {
    throw new Error(msg ?? 'bail')
  },
)
const getDiffCountMock = mock((currentCount: number, previousCount: number | null) =>
  previousCount === null ? null : currentCount - previousCount,
)

const spinnerState = {
  start: mock(() => {}),
  stop: mock(() => {}),
  message: mock(() => {}),
}
const logState = {
  info: mock(() => {}),
  success: mock(() => {}),
  warn: mock(() => {}),
  error: mock(() => {}),
}

async function loadProcessingModule() {
  mock.module(abs('../../libs/data/cache.ts'), () => ({
    cacheDivisions: cacheDivisionsMock,
    cacheSearchResults: cacheSearchResultsMock,
    getCachedDivision: getCachedDivisionMock,
    getCachedSearchResults: getCachedSearchResultsMock,
  }))
  mock.module(abs('../../libs/data/db.ts'), () => ({
    DuckDBManager: class {
      async getConnection() {
        return {
          run: connectionRunMock,
        }
      }

      async close() {
        await dbCloseMock()
      }
    },
  }))
  mock.module(abs('../../libs/core/fs.ts'), () => ({
    fileExists: fileExistsMock,
    getFeatureOutputFilename: (
      featureType: string,
      clipMode: string,
      skipBoundaryClip?: boolean,
    ) =>
      skipBoundaryClip
        ? `${featureType}.bboxCrop.parquet`
        : clipMode === 'preserve'
          ? `${featureType}.preserveCrop.parquet`
          : clipMode === 'all'
            ? `${featureType}.containCrop.parquet`
            : `${featureType}.parquet`,
  }))
  mock.module(abs('../../libs/data/queries.ts'), () => ({
    extractBoundsFromDivision: extractBoundsFromDivisionMock,
    getDivisionsByIds: getDivisionsByIdsMock,
    getDivisionsByName: getDivisionsByNameMock,
    getDivisionsBySourceRecordId: getDivisionsBySourceRecordIdMock,
    getFeaturesForBbox: getFeaturesForBboxMock,
    getFeaturesForGeomWithConnection: getFeaturesForGeomWithConnectionMock,
    getFeaturesForWorld: getFeaturesForWorldMock,
    getLastReleaseCount: getLastReleaseCountMock,
    localizeDivisionHierarchiesForRelease: localizeDivisionHierarchiesForReleaseMock,
    normalizeOsmRelationRecordId: normalizeOsmRelationRecordIdMock,
  }))
  mock.module(abs('../../libs/data/s3.ts'), () => ({
    downloadParquetFiles: downloadParquetFilesMock,
  }))
  mock.module(abs('../../libs/ui'), () => ({
    applyProgressUpdate: applyProgressUpdateMock,
    finalizeProgressDisplay: finalizeProgressDisplayMock,
    handleSkippedFeature: handleSkippedFeatureMock,
    updateProgressDisplay: updateProgressDisplayMock,
    updateProgressStatus: updateProgressStatusMock,
  }))
  mock.module(abs('../../libs/core/utils.ts'), () => ({
    bail: bailMock,
    bailFromSpinner: bailFromSpinnerMock,
    getDiffCount: getDiffCountMock,
  }))
  mock.module(abs('../../libs/core/utils'), () => ({
    bail: bailMock,
    bailFromSpinner: bailFromSpinnerMock,
    getDiffCount: getDiffCountMock,
  }))
  mock.module('@clack/prompts', () => ({
    log: logState,
    spinner: () => spinnerState,
  }))

  return await import(`../../libs/workflows/processing.ts`)
}

let tempDir = ''

function createDivision(id: string, overrides: Partial<Division> = {}): Division {
  return {
    id,
    country: 'HK',
    subtype: 'locality',
    names: { primary: `Division ${id}`, common: [] },
    hierarchies: [],
    ...overrides,
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

function createContext(overrides: Partial<ControlContext> = {}): ControlContext {
  return {
    releaseVersion: '2026-03-18.0',
    releaseContext: createReleaseContext(),
    themeMapping: { building: 'buildings', segment: 'transportation' },
    target: 'world',
    divisionId: null,
    division: null,
    bbox: null,
    geometry: null,
    skipBoundaryClip: true,
    clipMode: 'preserve',
    featureTypes: ['building'],
    featureNameWidth: 12,
    indexWidth: 2,
    outputDir: tempDir,
    onFileExists: 'replace',
    source: {
      env: {
        locale: 'en',
        outputDir: './data',
        releaseFn: 'releases.json',
        releaseUrl: 'https://example.com/releases',
        target: 'world',
        confirmFeatureSelection: true,
      },
      cli: {
        onFileExists: 'replace',
      },
      interactive: false,
    },
    ...overrides,
  }
}

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'overturist-processing-'))

  cacheDivisionsMock.mockClear()
  cacheSearchResultsMock.mockClear()
  getCachedDivisionMock.mockClear()
  getCachedSearchResultsMock.mockClear()
  connectionRunMock.mockClear()
  dbCloseMock.mockClear()
  fileExistsMock.mockClear()
  extractBoundsFromDivisionMock.mockClear()
  getDivisionsByIdsMock.mockClear()
  getDivisionsByNameMock.mockClear()
  getDivisionsBySourceRecordIdMock.mockClear()
  getFeaturesForBboxMock.mockClear()
  getFeaturesForGeomWithConnectionMock.mockClear()
  getFeaturesForWorldMock.mockClear()
  getLastReleaseCountMock.mockClear()
  localizeDivisionHierarchiesForReleaseMock.mockClear()
  normalizeOsmRelationRecordIdMock.mockClear()
  downloadParquetFilesMock.mockClear()
  applyProgressUpdateMock.mockClear()
  finalizeProgressDisplayMock.mockClear()
  handleSkippedFeatureMock.mockClear()
  updateProgressDisplayMock.mockClear()
  updateProgressStatusMock.mockClear()
  bailMock.mockClear()
  bailFromSpinnerMock.mockClear()
  getDiffCountMock.mockClear()
  spinnerState.start.mockClear()
  spinnerState.stop.mockClear()
  spinnerState.message.mockClear()
  logState.info.mockClear()
  logState.success.mockClear()
  logState.warn.mockClear()
  logState.error.mockClear()

  cacheDivisionsMock.mockImplementation(async () => {})
  cacheSearchResultsMock.mockImplementation(async () => {})
  getCachedDivisionMock.mockImplementation(async () => null)
  getCachedSearchResultsMock.mockImplementation(async () => false)
  connectionRunMock.mockImplementation(async () => {})
  dbCloseMock.mockImplementation(async () => {})
  fileExistsMock.mockImplementation(async () => false)
  extractBoundsFromDivisionMock.mockImplementation(async () => null)
  getDivisionsByIdsMock.mockImplementation(async () => [])
  getDivisionsByNameMock.mockImplementation(async () => [])
  getDivisionsBySourceRecordIdMock.mockImplementation(async () => [])
  getFeaturesForBboxMock.mockImplementation(
    async (
      _ctx: ControlContext,
      _featureType: string,
      _theme: string,
      _outputPath: string,
      onProgress?: (update?: ProgressUpdate) => void,
    ) => {
      onProgress?.({ stage: 'bbox', count: 3 })
      return { success: true, count: 3 }
    },
  )
  getFeaturesForGeomWithConnectionMock.mockImplementation(
    async (
      _connection: unknown,
      _ctx: ControlContext,
      _featureType: string,
      _theme: string,
      _outputPath: string,
      onProgress?: (update: ProgressUpdate) => void,
    ) => {
      onProgress?.({ stage: 'bbox', count: 2 })
      onProgress?.({ stage: 'geometry', count: 4 })
      return { success: true, finalCount: 4 }
    },
  )
  getFeaturesForWorldMock.mockImplementation(
    async (
      _featureType: string,
      _theme: string,
      _releaseVersion: string,
      _outputPath: string,
      onProgress?: (update?: ProgressUpdate) => void,
    ) => {
      onProgress?.({ stage: 'bbox', count: 7 })
      return { success: true, count: 7 }
    },
  )
  getLastReleaseCountMock.mockImplementation(async () => 2)
  localizeDivisionHierarchiesForReleaseMock.mockImplementation(
    async (_releaseVersion: string, divisions: Division[], _locale: string) =>
      divisions,
  )
  normalizeOsmRelationRecordIdMock.mockImplementation(
    (_value: string) => null as string | null,
  )
  downloadParquetFilesMock.mockImplementation(async () => {})
  bailMock.mockImplementation((msg?: string) => {
    throw new Error(msg ?? 'bail')
  })
  bailFromSpinnerMock.mockImplementation(
    (_spinner: unknown, _spinnerMsg: string, msg?: string) => {
      throw new Error(msg ?? 'bail')
    },
  )
  getDiffCountMock.mockImplementation(
    (currentCount: number, previousCount: number | null) =>
      previousCount === null ? null : currentCount - previousCount,
  )
})

afterEach(async () => {
  mock.restore()
  if (tempDir) {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

describe('processFeatureTypes', () => {
  test('initializes DuckDB once and processes world downloads through the world extractor', async () => {
    const { processFeatureTypes } = await loadProcessingModule()
    await processFeatureTypes(
      createContext({
        target: 'world',
        featureTypes: ['building'],
      }),
    )

    assert.equal(getFeaturesForWorldMock.mock.calls.length, 1)
    assert.equal(getFeaturesForBboxMock.mock.calls.length, 0)
    assert.equal(getFeaturesForGeomWithConnectionMock.mock.calls.length, 0)
    assert.equal(connectionRunMock.mock.calls.length, 1)
    assert.match(String(connectionRunMock.mock.calls[0]?.[0]), /INSTALL httpfs/)
    assert.equal(finalizeProgressDisplayMock.mock.calls.length, 1)
    assert.equal(dbCloseMock.mock.calls.length, 1)
  })

  test('creates boundary temp state and runs geometry extraction for division targets', async () => {
    const { processFeatureTypes } = await loadProcessingModule()
    await processFeatureTypes(
      createContext({
        target: 'division',
        divisionId: 'division-1',
        division: createDivision('division-1'),
        bbox: { xmin: 1, ymin: 2, xmax: 3, ymax: 4 },
        geometry: 'abcd1234',
        skipBoundaryClip: false,
      }),
    )

    assert.equal(connectionRunMock.mock.calls.length, 2)
    assert.match(
      String(connectionRunMock.mock.calls[1]?.[0]),
      /CREATE TEMP TABLE boundary_geom/,
    )
    assert.equal(getFeaturesForGeomWithConnectionMock.mock.calls.length, 1)
  })

  test('skips existing output files when onFileExists is skip', async () => {
    const { processFeatureTypes } = await loadProcessingModule()
    fileExistsMock.mockImplementationOnce(async () => true)

    await processFeatureTypes(
      createContext({
        target: 'world',
        onFileExists: 'skip',
      }),
    )

    assert.equal(handleSkippedFeatureMock.mock.calls.length, 1)
    assert.equal(getFeaturesForWorldMock.mock.calls.length, 0)
  })
})

describe('searchDivisions', () => {
  test('returns localized cached results when a search cache entry exists', async () => {
    const { searchDivisions } = await loadProcessingModule()
    getCachedSearchResultsMock.mockImplementationOnce(async () => ({
      results: [createDivision('cached-division')],
      totalCount: 1,
    }))
    localizeDivisionHierarchiesForReleaseMock.mockImplementationOnce(async () => [
      createDivision('localized-division'),
    ])

    const result = await searchDivisions(
      '2026-03-18.0',
      'central',
      ['locality'],
      2,
      'en',
    )

    assert.deepEqual(result, {
      results: [createDivision('localized-division')],
      totalCount: 1,
    })
    assert.equal(getDivisionsByNameMock.mock.calls.length, 0)
  })

  test('handles OSM relation searches and caches the results', async () => {
    const { searchDivisions } = await loadProcessingModule()
    normalizeOsmRelationRecordIdMock.mockImplementationOnce(() => 'r12345@%')
    getDivisionsBySourceRecordIdMock.mockImplementationOnce(async () => [
      createDivision('osm-division'),
    ])

    const result = await searchDivisions('2026-03-18.0', '12345', [], 99, 'en', false)

    assert.deepEqual(result, {
      results: [createDivision('osm-division')],
      totalCount: 1,
    })
    assert.equal(cacheSearchResultsMock.mock.calls.length, 1)
  })

  test('filters hierarchical searches using cached and fetched parent divisions', async () => {
    const { searchDivisions } = await loadProcessingModule()
    const initialResults = [
      createDivision('child-1', {
        names: { primary: 'Central', common: [] },
        hierarchies: [
          [
            { division_id: 'country-1', subtype: 'country', name: 'Hong Kong SAR' },
            { division_id: 'region-1', subtype: 'region', name: 'Hong Kong Island' },
            { division_id: 'child-1', subtype: 'locality', name: 'Central' },
          ],
        ],
      }),
      createDivision('child-2', {
        names: { primary: 'Central', common: [] },
        hierarchies: [
          [
            { division_id: 'country-1', subtype: 'country', name: 'Hong Kong SAR' },
            { division_id: 'region-2', subtype: 'region', name: 'Kowloon' },
            { division_id: 'child-2', subtype: 'locality', name: 'Central' },
          ],
        ],
      }),
    ]
    getDivisionsByNameMock.mockImplementationOnce(async () => initialResults)
    getCachedDivisionMock.mockImplementation(
      async (_version: string, divisionId: string) => {
        if (divisionId === 'country-1') {
          return createDivision('country-1', {
            subtype: 'country',
            names: {
              primary: 'Hong Kong SAR',
              common: [{ key: 'en', value: 'Hong Kong' }],
            },
          })
        }

        return null
      },
    )
    getDivisionsByIdsMock.mockImplementationOnce(async () => [
      createDivision('region-1', {
        subtype: 'region',
        names: {
          primary: 'Hong Kong Island',
          common: [{ key: 'en', value: 'Island' }],
        },
      }),
      createDivision('region-2', {
        subtype: 'region',
        names: { primary: 'Kowloon', common: [{ key: 'en', value: 'Kowloon' }] },
      }),
    ])

    const result = await searchDivisions(
      '2026-03-18.0',
      'Central, Island',
      ['locality'],
      3,
      'en',
      false,
    )

    assert.deepEqual(
      result.results.map(division => division.id),
      ['child-1'],
    )
    assert.equal(cacheSearchResultsMock.mock.calls.length, 1)
    assert.equal(cacheDivisionsMock.mock.calls.length, 2)
  })
})

describe('extractBoundsFromDivisionGeometry', () => {
  test('returns cached extracted bounds when they are already stored on the selected division', async () => {
    const { extractBoundsFromDivisionGeometry } = await loadProcessingModule()
    getCachedDivisionMock.mockImplementationOnce(
      async () =>
        createDivision('division-1', {
          bboxExtraction: { xmin: 1, ymin: 2, xmax: 3, ymax: 4 },
          geometryExtraction: 'cached-geometry',
          boundsExtractionDivisionId: 'division-1',
        }) as Division,
    )

    const result = await extractBoundsFromDivisionGeometry(
      '2026-03-18.0',
      createDivision('division-1', {
        hierarchies: [
          [{ division_id: 'division-1', subtype: 'locality', name: 'Central' }],
        ],
      }),
      'division-1',
    )

    assert.deepEqual(result, {
      bbox: { xmin: 1, ymin: 2, xmax: 3, ymax: 4 },
      geometry: 'cached-geometry',
      foundForDivisionId: 'division-1',
    })
    assert.equal(extractBoundsFromDivisionMock.mock.calls.length, 0)
  })

  test('falls back to a parent division and caches the extracted parent bounds on the selected division', async () => {
    const { extractBoundsFromDivisionGeometry } = await loadProcessingModule()
    const selectedDivision = createDivision('division-1', {
      hierarchies: [
        [
          { division_id: 'country-1', subtype: 'country', name: 'Hong Kong SAR' },
          { division_id: 'division-1', subtype: 'locality', name: 'Central' },
        ],
      ],
    })
    getCachedDivisionMock.mockImplementationOnce(async () => selectedDivision)
    extractBoundsFromDivisionMock.mockImplementationOnce(async () => null)
    extractBoundsFromDivisionMock.mockImplementationOnce(async () => ({
      bbox: { xmin: 1, ymin: 2, xmax: 3, ymax: 4 },
      geometry: 'parent-geometry',
    }))

    const result = await extractBoundsFromDivisionGeometry(
      '2026-03-18.0',
      selectedDivision,
      'division-1',
    )

    assert.deepEqual(result, {
      bbox: { xmin: 1, ymin: 2, xmax: 3, ymax: 4 },
      geometry: 'parent-geometry',
      foundForDivisionId: 'country-1',
    })
    assert.equal(cacheDivisionsMock.mock.calls.length, 1)
  })

  test('returns null when the selected division has no hierarchy information', async () => {
    const { extractBoundsFromDivisionGeometry } = await loadProcessingModule()
    const result = await extractBoundsFromDivisionGeometry(
      '2026-03-18.0',
      createDivision('division-1'),
      'division-1',
    )

    assert.equal(result, null)
    assert.equal(logState.warn.mock.calls.length, 1)
  })
})

describe('downloadFullDataset', () => {
  test('skips existing files when configured to skip', async () => {
    const { downloadFullDataset } = await loadProcessingModule()
    fileExistsMock.mockImplementationOnce(async () => true)

    await downloadFullDataset(
      createContext({
        featureTypes: ['building'],
        onFileExists: 'skip',
      }),
    )

    assert.equal(downloadParquetFilesMock.mock.calls.length, 0)
    assert.equal(logState.info.mock.calls.length, 1)
  })

  test('aborts early when configured to abort on existing files', async () => {
    const { downloadFullDataset } = await loadProcessingModule()
    fileExistsMock.mockImplementationOnce(async () => true)

    await downloadFullDataset(
      createContext({
        featureTypes: ['building'],
        onFileExists: 'abort',
      }),
    )

    assert.equal(downloadParquetFilesMock.mock.calls.length, 0)
    assert.equal(
      spinnerState.stop.mock.calls[0]?.[0],
      'Download aborted due to existing files',
    )
  })

  test('downloads files with a mapped theme and logs missing themes as warnings', async () => {
    const { downloadFullDataset } = await loadProcessingModule()
    downloadParquetFilesMock.mockImplementation(
      async (
        _version: string,
        _theme: string,
        _featureType: string,
        outputPath: string,
      ) => {
        await fs.writeFile(outputPath, '1234567890')
      },
    )

    await downloadFullDataset(
      createContext({
        featureTypes: ['building', 'unknown'],
        themeMapping: { building: 'buildings' },
      }),
    )

    assert.equal(downloadParquetFilesMock.mock.calls.length, 1)
    assert.equal(logState.success.mock.calls.length, 2)
    assert.equal(logState.warn.mock.calls.length, 1)
  })
})
