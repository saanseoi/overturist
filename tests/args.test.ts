import assert from 'node:assert/strict'
import { describe, test } from 'bun:test'
import kleur from 'kleur'
import { handleArguments } from '../libs/core'

function withPatchedExit<T>(fn: () => T): {
  error: unknown
  exitCode: number | undefined
} {
  const originalExit = process.exit
  let exitCode: number | undefined

  process.exit = ((code?: number) => {
    exitCode = code
    throw new Error(`process.exit:${code}`)
  }) as typeof process.exit

  try {
    fn()
    return { error: undefined, exitCode }
  } catch (error) {
    return { error, exitCode }
  } finally {
    process.exit = originalExit
  }
}

function captureConsoleOutput<T>(fn: () => T): {
  logs: string[]
  error: unknown
  exitCode: number | undefined
} {
  const originalLog = console.log
  const logs: string[] = []

  console.log = (...args: unknown[]) => {
    logs.push(args.join(' '))
  }

  try {
    const result = withPatchedExit(fn)

    return {
      logs,
      error: result.error,
      exitCode: result.exitCode,
    }
  } finally {
    console.log = originalLog
  }
}

describe('handleArguments', () => {
  test('parses repeatable and comma-separated values from argv', () => {
    const cliArgs = handleArguments([
      'bun',
      'overturist.ts',
      'get',
      '--theme',
      'buildings,addresses',
      '--theme',
      'base',
      '--type',
      'building',
      '--type',
      'segment,address',
      '--locale',
      'zh-hk',
      '--frame',
      'bbox',
      '--predicate',
      'within',
      '--geometry',
      'clip-smart',
      '--replace',
    ])

    assert.equal(cliArgs.get, true)
    assert.equal(cliArgs.onFileExists, 'replace')
    assert.deepEqual(cliArgs.themes, ['buildings', 'addresses', 'base'])
    assert.deepEqual(cliArgs.types, ['building', 'segment', 'address'])
    assert.equal(cliArgs.locale, 'zh-hk')
    assert.equal(cliArgs.frame, 'bbox')
    assert.equal(cliArgs.predicate, 'within')
    assert.equal(cliArgs.geometry, 'clip-smart')
  })

  test('detects scripting mode only when get is the first positional argument', () => {
    const cliArgs = handleArguments(['bun', 'overturist.ts', '--theme', 'buildings'])

    assert.equal(cliArgs.get, false)
    assert.equal(cliArgs.info, false)
    assert.deepEqual(cliArgs.themes, ['buildings'])
  })

  test('detects info mode only when info is the first positional argument', () => {
    const cliArgs = handleArguments([
      'bun',
      'overturist.ts',
      'info',
      '--division',
      'b4f09a9f-4cba-4a7c-bf58-2e63bc2e913d',
    ])

    assert.equal(cliArgs.get, false)
    assert.equal(cliArgs.info, true)
    assert.equal(cliArgs.divisionId, 'b4f09a9f-4cba-4a7c-bf58-2e63bc2e913d')
  })

  test('parses an OSM relation id separately from the canonical division id', () => {
    const cliArgs = handleArguments([
      'bun',
      'overturist.ts',
      'get',
      '--division',
      'b4f09a9f-4cba-4a7c-bf58-2e63bc2e913d',
      '--osmId',
      '12345',
    ])

    assert.equal(cliArgs.divisionId, 'b4f09a9f-4cba-4a7c-bf58-2e63bc2e913d')
    assert.equal(cliArgs.osmId, '12345')
  })

  test('parses repeatable arguments from aliases and equals syntax while preserving order', () => {
    const cliArgs = handleArguments([
      'bun',
      'overturist.ts',
      'get',
      '-T',
      'buildings',
      '--theme=base,addresses',
      '-t=segment,address',
      '--type',
      'building',
    ])

    assert.deepEqual(cliArgs.themes, ['buildings', 'base', 'addresses'])
    assert.deepEqual(cliArgs.types, ['segment', 'address', 'building'])
  })

  test('parses bbox arguments into numeric coordinates', () => {
    const cliArgs = handleArguments([
      'bun',
      'overturist.ts',
      'get',
      '--bbox',
      '114.1,22.2,114.3,22.4',
    ])

    assert.deepEqual(cliArgs.bbox, {
      xmin: 114.1,
      ymin: 22.2,
      xmax: 114.3,
      ymax: 22.4,
    })
  })

  test('throws for malformed bbox arguments', () => {
    assert.throws(
      () =>
        handleArguments(['bun', 'overturist.ts', 'get', '--bbox', '114.1,22.2,114.3']),
      /Invalid bbox format/,
    )

    assert.throws(
      () =>
        handleArguments([
          'bun',
          'overturist.ts',
          'get',
          '--bbox',
          '114.1,22.2,foo,22.4',
        ]),
      /Invalid bbox format/,
    )
  })

  test('prefers replace over abort for existing-file handling flags', () => {
    const cliArgs = handleArguments([
      'bun',
      'overturist.ts',
      'get',
      '--abort',
      '--replace',
    ])

    assert.equal(cliArgs.onFileExists, 'replace')
  })

  test('parses explicit skip file handling without forcing it by default', () => {
    const explicitSkipArgs = handleArguments(['bun', 'overturist.ts', 'get', '--skip'])
    const defaultArgs = handleArguments(['bun', 'overturist.ts', 'get'])

    assert.equal(explicitSkipArgs.onFileExists, 'skip')
    assert.equal(defaultArgs.onFileExists, undefined)
  })
  test('exits when the removed legacy --target flag is used', () => {
    const result = withPatchedExit(() =>
      handleArguments(['bun', 'overturist.ts', 'get', '--target', 'world']),
    )

    assert.equal(result.exitCode, 1)
    assert.match(String(result.error), /process\.exit:1/)
  })

  test('exits for invalid geometry values', () => {
    const result = withPatchedExit(() =>
      handleArguments(['bun', 'overturist.ts', 'get', '--geometry', 'none']),
    )

    assert.equal(result.exitCode, 1)
    assert.match(String(result.error), /process\.exit:1/)
  })

  test('renders geospatial help values in a distinct color', () => {
    const originalEnabled = kleur.enabled
    kleur.enabled = true

    try {
      const result = captureConsoleOutput(() =>
        handleArguments(['bun', 'overturist.ts', '--help']),
      )
      const output = result.logs.join('\n')

      assert.equal(result.exitCode, 0)
      assert.match(String(result.error), /process\.exit:0/)
      assert.match(
        output,
        new RegExp(
          `Spatial frame ${escapeRegex(kleur.cyan('bbox'))}${escapeRegex(
            kleur.grey(', '),
          )}${escapeRegex(kleur.cyan('division'))}`,
        ),
      )
      assert.match(
        output,
        new RegExp(
          `Spatial predicate ${escapeRegex(
            kleur.cyan('intersects'),
          )}${escapeRegex(kleur.grey(', '))}${escapeRegex(kleur.cyan('within'))}`,
        ),
      )
      assert.match(
        output,
        new RegExp(
          `Geometry output ${escapeRegex(kleur.cyan('preserve'))}${escapeRegex(
            kleur.grey(', '),
          )}${escapeRegex(kleur.cyan('clip-smart'))}${escapeRegex(
            kleur.grey(', '),
          )}${escapeRegex(kleur.cyan('clip-all'))}`,
        ),
      )
    } finally {
      kleur.enabled = originalEnabled
    }
  })
})

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
