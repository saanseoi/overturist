import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { afterAll, afterEach, beforeEach, describe, mock, test } from 'bun:test'

const abs = (relativePath: string) => new URL(relativePath, import.meta.url).pathname

const sendMock = mock(async () => ({}))
const runDuckDBQueryMock = mock(async () => ({
  stdout: '[]',
  stderr: '',
  exitCode: 0,
}))

async function loadS3Module() {
  class S3Client {
    async send(command: { input: Record<string, unknown> }) {
      return await sendMock(command)
    }
  }

  class GetObjectCommand {
    constructor(public input: Record<string, unknown>) {}
  }

  class ListObjectsV2Command {
    constructor(public input: Record<string, unknown>) {}
  }

  mock.module('@aws-sdk/client-s3', () => ({
    S3Client,
    GetObjectCommand,
    ListObjectsV2Command,
  }))
  mock.module(abs('../libs/data/db.ts'), () => ({
    runDuckDBQuery: runDuckDBQueryMock,
  }))
  mock.module(abs('../libs/data/db'), () => ({
    runDuckDBQuery: runDuckDBQueryMock,
  }))

  return await import(`../libs/data/s3.ts?test=${Date.now()}-${Math.random()}`)
}

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'overturist-s3-'))

beforeEach(async () => {
  sendMock.mockClear()
  sendMock.mockImplementation(async () => ({}))
  runDuckDBQueryMock.mockClear()
  runDuckDBQueryMock.mockImplementation(async () => ({
    stdout: '[]',
    stderr: '',
    exitCode: 0,
  }))
  await fs.rm(tempRoot, { recursive: true, force: true })
  await fs.mkdir(tempRoot, { recursive: true })
})

afterEach(() => {
  mock.restore()
})

afterAll(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true })
})

describe('release and theme discovery', () => {
  test('returns empty releases when S3 has no prefixes', async () => {
    const { getS3Releases } = await loadS3Module()
    sendMock.mockImplementation(async () => ({
      CommonPrefixes: [],
      IsTruncated: false,
    }))

    assert.deepEqual(await getS3Releases(), {
      latest: null,
      s3Releases: [],
    })
  })

  test('follows pagination and returns newest-first release versions', async () => {
    const { getS3Releases } = await loadS3Module()
    let page = 0
    sendMock.mockImplementation(async () => {
      page += 1
      if (page === 1) {
        return {
          CommonPrefixes: [{ Prefix: 'release/2025-12-22.0/' }],
          IsTruncated: true,
          NextContinuationToken: 'page-2',
        }
      }

      return {
        CommonPrefixes: [{ Prefix: 'release/2026-03-18.0/' }],
        IsTruncated: false,
      }
    })

    assert.deepEqual(await getS3Releases(), {
      latest: '2026-03-18.0',
      s3Releases: ['2026-03-18.0', '2025-12-22.0'],
    })
  })

  test('filters theme prefixes and builds feature-type maps per theme', async () => {
    const { getThemesForVersion, getFeatureTypesForVersion } = await loadS3Module()
    sendMock.mockImplementation(async command => {
      const prefix = String(command.input.Prefix)
      if (prefix === 'release/2026-03-18.0/') {
        return {
          CommonPrefixes: [
            { Prefix: 'release/2026-03-18.0/theme=buildings/' },
            { Prefix: 'release/2026-03-18.0/theme=divisions/' },
            { Prefix: 'release/2026-03-18.0/not-a-theme/' },
          ],
          IsTruncated: false,
        }
      }

      if (prefix === 'release/2026-03-18.0/theme=buildings/') {
        return {
          CommonPrefixes: [
            { Prefix: 'release/2026-03-18.0/theme=buildings/type=building/' },
          ],
          IsTruncated: false,
        }
      }

      return {
        CommonPrefixes: [
          { Prefix: 'release/2026-03-18.0/theme=divisions/type=division/' },
          { Prefix: 'release/2026-03-18.0/theme=divisions/type=division_area/' },
        ],
        IsTruncated: false,
      }
    })

    assert.deepEqual(await getThemesForVersion('2026-03-18.0'), [
      'buildings',
      'divisions',
    ])
    assert.deepEqual(await getFeatureTypesForVersion('2026-03-18.0'), {
      buildings: ['building'],
      divisions: ['division', 'division_area'],
    })
  })
})

describe('downloads', () => {
  test('materializes parquet files with DuckDB and throws on query failure', async () => {
    const { downloadParquetFiles } = await loadS3Module()
    const outputPath = path.join(tempRoot, 'nested/output.parquet')

    await downloadParquetFiles('2026-03-18.0', 'buildings', 'building', outputPath)

    const query = String(runDuckDBQueryMock.mock.calls[0]?.[0] ?? '')
    assert.match(query, /theme=buildings\/type=building\/\*\.parquet/)
    assert.equal((await fs.stat(path.dirname(outputPath))).isDirectory(), true)

    runDuckDBQueryMock.mockImplementation(async () => ({
      stdout: '',
      stderr: 'duckdb failed',
      exitCode: 1,
    }))

    await assert.rejects(
      downloadParquetFiles('2026-03-18.0', 'buildings', 'building', outputPath),
      /duckdb failed/,
    )
  })

  test('downloads a file from S3 to disk and errors when no body is returned', async () => {
    const { downloadFile } = await loadS3Module()
    const outputPath = path.join(tempRoot, 'download/result.txt')

    sendMock.mockImplementation(async () => ({
      Body: Readable.from(['hello world']),
    }))

    await downloadFile('s3://bucket-name/path/to/file.txt', outputPath)

    assert.equal(await fs.readFile(outputPath, 'utf8'), 'hello world')

    sendMock.mockImplementation(async () => ({
      Body: undefined,
    }))

    await assert.rejects(
      downloadFile('s3://bucket-name/path/to/file.txt', outputPath),
      /No data in response body/,
    )
  })
})

describe('path formatting', () => {
  test('builds the expected parquet glob path', async () => {
    const { getS3ParquetPath } = await loadS3Module()

    assert.equal(
      getS3ParquetPath('2026-03-18.0', 'buildings', 'building'),
      's3://overturemaps-us-west-2/release/2026-03-18.0/theme=buildings/type=building/*.parquet',
    )
  })
})
