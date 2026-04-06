import { outro } from '@clack/prompts'
import kleur from 'kleur'
import { getCachedSearchResults } from './cache'
import { executeDownloadWorkflow, resolveOptions } from './get'
import {
  infoCmd,
  persistAndDisplayDivisionInfo,
  resolveDivisionInfoContext,
} from './info'
import { initializeLocale } from './config'
import { localizeDivisionHierarchiesForRelease } from './queries'
import type { CliArgs, Config, Division } from './types'
import {
  displayBanner,
  promptForAreaSearchAction,
  promptForDownloadAction,
  promptForDivisionSelection,
  promptForMainAction,
  promptForSearchHistory,
  promptForSettingsAction,
} from './ui'

/**
 * MENUS
 */

/**
 * Runs the interactive mode with main menu loop
 */
export async function handleMainMenu(CONFIG: Config, cliArgs: CliArgs) {
  displayBanner()

  while (true) {
    const action = await promptForMainAction()

    switch (action) {
      case 'download_data': {
        await handleDownloadMenu(CONFIG, cliArgs)
        break
      }

      case 'inspect_division': {
        await handleDivisionInfoMenu(CONFIG, cliArgs)
        break
      }

      case 'manage_settings': {
        await handleSettingsMenu(CONFIG, cliArgs)
        break
      }

      case 'exit':
        outro(kleur.blue('Goodbye!'))
        process.exit(0)
        break

      default:
        console.error(kleur.red('Invalid action selected'))
        process.exit(1)
    }
  }
}

/**
 * Handles the division details menu loop and routes into the requested cached or new search workflow.
 * @param config - Initial configuration object
 * @param cliArgs - Command line arguments
 * @returns Promise resolving when the user leaves the division details menu
 */
async function handleDivisionInfoMenu(config: Config, cliArgs: CliArgs): Promise<void> {
  while (true) {
    const action = await promptForAreaSearchAction('Get division details:')

    switch (action) {
      case 'new_search': {
        await infoCmd(config, cliArgs)
        return
      }

      case 'repeat_search': {
        await handleRepeatSearchWorkflow(config, cliArgs, 'info')
        return
      }

      case 'back':
        return

      default:
        console.error(kleur.red('Invalid division details action selected'))
        return
    }
  }
}

/**
 * Handles the download menu loop and routes into the requested download workflow.
 * @param config - Initial configuration object
 * @param cliArgs - Command line arguments
 * @returns Promise resolving when the user leaves the download menu
 */
async function handleDownloadMenu(config: Config, cliArgs: CliArgs): Promise<void> {
  while (true) {
    const action = await promptForDownloadAction()

    switch (action) {
      case 'search_area': {
        const searchAction = await promptForAreaSearchAction()

        if (searchAction === 'back') {
          continue
        }

        if (searchAction === 'new_search') {
          const controlContext = await resolveOptions(config, cliArgs)

          if (!controlContext) {
            continue
          }

          await executeDownloadWorkflow(controlContext)
          return
        }

        if (searchAction === 'repeat_search') {
          await handleRepeatSearchWorkflow(config, cliArgs)
          return
        }

        console.error(kleur.red('Invalid search action selected'))
        return
      }

      case 'download_osm_id': {
        const controlContext = await resolveOptions(config, cliArgs, {
          target: 'division',
          divisionLookupMode: 'osm',
        })

        if (!controlContext) {
          continue
        }

        await executeDownloadWorkflow(controlContext)
        return
      }

      case 'download_world': {
        const controlContext = await resolveOptions(config, cliArgs, {
          target: 'world',
        })

        if (!controlContext) {
          continue
        }

        await executeDownloadWorkflow(controlContext)
        return
      }

      case 'back':
        return

      default:
        console.error(kleur.red('Invalid download action selected'))
        return
    }
  }
}

/**
 * Handles the settings menu loop
 */
async function handleSettingsMenu(CONFIG?: Config, cliArgs?: CliArgs) {
  while (true) {
    const action = await promptForSettingsAction()

    switch (action) {
      case 'show_preferences': {
        const { showPreferences } = await import('./settings')
        await showPreferences()
        break
      }

      case 'reset_preferences': {
        const { resetPreferences } = await import('./settings')
        await resetPreferences(CONFIG, cliArgs)
        break
      }

      case 'show_cache_stats': {
        const { showCacheStats } = await import('./settings')
        await showCacheStats()
        break
      }

      case 'purge_cache': {
        const { purgeCache } = await import('./settings')
        await purgeCache()
        break
      }

      case 'back':
        return // Return to main menu

      default:
        console.error(kleur.red('Invalid settings action selected'))
        return
    }
  }
}

/**
 * Handles the repeat search workflow by loading cached search results.
 * @param config - Initial configuration object
 * @param cliArgs - Command line arguments
 * @returns Promise resolving when workflow is complete or null if cancelled
 */
async function handleRepeatSearchWorkflow(
  config: Config,
  cliArgs: CliArgs,
  mode: 'download' | 'info' = 'download',
): Promise<void> {
  const searchItem = await promptForSearchHistory()
  if (!searchItem) {
    return // User cancelled or no history available
  }

  // Load the search results from cache file
  const cachedResults = await getCachedSearchResults(
    searchItem.version,
    searchItem.adminLevel,
    searchItem.term,
  )

  if (!cachedResults) {
    console.error(kleur.red('Could not load cached search results'))
    return
  }

  const { locale } = initializeLocale(config, cliArgs)
  const localizedResults = await localizeDivisionHierarchiesForRelease(
    searchItem.version,
    cachedResults.results,
    locale,
  )

  // Prompt for division selection
  const division = await promptForDivisionSelection({
    results: localizedResults,
    totalCount: cachedResults.totalCount,
  })

  if (!division) {
    return // User cancelled
  }

  // Set the division ID and selected division in config
  config.divisionId = division.id
  config.selectedDivision = division

  if (mode === 'info') {
    await handleDivisionInfoSelection(config, cliArgs, division, searchItem.version)
    return
  }

  // Use the common initialization and download workflow
  const initResult = await resolveOptions(config, cliArgs, {
    selectedDivision: division,
  })
  if (!initResult) {
    return
  }

  await executeDownloadWorkflow(initResult)
}

/**
 * Resolves division details for a selected search result without re-fetching the division.
 * @param config - Initial configuration object
 * @param cliArgs - Command line arguments
 * @param division - Division selected from cached search results
 * @param releaseVersion - Release version associated with the cached search
 * @returns Promise resolving when the division details have been displayed
 */
async function handleDivisionInfoSelection(
  config: Config,
  cliArgs: CliArgs,
  division: Division,
  releaseVersion: string,
): Promise<void> {
  const ctx = await resolveDivisionInfoContext(config, cliArgs, {
    releaseVersion,
    selectedDivision: division,
  })
  await persistAndDisplayDivisionInfo(ctx)
}
