import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, mock, test } from 'bun:test'
import type { CliArgs, Config } from '../../libs/core'

const abs = (relativePath: string) => new URL(relativePath, import.meta.url).pathname

const confirmMock = mock(async () => true)
const logState = {
  warning: mock(() => {}),
  info: mock(() => {}),
  message: mock(() => {}),
  error: mock(() => {}),
  success: mock(() => {}),
}
const reloadConfigMock = mock(() => {})

async function loadSettingsModule() {
  mock.module('@clack/prompts', () => ({
    confirm: confirmMock,
    log: logState,
  }))
  mock.module(abs('../../libs/core/config.ts'), () => ({
    reloadConfig: reloadConfigMock,
  }))
  mock.module(abs('../../libs/core/config'), () => ({
    reloadConfig: reloadConfigMock,
  }))

  return await import(`../../libs/workflows/settings.ts`)
}

const originalCwd = process.cwd()
const originalConsoleLog = console.log

let tempDir = ''
const consoleLogMock = mock(() => {})

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

beforeEach(async () => {
  confirmMock.mockClear()
  logState.warning.mockClear()
  logState.info.mockClear()
  logState.message.mockClear()
  logState.error.mockClear()
  logState.success.mockClear()
  reloadConfigMock.mockClear()
  consoleLogMock.mockClear()

  confirmMock.mockImplementation(async () => true)
  reloadConfigMock.mockImplementation(() => {})
  console.log = consoleLogMock as typeof console.log

  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'overturist-settings-'))
  process.chdir(tempDir)
})

afterEach(async () => {
  mock.restore()
  process.chdir(originalCwd)
  console.log = originalConsoleLog

  if (tempDir) {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

describe('showPreferences', () => {
  test('warns when no .env file exists', async () => {
    const { showPreferences } = await loadSettingsModule()
    await showPreferences()

    assert.equal(logState.warning.mock.calls.length, 1)
    assert.match(String(logState.warning.mock.calls[0]?.[0]), /No \.env file found/)
  })

  test('parses active env assignments and preserves empty values', async () => {
    const { showPreferences } = await loadSettingsModule()
    await fs.writeFile(
      path.join(tempDir, '.env'),
      ['# comment', 'LOCALE=en', 'EMPTY=', '', 'FEATURE_TYPES=building,segment'].join(
        '\n',
      ),
    )

    await showPreferences()

    assert.equal(logState.info.mock.calls.length >= 1, true)
    assert.deepEqual(
      logState.message.mock.calls.map(call => call[0]),
      ['LOCALE: en', 'EMPTY: ', 'FEATURE_TYPES: building,segment'],
    )
  })
})

describe('resetPreferences', () => {
  test('copies .env.example into .env and reloads config when confirmed', async () => {
    const { resetPreferences } = await loadSettingsModule()
    await fs.writeFile(path.join(tempDir, '.env.example'), 'LOCALE=fr\n')

    const config = createConfig()
    const cliArgs = createCliArgs()

    await resetPreferences(config, cliArgs)

    assert.equal(await fs.readFile(path.join(tempDir, '.env'), 'utf-8'), 'LOCALE=fr\n')
    assert.equal(confirmMock.mock.calls.length, 1)
    assert.equal(reloadConfigMock.mock.calls.length, 1)
    assert.deepEqual(reloadConfigMock.mock.calls[0], [config])
  })

  test('cancels without changing files when confirmation is declined', async () => {
    const { resetPreferences } = await loadSettingsModule()
    confirmMock.mockImplementationOnce(async () => false)
    await fs.writeFile(path.join(tempDir, '.env'), 'LOCALE=en\n')
    await fs.writeFile(path.join(tempDir, '.env.example'), 'LOCALE=fr\n')

    await resetPreferences(createConfig(), createCliArgs())

    assert.equal(await fs.readFile(path.join(tempDir, '.env'), 'utf-8'), 'LOCALE=en\n')
    assert.equal(
      logState.info.mock.calls.some(call => /cancelled/i.test(call[0])),
      true,
    )
  })

  test('deletes .env when no example file exists', async () => {
    const { resetPreferences } = await loadSettingsModule()
    await fs.writeFile(path.join(tempDir, '.env'), 'LOCALE=en\n')

    await resetPreferences()

    await assert.rejects(fs.access(path.join(tempDir, '.env')))
    assert.equal(logState.success.mock.calls.length, 1)
  })
})

describe('showCacheStats', () => {
  test('warns when the cache directory is missing', async () => {
    const { showCacheStats } = await loadSettingsModule()
    await showCacheStats()

    assert.equal(logState.warning.mock.calls.length, 1)
    assert.match(
      String(logState.warning.mock.calls[0]?.[0]),
      /No cache directory found/,
    )
  })

  test('prints directory summaries for nested cache contents', async () => {
    const { showCacheStats } = await loadSettingsModule()
    const cacheRoot = path.join(tempDir, '.cache', '2026-03-18.0', 'division')
    await fs.mkdir(cacheRoot, { recursive: true })
    await fs.writeFile(path.join(cacheRoot, 'division-1.json'), '1234')

    await showCacheStats()

    assert.equal(logState.info.mock.calls.length >= 1, true)
    assert.equal(consoleLogMock.mock.calls.length > 0, true)
  })
})

describe('purgeCache', () => {
  test('cancels without deleting the cache when not confirmed', async () => {
    const { purgeCache } = await loadSettingsModule()
    confirmMock.mockImplementationOnce(async () => false)
    await fs.mkdir(path.join(tempDir, '.cache'), { recursive: true })

    await purgeCache()

    await fs.access(path.join(tempDir, '.cache'))
    assert.equal(
      logState.info.mock.calls.some(call => /cancelled/i.test(call[0])),
      true,
    )
  })

  test('removes the cache directory when confirmed', async () => {
    const { purgeCache } = await loadSettingsModule()
    await fs.mkdir(path.join(tempDir, '.cache', 'v1'), { recursive: true })
    await fs.writeFile(path.join(tempDir, '.cache', 'v1', 'data.json'), '1')

    await purgeCache()

    await assert.rejects(fs.access(path.join(tempDir, '.cache')))
    assert.equal(logState.success.mock.calls.length, 1)
  })
})
