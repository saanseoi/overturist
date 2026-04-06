import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, mock, test } from 'bun:test'
import kleur from 'kleur'
import type { Division } from '../libs/core'

const selectMock = mock(async () => 'unused')
const textMock = mock(async () => 'unused')
const noteMock = mock(() => {})
const successExitMock = mock((message?: string) => {
  throw new Error(`successExit:${message ?? ''}`)
})
const getAdminLevelsMock = mock(() => ({
  1: { name: 'Country', subtypes: ['country'] },
  2: { name: 'Region', subtypes: ['region'] },
  3: { name: 'Locality', subtypes: ['locality'] },
  4: { name: 'Neighborhood', subtypes: ['neighborhood'] },
}))

function createDivision(id: string, names: string[], subtype = 'locality'): Division {
  return {
    id,
    names: {
      primary: names[names.length - 1],
      common: [],
    },
    subtype,
    country: 'HK',
    hierarchies: [
      names.map((name, index) => ({
        division_id: `${id}-${index}`,
        subtype:
          index === 0 ? 'country' : index === names.length - 1 ? subtype : 'region',
        name,
      })),
    ],
  }
}

async function loadDivisionsModule() {
  mock.module('@clack/prompts', () => ({
    select: selectMock,
    text: textMock,
    log: {
      message: mock(() => {}),
      warn: mock(() => {}),
      warning: mock(() => {}),
    },
    spinner: mock(() => ({
      start: () => {},
      stop: () => {},
      message: () => {},
    })),
    outro: mock(() => {}),
    groupMultiselect: mock(async () => []),
  }))
  mock.module(new URL('../libs/core/note.ts', import.meta.url).pathname, () => ({
    note: noteMock,
  }))
  mock.module(new URL('../libs/core/utils.ts', import.meta.url).pathname, () => ({
    successExit: successExitMock,
    bail: (message?: string) => {
      throw new Error(`bail:${message ?? ''}`)
    },
    getDiffCount: (currentCount: number, previousCount: number | null) =>
      previousCount === null ? null : currentCount - previousCount,
  }))
  mock.module(new URL('../libs/data/releases.ts', import.meta.url).pathname, () => ({
    getAdminLevels: getAdminLevelsMock,
  }))
  mock.module(new URL('../libs/ui/format.ts', import.meta.url).pathname, () => ({
    formatBboxPath: () => '',
    formatPath: (value: string) => value,
  }))

  return await import(
    new URL(
      `../libs/ui/divisions.ts?case=${Date.now()}-${Math.random()}`,
      import.meta.url,
    ).href
  )
}

beforeEach(() => {
  selectMock.mockReset()
  textMock.mockReset()
  noteMock.mockReset()
  successExitMock.mockReset()
  getAdminLevelsMock.mockReset()
  getAdminLevelsMock.mockReturnValue({
    1: { name: 'Country', subtypes: ['country'] },
    2: { name: 'Region', subtypes: ['region'] },
    3: { name: 'Locality', subtypes: ['locality'] },
    4: { name: 'Neighborhood', subtypes: ['neighborhood'] },
  })
})

afterEach(() => {
  mock.restore()
})

describe('divisions utils', () => {
  test('finds the shortest unique reverse hierarchy path for ambiguous results', async () => {
    const { getUniqueHierarchyPath, buildDivisionSelectionOption } = await import(
      new URL(
        `../libs/ui/divisions.utils.ts?case=${Date.now()}-${Math.random()}`,
        import.meta.url,
      ).href
    )

    const centralHongKong = createDivision('hk-central', [
      'Hong Kong',
      'Hong Kong Island',
      'Central',
    ])
    const centralSingapore = createDivision('sg-central', [
      'Singapore',
      'Central Region',
      'Central',
    ])

    assert.equal(
      getUniqueHierarchyPath(centralHongKong, [centralHongKong, centralSingapore]),
      'Central / Hong Kong Island',
    )

    const option = buildDivisionSelectionOption(centralHongKong, [
      centralHongKong,
      centralSingapore,
    ])

    assert.equal(
      option.label,
      `${kleur.magenta('locality')}: Central / Hong Kong Island`,
    )
    assert.equal(option.hint, 'Hong Kong')
  })

  test('formats and truncates common names and hierarchies for division info', async () => {
    const { formatCommonNameEntries, formatHierarchyEntries, formatSingleLineBbox } =
      await import(
        new URL(
          `../libs/ui/divisions.utils.ts?case=${Date.now()}-${Math.random()}`,
          import.meta.url,
        ).href
      )

    const commonNames = formatCommonNameEntries({
      id: 'division-1',
      names: {
        primary: 'Central',
        common: Array.from({ length: 6 }, (_, index) => ({
          key: `lang-${index}`,
          value: `Name ${index}`,
        })),
      },
      subtype: 'locality',
      country: 'HK',
      hierarchies: [],
    })

    assert.equal(commonNames.length, 6)
    assert.equal(commonNames.at(-1), kleur.gray('...1 more'))

    const hierarchies = formatHierarchyEntries(
      Array.from({ length: 6 }, (_, rowIndex) => [
        {
          division_id: `id-${rowIndex}-0`,
          subtype: 'country',
          name: `Country ${rowIndex}`,
        },
        {
          division_id: `id-${rowIndex}-1`,
          subtype: 'region',
          name: `Region ${rowIndex}`,
        },
      ]),
    )

    assert.equal(hierarchies.length, 6)
    assert.equal(hierarchies.at(-1), kleur.gray('...1 more'))
    assert.equal(
      formatSingleLineBbox({ xmin: 114.123456, ymin: 22.3, xmax: 114.4, ymax: 22 }),
      '114.12346, 22.3, 114.4, 22',
    )
  })

  test('sorts division results from larger subtypes to smaller ones', async () => {
    const { sortDivisionResultsLargeToSmall } = await import(
      new URL(
        `../libs/ui/divisions.utils.ts?case=${Date.now()}-${Math.random()}`,
        import.meta.url,
      ).href
    )

    const sorted = sortDivisionResultsLargeToSmall([
      createDivision('microhood-1', ['Hong Kong', 'Central', 'Pier'], 'microhood'),
      createDivision('dependency-1', ['Hong Kong'], 'dependency'),
      createDivision('neighborhood-1', ['Hong Kong', 'Mid-Levels'], 'neighborhood'),
      createDivision('locality-1', ['Hong Kong', 'Central and Western'], 'locality'),
    ])

    assert.deepEqual(
      sorted.map(division => division.subtype),
      ['dependency', 'locality', 'neighborhood', 'microhood'],
    )
  })
})

describe('promptForDivisionSelection', () => {
  test('sorts displayed results from larger subtypes to smaller ones', async () => {
    const results = [
      createDivision('microhood-1', ['Hong Kong', 'Central', 'Pier'], 'microhood'),
      createDivision('dependency-1', ['Hong Kong'], 'dependency'),
      createDivision('neighborhood-1', ['Hong Kong', 'Mid-Levels'], 'neighborhood'),
    ]

    const promptCalls: Array<{ options: Array<{ value: unknown }> }> = []
    selectMock.mockImplementation(
      async (config: { options: Array<{ value: unknown }> }) => {
        promptCalls.push(config)
        return config.options[0]?.value
      },
    )

    const { promptForDivisionSelection } = await loadDivisionsModule()
    const selected = await promptForDivisionSelection({
      results,
      totalCount: results.length,
    })

    assert.equal((promptCalls[0]?.options[0]?.value as Division).subtype, 'dependency')
    assert.equal(selected.subtype, 'dependency')
  })

  test('paginates through large result sets and returns the selected division', async () => {
    const results = Array.from({ length: 16 }, (_, index) =>
      createDivision(`division-${index + 1}`, [
        'Country',
        `Region ${index}`,
        `Place ${index}`,
      ]),
    )

    const promptCalls: Array<{ message: string; options: Array<{ value: unknown }> }> =
      []
    selectMock.mockImplementation(
      async (config: { message: string; options: Array<{ value: unknown }> }) => {
        promptCalls.push(config)
        return promptCalls.length === 1 ? 'next_page' : results[15]
      },
    )

    const { promptForDivisionSelection } = await loadDivisionsModule()
    const selected = await promptForDivisionSelection({
      results,
      totalCount: results.length,
    })

    assert.equal(selected.id, results[15].id)
    assert.equal(promptCalls.length, 2)
    assert.equal(promptCalls[0]?.options.at(-1)?.value, 'next_page')
    assert.equal(promptCalls[1]?.options[0]?.value, 'prev_page')
    assert.match(promptCalls[1]?.message ?? '', /16-16 of 16 results/)
  })
})

describe('displaySelectedDivision', () => {
  test('includes localized names only when they differ from the primary name', async () => {
    const { displaySelectedDivision } = await loadDivisionsModule()
    const division: Division = {
      id: 'division-1',
      names: {
        primary: 'Hong Kong',
        common: [
          { key: 'en', value: 'Hong Kong' },
          { key: 'zh', value: '香港' },
        ],
      },
      subtype: 'country',
      country: 'HK',
      hierarchies: [
        [{ division_id: 'country', subtype: 'country', name: 'Hong Kong' }],
      ],
    }

    displaySelectedDivision(division, 'zh')

    const [message, title] = noteMock.mock.calls[0] as [string, string]
    assert.equal(title, 'Selected Division')
    assert.match(message, /Name \(ZH\):/)
    assert.match(message, /香港/)
  })
})
