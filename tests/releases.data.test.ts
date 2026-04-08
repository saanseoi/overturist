import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, mock, test } from 'bun:test'
import type {
  CliArgs,
  Config,
  InteractiveOptions,
  OvertureRelease,
  ReleaseData,
} from '../libs/core'

const abs = (relativePath: string) => new URL(relativePath, import.meta.url).pathname

const getCachedReleasesMock = mock(async () => null as ReleaseData | null)
const cacheReleasesMock = mock(async () => {})
const getS3ReleasesMock = mock(async () => ({
  latest: '2026-03-18.0',
  s3Releases: ['2026-03-18.0'],
}))
const selectReleaseVersionMock = mock(async () => '2025-12-22.0')
const scrapeReleaseCalendarMock = mock(async () => [] as OvertureRelease[])
const bailMock = mock((msg?: string) => {
  throw new Error(msg ?? 'bail')
})
const bailFromSpinnerMock = mock(
  (_spinner: unknown, _spinnerMsg: string, msg?: string) => {
    throw new Error(msg ?? 'bailFromSpinner')
  },
)
const successExitMock = mock((msg?: string) => {
  throw new Error(msg ?? 'successExit')
})
const parseNaturalDateToISOMock = mock((dateText: string) => {
  const date = new Date(dateText)
  if (Number.isNaN(date.getTime())) {
    return null
  }

  return date.toISOString().slice(0, 10)
})
const logState = {
  message: mock(() => {}),
  warning: mock(() => {}),
}
const spinnerState = {
  start: mock(() => {}),
  stop: mock(() => {}),
  message: mock(() => {}),
}

function createConfig(overrides: Partial<Config> = {}): Config {
  return {
    locale: 'en',
    outputDir: './data',
    releaseFn: 'releases.json',
    releaseUrl: 'https://docs.overturemaps.org/release-calendar/',
    target: 'division',
    confirmFeatureSelection: true,
    spatialFrame: 'division',
    spatialPredicate: 'intersects',
    spatialGeometry: 'preserve',
    ...overrides,
  }
}

function createCliArgs(overrides: Partial<CliArgs> = {}): CliArgs {
  return {
    onFileExists: 'skip',
    ...overrides,
  }
}

async function loadReleasesModule() {
  mock.module(abs('../libs/data/cache.ts'), () => ({
    cacheReleases: cacheReleasesMock,
    getCachedReleases: getCachedReleasesMock,
  }))
  mock.module(abs('../libs/data/cache'), () => ({
    cacheReleases: cacheReleasesMock,
    getCachedReleases: getCachedReleasesMock,
  }))
  mock.module(abs('../libs/data/s3.ts'), () => ({
    getS3Releases: getS3ReleasesMock,
  }))
  mock.module(abs('../libs/data/s3'), () => ({
    getS3Releases: getS3ReleasesMock,
  }))
  mock.module(abs('../libs/ui.ts'), () => ({
    selectReleaseVersion: selectReleaseVersionMock,
  }))
  mock.module(abs('../libs/ui'), () => ({
    selectReleaseVersion: selectReleaseVersionMock,
  }))
  mock.module(abs('../libs/data/web.ts'), () => ({
    scrapeReleaseCalendar: scrapeReleaseCalendarMock,
  }))
  mock.module(abs('../libs/data/web'), () => ({
    scrapeReleaseCalendar: scrapeReleaseCalendarMock,
  }))
  mock.module(abs('../libs/core/utils.ts'), () => ({
    bail: bailMock,
    bailFromSpinner: bailFromSpinnerMock,
    parseNaturalDateToISO: parseNaturalDateToISOMock,
    successExit: successExitMock,
  }))
  mock.module(abs('../libs/core/utils'), () => ({
    bail: bailMock,
    bailFromSpinner: bailFromSpinnerMock,
    parseNaturalDateToISO: parseNaturalDateToISOMock,
    successExit: successExitMock,
  }))
  mock.module('@clack/prompts', () => ({
    log: logState,
    spinner: () => spinnerState,
  }))

  return await import(`../libs/data/releases.ts?test=${Date.now()}-${Math.random()}`)
}

beforeEach(() => {
  getCachedReleasesMock.mockClear()
  getCachedReleasesMock.mockImplementation(async () => null)
  cacheReleasesMock.mockClear()
  getS3ReleasesMock.mockClear()
  getS3ReleasesMock.mockImplementation(async () => ({
    latest: '2026-03-18.0',
    s3Releases: ['2026-03-18.0'],
  }))
  selectReleaseVersionMock.mockClear()
  selectReleaseVersionMock.mockImplementation(async () => '2025-12-22.0')
  scrapeReleaseCalendarMock.mockClear()
  scrapeReleaseCalendarMock.mockImplementation(async () => [])
  bailMock.mockClear()
  bailFromSpinnerMock.mockClear()
  parseNaturalDateToISOMock.mockClear()
  successExitMock.mockClear()
  logState.message.mockClear()
  logState.warning.mockClear()
  spinnerState.start.mockClear()
  spinnerState.stop.mockClear()
  spinnerState.message.mockClear()
})

afterEach(() => {
  mock.restore()
})

describe('initializeReleaseVersion', () => {
  test('prefers CLI releaseVersion over config and interactive options', async () => {
    const { initializeReleaseVersion } = await loadReleasesModule()

    const result = await initializeReleaseVersion(
      createConfig({ releaseVersion: '2025-12-22.0' }),
      createCliArgs({ releaseVersion: '2026-03-18.0' }),
      { releaseVersion: null } satisfies InteractiveOptions,
    )

    assert.equal(result.releaseVersion, '2026-03-18.0')
    assert.equal(selectReleaseVersionMock.mock.calls.length, 0)
  })

  test('prefers config over interactive selection when CLI is absent', async () => {
    const { initializeReleaseVersion } = await loadReleasesModule()
    getS3ReleasesMock.mockImplementation(async () => ({
      latest: '2026-03-18.0',
      s3Releases: ['2026-03-18.0', '2025-12-22.0'],
    }))

    const result = await initializeReleaseVersion(
      createConfig({ releaseVersion: '2025-12-22.0' }),
      createCliArgs(),
      { releaseVersion: null } satisfies InteractiveOptions,
    )

    assert.equal(result.releaseVersion, '2025-12-22.0')
    assert.equal(selectReleaseVersionMock.mock.calls.length, 0)
  })

  test('uses latest automatically in default or non-interactive mode', async () => {
    const { initializeReleaseVersion } = await loadReleasesModule()

    const undefinedMode = await initializeReleaseVersion(
      createConfig(),
      createCliArgs(),
    )
    const nonInteractiveMode = await initializeReleaseVersion(
      createConfig(),
      createCliArgs(),
      false,
    )

    assert.equal(undefinedMode.releaseVersion, '2026-03-18.0')
    assert.equal(nonInteractiveMode.releaseVersion, '2026-03-18.0')
  })

  test('prompts for selection only when interactive release selection is required', async () => {
    const { initializeReleaseVersion } = await loadReleasesModule()
    getS3ReleasesMock.mockImplementation(async () => ({
      latest: '2026-03-18.0',
      s3Releases: ['2026-03-18.0', '2025-12-22.0'],
    }))
    selectReleaseVersionMock.mockImplementation(async () => '2025-12-22.0')

    const result = await initializeReleaseVersion(createConfig(), createCliArgs(), {
      releaseVersion: null,
    } satisfies InteractiveOptions)

    assert.equal(result.releaseVersion, '2025-12-22.0')
    assert.equal(selectReleaseVersionMock.mock.calls.length, 1)
  })

  test('reuses cached release data for interactive initialization without blocking on refresh', async () => {
    const { initializeReleaseVersion } = await loadReleasesModule()
    getCachedReleasesMock.mockImplementation(async () => ({
      lastUpdated: '2026-04-06T00:00:00.000Z',
      lastChecked: '2026-04-07T00:00:00.000Z',
      source: 'cache',
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
    }))

    const result = await initializeReleaseVersion(createConfig(), createCliArgs(), {
      releaseVersion: null,
    } satisfies InteractiveOptions)

    assert.equal(result.releaseVersion, '2025-12-22.0')
    assert.equal(getS3ReleasesMock.mock.calls.length, 0)
    assert.equal(scrapeReleaseCalendarMock.mock.calls.length, 0)
    assert.equal(selectReleaseVersionMock.mock.calls.length, 1)
  })

  test('rejects selected versions that are not available on S3', async () => {
    const { initializeReleaseVersion } = await loadReleasesModule()

    await assert.rejects(
      initializeReleaseVersion(
        createConfig(),
        createCliArgs({ releaseVersion: '2026-02-01.0' }),
      ),
      /not available on S3/,
    )
    assert.equal(bailFromSpinnerMock.mock.calls.length, 1)
  })

  test('re-scrapes the release calendar even when cached latest matches S3 latest', async () => {
    const { initializeReleaseVersion } = await loadReleasesModule()
    getCachedReleasesMock.mockImplementation(async () => ({
      lastUpdated: '2026-03-18T00:00:00.000Z',
      lastChecked: '2026-03-18T00:00:00.000Z',
      source: 'cache',
      latest: '2026-03-18.0',
      totalReleases: 1,
      releases: [
        {
          version: '2026-03-18.0',
          date: '2026-03-18',
          schema: '1.16.0',
          isReleased: true,
          isAvailableOnS3: true,
        },
      ],
    }))
    scrapeReleaseCalendarMock.mockImplementation(async () => [
      {
        version: '2026-03-18.0',
        date: '2026-03-18',
        schema: '1.16.0',
        isReleased: true,
        isAvailableOnS3: false,
      },
      {
        version: '2026-02-18.0',
        date: '2026-02-18',
        schema: '1.16.0',
        isReleased: true,
        isAvailableOnS3: false,
      },
    ])

    const result = await initializeReleaseVersion(createConfig(), createCliArgs())

    assert.equal(scrapeReleaseCalendarMock.mock.calls.length, 1)
    assert.equal(
      result.releaseData.releases.some(release => release.version === '2026-02-18.0'),
      true,
    )
  })

  test('falls back to S3-only data when scraping fails and still caches the merged release data', async () => {
    const { initializeReleaseVersion } = await loadReleasesModule()
    getCachedReleasesMock.mockImplementation(async () => ({
      lastUpdated: '2026-01-01T00:00:00.000Z',
      lastChecked: '2026-01-01T00:00:00.000Z',
      source: 'cache',
      latest: '2025-12-22.0',
      totalReleases: 1,
      releases: [
        {
          version: '2025-12-22.0',
          date: '2025-12-22',
          schema: '1.15.0',
          isReleased: true,
          isAvailableOnS3: true,
        },
      ],
    }))
    getS3ReleasesMock.mockImplementation(async () => ({
      latest: '2026-03-18.0',
      s3Releases: ['2026-03-18.0', '2025-12-22.0'],
    }))
    scrapeReleaseCalendarMock.mockImplementation(async () => {
      throw new Error('fetch failed')
    })

    const result = await initializeReleaseVersion(createConfig(), createCliArgs())

    assert.equal(result.releaseData.latest, '2026-03-18.0')
    assert.equal(
      result.releaseData.releases.some(release => release.version === '2026-03-18.0'),
      true,
    )
    assert.equal(logState.warning.mock.calls.length, 1)
    assert.equal(cacheReleasesMock.mock.calls.length, 1)
  })

  test('exits successfully when S3 reports no releases', async () => {
    const { initializeReleaseVersion } = await loadReleasesModule()
    getS3ReleasesMock.mockImplementation(async () => ({
      latest: null,
      s3Releases: [],
    }))

    await assert.rejects(
      initializeReleaseVersion(createConfig(), createCliArgs()),
      /successExit/,
    )
    assert.equal(successExitMock.mock.calls.length, 1)
  })

  test('preserves released history after older releases roll off S3', async () => {
    const { initializeReleaseVersion } = await loadReleasesModule()
    getCachedReleasesMock.mockImplementation(async () => ({
      lastUpdated: '2026-04-06T00:00:00.000Z',
      lastChecked: '2026-04-06T00:00:00.000Z',
      source: 'cache',
      latest: '2026-03-18.0',
      totalReleases: 2,
      releases: [
        {
          version: '2025-12-17.0',
          date: '2025-12-17',
          schema: '1',
          isReleased: false,
          isAvailableOnS3: false,
        },
        {
          version: '2026-03-18.0',
          date: '2026-03-18',
          schema: '2',
          isReleased: true,
          isAvailableOnS3: true,
        },
      ],
    }))
    getS3ReleasesMock.mockImplementation(async () => ({
      latest: '2026-03-18.0',
      s3Releases: ['2026-03-18.0', '2026-02-18.0'],
    }))
    scrapeReleaseCalendarMock.mockImplementation(async () => [
      {
        version: '2026-03-18.0',
        date: '2026-03-18',
        schema: '1.16.0',
        isReleased: true,
        isAvailableOnS3: false,
      },
      {
        version: '2026-02-18.0',
        date: '2026-02-18',
        schema: '1.16.0',
        isReleased: true,
        isAvailableOnS3: false,
      },
      {
        version: '2025-12-17.0',
        date: '2025-12-17',
        schema: '1.15.0',
        isReleased: true,
        isAvailableOnS3: false,
      },
    ])

    const result = await initializeReleaseVersion(createConfig(), createCliArgs())

    assert.deepEqual(
      result.releaseData.releases.find(release => release.version === '2025-12-17.0'),
      {
        version: '2025-12-17.0',
        date: '2025-12-17',
        schema: '1.15.0',
        isReleased: true,
        isAvailableOnS3: false,
      },
    )
  })
})

describe('warmReleaseCacheForInteractiveStartup', () => {
  test('starts a refresh when the cached latest release is at least 21 days old and last check is stale', async () => {
    const { warmReleaseCacheForInteractiveStartup } = await loadReleasesModule()
    getCachedReleasesMock.mockImplementation(async () => ({
      lastUpdated: '2026-02-18T00:00:00.000Z',
      lastChecked: '2026-04-07T00:00:00.000Z',
      source: 'cache',
      latest: '2026-02-18.0',
      totalReleases: 1,
      releases: [
        {
          version: '2026-02-18.0',
          date: '2026-02-18',
          schema: '2',
          isReleased: true,
          isAvailableOnS3: true,
        },
      ],
    }))

    await warmReleaseCacheForInteractiveStartup(createConfig())
    await Promise.resolve()

    assert.equal(getS3ReleasesMock.mock.calls.length, 1)
  })

  test('skips startup refresh when the latest release is not yet 21 days old', async () => {
    const { warmReleaseCacheForInteractiveStartup } = await loadReleasesModule()
    getCachedReleasesMock.mockImplementation(async () => ({
      lastUpdated: '2026-04-06T00:00:00.000Z',
      lastChecked: '2026-04-08T12:00:00.000Z',
      source: 'cache',
      latest: '2026-03-25.0',
      totalReleases: 1,
      releases: [
        {
          version: '2026-03-25.0',
          date: '2026-03-25',
          schema: '2',
          isReleased: true,
          isAvailableOnS3: true,
        },
      ],
    }))

    await warmReleaseCacheForInteractiveStartup(createConfig())
    await Promise.resolve()

    assert.equal(getS3ReleasesMock.mock.calls.length, 0)
  })
})

describe('release context helpers', () => {
  test('returns null for unknown versions', async () => {
    const { getReleaseContext } = await loadReleasesModule()
    const releaseData: ReleaseData = {
      lastUpdated: '2026-04-06T00:00:00.000Z',
      lastChecked: '2026-04-06T00:00:00.000Z',
      source: 'test',
      latest: '2026-03-18.0',
      totalReleases: 1,
      releases: [
        {
          version: '2026-03-18.0',
          date: '2026-03-18',
          schema: '1.16.0',
          isReleased: true,
          isAvailableOnS3: true,
        },
      ],
    }

    assert.equal(getReleaseContext(releaseData, '2025-12-22.0'), null)
  })

  test('does not flag schema changes when either adjacent schema is unknown', async () => {
    const { getReleaseContext } = await loadReleasesModule()
    const releaseData: ReleaseData = {
      lastUpdated: '2026-04-06T00:00:00.000Z',
      lastChecked: '2026-04-06T00:00:00.000Z',
      source: 'test',
      latest: '2026-03-18.0',
      totalReleases: 2,
      releases: [
        {
          version: '2026-03-18.0',
          date: '2026-03-18',
          schema: 'Unknown',
          isReleased: true,
          isAvailableOnS3: true,
        },
        {
          version: '2025-12-22.0',
          date: '2025-12-22',
          schema: '1.15.0',
          isReleased: true,
          isAvailableOnS3: true,
        },
      ],
    }

    assert.equal(getReleaseContext(releaseData, '2026-03-18.0')?.isNewSchema, false)
  })

  test('returns null from preceding-release lookup when no prior S3 release exists or the version is absent', async () => {
    const { getPrecedingReleaseVersion } = await loadReleasesModule()
    const releaseData: ReleaseData = {
      lastUpdated: '2026-04-06T00:00:00.000Z',
      lastChecked: '2026-04-06T00:00:00.000Z',
      source: 'test',
      latest: '2026-03-18.0',
      totalReleases: 1,
      releases: [
        {
          version: '2026-03-18.0',
          date: '2026-03-18',
          schema: '1.16.0',
          isReleased: true,
          isAvailableOnS3: true,
        },
      ],
    }

    assert.equal(getPrecedingReleaseVersion('2026-03-18.0', releaseData), null)
    assert.equal(getPrecedingReleaseVersion('2025-12-22.0', releaseData), null)
  })
})
