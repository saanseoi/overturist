import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, mock, test } from 'bun:test'

const outroMock = mock(() => {})

async function loadUtilsModule() {
  mock.module('@clack/prompts', () => ({
    outro: outroMock,
  }))

  const moduleUrl = new URL(
    `../libs/core/utils.ts?case=${Date.now()}-${Math.random()}`,
    import.meta.url,
  )

  return await import(moduleUrl.href)
}

function runInlineBun(script: string) {
  return Bun.spawnSync({
    cmd: ['bun', '-e', script],
    cwd: process.cwd(),
    stdout: 'pipe',
    stderr: 'pipe',
  })
}

beforeEach(() => {
  outroMock.mockClear()
})

afterEach(() => {
  mock.restore()
})

describe('getDiffCount', () => {
  test('returns positive, negative, zero, and null deltas correctly', async () => {
    const { getDiffCount } = await loadUtilsModule()

    assert.equal(getDiffCount(10, 6), 4)
    assert.equal(getDiffCount(3, 9), -6)
    assert.equal(getDiffCount(5, 5), 0)
    assert.equal(getDiffCount(5, null), null)
  })
})

describe('parseNaturalDateToISO', () => {
  test('parses valid natural-language dates and trims surrounding whitespace', async () => {
    const { parseNaturalDateToISO } = await loadUtilsModule()

    assert.equal(parseNaturalDateToISO('22 October 2025'), '2025-10-22')
    assert.equal(parseNaturalDateToISO('  3 March 2026  '), '2026-03-03')
  })

  test('returns null for invalid dates', async () => {
    const { parseNaturalDateToISO } = await loadUtilsModule()

    assert.equal(parseNaturalDateToISO('not a real date'), null)
  })
})

describe('formatElapsedTime', () => {
  test('formats millisecond, second, and minute durations for CLI messages', async () => {
    const { formatElapsedTime } = await loadUtilsModule()

    assert.equal(formatElapsedTime(842), '842ms')
    assert.equal(formatElapsedTime(4_200), '4.2s')
    assert.equal(formatElapsedTime(123_000), '2m 03s')
  })
})

describe('termination helpers', () => {
  test('successExit exits with code 0 and prints a success outro when a message is provided', () => {
    const result = runInlineBun(
      "import { successExit } from './libs/core/utils.ts'; successExit('finished')",
    )

    assert.equal(result.exitCode, 0)
    assert.match(result.stdout.toString(), /finished/)
  })

  test('failedExit exits with code 1 and prints a failure outro when a message is provided', () => {
    const result = runInlineBun(
      "import { failedExit } from './libs/core/utils.ts'; failedExit('failed')",
    )

    assert.equal(result.exitCode, 1)
    assert.match(result.stdout.toString(), /failed/)
  })

  test('bail exits with code 1 and always prints an error outro', () => {
    const result = runInlineBun(
      "import { bail } from './libs/core/utils.ts'; bail('boom')",
    )

    assert.equal(result.exitCode, 1)
    assert.match(result.stdout.toString(), /boom/)
  })

  test('bailFromSpinner stops the spinner before exiting', () => {
    const result = runInlineBun(
      "import { bailFromSpinner } from './libs/core/utils.ts'; const spinner={ stop:(msg)=>console.log('STOP', msg), start:()=>{}, message:()=>{} }; bailFromSpinner(spinner, 'processing features', 'broken')",
    )

    assert.equal(result.exitCode, 1)
    assert.match(result.stdout.toString(), /STOP processing features/)
    assert.match(result.stdout.toString(), /broken/)
  })
})

describe('setupGracefulExit', () => {
  test('registers the SIGINT handler only once', async () => {
    mock.restore()
    mock.module('@clack/prompts', () => ({
      outro: outroMock,
    }))

    const moduleUrl = new URL(
      `../libs/core/utils.ts?setup=${Date.now()}`,
      import.meta.url,
    )
    const { setupGracefulExit } = await import(moduleUrl.href)

    const baselineListeners = process.listeners('SIGINT')
    const baselineCount = baselineListeners.length

    setupGracefulExit()
    const afterFirst = process.listeners('SIGINT')
    setupGracefulExit()
    const afterSecond = process.listeners('SIGINT')

    assert.equal(afterFirst.length, baselineCount + 1)
    assert.equal(afterSecond.length, baselineCount + 1)

    const addedHandler = afterFirst.at(-1)
    if (addedHandler) {
      process.off('SIGINT', addedHandler)
    }
  })
})
