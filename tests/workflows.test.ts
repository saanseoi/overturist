import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { describe, test } from 'bun:test'

const cwd = path.resolve(import.meta.dir, '..')
const suites = [
  './tests/workflow-suites/get.workflow.ts',
  './tests/workflow-suites/info.workflow.ts',
  './tests/workflow-suites/themes.workflow.ts',
  './tests/workflow-suites/divisions.workflow.ts',
  './tests/workflow-suites/interactive.workflow.ts',
  './tests/workflow-suites/settings.workflow.ts',
  './tests/workflow-suites/processing.workflow.ts',
]

describe('workflow suites', () => {
  for (const suite of suites) {
    test(suite, () => {
      const result = spawnSync('bun', ['test', suite], {
        cwd,
        encoding: 'utf8',
      })
      const output = `${result.stdout ?? ''}${result.stderr ?? ''}`

      assert.equal(result.status, 0, output)
      assert.match(output, /0 fail|Ran \d+ tests?/)
    })
  }
})
