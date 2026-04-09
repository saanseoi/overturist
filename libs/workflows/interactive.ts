import { outro } from '@clack/prompts'
import kleur from 'kleur'
import { note } from '../core/note'
import { bail } from '../core/utils'
import {
  cacheDivision,
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
import { getDivisionsByIds } from '../data/queries'
import type {
  CliArgs,
  Config,
  Division,
  InteractiveOptions,
  SearchHistoryItem,
} from '../core/types'
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

  const cachedResults = await resolveRepeatSearchResults(searchItem)

  if (!cachedResults) {
    console.error(kleur.red('Could not load cached search results'))
    return
  }

  // Prompt for division selection
  const division = await promptForDivisionSelection({
    results: cachedResults.results,
    totalCount: cachedResults.totalCount,
  })

  if (!division) {
    return // User cancelled
  }

  const resolvedDivision = await refreshRepeatSearchDivisionIfNeeded(
    searchItem.version,
    division,
    config,
    cliArgs,
  )

  // Set the division ID and selected division in config
  config.divisionId = resolvedDivision.id
  config.selectedDivision = resolvedDivision

  if (mode === 'info') {
    await handleDivisionInfoSelection(config, cliArgs, resolvedDivision)
    return
  }

  // Use the common initialization and download workflow
  const initResult = await resolveOptions(config, cliArgs, {
    releaseVersion: null,
    selectedDivision: resolvedDivision,
  })
  if (!initResult) {
    return
  }

  await executeDownloadWorkflow(initResult)
}

/**
 * Resolves cached repeat-search results from the selected history entry.
 * @param searchItem - Selected search-history entry
 * @returns Cached search results ready for the selection prompt, or null when unavailable
 */
async function resolveRepeatSearchResults(
  searchItem: SearchHistoryItem,
): Promise<Pick<SearchHistoryItem, 'results' | 'totalCount'> | null> {
  if (searchItem.results.length > 0) {
    return {
      results: searchItem.results,
      totalCount: searchItem.totalCount,
    }
  }

  return await getCachedSearchResults(
    searchItem.version,
    searchItem.adminLevel,
    searchItem.term,
  )
}

/**
 * Ensures the selected repeat-search division is present in the division cache.
 * @param releaseVersion - Release version associated with the cached search
 * @param division - Division selected from the cached search results
 * @param config - Environment-backed configuration object
 * @param cliArgs - Parsed command-line arguments
 * @returns Division ready for downstream workflows
 */
async function refreshRepeatSearchDivisionIfNeeded(
  releaseVersion: string,
  division: Division,
  config: Config,
  cliArgs: CliArgs,
): Promise<Division> {
  const cachedDivision = await getCachedDivision(releaseVersion, division.id)

  if (cachedDivision) {
    return cachedDivision
  }

  note(
    [
      `${kleur.bold('Cached search:')} ${kleur.cyan(division.names?.primary || division.id)}`,
      `${kleur.bold('Status:')} ${kleur.yellow('Division details were missing from the local cache')}`,
      `${kleur.bold('Action:')} ${kleur.gray('Re-downloading the division now')}`,
    ].join('\n'),
    'Repeat Search',
  )

  const { locale } = initializeLocale(config, cliArgs)
  const refreshedDivisions = await getDivisionsByIds(
    releaseVersion,
    [division.id],
    true,
    locale,
  )
  const refreshedDivision = refreshedDivisions[0]

  if (!refreshedDivision) {
    return division
  }

  await cacheDivision(releaseVersion, refreshedDivision.id, refreshedDivision)
  return refreshedDivision
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
): Promise<void> {
  const ctx = await resolveDivisionInfoContext(config, cliArgs, {
    releaseVersion: null,
    selectedDivision: division,
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

  if (cliArgs.bbox) {
    return { target: 'bbox' }
  }

  if (cliArgs.bboxRequested) {
    if (config.bbox) {
      return { target: 'bbox' }
    }

    bail(
      'The --bbox flag requires bbox coordinates or BBOX_XMIN/BBOX_YMIN/BBOX_XMAX/BBOX_YMAX in .env',
    )
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
    const bboxSource = cliArgs.bbox ? 'CLI' : config.bbox ? 'Config' : 'Unknown'

    note(
      [
        `${kleur.bold('Target:')} ${kleur.cyan('Bounding box')}`,
        `${kleur.bold('Source:')} ${kleur.gray(bboxSource)}`,
      ].join('\n'),
      'Download Data',
    )
    return
  }

  const divisionId = cliArgs.divisionId || config.divisionId

  if (divisionId) {
    const cachedDivision = await findCachedDivisionSummary(divisionId)

    if (cachedDivision) {
      const divisionName = cachedDivision.names?.primary || cachedDivision.id
      const hierarchy =
        cachedDivision.hierarchies?.[0]?.map(entry => entry.name).join(' / ') || '-'
      note(
        [
          `${kleur.bold('Target:')} ${kleur.cyan('Division')}`,
          `${kleur.bold('Name:')} ${kleur.cyan(divisionName)}`,
          `${kleur.bold('Subtype:')} ${kleur.magenta(cachedDivision.subtype || '-')}`,
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
