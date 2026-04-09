import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeEach, describe, mock, test } from 'bun:test'
import type { Division, ReleaseData } from '../libs/core'

const abs = (relativePath: string) => new URL(relativePath, import.meta.url).pathname
const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'overturist-cache-'))
const cacheRoot = path.join(tempRoot, 'cache-root')

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

async function writeJsonFile(filePath: string, data: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(data, null, 2))
}

async function loadCacheModule() {
  const ensureDirectoryExists = async (dirPath: string) => {
    await fs.mkdir(dirPath, { recursive: true })
  }

  const readJsonFile = async <T>(filePath: string): Promise<T | null> => {
    try {
      return JSON.parse(await fs.readFile(filePath, 'utf8')) as T
    } catch {
      return null
    }
  }

  const readDirectoryEntries = async (dirPath: string) => {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true })
      return entries.map(entry => ({
        name: entry.name,
        isDirectory: entry.isDirectory(),
      }))
    } catch {
      return []
    }
  }

  const directoryHasJsonFiles = async (dirPath: string) => {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true })
      return entries.some(entry => entry.isFile() && entry.name.endsWith('.json'))
    } catch {
      return false
    }
  }

  mock.module(abs('../libs/core/fs.ts'), () => ({
    CACHE_DIR: cacheRoot,
    directoryHasJsonFiles,
    ensureDirectoryExists,
    readDirectoryEntries,
    readJsonFile,
    writeJsonFile,
  }))
  mock.module(abs('../libs/core/fs'), () => ({
    CACHE_DIR: cacheRoot,
    directoryHasJsonFiles,
    ensureDirectoryExists,
    readDirectoryEntries,
    readJsonFile,
    writeJsonFile,
  }))

  return await import(`../libs/data/cache.ts?test=${Date.now()}-${Math.random()}`)
}

beforeEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true })
  await fs.mkdir(cacheRoot, { recursive: true })
})

afterEach(() => {
  mock.restore()
})

afterAll(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true })
})

describe('cache temp paths', () => {
  test('rewrites output paths into mirrored cache paths and creates parent directories', async () => {
    const workspaceRoot = path.join(tempRoot, 'workspace-1')
    const originalCwd = process.cwd()
    await fs.mkdir(workspaceRoot, { recursive: true })
    process.chdir(workspaceRoot)

    try {
      const { getTempCachePath } = await loadCacheModule()
      const cachePath = await getTempCachePath('data/2026-03-18.0/hk/building.parquet')

      assert.equal(
        cachePath,
        path.join('.cache', '2026-03-18.0', 'hk', 'building.parquet'),
      )

      const stat = await fs.stat(path.dirname(cachePath))
      assert.equal(stat.isDirectory(), true)
    } finally {
      process.chdir(originalCwd)
    }
  })

  test('supports absolute workspace paths and custom cache filenames', async () => {
    const workspaceRoot = path.join(tempRoot, 'workspace-2')
    const originalCwd = process.cwd()
    await fs.mkdir(path.join(workspaceRoot, 'data/2026-03-18.0/hk'), {
      recursive: true,
    })
    process.chdir(workspaceRoot)

    try {
      const { getTempCachePath } = await loadCacheModule()
      const outputFile = path.join(
        workspaceRoot,
        'data/2026-03-18.0/hk/building.parquet',
      )

      const cachePath = await getTempCachePath(outputFile, 'bbox.parquet')

      assert.equal(cachePath, path.join('.cache', '2026-03-18.0', 'hk', 'bbox.parquet'))
    } finally {
      process.chdir(originalCwd)
    }
  })

  test('rejects paths outside the workspace', async () => {
    const workspaceRoot = path.join(tempRoot, 'workspace-3')
    const originalCwd = process.cwd()
    await fs.mkdir(workspaceRoot, { recursive: true })
    process.chdir(workspaceRoot)

    try {
      const { getTempCachePath } = await loadCacheModule()
      await assert.rejects(
        getTempCachePath('../outside/file.parquet'),
        /Cannot derive cache path outside workspace/,
      )
    } finally {
      process.chdir(originalCwd)
    }
  })
})

describe('division cache', () => {
  test('round-trips cached divisions with canonical bbox coordinates intact', async () => {
    const { cacheDivision, getCachedDivision } = await loadCacheModule()
    const division = createDivision('gers:1', {
      bbox: { xmin: 1, ymin: 2, xmax: 3, ymax: 4 },
    })

    await cacheDivision('2026-03-18.0', division.id, division)

    const cached = await getCachedDivision('2026-03-18.0', division.id)

    assert.deepEqual(cached, division)
  })

  test('returns null for invalid cached division payloads', async () => {
    const { getCachedDivision } = await loadCacheModule()
    await writeJsonFile(
      path.join(cacheRoot, '2026-03-18.0/division/gers-invalid.json'),
      { id: 'gers-invalid', bbox: { xmin: 1, ymin: 2, xmax: 3, ymax: 4 } },
    )

    const cached = await getCachedDivision('2026-03-18.0', 'gers-invalid')

    assert.equal(cached, null)
  })
})

describe('release cache', () => {
  test('writes releases in ascending version order', async () => {
    const { cacheReleases } = await loadCacheModule()
    const releaseData: ReleaseData = {
      lastUpdated: '2026-04-06T00:00:00.000Z',
      lastChecked: '2026-04-06T00:00:00.000Z',
      source: 'test',
      latest: '2026-03-18.0',
      totalReleases: 3,
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
        {
          version: '2026-01-15.0',
          date: '2026-01-15',
          schema: '1',
          isReleased: true,
          isAvailableOnS3: true,
        },
      ],
    }

    await cacheReleases(releaseData)

    const cached = JSON.parse(
      await fs.readFile(path.join(cacheRoot, 'releases.json'), 'utf8'),
    ) as ReleaseData

    assert.deepEqual(
      cached.releases.map(release => release.version),
      ['2025-12-22.0', '2026-01-15.0', '2026-03-18.0'],
    )
  })
})

describe('search cache', () => {
  test('stores search results under a sanitized filename and returns cache metadata', async () => {
    const { cacheSearchResults, getCachedSearchResults } = await loadCacheModule()
    const term = `Central %/_:"<>|?* Zone`
    await cacheSearchResults('2026-03-18.0', 2, term, {
      totalCount: 1,
      results: [createDivision('gers:central')],
    })

    const cached = await getCachedSearchResults('2026-03-18.0', 2, term)

    assert.ok(cached)
    assert.equal(cached.term, term)
    const cachedFilename = path.basename(cached.cachePath)
    assert.equal(cachedFilename, cachedFilename.toLowerCase())
    assert.equal(/[<>:"/\\|?*\s]/.test(cachedFilename), false)
    assert.equal(cachedFilename.endsWith('.json'), true)
    assert.equal(cached.results[0]?.id, 'gers:central')
  })

  test('returns search history sorted by last run time newest-first and ignores invalid entries', async () => {
    const { getSearchHistory } = await loadCacheModule()
    await writeJsonFile(path.join(cacheRoot, '2026-03-18.0/search/2/older.json'), {
      createdAt: '2026-03-18T00:00:00.000Z',
      lastRunAt: '2026-03-20T00:00:00.000Z',
      version: '2026-03-18.0',
      adminLevel: 2,
      term: 'older',
      totalCount: 1,
      results: [createDivision('gers:older')],
    })
    await writeJsonFile(path.join(cacheRoot, '2026-03-18.0/search/2/newer.json'), {
      createdAt: '2026-03-19T00:00:00.000Z',
      lastRunAt: '2026-03-21T00:00:00.000Z',
      version: '2026-03-18.0',
      adminLevel: 2,
      term: 'newer',
      totalCount: 1,
      results: [createDivision('gers:newer')],
    })
    await writeJsonFile(path.join(cacheRoot, '2026-03-18.0/search/2/fallback.json'), {
      createdAt: '2026-03-20T12:00:00.000Z',
      version: '2026-03-18.0',
      adminLevel: 2,
      term: 'fallback',
      totalCount: 1,
      results: [createDivision('gers:fallback')],
    })
    await writeJsonFile(
      path.join(cacheRoot, '2026-03-18.0/search/not-a-level/ignored.json'),
      {
        createdAt: '2026-03-20T00:00:00.000Z',
      },
    )
    await fs.mkdir(path.join(cacheRoot, '2026-03-18.0/search/2/nested'), {
      recursive: true,
    })

    const history = await getSearchHistory()

    assert.deepEqual(
      history.map(item => item.term),
      ['newer', 'fallback', 'older'],
    )
  })

  test('refreshes lastRunAt when an existing cached search is repeated', async () => {
    const { touchCachedSearchResults, getCachedSearchResults } = await loadCacheModule()
    await writeJsonFile(path.join(cacheRoot, '2026-03-18.0/search/2/central.json'), {
      createdAt: '2026-03-18T00:00:00.000Z',
      lastRunAt: '2026-03-20T00:00:00.000Z',
      version: '2026-03-18.0',
      adminLevel: 2,
      term: 'Central',
      totalCount: 1,
      results: [createDivision('gers:central')],
    })

    const updated = await touchCachedSearchResults('2026-03-18.0', 2, 'Central')
    const cached = await getCachedSearchResults('2026-03-18.0', 2, 'Central')

    assert.ok(updated)
    assert.ok(cached)
    assert.equal(updated.createdAt, '2026-03-18T00:00:00.000Z')
    assert.equal(cached.createdAt, '2026-03-18T00:00:00.000Z')
    assert.notEqual(updated.lastRunAt, '2026-03-20T00:00:00.000Z')
    assert.equal(updated.lastRunAt, cached.lastRunAt)
    assert.ok(
      new Date(updated.lastRunAt ?? '').getTime() >
        Date.parse('2026-03-20T00:00:00.000Z'),
    )
  })

  test('detects cached searches only when json files exist in admin-level folders', async () => {
    const { hasCachedSearches } = await loadCacheModule()
    await fs.mkdir(path.join(cacheRoot, '2026-03-18.0/search/2'), {
      recursive: true,
    })

    assert.equal(await hasCachedSearches(), false)

    await writeJsonFile(path.join(cacheRoot, '2026-03-18.0/search/2/search.json'), {
      createdAt: '2026-03-19T00:00:00.000Z',
      version: '2026-03-18.0',
      adminLevel: 2,
      term: 'central',
      totalCount: 1,
      results: [createDivision('gers:central')],
    })

    assert.equal(await hasCachedSearches(), true)
  })

  test('lists cached versions using reverse lexical order and ignores files', async () => {
    const { getVersionsInCache } = await loadCacheModule()
    await fs.mkdir(path.join(cacheRoot, '2026-03-18.0'), { recursive: true })
    await fs.mkdir(path.join(cacheRoot, '2025-12-22.0'), { recursive: true })
    await fs.writeFile(path.join(cacheRoot, 'release-note.txt'), 'ignore')

    assert.deepEqual(await getVersionsInCache(), ['2026-03-18.0', '2025-12-22.0'])
  })
})
