import { select } from '@clack/prompts'

/**
 * Prompts for the main action.
 * @returns Selected action, or `null` when the root menu is cancelled.
 */
export async function promptForMainAction(): Promise<string | null> {
  const selected = await select({
    message: 'What would you like to do?',
    options: [
      {
        value: 'download_data',
        label: 'Download data',
        hint: 'download an area or the whole world',
      },
      {
        value: 'inspect_division',
        label: 'Get division details',
        hint: 'inspect one division and save its metadata',
      },
      {
        value: 'manage_settings',
        label: 'Settings',
        hint: 'manage preferences and cache',
      },
      {
        value: 'exit',
        label: 'Exit',
        hint: 'quit the application',
      },
    ],
  })

  return typeof selected === 'symbol' ? null : selected
}

/**
 * Prompts for the second-level download action.
 * @returns Selected action, or `back` when the prompt is cancelled.
 */
export async function promptForDownloadAction(): Promise<string> {
  const selected = await select({
    message: 'Download data:',
    options: [
      {
        value: 'search_area',
        label: 'Search',
        hint: 'find a division by name',
      },
      {
        value: 'download_osm_id',
        label: 'Provide an OSM Id',
        hint: 'resolve an OSM relation id',
      },
      {
        value: 'download_world',
        label: 'The whole world',
        hint: 'download the full dataset',
      },
      {
        value: 'back',
        label: 'Back',
        hint: 'return to the startup screen',
      },
    ],
  })

  return typeof selected === 'symbol' ? 'back' : selected
}

/**
 * Prompts for the area-search action.
 * @param message - Prompt label to show
 * @returns Selected action, or `back` when the prompt is cancelled.
 */
export async function promptForAreaSearchAction(
  message: string = 'Search for an area:',
): Promise<string> {
  const cacheModule = await import('../data/cache')
  const hasSearches = await cacheModule.hasCachedSearches()

  const selected = await select({
    message,
    options: [
      {
        value: 'new_search',
        label: 'New search',
        hint: 'search by division name',
      },
      ...(hasSearches
        ? [
            {
              value: 'repeat_search',
              label: 'Repeat a search',
              hint: 'from your local search history',
            },
          ]
        : []),
      {
        value: 'back',
        label: 'Back',
        hint: 'return to download options',
      },
    ],
  })

  return typeof selected === 'symbol' ? 'back' : selected
}

/**
 * Prompts for the settings action.
 * @returns Selected action, or `back` when the prompt is cancelled.
 */
export async function promptForSettingsAction(): Promise<string> {
  const selected = await select({
    message: 'Manage Settings and Cache:',
    options: [
      {
        value: 'show_preferences',
        label: 'Show preferences',
        hint: 'display current .env configuration',
      },
      {
        value: 'reset_preferences',
        label: 'Reset preferences',
        hint: 'delete the .env file',
      },
      {
        value: 'show_cache_stats',
        label: 'Show cache stats',
        hint: 'display cache directory sizes',
      },
      {
        value: 'purge_cache',
        label: 'Purge cache',
        hint: 'delete the entire .cache directory',
      },
      {
        value: 'back',
        label: 'Back to main menu',
        hint: 'return to the previous menu',
      },
    ],
  })

  return typeof selected === 'symbol' ? 'back' : selected
}
