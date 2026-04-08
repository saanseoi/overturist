import { spinner } from '@clack/prompts'
import kleur from 'kleur'
import { getCachedDivision } from '../data/cache'
import { ALL_DIVISION_SUBTYPES } from '../core/constants'
import { searchDivisions } from './processing'
import {
  getDivisionsByIds,
  getDivisionsBySourceRecordId,
  localizeDivisionHierarchiesForRelease,
  normalizeOsmRelationRecordId,
} from '../data/queries'
import { getAdminLevels } from '../data/releases'
import type {
  CliArgs,
  Config,
  Division,
  GERS,
  InteractiveOptions,
  Target,
  Version,
} from '../core/types'
import {
  displaySelectedDivision,
  promptForAdministrativeLevel,
  promptForAreaName,
  promptForDivisionSelection,
  promptForOsmRelationId,
} from '../ui'
import { bail, bailFromSpinner, formatElapsedTime } from '../core/utils'

const ANY_ADMIN_LEVEL = 99

type DivisionSelectionResult = {
  divisionId: string
  division: Division
}

/**
 * Resolves the division context for the current run.
 * @param releaseVersion - Release version used to localize and resolve divisions
 * @param locale - Preferred locale for hierarchy display
 * @param config - Configuration object containing environment-derived defaults
 * @param cliArgs - Command line arguments for the current invocation
 * @param target - Selected extraction target
 * @param interactiveOpts - Interactive options (`false` = non-interactive)
 * @returns Promise resolving to the selected division and its canonical Overture id
 * @remarks World downloads do not require a division, and programmatic runs must
 * provide a division id when the target is not `world`.
 */
export async function initializeDivision(
  releaseVersion: Version,
  locale: string,
  config: Config,
  cliArgs: CliArgs,
  target: Target,
  interactiveOpts: InteractiveOptions | false | undefined,
): Promise<{ divisionId: string | null; division: Division | null }> {
  if (target === 'world' || target === 'bbox') {
    return {
      divisionId: null,
      division: null,
    }
  }

  const preselectedDivision = getPreselectedDivision(interactiveOpts, config, cliArgs)

  if (preselectedDivision) {
    const [localizedDivision] = await localizeDivisionHierarchiesForRelease(
      releaseVersion,
      [preselectedDivision],
      locale,
    )

    return {
      divisionId: localizedDivision.id,
      division: localizedDivision,
    }
  }

  if (cliArgs.divisionId) {
    const division = await getCachedDivisionOrLoad(
      cliArgs.divisionId,
      releaseVersion,
      locale,
    )

    return {
      divisionId: division.id,
      division,
    }
  } else if (cliArgs.osmId) {
    const division = await getDivisionByOsmId(cliArgs.osmId, releaseVersion, locale)

    return {
      divisionId: division.id,
      division,
    }
  } else if (config.divisionId) {
    const division = await getCachedDivisionOrLoad(
      config.divisionId,
      releaseVersion,
      locale,
    )

    return {
      divisionId: division.id,
      division,
    }
  } else if (interactiveOpts === false) {
    bail('No divisionId provided')
  }

  if (interactiveOpts?.divisionLookupMode === 'osm') {
    return await handleOsmDivisionSelection(releaseVersion, locale)
  }

  return await handleDivisionSelection(releaseVersion, locale)
}

/**
 * Resolves any preselected division that can be reused without prompting.
 * @param interactiveOpts - Interactive selection state
 * @param config - Configuration object containing persisted selections
 * @param cliArgs - Command line arguments for the current invocation
 * @returns Preselected division when it remains compatible with the active ids
 */
export function getPreselectedDivision(
  interactiveOpts: InteractiveOptions | false | undefined,
  config: Config,
  cliArgs: CliArgs,
): Division | undefined {
  if (interactiveOpts && 'selectedDivision' in interactiveOpts) {
    return interactiveOpts.selectedDivision
  }

  // Interactive prompt flows should only reuse an explicitly injected division.
  if (interactiveOpts) {
    return undefined
  }

  // Reuse the persisted selection only when it still matches any explicit ids.
  if (
    config.selectedDivision &&
    (!cliArgs.divisionId || config.selectedDivision.id === cliArgs.divisionId) &&
    (!config.divisionId || config.selectedDivision.id === config.divisionId)
  ) {
    return config.selectedDivision
  }

  return undefined
}

/**
 * Handles interactive division selection by administrative level and area name.
 * @param releaseVersion - Release version used to scope division searches
 * @param locale - Preferred locale for displaying the selected division
 * @returns Promise resolving to the selected division and canonical id
 */
export async function handleDivisionSelection(
  releaseVersion: Version,
  locale: string,
): Promise<DivisionSelectionResult> {
  const adminLevel = await promptForAdministrativeLevel(releaseVersion)

  const adminLevels = getAdminLevels(releaseVersion)
  const subtypes =
    adminLevel === ANY_ADMIN_LEVEL
      ? [...ALL_DIVISION_SUBTYPES]
      : adminLevels[adminLevel as keyof typeof adminLevels].subtypes

  const queryString = await promptForAreaName(adminLevel, releaseVersion)

  return await selectDivisionFromSearch({
    releaseVersion,
    locale,
    queryString,
    subtypes: [...subtypes],
    adminLevel,
    loadingMessage: `Searching for matching divisions (${kleur.gray('takes several minutes')})`,
    noResultsMessage: `No ${adminLevel === ANY_ADMIN_LEVEL ? 'division' : subtypes.join('/ ')} found matching "${kleur.red(queryString)}"`,
  })
}

/**
 * Handles the division selection workflow for OSM relation id input.
 * @param releaseVersion - Release version to search within
 * @param locale - Preferred locale for displaying the selected division
 * @returns Promise resolving to the selected division and canonical id
 */
export async function handleOsmDivisionSelection(
  releaseVersion: Version,
  locale: string,
): Promise<DivisionSelectionResult> {
  const queryString = await promptForOsmRelationId()

  return await selectDivisionFromSearch({
    releaseVersion,
    locale,
    queryString,
    subtypes: [],
    adminLevel: ANY_ADMIN_LEVEL,
    loadingMessage: `Searching for the division matching the OSM Relation Id (${kleur.gray('takes several minutes')})`,
    noResultsMessage: `No division found for OSM relation "${kleur.red(queryString)}"`,
  })
}

/**
 * Runs a division search workflow with shared spinner, selection, and error handling.
 * @param params - Search parameters and user-facing messages for the workflow
 * @returns Promise resolving to the selected division and canonical id
 */
async function selectDivisionFromSearch(params: {
  releaseVersion: Version
  locale: string
  queryString: string
  subtypes: string[]
  adminLevel: number
  loadingMessage: string
  noResultsMessage: string
}): Promise<DivisionSelectionResult> {
  const { releaseVersion, locale, queryString, subtypes, adminLevel } = params
  const s = spinner()
  const startedAt = Date.now()
  s.start(params.loadingMessage)

  try {
    const searchResult = await searchDivisions(
      releaseVersion,
      queryString,
      subtypes,
      adminLevel,
      locale,
    )

    if (searchResult.results.length === 0) {
      s.stop(
        `No divisions found ${kleur.gray(`(${formatElapsedTime(Date.now() - startedAt)})`)}`,
      )
      bail(params.noResultsMessage)
    }

    s.stop(
      `Found ${kleur.green(searchResult.totalCount)} matching division${searchResult.totalCount > 1 ? 's' : ''} ${kleur.gray(`(${formatElapsedTime(Date.now() - startedAt)})`)}`,
    )

    const selectedDivision = await promptForDivisionSelection(searchResult)
    displaySelectedDivision(selectedDivision, locale)

    return {
      divisionId: selectedDivision.id,
      division: selectedDivision,
    }
  } catch (error) {
    bailFromSpinner(
      s,
      'Division search failed',
      `Failed to search for divisions: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Resolves a division reference to a concrete division record.
 * @param divisionId - Overture division ID
 * @param releaseVersion - Release version to resolve against
 * @param locale - Preferred locale used to localize the resolved hierarchy
 * @returns Promise resolving to the matched division record
 */
async function getCachedDivisionOrLoad(
  divisionId: GERS,
  releaseVersion: Version,
  locale: string,
): Promise<Division> {
  const cachedDivision = await getCachedDivision(releaseVersion, divisionId)

  if (cachedDivision) {
    // Cached divisions still need hierarchy localization for the active locale.
    const [localizedDivision] = await localizeDivisionHierarchiesForRelease(
      releaseVersion,
      [cachedDivision],
      locale,
    )

    return localizedDivision
  }

  const divisions = await getDivisionsByIds(releaseVersion, [divisionId], true, locale)

  if (!divisions || divisions.length === 0) {
    bail(
      `Division ${kleur.yellow(divisionId)} not found in release "${kleur.cyan(releaseVersion)}"`,
    )
  }

  return divisions[0]
}

/**
 * Resolves an OSM relation id to a concrete division record.
 * @param osmId - Raw OSM relation id provided by the caller
 * @param releaseVersion - Release version to resolve against
 * @param locale - Preferred locale used to localize the resolved hierarchy
 * @returns Promise resolving to the matched division record
 */
async function getDivisionByOsmId(
  osmId: string,
  releaseVersion: Version,
  locale: string,
): Promise<Division> {
  const sourceRecordIdPattern = normalizeOsmRelationRecordId(osmId)

  if (!sourceRecordIdPattern) {
    bail(`Invalid OSM relation id: ${kleur.yellow(osmId)}`)
  }

  const s = spinner()
  const startedAt = Date.now()
  s.start(
    `Searching for the division matching the OSM Relation Id (${kleur.gray('takes several minutes')})`,
  )

  // OSM relation lookups are resolved directly because the input id is not the cache key.
  try {
    const divisions = await getDivisionsBySourceRecordId(
      releaseVersion,
      sourceRecordIdPattern,
      [],
      locale,
    )

    if (divisions.length === 0) {
      s.stop(
        `No divisions found ${kleur.gray(`(${formatElapsedTime(Date.now() - startedAt)})`)}`,
      )
      bail(
        `Division source ${kleur.yellow(osmId)} not found in release "${kleur.cyan(releaseVersion)}"`,
      )
    }

    if (divisions.length > 1) {
      s.stop(
        `Found ${kleur.green(divisions.length)} matching divisions ${kleur.gray(`(${formatElapsedTime(Date.now() - startedAt)})`)}`,
      )

      const divisionSummary = divisions
        .slice(0, 5)
        .map(division => division.names?.primary || division.id)
        .join(', ')

      bail(
        `Division source ${kleur.yellow(osmId)} matched multiple divisions: ${kleur.cyan(divisionSummary)}`,
      )
    }

    s.stop(
      `Found ${kleur.green(1)} matching division ${kleur.gray(`(${formatElapsedTime(Date.now() - startedAt)})`)}`,
    )

    return divisions[0]
  } catch (error) {
    bailFromSpinner(
      s,
      'OSM relation lookup failed',
      `Failed to search for divisions: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}
