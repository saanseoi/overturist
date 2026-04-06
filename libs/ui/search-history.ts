import type { Option } from '@clack/prompts'
import { log, select } from '@clack/prompts'
import { getSearchHistory } from '../data/cache'
import type { SearchHistoryItem } from '../core/types'
import { buildSearchHistoryOptions } from './search-history.utils'

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

  const options = buildSearchHistoryOptions(history)

  const selected = await select({
    message: 'Which search would you like to repeat?',
    options: options as Option<string | SearchHistoryItem>[],
  })

  if (typeof selected === 'symbol' || selected === 'show_more') {
    return null
  }

  return typeof selected === 'string' ? null : selected
}
