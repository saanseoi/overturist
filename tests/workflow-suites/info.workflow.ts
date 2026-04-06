import assert from 'node:assert/strict'
import path from 'node:path'
import { afterEach, beforeEach, describe, mock, test } from 'bun:test'
import type { CliArgs, Config, Division, ReleaseContext } from '../../libs/core'

const abs = (relativePath: string) => new URL(relativePath, import.meta.url).pathname

const initializeLocaleMock = mock(() => ({ locale: 'en' }))
const initializeDivisionMock = mock(async () => ({
  divisionId: 'division-1',
  division: createDivision('division-1'),
}))
const ensureDirectoryExistsMock = mock(async () => {})
const getOutputDirMock = mock(() => '/tmp/info-output')
const writeJsonFileMock = mock(async () => {})
const initializeReleaseVersionMock = mock(async () => ({
  releaseVersion: '2026-03-18.0',
  releaseContext: createReleaseContext(),
}))
const displayDivisionInfoMock = mock(() => {})
const bailFromSpinnerMock = mock(
  (_spinner: unknown, _spinnerMsg: string, msg?: string) => {
    throw new Error(msg ?? 'bail')
  },
)

const spinnerState = {
  start: mock(() => {}),
  stop: mock(() => {}),
  message: mock(() => {}),
}

async function loadInfoModule() {
  mock.module(abs('../../libs/core/config.ts'), () => ({
    initializeLocale: initializeLocaleMock,
  }))
  mock.module(abs('../../libs/workflows/divisions.ts'), () => ({
    initializeDivision: initializeDivisionMock,
  }))
  mock.module(abs('../../libs/core/fs.ts'), () => ({
    ensureDirectoryExists: ensureDirectoryExistsMock,
    getOutputDir: getOutputDirMock,
    writeJsonFile: writeJsonFileMock,
  }))
  mock.module(abs('../../libs/data/releases.ts'), () => ({
    initializeReleaseVersion: initializeReleaseVersionMock,
  }))
  mock.module(abs('../../libs/ui'), () => ({
    displayDivisionInfo: displayDivisionInfoMock,
  }))
  mock.module(abs('../../libs/core/utils.ts'), () => ({
    bailFromSpinner: bailFromSpinnerMock,
  }))
  mock.module('@clack/prompts', () => ({
    spinner: () => spinnerState,
  }))

  return await import(`../../libs/workflows/info.ts`)
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

beforeEach(() => {
  initializeLocaleMock.mockClear()
  initializeDivisionMock.mockClear()
  ensureDirectoryExistsMock.mockClear()
  getOutputDirMock.mockClear()
  writeJsonFileMock.mockClear()
  initializeReleaseVersionMock.mockClear()
  displayDivisionInfoMock.mockClear()
  bailFromSpinnerMock.mockClear()
  spinnerState.start.mockClear()
  spinnerState.stop.mockClear()
  spinnerState.message.mockClear()
})

afterEach(() => {
  mock.restore()
})

describe('resolveDivisionInfoContext', () => {
  test('builds the division info context and ensures the output directory exists', async () => {
    const { resolveDivisionInfoContext } = await loadInfoModule()
    const config = createConfig()
    const cliArgs = createCliArgs()

    const ctx = await resolveDivisionInfoContext(config, cliArgs, false)

    assert.deepEqual(ctx, {
      releaseVersion: '2026-03-18.0',
      releaseContext: createReleaseContext(),
      divisionId: 'division-1',
      division: createDivision('division-1'),
      outputDir: '/tmp/info-output',
    })
    assert.deepEqual(getOutputDirMock.mock.calls[0], [
      'division',
      config,
      '2026-03-18.0',
      createDivision('division-1'),
      null,
    ])
    assert.deepEqual(ensureDirectoryExistsMock.mock.calls[0], ['/tmp/info-output'])
  })

  test('throws when no division is selected', async () => {
    const { resolveDivisionInfoContext } = await loadInfoModule()
    initializeDivisionMock.mockImplementationOnce(async () => ({
      divisionId: null,
      division: null,
    }))

    await assert.rejects(
      resolveDivisionInfoContext(createConfig(), createCliArgs(), false),
      /No division selected/,
    )
  })
})

describe('persistAndDisplayDivisionInfo', () => {
  test('writes division.json with the release version and displays the payload', async () => {
    const { persistAndDisplayDivisionInfo } = await loadInfoModule()
    const ctx = {
      releaseVersion: '2026-03-18.0',
      releaseContext: createReleaseContext(),
      divisionId: 'division-1',
      division: createDivision('division-1'),
      outputDir: '/tmp/info-output',
    }

    await persistAndDisplayDivisionInfo(ctx)

    const expectedOutputFile = path.join('/tmp/info-output', 'division.json')
    const expectedPayload = {
      ...createDivision('division-1'),
      releaseVersion: '2026-03-18.0',
    }

    assert.deepEqual(writeJsonFileMock.mock.calls[0], [
      expectedOutputFile,
      expectedPayload,
    ])
    assert.deepEqual(displayDivisionInfoMock.mock.calls[0], [ctx, expectedPayload])
    assert.equal(spinnerState.start.mock.calls.length, 1)
    assert.equal(spinnerState.stop.mock.calls.length, 1)
  })

  test('bails through the spinner helper when persistence fails', async () => {
    const { persistAndDisplayDivisionInfo } = await loadInfoModule()
    writeJsonFileMock.mockImplementationOnce(async () => {
      throw new Error('disk full')
    })

    await assert.rejects(
      persistAndDisplayDivisionInfo({
        releaseVersion: '2026-03-18.0',
        releaseContext: createReleaseContext(),
        divisionId: 'division-1',
        division: createDivision('division-1'),
        outputDir: '/tmp/info-output',
      }),
      /disk full/,
    )

    assert.equal(bailFromSpinnerMock.mock.calls.length, 1)
    assert.equal(spinnerState.stop.mock.calls.length, 0)
  })
})

describe('infoCmd', () => {
  test('resolves the context and persists the selected division info', async () => {
    const { infoCmd } = await loadInfoModule()
    await infoCmd(createConfig(), createCliArgs(), false)

    assert.equal(initializeReleaseVersionMock.mock.calls.length, 1)
    assert.equal(initializeDivisionMock.mock.calls.length, 1)
    assert.equal(writeJsonFileMock.mock.calls.length, 1)
    assert.equal(displayDivisionInfoMock.mock.calls.length, 1)
  })
})
