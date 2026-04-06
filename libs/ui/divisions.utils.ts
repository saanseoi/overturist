import kleur from 'kleur'
import type { BBox, Division, DivisionOption } from '../core/types'
import { ANY_ADMIN_LEVEL } from './shared'

/**
 * Returns placeholder text tuned to the chosen admin level.
 * @param level - Selected admin level
 * @returns Contextual placeholder text.
 */
export function getAreaPlaceholder(level: number): string {
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
export function buildDivisionSelectionOption(
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
export function getUniqueHierarchyPath(
  result: Division,
  allResults: Division[],
): string {
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
export function formatDivisionInfoSection(title: string, lines: string[]): string {
  return [kleur.bold(title), ...lines.map(line => `  ${line}`)].join('\n')
}

/**
 * Formats common-name entries with truncation.
 * @param division - Division payload being displayed
 * @returns Formatted common-name lines.
 */
export function formatCommonNameEntries(
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
export function formatHierarchyEntries(
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
 * Formats a bbox compactly for note output.
 * @param bbox - Bounding box coordinates
 * @returns Rounded bbox string.
 */
export function formatSingleLineBbox(bbox: BBox): string {
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
export function roundCoordinate(value: number, precision: number): string {
  return Number(value.toFixed(precision)).toString()
}

/**
 * Truncates formatted entries and appends a remainder indicator.
 * @param entries - Preformatted entries
 * @param limit - Maximum number of entries to keep
 * @returns Visible entries plus a remainder indicator when needed.
 */
export function formatTruncatedEntries(entries: string[], limit: number): string[] {
  const visibleEntries = entries.slice(0, limit).map(entry => `- ${entry}`)
  const remainder = entries.length - limit

  if (remainder > 0) {
    visibleEntries.push(kleur.gray(`...${remainder} more`))
  }

  return visibleEntries
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
