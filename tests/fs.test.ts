import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, test } from 'bun:test'
import {
  CACHE_DIR,
  buildBboxPath,
  checkForExistingFiles,
  directoryHasJsonFiles,
  ensureDirectoryExists,
  ensureVersionedCacheDir,
  fileExists,
  getFeatureOutputFilename,
  getOutputDir,
  initializeOutputDir,
  isParquetExists,
  readDirectoryEntries,
  readJsonFile,
  writeJsonFile,
} from '../libs/core'
import type { BBox, Config, Division } from '../libs/core'

const config: Config = {
  locale: 'en',
  outputDir: './data',
  releaseFn: 'releases.json',
  releaseUrl: 'https://docs.overturemaps.org/release-calendar/',
  target: 'division',
  confirmFeatureSelection: true,
}

let tempDir = ''

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'overturist-fs-'))
})

afterEach(async () => {
  if (tempDir) {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

describe('buildBboxPath', () => {
  test('rounds bbox coordinates to five decimal places', () => {
    const bbox: BBox = {
      xmin: 114.1234567,
      ymin: 22.2345678,
      xmax: 114.9876543,
      ymax: 22.8765432,
    }

    assert.equal(buildBboxPath(bbox), '114.12346,22.23457,114.98765,22.87654')
  })
})

describe('getOutputDir', () => {
  test('uses the hierarchy path for division targets', () => {
    const division: Division = {
      id: 'division-1',
      country: 'HK',
      subtype: 'locality',
      names: {
        primary: 'Hong Kong',
        common: [],
      },
      hierarchies: [
        [
          { division_id: 'country-1', subtype: 'country', name: 'Hong Kong SAR' },
          { division_id: 'locality-1', subtype: 'locality', name: 'Central & Western' },
        ],
      ],
    }

    assert.equal(
      getOutputDir('division', config, '2025-12-22.0', division, null),
      'data/2025-12-22.0/divisions/Hong Kong SAR/Central & Western',
    )
  })

  test('uses a stable path for bbox targets', () => {
    assert.equal(
      getOutputDir('bbox', config, '2025-12-22.0', null, {
        xmin: 114.123456,
        ymin: 22.2,
        xmax: 114.3,
        ymax: 22.4,
      }),
      'data/2025-12-22.0/bbox/114.12346,22.2,114.3,22.4',
    )
  })

  test('uses the full path for world targets', () => {
    assert.equal(
      getOutputDir('world', config, '2025-12-22.0', null, null),
      'data/2025-12-22.0/full',
    )
  })

  test('sanitizes hierarchy names using the first hierarchy only', () => {
    const division: Division = {
      id: 'division-2',
      country: 'HK',
      subtype: 'locality',
      names: {
        primary: 'Hong Kong',
        common: [],
      },
      hierarchies: [
        [
          { division_id: 'country-1', subtype: 'country', name: 'Hong<> Kong' },
          { division_id: 'region-1', subtype: 'region', name: '  Central   /  West  ' },
          { division_id: 'hood-1', subtype: 'neighborhood', name: '   ' },
        ],
        [{ division_id: 'alt-1', subtype: 'country', name: 'Ignored Hierarchy' }],
      ],
    }

    assert.equal(
      getOutputDir('division', config, '2025-12-22.0', division, null),
      'data/2025-12-22.0/divisions/Hong Kong/Central West/unnamed',
    )
  })
})

describe('filesystem helpers', () => {
  test('builds clip-mode-aware parquet filenames', () => {
    assert.equal(getFeatureOutputFilename('building', 'smart'), 'building.parquet')
    assert.equal(
      getFeatureOutputFilename('building', 'preserve'),
      'building.preserveCrop.parquet',
    )
    assert.equal(
      getFeatureOutputFilename('building', 'all'),
      'building.containCrop.parquet',
    )
  })

  test('checks for existing parquet files by feature type', async () => {
    const outputDir = path.join(tempDir, 'existing-files')
    await ensureDirectoryExists(outputDir)
    await fs.writeFile(path.join(outputDir, 'building.parquet'), '')
    await fs.writeFile(path.join(outputDir, 'segment.containCrop.parquet'), '')

    const existing = await checkForExistingFiles(
      ['building', 'address', 'segment'],
      outputDir,
      'all',
    )

    assert.deepEqual(existing, ['segment'])
  })

  test('creates output directories for the requested target', async () => {
    const localConfig = { ...config, outputDir: tempDir }
    const division: Division = {
      id: 'division-1',
      country: 'HK',
      subtype: 'locality',
      names: { primary: 'Hong Kong', common: [] },
      hierarchies: [
        [{ division_id: 'country-1', subtype: 'country', name: 'Hong Kong SAR' }],
      ],
    }

    const result = await initializeOutputDir(
      'division',
      localConfig,
      '2025-12-22.0',
      division,
      null,
    )

    assert.equal(
      result.outputDir,
      path.join(tempDir, '2025-12-22.0', 'divisions', 'Hong Kong SAR'),
    )
    assert.equal(await fileExists(result.outputDir), true)
  })

  test('creates versioned cache directories', async () => {
    await ensureVersionedCacheDir('2025-12-22.0', 'queries')

    assert.equal(
      await fileExists(path.join(CACHE_DIR, '2025-12-22.0', 'queries')),
      true,
    )
  })

  test('reads valid json files and treats missing or invalid json as cache misses', async () => {
    const validPath = path.join(tempDir, 'valid.json')
    const invalidPath = path.join(tempDir, 'invalid.json')
    await fs.writeFile(validPath, JSON.stringify({ ok: true }))
    await fs.writeFile(invalidPath, '{not json')

    assert.deepEqual(await readJsonFile<{ ok: boolean }>(validPath), { ok: true })
    assert.equal(await readJsonFile(invalidPath), null)
    assert.equal(await readJsonFile(path.join(tempDir, 'missing.json')), null)
  })

  test('writes pretty printed json files', async () => {
    const filePath = path.join(tempDir, 'pretty.json')
    await writeJsonFile(filePath, { hello: 'world', count: 2 })

    const content = await fs.readFile(filePath, 'utf-8')
    assert.match(content, /\n {4}"hello": "world"/)
    assert.deepEqual(JSON.parse(content), { hello: 'world', count: 2 })
  })

  test('detects directories containing json files only', async () => {
    const jsonDir = path.join(tempDir, 'json-dir')
    const textDir = path.join(tempDir, 'text-dir')
    await ensureDirectoryExists(jsonDir)
    await ensureDirectoryExists(textDir)
    await fs.writeFile(path.join(jsonDir, 'item.json'), '{}')
    await fs.writeFile(path.join(textDir, 'item.txt'), 'x')

    assert.equal(await directoryHasJsonFiles(jsonDir), true)
    assert.equal(await directoryHasJsonFiles(textDir), false)
    assert.equal(await directoryHasJsonFiles(path.join(tempDir, 'missing')), false)
  })

  test('reads directory entries with type information and returns an empty list on failure', async () => {
    const dirPath = path.join(tempDir, 'entries')
    await ensureDirectoryExists(dirPath)
    await ensureDirectoryExists(path.join(dirPath, 'nested'))
    await fs.writeFile(path.join(dirPath, 'item.json'), '{}')

    const entries = await readDirectoryEntries(dirPath)
    const byName = Object.fromEntries(
      entries.map(entry => [entry.name, entry.isDirectory]),
    )

    assert.equal(byName.nested, true)
    assert.equal(byName['item.json'], false)
    assert.deepEqual(await readDirectoryEntries(path.join(tempDir, 'missing')), [])
  })

  test('checks file and parquet existence helpers', async () => {
    const outputDir = path.join(tempDir, 'parquet-output')
    await ensureDirectoryExists(outputDir)
    const parquetFile = path.join(outputDir, 'building.parquet')
    await fs.writeFile(parquetFile, '')
    await fs.writeFile(path.join(outputDir, 'address.preserveCrop.parquet'), '')

    assert.equal(await fileExists(parquetFile), true)
    assert.equal(await fileExists(path.join(outputDir, 'missing.parquet')), false)
    assert.equal(await isParquetExists(outputDir, 'building'), true)
    assert.equal(await isParquetExists(outputDir, 'address'), false)
    assert.equal(await isParquetExists(outputDir, 'address', 'preserve'), true)
  })
})
