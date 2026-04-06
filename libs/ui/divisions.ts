import path from 'node:path'
import type { Option } from '@clack/prompts'
import { select, text } from '@clack/prompts'
import kleur from 'kleur'
import { note } from '../note'
import { getAdminLevels } from '../releases'
import type { BBox, ControlContext, Division, DivisionOption, Version } from '../types'
import { successExit } from '../utils'
import { formatPath } from './format'
import { ANY_ADMIN_LEVEL } from './shared'

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
  const { results, totalCount } = searchResults

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

/**
 * Returns placeholder text tuned to the chosen admin level.
 * @param level - Selected admin level
 * @returns Contextual placeholder text.
 */
function getAreaPlaceholder(level: number): string {
  switch (level) {
    case ANY_ADMIN_LEVEL:
      return "e.g. 'Kowloon', '10268797', or 'Central, Hong Kong'"
    case 1:
      return "e.g. 'Hong Kong' or 'HK'"
    case 2:
      return "e.g. 'California', 'Kowloon', or '10268797'"
    case 3:
      return "e.g. 'Aberdeen'"
    case 4:
      return "e.g. 'Manhattan', '10268797', or 'Central, Hong Kong'"
    default:
      return 'e.g. Hong Kong'
  }
}

/**
 * Builds a selection option that uses the shortest unique hierarchy path.
 * @param result - Division represented by the option
 * @param allResults - Full result set used for disambiguation
 * @returns Select option for the current division.
 */
function buildDivisionSelectionOption(
  result: Division,
  allResults: Division[],
): DivisionOption {
  const hierarchy = result.hierarchies?.[0]
  const uniquePath = getUniqueHierarchyPath(result, allResults)
  const mostSpecificEntry = hierarchy?.[hierarchy.length - 1]

  let label = uniquePath
  if (mostSpecificEntry) {
    label = `${kleur.magenta(mostSpecificEntry.subtype)}: ${uniquePath}`
  }

  let remainingHierarchy = ''
  if (hierarchy && uniquePath) {
    const usedNames = uniquePath.split(' / ').map(name => name.trim())
    const unusedEntries = hierarchy.filter(
      hierarchyEntry =>
        !usedNames.some(
          usedName => hierarchyEntry.name.toLowerCase() === usedName.toLowerCase(),
        ),
    )

    remainingHierarchy = unusedEntries
      .reverse()
      .map(entry => entry.name)
      .join(' / ')
  }

  return {
    value: result,
    label,
    hint: remainingHierarchy || '',
  }
}

/**
 * Finds the shortest unique hierarchy path for a division result.
 * @param result - Division to disambiguate
 * @param allResults - Peer results from the same search
 * @returns Shortest unique path, or a full reverse hierarchy fallback.
 */
function getUniqueHierarchyPath(result: Division, allResults: Division[]): string {
  if (!result.hierarchies?.[0]) {
    return result.id
  }

  const hierarchy = result.hierarchies[0]

  // Grow a reverse hierarchy path until it uniquely identifies this result.
  for (let i = hierarchy.length - 1; i >= 0; i--) {
    const candidatePath = hierarchy
      .slice(i)
      .reverse()
      .map(entry => entry.name)
      .join(' / ')

    const isUnique =
      allResults.filter(other => {
        if (other.id === result.id) {
          return true
        }

        if (!other.hierarchies?.[0]) {
          return false
        }

        const otherPath = other.hierarchies[0]
          .slice(i)
          .reverse()
          .map(entry => entry.name)
          .join(' / ')

        return otherPath === candidatePath
      }).length === 1

    if (isUnique) {
      return candidatePath
    }
  }

  return hierarchy
    .slice()
    .reverse()
    .map(entry => entry.name)
    .join(' / ')
}

/**
 * Formats a titled division-info section.
 * @param title - Section heading
 * @param lines - Section content lines
 * @returns Joined section string.
 */
function formatDivisionInfoSection(title: string, lines: string[]): string {
  return [kleur.bold(title), ...lines.map(line => `  ${line}`)].join('\n')
}

/**
 * Formats common-name entries with truncation.
 * @param division - Division payload being displayed
 * @returns Formatted common-name lines.
 */
function formatCommonNameEntries(
  division: Division & { releaseVersion?: string },
): string[] {
  const names = division.names?.common || []
  if (names.length === 0) {
    return [kleur.gray('-')]
  }

  return formatTruncatedEntries(
    names.map(name => `${kleur.cyan(name.key)}: ${kleur.green(name.value)}`),
    5,
  )
}

/**
 * Formats hierarchy entries with truncation.
 * @param hierarchies - Hierarchy arrays from the division payload
 * @returns Formatted hierarchy lines.
 */
function formatHierarchyEntries(
  hierarchies?: Array<Array<{ division_id: string; subtype: string; name: string }>>,
): string[] {
  if (!hierarchies || hierarchies.length === 0) {
    return [kleur.gray('-')]
  }

  return formatTruncatedEntries(
    hierarchies.map(hierarchy =>
      hierarchy
        .map((entry, index) => {
          const prefix = index === 0 ? '' : ' '.repeat(index * 2 + 4)
          return `${prefix}${formatHierarchyEntryLine(entry)}`
        })
        .join('\n'),
    ),
    5,
  )
}

/**
 * Formats a single hierarchy entry.
 * @param entry - Hierarchy entry to format
 * @returns Styled hierarchy line.
 */
function formatHierarchyEntryLine(entry?: {
  division_id: string
  subtype: string
  name: string
}): string {
  if (!entry) {
    return kleur.gray('-')
  }

  return `${kleur.cyan(entry.name)} ${kleur.gray(`(${entry.subtype}, ${entry.division_id})`)}`
}

/**
 * Formats a bbox compactly for note output.
 * @param bbox - Bounding box coordinates
 * @returns Rounded bbox string.
 */
function formatSingleLineBbox(bbox: BBox): string {
  const precision = 5
  return [bbox.xmin, bbox.ymin, bbox.xmax, bbox.ymax]
    .map(value => roundCoordinate(value, precision))
    .join(', ')
}

/**
 * Rounds a coordinate and trims trailing zeroes.
 * @param value - Coordinate value
 * @param precision - Decimal precision to preserve
 * @returns Compact coordinate string.
 */
function roundCoordinate(value: number, precision: number): string {
  return Number(value.toFixed(precision)).toString()
}

/**
 * Truncates formatted entries and appends a remainder indicator.
 * @param entries - Preformatted entries
 * @param limit - Maximum number of entries to keep
 * @returns Visible entries plus a remainder indicator when needed.
 */
function formatTruncatedEntries(entries: string[], limit: number): string[] {
  const visibleEntries = entries.slice(0, limit).map(entry => `- ${entry}`)
  const remainder = entries.length - limit

  if (remainder > 0) {
    visibleEntries.push(kleur.gray(`...${remainder} more`))
  }

  return visibleEntries
}
