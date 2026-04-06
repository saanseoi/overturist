import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, mock, test } from 'bun:test'
import type {
  CliArgs,
  Config,
  ControlContext,
  Division,
  ReleaseContext,
  ReleaseData,
  ThemeMapping,
} from '../../libs/core'

const abs = (relativePath: string) => new URL(relativePath, import.meta.url).pathname

const initializeLocaleMock = mock(() => ({ locale: 'en' }))
const initializeTargetMock = mock(() => ({ target: 'division' as const }))
const initializeBoundsMock = mock(async () => ({
  bbox: { xmin: 1, ymin: 2, xmax: 3, ymax: 4 },
  skipBoundaryClip: false,
  clipMode: 'preserve' as const,
  geometry: 'geom-hex',
}))
const setupGracefulExitMock = mock(() => {})

const initializeDivisionMock = mock(
  async () =>
    ({
      divisionId: 'division-1',
      division: createDivision('division-1'),
    }) as { divisionId: string; division: Division },
)
const initializeOutputDirMock = mock(async () => ({ outputDir: '/tmp/output' }))
const initializeFileHandlingMock = mock(async () => ({ onFileExists: 'skip' as const }))
const processFeatureTypesMock = mock(async () => {})
const initializeReleaseVersionMock = mock(
  async () =>
    ({
      releaseVersion: '2026-03-18.0',
      releaseData: createReleaseData(),
      releaseContext: createReleaseContext(),
    }) as {
      releaseVersion: string
      releaseData: ReleaseData
      releaseContext: ReleaseContext
    },
)
const initializeThemeMappingMock = mock(
  async () =>
    ({
      themeMapping: { building: 'buildings' } as ThemeMapping,
      featureTypes: ['building'],
    }) as { themeMapping: ThemeMapping; featureTypes: string[] },
)
const calculateColumnWidthsMock = mock(() => ({ featureNameWidth: 12, indexWidth: 2 }))
const displayExtractionPlanMock = mock(() => {})
const displayTableHeaderMock = mock(() => {})

async function loadGetModule() {
  mock.module(abs('../../libs/core/config.ts'), () => ({
    initializeBounds: initializeBoundsMock,
    initializeLocale: initializeLocaleMock,
    initializeTarget: initializeTargetMock,
  }))
  mock.module(abs('../../libs/workflows/divisions.ts'), () => ({
    initializeDivision: initializeDivisionMock,
  }))
  mock.module(abs('../../libs/core/fs.ts'), () => ({
    initializeFileHandling: initializeFileHandlingMock,
    initializeOutputDir: initializeOutputDirMock,
  }))
  mock.module(abs('../../libs/workflows/processing.ts'), () => ({
    processFeatureTypes: processFeatureTypesMock,
  }))
  mock.module(abs('../../libs/data/releases.ts'), () => ({
    initializeReleaseVersion: initializeReleaseVersionMock,
  }))
  mock.module(abs('../../libs/workflows/themes.ts'), () => ({
    initializeThemeMapping: initializeThemeMappingMock,
  }))
  mock.module(abs('../../libs/ui'), () => ({
    calculateColumnWidths: calculateColumnWidthsMock,
    displayExtractionPlan: displayExtractionPlanMock,
    displayTableHeader: displayTableHeaderMock,
  }))
  mock.module(abs('../../libs/core/utils.ts'), () => ({
    setupGracefulExit: setupGracefulExitMock,
  }))

  return await import(`../../libs/workflows/get.ts`)
}

function createDivision(id: string): Division {
  return {
    id,
    country: 'HK',
    subtype: 'locality',
    names: { primary: 'Central', common: [] },
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

function createReleaseData(): ReleaseData {
  return {
    lastUpdated: '2026-04-06T00:00:00.000Z',
    lastChecked: '2026-04-06T00:00:00.000Z',
    source: 'test',
    latest: '2026-03-18.0',
    totalReleases: 1,
    releases: [
      {
        version: '2026-03-18.0',
        date: '2026-03-18',
        schema: '2',
        isReleased: true,
        isAvailableOnS3: true,
      },
    ],
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

function createControlContext(): ControlContext {
  const config = createConfig()
  const cliArgs = createCliArgs()
  const division = createDivision('division-1')

  return {
    releaseVersion: '2026-03-18.0',
    releaseContext: createReleaseContext(),
    themeMapping: { building: 'buildings' },
    target: 'division',
    divisionId: division.id,
    division,
    bbox: { xmin: 1, ymin: 2, xmax: 3, ymax: 4 },
    geometry: 'geom-hex',
    skipBoundaryClip: false,
    clipMode: 'preserve',
    featureTypes: ['building'],
    featureNameWidth: 12,
    indexWidth: 2,
    outputDir: '/tmp/output',
    onFileExists: 'skip',
    source: {
      env: config,
      cli: cliArgs,
      interactive: false,
    },
  }
}

beforeEach(() => {
  initializeLocaleMock.mockClear()
  initializeTargetMock.mockClear()
  initializeBoundsMock.mockClear()
  setupGracefulExitMock.mockClear()
  initializeDivisionMock.mockClear()
  initializeOutputDirMock.mockClear()
  initializeFileHandlingMock.mockClear()
  processFeatureTypesMock.mockClear()
  initializeReleaseVersionMock.mockClear()
  initializeThemeMappingMock.mockClear()
  calculateColumnWidthsMock.mockClear()
  displayExtractionPlanMock.mockClear()
  displayTableHeaderMock.mockClear()
})

afterEach(() => {
  mock.restore()
})

describe('resolveOptions', () => {
  test('builds the full control context from workflow initializers', async () => {
    const { resolveOptions } = await loadGetModule()
    const config = createConfig()
    const cliArgs = createCliArgs({ locale: 'zh-hk' })

    const context = await resolveOptions(config, cliArgs, false)

    assert.deepEqual(context, {
      releaseVersion: '2026-03-18.0',
      releaseContext: createReleaseContext(),
      themeMapping: { building: 'buildings' },
      target: 'division',
      divisionId: 'division-1',
      division: createDivision('division-1'),
      bbox: { xmin: 1, ymin: 2, xmax: 3, ymax: 4 },
      geometry: 'geom-hex',
      skipBoundaryClip: false,
      clipMode: 'preserve',
      featureTypes: ['building'],
      featureNameWidth: 12,
      indexWidth: 2,
      outputDir: '/tmp/output',
      onFileExists: 'skip',
      source: {
        env: config,
        cli: cliArgs,
        interactive: false,
      },
    })

    assert.equal(setupGracefulExitMock.mock.calls.length, 1)
    assert.equal(initializeReleaseVersionMock.mock.calls.length, 1)
    assert.equal(initializeLocaleMock.mock.calls.length, 1)
    assert.equal(initializeTargetMock.mock.calls.length, 1)
    assert.equal(initializeDivisionMock.mock.calls.length, 1)
    assert.equal(initializeThemeMappingMock.mock.calls.length, 1)
    assert.equal(initializeBoundsMock.mock.calls.length, 1)
    assert.equal(initializeOutputDirMock.mock.calls.length, 1)
    assert.equal(calculateColumnWidthsMock.mock.calls.length, 1)
    assert.equal(initializeFileHandlingMock.mock.calls.length, 1)

    assert.deepEqual(initializeBoundsMock.mock.calls[0], [
      config,
      cliArgs,
      'division',
      createDivision('division-1'),
      'division-1',
      '2026-03-18.0',
    ])
    assert.deepEqual(initializeFileHandlingMock.mock.calls[0], [
      config,
      cliArgs,
      false,
      ['building'],
      '/tmp/output',
      'preserve',
    ])
  })
})

describe('executeDownloadWorkflow', () => {
  test('renders the plan and processes feature types', async () => {
    const { executeDownloadWorkflow } = await loadGetModule()
    const ctx = createControlContext()

    const result = await executeDownloadWorkflow(ctx)

    assert.equal(result, true)
    assert.deepEqual(displayExtractionPlanMock.mock.calls[0], [ctx])
    assert.deepEqual(displayTableHeaderMock.mock.calls[0], [ctx])
    assert.deepEqual(processFeatureTypesMock.mock.calls[0], [ctx])
  })
})

describe('getCmd', () => {
  test('resolves options non-interactively and executes the workflow', async () => {
    const { getCmd } = await loadGetModule()
    const config = createConfig()
    const cliArgs = createCliArgs()

    await getCmd(config, cliArgs)

    assert.equal(initializeReleaseVersionMock.mock.calls.length, 1)
    assert.deepEqual(initializeReleaseVersionMock.mock.calls[0], [
      config,
      cliArgs,
      false,
    ])
    assert.equal(processFeatureTypesMock.mock.calls.length, 1)
    assert.equal(displayExtractionPlanMock.mock.calls.length, 1)
    assert.equal(displayTableHeaderMock.mock.calls.length, 1)
  })
})
