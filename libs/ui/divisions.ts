import path from 'node:path'
import type { Option } from '@clack/prompts'
import { select, text } from '@clack/prompts'
import kleur from 'kleur'
import { note } from '../core/note'
import { getAdminLevels } from '../data/releases'
import type { ControlContext, Division, DivisionOption, Version } from '../core/types'
import { successExit } from '../core/utils'
import { formatPath } from './format'
import { ANY_ADMIN_LEVEL } from './shared'
import {
  buildDivisionSelectionOption,
  formatCommonNameEntries,
  formatDivisionInfoSection,
  formatHierarchyEntries,
  formatSingleLineBbox,
  getAreaPlaceholder,
  sortDivisionResultsLargeToSmall,
} from './divisions.utils'

/**
 * Prompts for the administrative level used by a division search.
 * @param releaseVersion - Release version used to resolve level names
 * @returns Selected administrative level.
 */
export async function promptForAdministrativeLevel(
  releaseVersion: Version,
): Promise<number> {
  const adminLevels = getAdminLevels(releaseVersion)

  const level = await select({
    message: 'Select administrative level:',
    options: [
      {
        value: ANY_ADMIN_LEVEL,
        label: 'ANY',
        hint: 'search across all division subtypes',
      },
      ...Object.entries(adminLevels).map(([num, config]) => ({
        value: Number.parseInt(num, 10),
        label: `${num}. ${config.name}`,
        hint: config.subtypes.join(', '),
      })),
    ],
  })

  if (typeof level === 'symbol') {
    successExit('Administrative level selection cancelled')
  }

  return level as number
}

/**
 * Prompts for a division search term.
 * @param level - Selected administrative level
 * @param version - Release version used to resolve level names
 * @returns Search term entered by the user.
 */
export async function promptForAreaName(
  level: number,
  version: Version,
): Promise<string> {
  const adminLevels = getAdminLevels(version)
  const levelConfig = adminLevels[level as keyof typeof adminLevels]
  const isCountryLevel = level === 1
  const message =
    level === ANY_ADMIN_LEVEL
      ? 'Enter division name (or country code):'
      : isCountryLevel
        ? `Enter ${levelConfig.name.toLowerCase()} name (or country code):`
        : `Enter ${levelConfig.name.toLowerCase()} name:`

  const result = await text({
    message,
    placeholder: getAreaPlaceholder(level),
    validate: (value: string | undefined) => {
      if (!value || value.trim().length === 0) {
        return 'Please enter a name to search for'
      }
      return undefined
    },
  })

  if (typeof result === 'symbol' || !result) {
    successExit('Area name entry cancelled')
  }

  return result.trim()
}

/**
 * Prompts for an OSM relation id.
 * @returns Normalized user input.
 */
export async function promptForOsmRelationId(): Promise<string> {
  const result = await text({
    message: 'Enter OSM relation id:',
    placeholder: "e.g. '10268797' or 'r10268797'",
    validate: (value: string | undefined) => {
      if (!value || value.trim().length === 0) {
        return 'Please enter an OSM relation id'
      }
      return undefined
    },
  })

  if (typeof result === 'symbol' || !result) {
    successExit('OSM relation id entry cancelled')
  }

  return result.trim()
}

/**
 * Prompts for a division from a paginated search result set.
 * @param searchResults - Division search results and total count
 * @returns Selected division.
 */
export async function promptForDivisionSelection(searchResults: {
  results: Division[]
  totalCount: number
}): Promise<Division> {
  const { totalCount } = searchResults
  const results = sortDivisionResultsLargeToSmall(searchResults.results)

  if (totalCount === 0 || results.length === 0) {
    successExit('No divisions found. Please try a different search term.')
  }

  const pageSize = 15
  let currentPage = 0

  while (true) {
    const startIndex = currentPage * pageSize
    const endIndex = Math.min(startIndex + pageSize, totalCount)
    const currentPageResults = results.slice(startIndex, endIndex)
    const options: DivisionOption[] = currentPageResults.map(result =>
      buildDivisionSelectionOption(result, results),
    )

    if (endIndex < totalCount) {
      options.push({
        value: 'next_page',
        label: kleur.blue('→ Show more results'),
        hint: `Results ${endIndex + 1}-${Math.min(endIndex + pageSize, totalCount)} of ${totalCount}`,
      })
    }

    if (currentPage > 0) {
      options.unshift({
        value: 'prev_page',
        label: kleur.blue('← Previous page'),
        hint: `Results ${startIndex - pageSize + 1}-${startIndex} of ${totalCount}`,
      })
    }

    const message =
      totalCount > pageSize
        ? `Select the area you're looking for: (${kleur.cyan(`${startIndex + 1}-${endIndex} of ${totalCount} results`)})`
        : "Select the area you're looking for:"

    const selected = await select({
      message,
      options: options as Option<string | Division>[],
    })

    if (typeof selected === 'symbol') {
      successExit('Division selection cancelled')
    }

    if (selected === 'next_page') {
      currentPage++
      continue
    }

    if (selected === 'prev_page') {
      currentPage--
      continue
    }

    return selected as Division
  }
}

/**
 * Displays the selected division summary.
 * @param division - Selected division
 * @param locale - Preferred locale for localized names
 * @returns Nothing. Writes a note to stdout.
 */
export function displaySelectedDivision(division: Division, locale: string): void {
  const subtype = division.subtype || 'Unknown'
  const primaryName = division.names?.primary || '-'
  const localizedName = division.names?.common?.find(name => name.key === locale)?.value
  const hierarchy =
    division.hierarchies?.[0]
      ?.slice(0, -1)
      .reverse()
      .map(entry => entry.name)
      .join(' / ') || ''

  const noteLines = [`${kleur.bold('Name:')} ${kleur.cyan(primaryName)}`]

  if (localizedName && localizedName !== primaryName) {
    const localeLabel = locale.toUpperCase()
    noteLines.push(
      `${kleur.bold(`Name (${localeLabel}):`)} ${kleur.cyan(localizedName)}`,
    )
  }

  noteLines.push(`${kleur.bold('Level:')} ${kleur.magenta(subtype)}`)

  if (hierarchy) {
    noteLines.push(`${kleur.bold('Hierarchy:')} ${kleur.gray(hierarchy)}`)
  }

  noteLines.push(`${kleur.bold('ID:')} ${kleur.yellow(division.id)}`)
  note(noteLines.join('\n'), 'Selected Division')
}

/**
 * Displays persisted division metadata and output location.
 * @param ctx - Division info context
 * @param division - Persisted division payload
 * @returns Nothing. Writes formatted sections to stdout.
 */
export function displayDivisionInfo(
  ctx: Pick<
    ControlContext,
    'releaseVersion' | 'releaseContext' | 'divisionId' | 'division' | 'outputDir'
  >,
  division: Division & { releaseVersion?: string },
): void {
  const selectedDivision = ctx.division
  const hierarchy =
    selectedDivision?.hierarchies?.[0]?.map(entry => entry.name).join(' / ') || '-'
  const bbox = selectedDivision?.bbox
    ? formatSingleLineBbox(selectedDivision.bbox)
    : '-'

  const noteLines = [
    `${kleur.bold('Release:')} ${kleur.cyan(ctx.releaseVersion)}${ctx.releaseContext.isLatest ? ` ${kleur.gray('(latest)')}` : ''}`,
    `${kleur.bold('Name:')} ${kleur.cyan(selectedDivision?.names?.primary || selectedDivision?.id || '-')}`,
    `${kleur.bold('Subtype:')} ${kleur.magenta(selectedDivision?.subtype || '-')}`,
    `${kleur.bold('Country:')} ${kleur.green(selectedDivision?.country || '-')}`,
    `${kleur.bold('ID:')} ${kleur.yellow(ctx.divisionId || '-')}`,
    `${kleur.bold('Hierarchy:')} ${kleur.gray(hierarchy)}`,
    `${kleur.bold('BBox:')} ${kleur.cyan(bbox)}`,
    `${kleur.bold('Output:')} ${kleur.cyan(formatPath(path.join(ctx.outputDir, 'division.json')))}`,
  ]

  note(noteLines.join('\n'), 'Division Details')
  console.log(
    formatDivisionInfoSection('Common Names', formatCommonNameEntries(division)),
  )
  console.log(
    formatDivisionInfoSection(
      'Hierarchies',
      formatHierarchyEntries(division.hierarchies),
    ),
  )
}
