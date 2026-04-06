import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, mock, test } from 'bun:test'
import type { SearchHistoryItem } from '../libs/core'
import { ANY_ADMIN_LEVEL } from '../libs/ui/shared'

const selectMock = mock(async () => null)
const warningMock = mock(() => {})
const getSearchHistoryMock = mock(async () => [])
const getAdminLevelsMock = mock(() => ({
  2: { name: 'Region', subtypes: ['region'] },
}))

function createHistoryItem(
  overrides: Partial<SearchHistoryItem> = {},
): SearchHistoryItem {
  return {
    term: 'Central',
    adminLevel: 2,
    version: '2026-03-18.0',
    createdAt: '2026-04-07T01:23:00.000Z',
    totalCount: 2,
    results: [],
    ...overrides,
  }
}

async function loadSearchHistoryModule() {
  mock.module('@clack/prompts', () => ({
    select: selectMock,
    log: {
      warning: warningMock,
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
    groupMultiselect: mock(async () => []),
  }))
  mock.module(new URL('../libs/data/cache.ts', import.meta.url).pathname, () => ({
    getSearchHistory: getSearchHistoryMock,
  }))
  mock.module(new URL('../libs/data/releases.ts', import.meta.url).pathname, () => ({
    getAdminLevels: getAdminLevelsMock,
  }))

  return await import(
    new URL(
      `../libs/ui/search-history.ts?case=${Date.now()}-${Math.random()}`,
      import.meta.url,
    ).href
  )
}

beforeEach(() => {
  selectMock.mockReset()
  warningMock.mockReset()
  getSearchHistoryMock.mockReset()
  getAdminLevelsMock.mockReset()
  getAdminLevelsMock.mockReturnValue({
    2: { name: 'Region', subtypes: ['region'] },
  })
})

afterEach(() => {
  mock.restore()
})

describe('search-history utils', () => {
  test('labels osm lookups, generic ANY searches, and unknown admin levels correctly', async () => {
    mock.module('@clack/prompts', () => ({
      select: selectMock,
      log: {
        warning: warningMock,
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
      groupMultiselect: mock(async () => []),
    }))
    mock.module(new URL('../libs/data/releases.ts', import.meta.url).pathname, () => ({
      getAdminLevels: getAdminLevelsMock,
    }))

    const { toSearchHistoryLevelLabel, buildSearchHistoryOptions } = await import(
      new URL(
        `../libs/ui/search-history.utils.ts?case=${Date.now()}-${Math.random()}`,
        import.meta.url,
      ).href
    )

    assert.equal(
      toSearchHistoryLevelLabel('2026-03-18.0', ANY_ADMIN_LEVEL, 'r10268797'),
      'OSM relation',
    )
    assert.equal(
      toSearchHistoryLevelLabel('2026-03-18.0', ANY_ADMIN_LEVEL, 'Central'),
      'ANY',
    )
    assert.equal(toSearchHistoryLevelLabel('2026-03-18.0', 999, 'Central'), 'Level 999')

    const history = [
      createHistoryItem({ term: 'Central', totalCount: 1 }),
      ...Array.from({ length: 50 }, (_, index) =>
        createHistoryItem({
          term: `Search ${index + 2}`,
          createdAt: `2026-04-07T0${index % 10}:00:00.000Z`,
        }),
      ),
    ]
    const options = buildSearchHistoryOptions(history)

    assert.equal(options.length, 51)
    assert.match(options[0]?.hint ?? '', /1 result$/)
    assert.equal(options.at(-1)?.value, 'show_more')
    assert.match(options.at(-1)?.hint ?? '', /Showing 50 of 51 total searches/)
  })
})

describe('promptForSearchHistory', () => {
  test('warns and returns null when there is no search history', async () => {
    getSearchHistoryMock.mockResolvedValue([])

    const { promptForSearchHistory } = await loadSearchHistoryModule()
    const result = await promptForSearchHistory()

    assert.equal(result, null)
    assert.equal(warningMock.mock.calls.length, 1)
    assert.equal(selectMock.mock.calls.length, 0)
  })

  test('returns the selected history item from the prompt', async () => {
    const historyItem = createHistoryItem({ term: 'Kowloon' })
    getSearchHistoryMock.mockResolvedValue([historyItem])
    selectMock.mockResolvedValue(historyItem)

    const { promptForSearchHistory } = await loadSearchHistoryModule()
    const result = await promptForSearchHistory()

    assert.equal(result?.term, 'Kowloon')
  })
})
