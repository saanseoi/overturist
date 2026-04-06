import kleur from 'kleur'
import { getAdminLevels } from '../data/releases'
import type { SearchHistoryItem } from '../core/types'
import { ANY_ADMIN_LEVEL } from './shared'

/**
 * Builds the human-readable label for a cached search level.
 * @param version - Cached release version
 * @param adminLevel - Cached administrative level
 * @param term - Original search term
 * @returns Search level label for the option hint.
 */
export function toSearchHistoryLevelLabel(
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

/**
 * Converts cached search history into prompt options.
 * @param history - Cached search history items
 * @returns Prompt options with display labels and hints.
 */
export function buildSearchHistoryOptions(history: SearchHistoryItem[]): Array<{
  value: SearchHistoryItem | string
  label: string
  hint: string
}> {
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

  return options
}
