import assert from 'node:assert/strict'
import { describe, test } from 'bun:test'
import { resolveExistingFilesActionStrategy } from '../libs/ui/file-handling.utils'

describe('resolveExistingFilesActionStrategy', () => {
  test('returns none when no existing files are present', () => {
    assert.deepEqual(resolveExistingFilesActionStrategy([], undefined, {}, 'skip'), {
      kind: 'none',
      action: null,
    })
  })

  test('returns prompt when interactive mode needs user input', () => {
    assert.deepEqual(
      resolveExistingFilesActionStrategy(['a.parquet'], undefined, {}, 'skip'),
      { kind: 'prompt', action: null },
    )
  })

  test('returns preset action when one was supplied explicitly', () => {
    assert.deepEqual(
      resolveExistingFilesActionStrategy(['a.parquet'], 'abort', false, 'skip'),
      { kind: 'preset', action: 'abort' },
    )
  })

  test('falls back to the default action in non-interactive mode', () => {
    assert.deepEqual(
      resolveExistingFilesActionStrategy(['a.parquet'], undefined, false, 'skip'),
      { kind: 'default', action: 'skip' },
    )
  })
})
