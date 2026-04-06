import type { Option } from '@clack/prompts'
import { log, select } from '@clack/prompts'
import kleur from 'kleur'
import { getSearchHistory } from '../data/cache'
import { getAdminLevels } from '../data/releases'
import type { SearchHistoryItem } from '../core/types'
import { ANY_ADMIN_LEVEL } from './shared'

/**
 * Prompts the user to select an item from search history.
 * @returns Selected history item, or `null` when cancelled or unavailable.
 */
export async function promptForSearchHistory(): Promise<SearchHistoryItem | null> {
  const history = await getSearchHistory()

  if (history.length === 0) {
    log.warning('No search history found.')
    return null
  }

  const options: Array<{
    value: SearchHistoryItem | string
    label: string
    hint: string
  }> = history.slice(0, 50).map(entry => {
    const createdDate = new Date(entry.createdAt)
    const date = createdDate.toISOString().split('T')[0]
    const time = createdDate.toTimeString().split(' ')[0].substring(0, 5)
    const levelName = toSearchHistoryLevelLabel(
      entry.version,
      entry.adminLevel,
      entry.term,
    )

    return {
      value: entry,
      label: entry.term,
      hint: `${levelName} • ${date} ${time} • ${entry.totalCount} ${entry.totalCount > 1 ? 'results' : 'result'}`,
    }
  })

  if (history.length > 50) {
    options.push({
      value: 'show_more',
      label: kleur.blue('Show older searches...'),
      hint: `Showing 50 of ${history.length} total searches`,
    })
  }

  const selected = await select({
    message: 'Which search would you like to repeat?',
    options: options as Option<string | SearchHistoryItem>[],
  })

  if (typeof selected === 'symbol' || selected === 'show_more') {
    return null
  }

  return typeof selected === 'string' ? null : selected
}

/**
 * Builds the human-readable label for a cached search level.
 * @param version - Cached release version
 * @param adminLevel - Cached administrative level
 * @param term - Original search term
 * @returns Search level label for the option hint.
 */
function toSearchHistoryLevelLabel(
  version: string,
  adminLevel: number,
  term: string,
): string {
  const isOsmLookup =
    /^\d+$/.test(term) || /^r\d+$/.test(term) || /^r\d+@.+$/.test(term)

  if (adminLevel === ANY_ADMIN_LEVEL && isOsmLookup) {
    return 'OSM relation'
  }

  if (adminLevel === ANY_ADMIN_LEVEL) {
    return 'ANY'
  }

  const adminLevels = getAdminLevels(version)
  return (
    adminLevels[adminLevel as keyof typeof adminLevels]?.name || `Level ${adminLevel}`
  )
}
