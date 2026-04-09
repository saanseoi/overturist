import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, mock, test } from 'bun:test'
import type { ControlContext, FeatureStats, ProgressState } from '../libs/core'

const noteMock = mock(() => {})
const getFeatureStatsMock = mock(
  async () =>
    ({
      count: 12,
      hasArea: true,
      areaKm2: 48.25,
    }) satisfies FeatureStats,
)
const getLastReleaseFeatureStatsMock = mock(
  async () =>
    ({
      count: 10,
      hasArea: true,
      areaKm2: 40.25,
    }) satisfies FeatureStats,
)
function stripAnsi(value: string): string {
  let result = ''

  for (let index = 0; index < value.length; index++) {
    const char = value[index]
    const nextChar = value[index + 1]

    if (char === '\u001B' && nextChar === '[') {
      index += 2
      while (index < value.length && value[index] !== 'm') {
        index++
      }
      continue
    }

    result += char
  }

  return result
}

async function withStdoutIsTTY<T>(
  value: boolean | undefined,
  run: () => Promise<T>,
): Promise<T> {
  const originalIsTTY = process.stdout.isTTY
  Object.defineProperty(process.stdout, 'isTTY', {
    configurable: true,
    value,
  })

  try {
    return await run()
  } finally {
    Object.defineProperty(process.stdout, 'isTTY', {
      configurable: true,
      value: originalIsTTY,
    })
  }
}

async function loadProgressModule() {
  mock.module('@clack/prompts', () => ({
    log: {
      warning: mock(() => {}),
      warn: mock(() => {}),
      message: mock(() => {}),
    },
    spinner: mock(() => ({
      start: () => {},
      stop: () => {},
      message: () => {},
    })),
    outro: mock(() => {}),
    select: mock(async () => null),
    text: mock(async () => ''),
    groupMultiselect: mock(async () => []),
  }))
  mock.module(new URL('../libs/core/note.ts', import.meta.url).pathname, () => ({
    note: noteMock,
  }))
  mock.module(new URL('../libs/ui/format.ts', import.meta.url).pathname, () => ({
    formatBboxPath: () => '114.12346 , 22.3 , 114.4 , 22',
    formatPath: (value: string) => value,
  }))
  mock.module(new URL('../libs/data/queries.ts', import.meta.url).pathname, () => ({
    getFeatureStats: getFeatureStatsMock,
    getLastReleaseFeatureStats: getLastReleaseFeatureStatsMock,
  }))
  return await import(
    new URL(
      `../libs/ui/progress.ts?case=${Date.now()}-${Math.random()}`,
      import.meta.url,
    ).href
  )
}

function createProgressState(overrides: Partial<ProgressState> = {}): ProgressState {
  return {
    bboxComplete: false,
    geomComplete: false,
    hasGeometryPass: true,
    isProcessing: false,
    activeStage: null,
    hasCountMetric: false,
    featureCount: 0,
    diffCount: null,
    hasAreaMetric: false,
    featureAreaKm2: null,
    diffAreaKm2: null,
    currentMessage: null,
    ...overrides,
  }
}

function createContext(overrides: Partial<ControlContext> = {}): ControlContext {
  return {
    target: 'division',
    spatialFrame: 'division',
    spatialPredicate: 'intersects',
    spatialGeometry: 'clip-smart',
    bbox: { xmin: 114.123456, ymin: 22.3, xmax: 114.4, ymax: 22 },
    outputDir: './data/out',
    releaseVersion: '2026-03-18.0',
    divisionId: 'division-1',
    division: {
      id: 'division-1',
      country: 'HK',
      subtype: 'locality',
      names: { primary: 'Central', common: [] },
      hierarchies: [],
    },
    geometry: null,
    onFileExists: 'skip',
    releaseContext: {
      version: '2026-03-18.0',
      schema: '2',
      date: '2026-03-18',
      isNewSchema: true,
      isLatest: true,
      previousVersion: '2025-12-22.0',
      previousSchema: '1',
    },
    featureTypes: ['building'],
    featureNameWidth: 16,
    indexWidth: 5,
    themeMapping: {
      building: 'buildings',
    },
    source: {
      env: {
        locale: 'en',
        outputDir: './data',
        releaseFn: 'releases.json',
        releaseUrl: 'https://example.com/releases',
        target: 'division',
        confirmFeatureSelection: true,
      },
      cli: {
        onFileExists: 'skip',
      },
    },
    ...overrides,
  } as ControlContext
}

beforeEach(() => {
  noteMock.mockReset()
  getFeatureStatsMock.mockReset()
  getLastReleaseFeatureStatsMock.mockReset()
  getFeatureStatsMock.mockResolvedValue({
    count: 12,
    hasArea: true,
    areaKm2: 48.25,
  })
  getLastReleaseFeatureStatsMock.mockResolvedValue({
    count: 10,
    hasArea: true,
    areaKm2: 40.25,
  })
})

afterEach(() => {
  mock.restore()
})

describe('progress helpers', () => {
  test('updates mutable progress state incrementally', async () => {
    const { applyProgressUpdate } = await loadProgressModule()
    const progress = createProgressState({ diffCount: 4 })

    applyProgressUpdate(progress, {
      stage: 'bbox',
      count: 7,
      areaApplicable: true,
      areaKm2: 12.5,
      message: 'Filtering bbox',
    })

    assert.deepEqual(progress, {
      bboxComplete: false,
      geomComplete: false,
      hasGeometryPass: true,
      isProcessing: true,
      activeStage: 'bbox',
      hasCountMetric: true,
      featureCount: 7,
      diffCount: 4,
      hasAreaMetric: true,
      featureAreaKm2: 12.5,
      diffAreaKm2: null,
      currentMessage: 'Filtering bbox',
    })
  })

  test('formats diff text and column widths for edge cases', async () => {
    const {
      toCountText,
      toDiffText,
      toAreaText,
      toAreaDiffText,
      calculateColumnWidths,
    } = await loadProgressModule()

    assert.equal(stripAnsi(toCountText(0, false)).trim(), 'n/a')
    assert.equal(stripAnsi(toCountText(0, true)).trim(), '0')
    assert.equal(stripAnsi(toDiffText(null)).trim(), 'NEW')
    assert.equal(stripAnsi(toDiffText(0)).trim(), '-')
    assert.equal(stripAnsi(toDiffText(5)).trim(), '+5')
    assert.equal(stripAnsi(toDiffText(-3)).trim(), '-3')
    assert.equal(stripAnsi(toAreaText(null, false)).trim(), 'n/a')
    assert.equal(stripAnsi(toAreaText(12.5, true)).trim(), '12.5')
    assert.equal(stripAnsi(toAreaDiffText(null, true)).trim(), 'NEW')
    assert.equal(stripAnsi(toAreaDiffText(null, false)).trim(), 'n/a')
    assert.deepEqual(calculateColumnWidths(['short']), {
      featureNameWidth: 16,
      indexWidth: 5,
    })
    assert.equal(
      calculateColumnWidths(
        Array.from({ length: 10 }, (_, index) => `feature-${index}`),
      ).indexWidth,
      6,
    )
  })
})

describe('displayExtractionPlan', () => {
  test('renders latest/new flags plus division details including GERS id', async () => {
    const { displayExtractionPlan } = await loadProgressModule()

    displayExtractionPlan(createContext())

    const [message, title] = noteMock.mock.calls[0] as [string, string]
    assert.equal(title, 'Extraction Plan')
    assert.match(message, /2026-03-18\.0/)
    assert.match(message, /\(latest\)/)
    assert.match(message, /\(new\)/)
    assert.match(message, /Central/)
    assert.match(message, /division-1/)
    assert.match(message, /locality/)
    assert.match(message, /114\.12346 , 22\.3 , 114\.4 , 22/)
    assert.match(message, /data/)
  })

  test('omits GERS id when the extraction plan is bbox scoped', async () => {
    const { displayExtractionPlan } = await loadProgressModule()

    displayExtractionPlan(
      createContext({
        target: 'bbox',
        divisionId: null,
        division: null,
        spatialFrame: 'bbox',
      }),
    )

    const [message] = noteMock.mock.calls[0] as [string, string]
    assert.doesNotMatch(message, /GERS ID/)
    assert.doesNotMatch(message, /Subtype/)
    assert.doesNotMatch(message, /Central/)
  })
})

describe('snapshot progress rendering', () => {
  test('does not print an initial empty table before the first row change', async () => {
    const calls = await withStdoutIsTTY(false, async () => {
      const { displayTableHeader } = await loadProgressModule()
      const originalLog = console.log
      const nextCalls: unknown[][] = []
      console.log = ((...args: unknown[]) => {
        nextCalls.push(args)
      }) as typeof console.log

      try {
        displayTableHeader(createContext())
        await Promise.resolve()
      } finally {
        console.log = originalLog
      }

      return nextCalls
    })

    assert.equal(calls.length, 0)
  })

  test('coalesces active-table updates into one full-table snapshot', async () => {
    const calls = await withStdoutIsTTY(false, async () => {
      const { displayTableHeader, updateProgressDisplay, updateProgressStatus } =
        await loadProgressModule()
      const originalLog = console.log
      const nextCalls: unknown[][] = []
      console.log = ((...args: unknown[]) => {
        nextCalls.push(args)
      }) as typeof console.log

      try {
        displayTableHeader(
          createContext({
            featureTypes: ['building', 'segment'],
            featureNameWidth: 16,
            indexWidth: 5,
            themeMapping: {
              building: 'buildings',
              segment: 'transportation',
            },
          }),
        )
        updateProgressDisplay(
          'building',
          0,
          2,
          createProgressState({
            isProcessing: true,
            activeStage: 'bbox',
            currentMessage: 'Filtering buildings',
          }),
          16,
          5,
          7,
        )
        updateProgressStatus('Filtering buildings')
        await Promise.resolve()
      } finally {
        console.log = originalLog
      }

      return nextCalls
    })

    assert.equal(calls.length, 1)
    const snapshot = stripAnsi((calls[0]?.[0] as string) || '')
    assert.match(snapshot, /FEATURE/)
    assert.match(snapshot, /\[1\/2\]/)
    assert.match(snapshot, /\[2\/2\]/)
    assert.match(snapshot, /building/)
    assert.match(snapshot, /segment/)
    assert.match(snapshot, /Filtering buildings/)
  })

  test('ignores status-only updates when the table body has not changed', async () => {
    const calls = await withStdoutIsTTY(false, async () => {
      const { displayTableHeader, updateProgressDisplay, updateProgressStatus } =
        await loadProgressModule()
      const originalLog = console.log
      const nextCalls: unknown[][] = []
      console.log = ((...args: unknown[]) => {
        nextCalls.push(args)
      }) as typeof console.log

      try {
        displayTableHeader(createContext())
        updateProgressDisplay(
          'building',
          0,
          1,
          createProgressState({
            isProcessing: true,
            activeStage: 'bbox',
            currentMessage: 'Preparing buildings',
          }),
          16,
          5,
          7,
        )
        await Promise.resolve()
        updateProgressStatus('Obtaining every building in the bbox')
        await Promise.resolve()
      } finally {
        console.log = originalLog
      }

      return nextCalls
    })

    assert.equal(calls.length, 1)
    const snapshot = stripAnsi((calls[0]?.[0] as string) || '')
    assert.match(snapshot, /Preparing buildings/)
    assert.doesNotMatch(snapshot, /Obtaining every building in the bbox/)
  })

  test('resets queued snapshot state when a new table starts', async () => {
    const calls = await withStdoutIsTTY(false, async () => {
      const { displayTableHeader, updateProgressDisplay } = await loadProgressModule()
      const originalLog = console.log
      const nextCalls: unknown[][] = []
      console.log = ((...args: unknown[]) => {
        nextCalls.push(args)
      }) as typeof console.log

      try {
        displayTableHeader(createContext())
        updateProgressDisplay(
          'building',
          0,
          1,
          createProgressState({
            isProcessing: true,
            activeStage: 'bbox',
            currentMessage: 'Preparing buildings',
          }),
          16,
          5,
          7,
        )

        displayTableHeader(
          createContext({
            featureTypes: ['building', 'segment'],
            featureNameWidth: 16,
            indexWidth: 5,
            themeMapping: {
              building: 'buildings',
              segment: 'transportation',
            },
          }),
        )
        updateProgressDisplay(
          'building',
          0,
          2,
          createProgressState({
            isProcessing: true,
            activeStage: 'bbox',
            currentMessage: 'Filtering buildings',
          }),
          16,
          5,
          7,
        )
        await Promise.resolve()
      } finally {
        console.log = originalLog
      }

      return nextCalls
    })

    assert.equal(calls.length, 1)
    const snapshot = stripAnsi((calls[0]?.[0] as string) || '')
    assert.match(snapshot, /\[1\/2\]/)
    assert.match(snapshot, /segment/)
    assert.match(snapshot, /Filtering buildings/)
  })
})

describe('live progress rendering', () => {
  test('uses in-place stdout rendering when stdout is a TTY', async () => {
    const originalIsTTY = process.stdout.isTTY
    const originalWrite = process.stdout.write.bind(process.stdout)
    const writes: string[] = []

    Object.defineProperty(process.stdout, 'isTTY', {
      configurable: true,
      value: true,
    })
    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString())
      return true
    }) as typeof process.stdout.write

    try {
      const { displayTableHeader, finalizeProgressDisplay } = await loadProgressModule()
      displayTableHeader(createContext())
      finalizeProgressDisplay()
    } finally {
      process.stdout.write = originalWrite
      Object.defineProperty(process.stdout, 'isTTY', {
        configurable: true,
        value: originalIsTTY,
      })
    }

    assert.equal(writes.length > 0, true)
    assert.match(stripAnsi(writes[0] || ''), /FEATURE/)
    assert.match(stripAnsi(writes[0] || ''), /\[1\/1\]/)
  })
})

describe('handleSkippedFeature', () => {
  test('renders count and area from the existing output and compares them to the previous release', async () => {
    const { handleSkippedFeature } = await loadProgressModule()
    const originalLog = console.log
    const calls: unknown[][] = []
    console.log = ((...args: unknown[]) => {
      calls.push(args)
    }) as typeof console.log
    getFeatureStatsMock.mockResolvedValue({
      count: 12,
      hasArea: true,
      areaKm2: 48.25,
    })
    getLastReleaseFeatureStatsMock.mockResolvedValue({
      count: 10,
      hasArea: true,
      areaKm2: 40.25,
    })

    try {
      await handleSkippedFeature(
        createContext(),
        'building',
        0,
        '/tmp/existing.parquet',
      )
    } finally {
      console.log = originalLog
    }

    const output = stripAnsi((calls[0]?.[0] as string) || '')
    assert.match(output, /\[1\/1\]/)
    assert.match(output, /12/)
    assert.match(output, /\+2/)
    assert.match(output, /48\.3/)
    assert.match(output, /\+8/)
    assert.doesNotMatch(output, /NEW/)
  })

  test('falls back to zero count when the existing output cannot be counted', async () => {
    const { handleSkippedFeature } = await loadProgressModule()
    const originalLog = console.log
    const calls: unknown[][] = []
    console.log = ((...args: unknown[]) => {
      calls.push(args)
    }) as typeof console.log
    getFeatureStatsMock.mockRejectedValue(new Error('missing file'))
    getLastReleaseFeatureStatsMock.mockResolvedValue({
      count: 3,
      hasArea: false,
      areaKm2: null,
    })

    try {
      await handleSkippedFeature(createContext(), 'building', 0, '/tmp/missing.parquet')
    } finally {
      console.log = originalLog
    }

    const output = calls[0]?.[0] as string
    assert.match(output, /\[1\/1\]/)
    assert.match(output, /0/)
    assert.match(output, /n\/a/)
    assert.match(output, /-3|NEW/)
  })
})
