import { outro } from '@clack/prompts'
import kleur from 'kleur'
import { note } from '../core/note'
import {
  getCachedDivision,
  getCachedSearchResults,
  getVersionsInCache,
} from '../data/cache'
import { warmReleaseCacheForInteractiveStartup } from '../data/releases'
import { executeDownloadWorkflow, resolveOptions } from './get'
import {
  infoCmd,
  persistAndDisplayDivisionInfo,
  resolveDivisionInfoContext,
} from './info'
import { initializeLocale } from '../core/config'
import { localizeDivisionHierarchiesForRelease } from '../data/queries'
import type { CliArgs, Config, Division, InteractiveOptions } from '../core/types'
import {
  displayBanner,
  promptForAreaSearchAction,
  promptForDownloadAction,
  promptForDivisionSelection,
  promptForMainAction,
  promptForSearchHistory,
  promptForSettingsAction,
} from '../ui'

/**
 * MENUS
 */

/**
 * Runs the interactive mode with main menu loop
 */
export async function handleMainMenu(CONFIG: Config, cliArgs: CliArgs) {
  void warmReleaseCacheForInteractiveStartup(CONFIG)
  displayBanner()

  if (await handlePresetDownloadFlow(CONFIG, cliArgs)) {
    return
  }

  while (true) {
    const action = await promptForMainAction()

    if (action === null) {
      outro(kleur.blue('Goodbye!'))
      return
    }

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
        await infoCmd(config, cliArgs, { releaseVersion: null })
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
          const controlContext = await resolveOptions(config, cliArgs, {
            releaseVersion: null,
          })

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
          releaseVersion: null,
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
          releaseVersion: null,
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
    await handleDivisionInfoSelection(config, cliArgs)
    return
  }

  // Use the common initialization and download workflow
  const initResult = await resolveOptions(config, cliArgs, { releaseVersion: null })
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
): Promise<void> {
  const ctx = await resolveDivisionInfoContext(config, cliArgs, {
    releaseVersion: null,
  })
  await persistAndDisplayDivisionInfo(ctx)
}

/**
 * Bypasses the main menu when the invocation already identifies a download target.
 * @param config - Initial configuration object
 * @param cliArgs - Command line arguments
 * @returns Promise resolving to true when a direct download flow ran
 */
async function handlePresetDownloadFlow(
  config: Config,
  cliArgs: CliArgs,
): Promise<boolean> {
  const presetTarget = await getPresetDownloadTarget(config, cliArgs)

  if (!presetTarget) {
    return false
  }

  await displayPresetDownloadHeader(config, cliArgs, presetTarget)
  const controlContext = await resolveOptions(config, cliArgs, {
    releaseVersion: null,
    ...presetTarget,
  })

  if (!controlContext) {
    return true
  }

  await executeDownloadWorkflow(controlContext)
  return true
}

/**
 * Resolves any direct target selection that should skip the interactive target menu.
 * @param config - Initial configuration object
 * @param cliArgs - Command line arguments
 * @returns Interactive target overrides or null when the user should see the normal menu
 */
async function getPresetDownloadTarget(
  config: Config,
  cliArgs: CliArgs,
): Promise<InteractiveOptions | null> {
  if (cliArgs.world) {
    return { target: 'world' }
  }

  if (cliArgs.osmIdRequested || cliArgs.osmId) {
    return {
      target: 'division',
      divisionLookupMode: 'osm',
    }
  }

  if (cliArgs.divisionRequested || cliArgs.divisionId || config.divisionId) {
    return { target: 'division' }
  }

  if (cliArgs.bboxRequested || cliArgs.bbox) {
    return { target: 'bbox' }
  }

  if (config.target === 'world') {
    return { target: 'world' }
  }

  if (config.target === 'bbox' && config.bbox) {
    return { target: 'bbox' }
  }

  if (config.divisionId) {
    return { target: 'division' }
  }

  return null
}

/**
 * Displays the resolved or pending target before interactive download setup continues.
 * @param config - Initial configuration object
 * @param cliArgs - Command line arguments
 * @param interactiveOpts - Interactive target overrides
 * @returns Promise resolving when the header has been rendered
 */
async function displayPresetDownloadHeader(
  config: Config,
  cliArgs: CliArgs,
  interactiveOpts: InteractiveOptions,
): Promise<void> {
  if (interactiveOpts.target === 'world') {
    note(`${kleur.bold('Target:')} ${kleur.cyan('World')}`, 'Download Data')
    return
  }

  if (interactiveOpts.target === 'bbox') {
    note(
      [
        `${kleur.bold('Target:')} ${kleur.cyan('Bounding box')}`,
        `${kleur.bold('Source:')} ${kleur.gray(cliArgs.bbox ? 'CLI' : 'Config')}`,
      ].join('\n'),
      'Download Data',
    )
    return
  }

  const divisionId = cliArgs.divisionId || config.divisionId

  if (divisionId) {
    const cachedDivision = await findCachedDivisionSummary(divisionId)

    if (cachedDivision) {
      const hierarchy =
        cachedDivision.hierarchies?.[0]?.map(entry => entry.name).join(' / ') || '-'
      note(
        [
          `${kleur.bold('Target:')} ${kleur.cyan(cachedDivision.names?.primary || cachedDivision.id)}`,
          `${kleur.bold('Hierarchy:')} ${kleur.gray(hierarchy)}`,
          `${kleur.bold('GERS Id:')} ${kleur.yellow(cachedDivision.id)}`,
        ].join('\n'),
        'Download Data',
      )
      return
    }

    note(
      [
        `${kleur.bold('Target:')} ${kleur.cyan('Division')}`,
        `${kleur.bold('GERS Id:')} ${kleur.yellow(divisionId)} ${kleur.green('(NEW)')}`,
      ].join('\n'),
      'Download Data',
    )
    return
  }

  if (cliArgs.osmId) {
    note(
      [
        `${kleur.bold('Target:')} ${kleur.cyan('Division')}`,
        `${kleur.bold('OSM Id:')} ${kleur.yellow(cliArgs.osmId)} ${kleur.green('(NEW)')}`,
      ].join('\n'),
      'Download Data',
    )
    return
  }

  if (interactiveOpts.divisionLookupMode === 'osm' || cliArgs.osmIdRequested) {
    note(
      `${kleur.bold('Target:')} ${kleur.cyan('Division for OSM relation id')}`,
      'Download Data',
    )
    return
  }

  note(`${kleur.bold('Target:')} ${kleur.cyan('Division')}`, 'Download Data')
}

/**
 * Finds a cached division record across locally cached versions.
 * @param divisionId - Division identifier to look up
 * @returns Cached division when present, otherwise null
 */
async function findCachedDivisionSummary(divisionId: string): Promise<Division | null> {
  const cachedVersions = await getVersionsInCache()

  for (const version of cachedVersions) {
    const cachedDivision = await getCachedDivision(version, divisionId)
    if (cachedDivision) {
      return cachedDivision
    }
  }

  return null
}
