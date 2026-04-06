import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, mock, test } from 'bun:test'
import type { ThemeDifferences } from '../libs/core'

const selectMock = mock(async () => 'update')
const groupMultiselectMock = mock(async () => ['building'])
const noteMock = mock(() => {})
const bailMock = mock((message?: string) => {
  throw new Error(`bail:${message ?? ''}`)
})

async function loadThemesModule() {
  mock.module('@clack/prompts', () => ({
    select: selectMock,
    groupMultiselect: groupMultiselectMock,
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
    text: mock(async () => ''),
  }))
  mock.module(new URL('../libs/core/note.ts', import.meta.url).pathname, () => ({
    note: noteMock,
  }))
  mock.module(new URL('../libs/core/utils.ts', import.meta.url).pathname, () => ({
    bail: bailMock,
  }))

  return await import(
    new URL(`../libs/ui/themes.ts?case=${Date.now()}-${Math.random()}`, import.meta.url)
      .href
  )
}

beforeEach(() => {
  selectMock.mockReset()
  groupMultiselectMock.mockReset()
  noteMock.mockReset()
  bailMock.mockReset()
})

afterEach(() => {
  mock.restore()
})

describe('themes helpers', () => {
  test('builds grouped feature selection options by theme', async () => {
    const { buildThemeSelectionOptions } = await import(
      new URL(
        `../libs/ui/themes.utils.ts?case=${Date.now()}-${Math.random()}`,
        import.meta.url,
      ).href
    )

    assert.deepEqual(
      buildThemeSelectionOptions({
        building: 'buildings',
        address: 'buildings',
        segment: 'transportation',
      }),
      {
        buildings: [
          { value: 'building', label: 'building' },
          { value: 'address', label: 'address' },
        ],
        transportation: [{ value: 'segment', label: 'segment' }],
      },
    )
  })

  test('builds theme drift messages with only the populated sections', async () => {
    const { buildThemeDifferenceMessage } = await loadThemesModule()
    const differences: ThemeDifferences = {
      missingFromCurrent: ['building'],
      missingFromPreceding: [],
      changedThemes: [
        {
          type: 'segment',
          precedingTheme: 'base',
          currentTheme: 'transportation',
        },
      ],
      hasDifferences: true,
    }

    const message = buildThemeDifferenceMessage(differences)

    assert.match(message, /Missing on S3/)
    assert.doesNotMatch(message, /New on S3/)
    assert.match(message, /Reassigned themes/)
    assert.match(message, /Overture changed their schema/)
  })
})

describe('selectFeatureTypesInteractively', () => {
  test('defaults initial values to all feature types and preserves explicit selections', async () => {
    const { selectFeatureTypesInteractively } = await loadThemesModule()

    groupMultiselectMock.mockResolvedValueOnce(['building'])
    await selectFeatureTypesInteractively({
      building: 'buildings',
      address: 'buildings',
    })

    assert.deepEqual(groupMultiselectMock.mock.calls[0]?.[0].initialValues, [
      'building',
      'address',
    ])

    groupMultiselectMock.mockResolvedValueOnce(['address'])
    await selectFeatureTypesInteractively(
      {
        building: 'buildings',
        address: 'buildings',
      },
      ['address'],
    )

    assert.deepEqual(groupMultiselectMock.mock.calls[1]?.[0].initialValues, ['address'])
  })
})
