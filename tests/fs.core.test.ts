import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, mock, test } from 'bun:test'
import type { CliArgs, Config, Division } from '../libs/core'

const abs = (relativePath: string) => new URL(relativePath, import.meta.url).pathname

const determineActionOnExistingFilesMock = mock(async () => 'skip' as const)
const bailMock = mock((msg?: string) => {
  throw new Error(msg ?? 'bail')
})
const failedExitMock = mock((msg?: string) => {
  throw new Error(msg ?? 'failedExit')
})

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

async function loadFsModule() {
  mock.module(abs('../libs/ui/index.ts'), () => ({
    determineActionOnExistingFiles: determineActionOnExistingFilesMock,
  }))
  mock.module(abs('../libs/ui/index'), () => ({
    determineActionOnExistingFiles: determineActionOnExistingFilesMock,
  }))
  mock.module(abs('../libs/ui.ts'), () => ({
    determineActionOnExistingFiles: determineActionOnExistingFilesMock,
  }))
  mock.module(abs('../libs/ui'), () => ({
    determineActionOnExistingFiles: determineActionOnExistingFilesMock,
  }))
  mock.module(abs('../libs/core/utils.ts'), () => ({
    bail: bailMock,
    failedExit: failedExitMock,
  }))
  mock.module(abs('../libs/core/utils'), () => ({
    bail: bailMock,
    failedExit: failedExitMock,
  }))

  return await import('../libs/core/fs.ts')
}

beforeEach(() => {
  determineActionOnExistingFilesMock.mockClear()
  determineActionOnExistingFilesMock.mockImplementation(async () => 'skip')
  bailMock.mockClear()
  failedExitMock.mockClear()
})

afterEach(() => {
  mock.restore()
})

describe('getOutputDir error paths', () => {
  test('fails when division target does not have hierarchies', async () => {
    const { getOutputDir } = await loadFsModule()

    assert.throws(
      () =>
        getOutputDir(
          'division',
          createConfig(),
          '2025-12-22.0',
          createDivision({ hierarchies: undefined as never }),
          null,
        ),
      /Missing hierarchies for division/,
    )
  })

  test('fails when bbox target does not have a bbox', async () => {
    const { getOutputDir } = await loadFsModule()

    assert.throws(
      () => getOutputDir('bbox', createConfig(), '2025-12-22.0', null, null),
      /Missing bbox/,
    )
  })
})

describe('initializeFileHandling', () => {
  test('passes existing files and configured preference to the UI helper', async () => {
    const { initializeFileHandling } = await loadFsModule()

    const result = await initializeFileHandling(
      createConfig({ onFileExists: 'replace' }),
      createCliArgs({ onFileExists: 'abort' }),
      false,
      [],
      '/tmp/nonexistent-output',
      'all',
    )

    assert.equal(result.onFileExists, 'skip')
    assert.deepEqual(determineActionOnExistingFilesMock.mock.calls[0], [
      [],
      'replace',
      false,
    ])
  })

  test('detects existing parquet files before delegating file handling', async () => {
    const { initializeFileHandling } = await loadFsModule()
    const fs = await import('node:fs/promises')
    const os = await import('node:os')
    const path = await import('node:path')

    const outputDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'overturist-file-handling-'),
    )

    try {
      await fs.writeFile(path.join(outputDir, 'building.parquet'), '')

      await initializeFileHandling(
        createConfig(),
        createCliArgs({ onFileExists: 'skip' }),
        undefined,
        ['building', 'address'],
        outputDir,
        'smart',
      )

      assert.deepEqual(determineActionOnExistingFilesMock.mock.calls[0], [
        ['building'],
        'skip',
        undefined,
      ])
    } finally {
      await fs.rm(outputDir, { recursive: true, force: true })
    }
  })

  test('exits early when file handling resolves to abort', async () => {
    determineActionOnExistingFilesMock.mockImplementation(async () => 'abort')
    const { initializeFileHandling } = await loadFsModule()

    await assert.rejects(
      () =>
        initializeFileHandling(
          createConfig(),
          createCliArgs(),
          false,
          [],
          '/tmp/nonexistent-output',
          'smart',
        ),
      /Aborting file handling/,
    )

    assert.equal(failedExitMock.mock.calls.length, 1)
  })
})
