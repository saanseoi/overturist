import assert from 'node:assert/strict'
import { describe, test } from 'bun:test'
import {
  DuckDBManager,
  runDuckDBQuery,
  runDuckDBQueryWithManager,
} from '../libs/data/db'

describe('runDuckDBQuery', () => {
  test('returns materialized JSON rows for successful queries', async () => {
    const result = await runDuckDBQuery('SELECT 1 AS value;')

    assert.equal(result.exitCode, 0)
    assert.equal(result.stderr, '')
    assert.deepEqual(JSON.parse(result.stdout), [{ value: 1 }])
  })

  test('returns a structured error instead of throwing on query failure', async () => {
    const progressUpdates: Array<[number, string]> = []
    const result = await runDuckDBQuery('SELECT * FROM missing_table;', {
      silent: true,
      progressCallback: (progress, status) => {
        progressUpdates.push([progress, status])
      },
    })

    assert.equal(result.exitCode, 1)
    assert.equal(result.stdout, '')
    assert.match(result.stderr, /missing_table/i)
    assert.equal(progressUpdates.length, 1)
    assert.equal(progressUpdates[0]?.[0], 0)
    assert.match(progressUpdates[0]?.[1] ?? '', /Error:/)
  })

  test('reports completion progress on success', async () => {
    const progressUpdates: Array<[number, string]> = []

    await runDuckDBQuery('SELECT 1;', {
      progressCallback: (progress, status) => {
        progressUpdates.push([progress, status])
      },
    })

    assert.deepEqual(progressUpdates, [[100, 'Complete']])
  })
})

describe('DuckDBManager', () => {
  test('reuses the same connection until closed', async () => {
    const manager = new DuckDBManager()
    const firstConnection = await manager.getConnection()
    const secondConnection = await manager.getConnection()

    assert.equal(firstConnection, secondConnection)

    await manager.close()
  })

  test('creates a fresh connection after close', async () => {
    const manager = new DuckDBManager()
    const firstConnection = await manager.getConnection()

    await manager.close()

    const secondConnection = await manager.getConnection()

    assert.notEqual(firstConnection, secondConnection)

    await manager.close()
  })
})

describe('runDuckDBQueryWithManager', () => {
  test('uses the shared connection so temp tables persist across queries', async () => {
    const manager = new DuckDBManager()

    const createResult = await runDuckDBQueryWithManager(
      manager,
      'CREATE TEMP TABLE persisted AS SELECT 7 AS value;',
    )
    const readResult = await runDuckDBQueryWithManager(
      manager,
      'SELECT * FROM persisted;',
    )

    assert.equal(createResult.exitCode, 0)
    assert.equal(readResult.exitCode, 0)
    assert.deepEqual(JSON.parse(readResult.stdout), [{ value: 7 }])

    await manager.close()
  })
})
