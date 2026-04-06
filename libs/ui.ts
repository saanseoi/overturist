import path from 'node:path'
import readline from 'node:readline'
import type { Option } from '@clack/prompts'
import { groupMultiselect, log, select, text } from '@clack/prompts'
import kleur from 'kleur'
import { getSearchHistory } from './cache'
import { DEFAULT_ON_FILE_EXISTS } from './constants'
import { buildBboxPath } from './fs'
import { note } from './note'
import { getCount, getLastReleaseCount } from './queries'
import { getAdminLevels } from './releases'
import { getS3Releases } from './s3'
import type {
  BBox,
  ControlContext,
  Division,
  InteractiveOptions,
  OnExistingFilesAction,
  ProgressState,
  ProgressUpdate,
  ReleaseData,
  SearchHistoryItem,
  ThemeDifferences,
  ThemeMapping,
  Version,
} from './types'
import { bail, getDiffCount, successExit } from './utils'

// Local type definition to avoid import issues
type DivisionOption = { value: Division | string; label: string; hint: string }

const ANY_ADMIN_LEVEL = 99
const SPINNER_FRAMES = ['◒', '◐', '◓', '◑']

type ProgressTableState = {
  isActive: boolean
  headerLines: string[]
  rowLines: string[]
  lineCount: number
  statusLine: string
  spinnerTimer: ReturnType<typeof setInterval> | null
}

const progressTableState: ProgressTableState = {
  isActive: false,
  headerLines: [],
  rowLines: [],
  lineCount: 0,
  statusLine: '',
  spinnerTimer: null,
}

/**
 * COMMON
 */

/**
 * Displays a colorful rainbow banner.
 */
export function displayBanner(showGutter: boolean = true) {
  const rainbowArt = [
    kleur.red('山 山 山 山 山 山 山 山  山 山 山 山 山 山 山 山 山'),
    kleur.magenta(' '),
    kleur.red('  ▗▄▖ ▗▖  ▗▖▗▄▄▄▖▗▄▄▖▗▄▄▄▖▗▖ ▗▖▗▄▄▖ ▗▄▄▄▖ ▗▄▄▖▗▄▄▄▖'),
    kleur.yellow(' ▐▌ ▐▌▐▌  ▐▌▐▌   ▐▌ ▐▌ █  ▐▌ ▐▌▐▌ ▐▌  █  ▐▌     █  '),
    kleur.green(' ▐▌ ▐▌▐▌  ▐▌▐▛▀▀▘▐▛▀▚▖ █  ▐▌ ▐▌▐▛▀▚▖  █   ▝▀▚▖  █  '),
    kleur.cyan(' ▝▚▄▞▘ ▝▚▞▘ ▐▙▄▄▖▐▌ ▐▌ █  ▝▚▄▞▘▐▌ ▐▌▗▄█▄▖▗▄▄▞▘  █  '),
    kleur.magenta(' '),
    kleur.blue('水 水 水 水 https://github.com/saanseoi 水 水 水 水'),
  ]

  if (showGutter) {
    log.message(rainbowArt.join('\n'))
  } else {
    console.log(rainbowArt.join('\n'))
  }
}

/**
 * MENU :: MAIN
 */

/**
 * Prompts user for the main action selection.
 * @returns Promise resolving to selected action
 */
export async function promptForMainAction(): Promise<string> {
  const options = [
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
      hint: 'Manage preferences and cache',
    },
    {
      value: 'exit',
      label: 'Exit',
      hint: 'Quit the application',
    },
  ]

  const selected = await select({
    message: 'What would you like to do?',
    options,
  })

  if (typeof selected === 'symbol') {
    throw new Error('Operation cancelled')
  }

  return selected
}

/**
 * Prompts user for the second-level download action selection.
 * @returns Promise resolving to selected download action
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

  if (typeof selected === 'symbol') {
    return 'back'
  }

  return selected
}

/**
 * Prompts user for the third-level area search action selection.
 * @returns Promise resolving to selected search action
 */
export async function promptForAreaSearchAction(
  message: string = 'Search for an area:',
): Promise<string> {
  const cacheModule = await import('./cache')
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

  if (typeof selected === 'symbol') {
    return 'back'
  }

  return selected
}

/**
 * MENU :: SEARCH HISTORY
 */

/**
 * Prompts user to select from search history.
 * @returns Promise resolving to search history entry or null if cancelled
 */
export async function promptForSearchHistory(): Promise<SearchHistoryItem | null> {
  const history = await getSearchHistory()

  if (history.length === 0) {
    log.warning('No search history found.')
    return null
  }

  // Build options for search history selection
  const options: Array<{
    value: SearchHistoryItem | string
    label: string
    hint: string
  }> = history.slice(0, 50).map(entry => {
    const createdDate = new Date(entry.createdAt)
    const date = createdDate.toISOString().split('T')[0] // YYYY-MM-DD format
    const time = createdDate.toTimeString().split(' ')[0].substring(0, 5) // HH:MM format
    const levelName = toSearchHistoryLevelLabel(
      entry.version,
      entry.adminLevel,
      entry.term,
    )

    return {
      value: entry,
      label: `${entry.term}`,
      hint: `${levelName} • ${date} ${time} • ${entry.totalCount} ${entry.totalCount > 1 ? 'results' : 'result'}`,
    }
  })

  // Add pagination options if there are more than 50 entries
  if (history.length > 50) {
    options.push({
      value: 'show_more',
      label: kleur.blue('Show older searches...'),
      hint: `Showing 50 of ${history.length} total searches`,
    })
  }

  const message = 'Which search would you like to repeat?'
  const selected = await select({
    message,
    options: options as Option<string | SearchHistoryItem>[], // Type assertion for clack compatibility
  })

  if (typeof selected === 'symbol' || selected === 'show_more') {
    return null
  }

  if (typeof selected === 'string') {
    return null
  }

  return selected
}

/**
 * Builds the human-readable search-history label for an administrative level.
 * @param version - Cached release version associated with the search
 * @param adminLevel - Cached administrative level used for the search
 * @param term - Original search term
 * @returns Human-readable label for the search-history hint
 */
function toSearchHistoryLevelLabel(
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
 * MENU :: SETTINGS
 */

/**
 * Prompts user for settings and cache management options.
 * @returns Promise resolving to selected action
 */
export async function promptForSettingsAction(): Promise<string> {
  const options = [
    {
      value: 'show_preferences',
      label: 'Show preferences',
      hint: 'Display current .env configuration',
    },
    {
      value: 'reset_preferences',
      label: 'Reset preferences',
      hint: 'Delete the .env file',
    },
    {
      value: 'show_cache_stats',
      label: 'Show cache stats',
      hint: 'Display cache directory sizes',
    },
    {
      value: 'purge_cache',
      label: 'Purge cache',
      hint: 'Delete entire .cache directory',
    },
    {
      value: 'back',
      label: 'Back to main menu',
      hint: 'Return to previous menu',
    },
  ]

  const selected = await select({
    message: 'Manage Settings and Cache:',
    options,
  })

  if (typeof selected === 'symbol') {
    return 'back'
  }

  return selected
}

/**
 * GET
 */

/**
 * Formats a BBox path string by making whole numbers bold and commas grey.
 * @param bboxPath - BBox path string in format "xmin,ymin,xmax,ymax"
 * @returns Formatted string with bold whole numbers and grey commas
 */
function formatBboxPath(bbox: BBox): string {
  // Split the coordinates by comma
  const bboxPath = buildBboxPath(bbox)
  const coords = bboxPath.split(',')

  // Format each coordinate: make whole numbers bold, keep decimals normal
  const formattedCoords = coords.map(coord => {
    const match = coord.match(/^(-?\d+)(\.\d+)?$/)
    if (match) {
      const wholeNumber = match[1]
      const decimal = match[2] || ''
      return kleur.bold(wholeNumber) + decimal
    }
    return coord // fallback if doesn't match expected format
  })

  // Join with grey commas
  return formattedCoords.join(`${kleur.gray(' , ')}`)
}

/**
 * Formats a path string by making forward slashes grey.
 * @param pathStr - Path string to format
 * @returns Formatted string with grey forward slashes
 */
function formatPath(pathStr: string): string {
  return pathStr.replace(/\//g, kleur.gray('/'))
}

/**
 * Displays the extraction plan summary as a note with key information.
 * Shows release version, schema, bounding box, and output directory in a formatted note.
 *
 * @param ctx - Context containing release context, output directory, and bounding box
 */
export function displayExtractionPlan(ctx: ControlContext) {
  const { releaseContext, outputDir, bbox } = ctx
  const { version, schema, isLatest, isNewSchema } = releaseContext
  const bboxText = bbox ? formatBboxPath(bbox) : 'No bounding box (full dataset)'
  const outputDirText = outputDir ? formatPath(outputDir) : 'No output directory'

  const planLines = [
    `${kleur.bold('Release')}      ${kleur.bold(kleur.cyan(version))}${isLatest ? ` ${kleur.red('(latest)')}` : ''}`,
    `${kleur.bold('Schema')}       ${kleur.bold(kleur.cyan(schema))}${isNewSchema ? ` ${kleur.red('(new)')}` : ''}`,
    `${kleur.bold('Target')}       ${kleur.bold(kleur.cyan(ctx.target))}${ctx.noClip ? ` ${kleur.red('(skipBoundaryFilter)')}` : ''}`,
    `${kleur.bold('BBox')}         ${kleur.cyan(bboxText)}`,
    `${kleur.bold('Output')}       ${kleur.cyan(outputDirText)}`,
  ]

  note(planLines.join('\n'), 'Extraction Plan')
}

/**
 * GET :: DOWNLOAD PROGRESS
 */

/**
 * Displays the table header for feature processing progress.
 * Creates a formatted header with column titles and separator line.
 *
 * @param ctx - Context containing featureNameWidth and indexWidth
 */
export function displayTableHeader(ctx: ControlContext) {
  const { featureNameWidth, indexWidth } = ctx

  const headerLine = `${kleur.white(''.padEnd(indexWidth + 1))} ${kleur.cyan('FEATURE'.padEnd(featureNameWidth + 1))} ${kleur.white('BBOX'.padEnd(6))} ${kleur.white('GEOM'.padEnd(6))} ${kleur.white('COUNT'.padEnd(9))} ${kleur.white('DIFF'.padEnd(8))}`
  const separatorLine = ` ${kleur.gray('─'.repeat(indexWidth + 2))}${kleur.gray('─'.repeat(featureNameWidth))} ${kleur.gray('─'.repeat(6))} ${kleur.gray('─'.repeat(6))} ${kleur.gray('─'.repeat(9))} ${kleur.gray('─'.repeat(9))}`
  progressTableState.isActive = true
  progressTableState.headerLines = [headerLine, separatorLine]
  progressTableState.rowLines = ctx.featureTypes.map((featureType, index) =>
    renderProgressRow(
      featureType,
      index,
      ctx.featureTypes.length,
      {
        bboxComplete: false,
        geomComplete: false,
        hasGeometryPass: ctx.target === 'division' && !ctx.noClip,
        isProcessing: false,
        activeStage: null,
        featureCount: 0,
        diffCount: null,
        currentMessage: null,
      },
      ctx.featureNameWidth,
      ctx.indexWidth,
    ),
  )
  progressTableState.statusLine = kleur.gray('Currently: waiting to start')
  if (!progressTableState.spinnerTimer && process.stdout.isTTY) {
    progressTableState.spinnerTimer = setInterval(() => {
      renderProgressTable()
    }, 120)
  }
  renderProgressTable()
}

/**
 * Updates the progress display for a specific feature being processed.
 * @param featureType - Name of the feature type being processed
 * @param index - Current index (0-based) in the processing queue
 * @param total - Total number of features to process
 * @param progress - Progress state object with completion flags and counts
 * @param featureNameWidth - Width for feature name column alignment
 * @param indexWidth - Width for index column alignment
 * @returns Nothing. Writes the current progress row to stdout.
 */
export function updateProgressDisplay(
  featureType: string,
  index: number,
  total: number,
  progress: ProgressState,
  featureNameWidth: number,
  indexWidth: number,
): void {
  const line = renderProgressRow(
    featureType,
    index,
    total,
    progress,
    featureNameWidth,
    indexWidth,
  )

  if (!progressTableState.isActive) {
    const headerLine = `${kleur.white(''.padEnd(indexWidth + 1))} ${kleur.cyan('FEATURE'.padEnd(featureNameWidth + 1))} ${kleur.white('BBOX'.padEnd(6))} ${kleur.white('GEOM'.padEnd(6))} ${kleur.white('COUNT'.padEnd(9))} ${kleur.white('DIFF'.padEnd(8))}`
    const separatorLine = ` ${kleur.gray('─'.repeat(indexWidth + 2))}${kleur.gray('─'.repeat(featureNameWidth))} ${kleur.gray('─'.repeat(6))} ${kleur.gray('─'.repeat(6))} ${kleur.gray('─'.repeat(9))} ${kleur.gray('─'.repeat(9))}`
    console.log(headerLine)
    console.log(separatorLine)
    console.log(line)
    return
  }

  progressTableState.rowLines[index] = line
  progressTableState.statusLine = formatStatusLine(progress)
  renderProgressTable()
}

/**
 * Updates the live status line beneath the progress table.
 * @param message - User-facing status message to render
 * @returns Nothing. Re-renders the active progress block when available.
 */
export function updateProgressStatus(message: string): void {
  if (!progressTableState.isActive) {
    return
  }

  progressTableState.statusLine = kleur.gray(`Currently: ${message}`)
  renderProgressTable()
}

/**
 * Stops the in-place progress table renderer and restores normal terminal output.
 * @returns Nothing. Leaves the cursor below the rendered table.
 */
export function finalizeProgressDisplay(): void {
  if (!progressTableState.isActive) {
    return
  }

  process.stdout.write('\n')
  if (progressTableState.spinnerTimer) {
    clearInterval(progressTableState.spinnerTimer)
  }
  progressTableState.isActive = false
  progressTableState.headerLines = []
  progressTableState.rowLines = []
  progressTableState.lineCount = 0
  progressTableState.statusLine = ''
  progressTableState.spinnerTimer = null
}

/**
 * Applies a progress update emitted from an extraction query.
 * @param progress - Mutable progress state for the active feature row
 * @param update - Incremental update from the extraction layer
 * @returns Nothing. Mutates the state in place.
 */
export function applyProgressUpdate(
  progress: ProgressState,
  update: ProgressUpdate,
): void {
  if (update.stage === 'bbox' || update.stage === 'geometry') {
    progress.isProcessing = true
    progress.activeStage = update.stage
  }

  if (typeof update.count === 'number') {
    progress.featureCount = update.count
  }

  if (update.message) {
    progress.currentMessage = update.message
  }
}

/**
 * Renders one feature row for the progress table.
 * @param featureType - Name of the feature type being processed
 * @param index - Current index (0-based) in the processing queue
 * @param total - Total number of features to process
 * @param progress - Progress state object with completion flags and counts
 * @param featureNameWidth - Width for feature name column alignment
 * @param indexWidth - Width for index column alignment
 * @returns Fully formatted row string
 */
function renderProgressRow(
  featureType: string,
  index: number,
  total: number,
  progress: ProgressState,
  featureNameWidth: number,
  indexWidth: number,
): string {
  const indexNum = index + 1
  let progressPrefix: string
  if (total > 9 && indexNum < 10) {
    progressPrefix = `[${indexNum}/${total}]`.padStart(indexWidth + 1)
  } else {
    progressPrefix = `[${indexNum}/${total}]`.padStart(indexWidth)
  }

  let bboxDisplay: string, geomDisplay: string

  if (progress.bboxComplete) {
    bboxDisplay = kleur.green('✅    ')
  } else if (progress.isProcessing && progress.activeStage === 'bbox') {
    const spinnerIndex = Math.floor(Date.now() / 100) % SPINNER_FRAMES.length
    bboxDisplay = kleur.yellow(`${SPINNER_FRAMES[spinnerIndex]}   `.padEnd(6))
  } else {
    bboxDisplay = kleur.white('⬜   ')
  }

  if (!progress.hasGeometryPass) {
    geomDisplay = kleur.gray('n/a'.padEnd(6))
  } else if (progress.geomComplete) {
    geomDisplay = kleur.green('✅    ')
  } else if (progress.isProcessing && progress.activeStage === 'bbox') {
    geomDisplay = kleur.cyan('🌀   '.padEnd(6))
  } else if (progress.isProcessing && progress.activeStage === 'geometry') {
    const spinnerIndex = Math.floor(Date.now() / 100) % SPINNER_FRAMES.length
    geomDisplay = kleur.yellow(`${SPINNER_FRAMES[spinnerIndex]}   `.padEnd(6))
  } else {
    geomDisplay = kleur.white('⬜    ')
  }

  const bboxCol = bboxDisplay.padEnd(6)
  const geomCol = geomDisplay.padEnd(6)

  const count = progress.featureCount || 0
  const countText = count.toString().padStart(7)

  let diffText: string
  if (progress.diffCount === null) {
    diffText = kleur.yellow('NEW'.padStart(9))
  } else if (progress.diffCount === 0) {
    diffText = kleur.white('-'.padStart(9))
  } else if (progress.diffCount > 0) {
    diffText = kleur.green(`+${progress.diffCount}`.padStart(9))
  } else {
    diffText = kleur.red(progress.diffCount.toString().padStart(9))
  }

  return (
    `${kleur.white(progressPrefix)} ${kleur.cyan(featureType.padEnd(featureNameWidth))} │ ` +
    `${bboxCol} ${geomCol} ${kleur.white(countText)} ${diffText}`
  )
}

/**
 * Handles the skipped feature logic when files already exist.
 * @param controlContext - Control context with feature metadata and display widths
 * @param featureType - Feature type being processed
 * @param index - Index of the feature type
 * @param outputPath - Path to the output file
 * @returns Promise that resolves after the skipped row is written
 */
export async function handleSkippedFeature(
  controlContext: ControlContext,
  featureType: string,
  index: number,
  outputPath: string,
): Promise<void> {
  let existingCount = 0
  try {
    existingCount = await getCount(outputPath)
  } catch (_error) {
    existingCount = 0
  }

  // Get previous count for diff display
  const lastReleaseCount = await getLastReleaseCount(controlContext, featureType)
  const diffCount = getDiffCount(existingCount, lastReleaseCount)
  const diffText = toDiffText(diffCount)

  const indexNum = index + 1

  const geomStatus =
    controlContext.target === 'division' && !controlContext.noClip
      ? kleur.yellow('⏭️'.padEnd(6))
      : kleur.gray('n/a'.padEnd(6))
  const skippedProgress = `${kleur.white(`[${indexNum}/${controlContext.featureTypes.length}]`.padStart(controlContext.indexWidth))} ${kleur.cyan(featureType.padEnd(controlContext.featureNameWidth))} │ ${kleur.yellow('⏭️'.padEnd(6))} ${geomStatus} ${kleur.white(existingCount.toString().padStart(7))} ${diffText}`

  if (progressTableState.isActive) {
    progressTableState.rowLines[index] = skippedProgress
    progressTableState.statusLine = kleur.gray(`Currently: skipping ${featureType}`)
    renderProgressTable()
    return
  }

  console.log(skippedProgress)
}

/**
 * Formats the footer status line shown beneath the progress table.
 * @param progress - Progress state for the currently active row
 * @returns Styled one-line status string
 */
function formatStatusLine(progress: ProgressState): string {
  if (!progress.currentMessage) {
    return kleur.gray('Currently: waiting for the next update')
  }

  return kleur.gray(`Currently: ${progress.currentMessage}`)
}

/**
 * Re-renders the active progress table in place.
 * @returns Nothing. Writes directly to stdout.
 */
function renderProgressTable(): void {
  if (!progressTableState.isActive) {
    return
  }

  const sections = [
    ...progressTableState.headerLines,
    ...progressTableState.rowLines,
    '',
    progressTableState.statusLine,
  ]

  if (process.stdout.isTTY && progressTableState.lineCount > 0) {
    readline.moveCursor(process.stdout, 0, -progressTableState.lineCount)
    readline.cursorTo(process.stdout, 0)
    readline.clearScreenDown(process.stdout)
  }

  process.stdout.write(`${sections.join('\n')}\n`)
  progressTableState.lineCount = sections.length
}

/**
 * Formats diff count with appropriate coloring.
 * @param diffCount - The difference count to format
 * @returns Formatted diff text with colors
 */
export function toDiffText(diffCount: number | null): string {
  if (diffCount === null) {
    return kleur.yellow('NEW'.padStart(9))
  } else if (diffCount === 0) {
    return kleur.white('-'.padStart(9))
  } else if (diffCount > 0) {
    return kleur.green(`+${diffCount}`.padStart(9))
  } else {
    return kleur.red(diffCount.toString().padStart(9))
  }
}

/**
 * Calculates optimal column widths for displaying feature progress table.
 * Ensures proper alignment based on the longest feature name and total count.
 *
 * @param featureTypes - Array of feature type strings to calculate widths for
 * @returns Object containing calculated widths for feature name and index columns
 */
export function calculateColumnWidths(featureTypes: string[]): {
  featureNameWidth: number
  indexWidth: number
} {
  const maxFeatureLength = Math.max(...featureTypes.map(f => f.length))
  const featureNameWidth = Math.max(maxFeatureLength, 15) + 1
  const indexWidth = featureTypes.length >= 10 ? 6 : 5
  return { featureNameWidth, indexWidth }
}

/**
 * GET :: ON EXISTING FILES
 */

/**
 * Determines how to handle existing files when extracting data.
 * Either prompts the user interactively or uses the provided mode.
 *
 * @param existingFiles - Array of existing file paths found
 * @param existingFilesActionFromArgs - Pre-determined mode or undefined for interactive prompt
 * @returns Promise resolving to the selected onExistingFilesAction mode
 */
export async function determineActionOnExistingFiles(
  existingFiles: string[],
  onFileExists: OnExistingFilesAction | symbol | undefined | null,
  interactiveOpts: InteractiveOptions | false | undefined,
): Promise<OnExistingFilesAction | null | symbol> {
  const isActionUserDefined = onFileExists !== undefined
  const isNonInteractive = interactiveOpts === false
  const hasExistingFiles = existingFiles.length > 0

  if (!isNonInteractive && !isActionUserDefined && hasExistingFiles) {
    return await select({
      message: `Found ${kleur.red(existingFiles.length)} existing files for this release. What would you like to do?`,
      options: [
        {
          value: 'skip',
          label: 'Skip',
          hint: 'Keep existing files and download missing ones',
        },
        {
          value: 'replace',
          label: 'Replace',
          hint: 'Replace existing files with fresh downloads',
        },
        { value: 'abort', label: 'Abort', hint: 'Exit the script' },
      ],
    })
  } else if (onFileExists !== undefined && hasExistingFiles) {
    const modeText =
      onFileExists === 'skip'
        ? kleur.green('Skipping existing files')
        : onFileExists === 'replace'
          ? kleur.yellow('Overriding existing files')
          : onFileExists === 'abort'
            ? kleur.red('Aborting due to existing files')
            : ''
    log.message(
      `📁 Found ${kleur.green(existingFiles.length)} existing files - ${modeText}`,
    )
    return onFileExists
  } else if (hasExistingFiles) {
    log.warn(
      `📁 Found ${kleur.red(existingFiles.length)} existing files - skipping by default`,
    )
    return DEFAULT_ON_FILE_EXISTS
  } else {
    return null
  }
}

/**
 * GET :: VERSION
 */

/**
 * Allows user to select a specific version from available releases.
 * Displays an interactive selection menu with S3-available versions.
 *
 * @param releaseData - Optional release data to use. If not provided, will fetch fresh data from S3.
 * @returns Promise resolving to selected version string or null if cancelled
 */
export async function selectReleaseVersion(releaseData?: ReleaseData): Promise<string> {
  // Use provided release data or fetch fresh data if not available
  let availableReleases: string[]

  if (releaseData) {
    // Filter to only S3-available releases from the provided data
    availableReleases = releaseData.releases
      .filter(release => release.isAvailableOnS3)
      .map(release => release.version)
      .sort()
      .reverse() // Show newest first
  } else {
    // Fallback to fetching fresh data from S3
    const { s3Releases } = await getS3Releases()
    availableReleases = s3Releases
  }

  const latest = availableReleases[0]

  // Create options for the select prompt
  const versionOptions = availableReleases.map(version => {
    const isLatest = version === latest
    const label = isLatest ? `${version} (latest)` : version
    return {
      value: version,
      label: kleur.cyan(label),
    }
  })

  const selectedVersion = (await select({
    message: 'Choose a release version:',
    options: versionOptions,
  })) as string

  // Check if selection was cancelled (result is undefined or a symbol)
  if (!selectedVersion || typeof selectedVersion === 'symbol') {
    successExit('Version selection cancelled')
  }

  return selectedVersion
}

/**
 * GET :: THEMES
 */

/**
 * Builds a formatted message showing theme differences.
 * @param differences - Theme differences to display
 * @returns Formatted message string
 */
export function buildThemeDifferenceMessage(differences: ThemeDifferences): string {
  const sections: string[] = []
  if (differences.missingFromCurrent.length > 0) {
    sections.push(
      `⚠️ Missing on S3 (${kleur.red(differences.missingFromCurrent.length)} types):\n`,
      differences.missingFromCurrent.map(type => `   • ${kleur.red(type)}`).join('\n'),
      '\n\n',
    )
  }

  if (differences.missingFromPreceding.length > 0) {
    sections.push(
      `⚠️ New on S3 (${kleur.red(differences.missingFromPreceding.length)} types):\n`,
      differences.missingFromPreceding
        .map(type => `   • ${kleur.red(type)}`)
        .join('\n'),
      '\n\n',
    )
  }

  if (differences.changedThemes.length > 0) {
    sections.push(
      `⚠️ Reassigned themes (${kleur.red(differences.changedThemes.length)} types):\n`,
      differences.changedThemes
        .map(
          difference =>
            `   • ${kleur.red(difference.type)}: ${kleur.yellow(difference.precedingTheme)} -> ${kleur.green(difference.currentTheme)}`,
        )
        .join('\n'),
      '\n\n',
    )
  }

  sections.push('💡 Overture changed their schema, or their S3 upload is in progress.')

  return sections.join('')
}

/**
 * Displays the UI for theme differences and prompts user for action.
 * @param differences - Theme differences to display
 * @returns Promise resolving to user's chosen action ('update', 'ignore', or 'cancel')
 */
export async function promptUserForThemeAction(
  differences: ThemeDifferences,
): Promise<'update' | 'cancel'> {
  // Build and display the difference message
  const noteMessage = buildThemeDifferenceMessage(differences)
  note(noteMessage, 'Overture Maps schema drift')

  // Ask user what to do with three clear options
  const action = await select({
    message: 'Update your theme schema to match S3?',
    options: [
      {
        value: 'update',
        label: 'Accept',
        hint: 'S3 schema as the latest theme mapping',
      },
      {
        value: 'cancel',
        label: 'Reject',
        hint: 'to manually confirm the schema changes',
      },
    ],
    initialValue: 'update',
  })

  if (typeof action === 'symbol') {
    return 'cancel'
  }

  return action as 'update' | 'cancel'
}

/**
 * GET :: FEATURE TYPES
 */

/**
 * Interactive feature type selection using groupMultiselect.
 */
export async function selectFeatureTypesInteractively(
  themeMapping: ThemeMapping,
  initialValues: string[] = [],
): Promise<string[]> {
  // Group feature types by theme
  const themesToFeatureTypes: { [theme: string]: string[] } = {}

  for (const [featureType, theme] of Object.entries(themeMapping)) {
    if (!themesToFeatureTypes[theme]) {
      themesToFeatureTypes[theme] = []
    }
    themesToFeatureTypes[theme].push(featureType)
  }

  // Convert to groupMultiselect format
  const options: { [theme: string]: Array<{ value: string; label: string }> } = {}

  for (const [theme, featureTypes] of Object.entries(themesToFeatureTypes)) {
    options[theme] = featureTypes.map(featureType => ({
      value: featureType,
      label: featureType,
    }))
  }

  // If no initialValues provided, select all by default
  const selectedValues =
    initialValues.length > 0 ? initialValues : Object.keys(themeMapping)

  const selectedOptions = await groupMultiselect({
    message: `Confirm which feature types to download:`,
    options,
    selectableGroups: true,
    initialValues: selectedValues,
    // @ts-expect-error: Forward compatiable -- remove in @clack/prompts v1.0.0
    groupSpacing: 1,
  })

  if (typeof selectedOptions === 'symbol') {
    bail('Feature selection cancelled')
  }

  return selectedOptions as string[]
}

/**
 * GET :: DIVISIONS
 */

/**
 * Prompts user to select an administrative level.
 * @param config - Config with releaseVersion to use for admin level mapping.
 * @returns Promise resolving to selected administrative level (1-4)
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
        hint: 'Search across all division subtypes',
      },
      ...Object.entries(adminLevels).map(([num, config]) => ({
        value: parseInt(num, 10),
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
 * Prompts user to enter area name or country code for search.
 * @param level - Selected administrative level
 * @param config - Config with releaseVersion to use for admin level mapping.
 * @returns Promise resolving to search query string
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

  // Contextual placeholders based on administrative level
  const getPlaceholder = (level: number): string => {
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
        return 'e.g., Hong Kong'
    }
  }

  const result = await text({
    message,
    placeholder: getPlaceholder(level),
    validate: (value: string) => {
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
 * Prompts user to enter an OSM relation id for division lookup.
 * @returns Promise resolving to the normalized user input
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
 * Displays division search results and prompts user to select one.
 * @param results - Array of division search results
 * @returns Promise resolving to selected division object
 */
export async function promptForDivisionSelection(searchResults: {
  results: Division[]
  totalCount: number
}): Promise<Division> {
  const { results, totalCount } = searchResults

  // Handle case with no results
  if (totalCount === 0 || results.length === 0) {
    successExit(`No divisions found. Please try a different search term.`)
  }

  const PAGE_SIZE = 15
  let currentPage = 0
  // Pagination loop
  while (true) {
    const startIndex = currentPage * PAGE_SIZE
    const endIndex = Math.min(startIndex + PAGE_SIZE, totalCount)
    const currentPageResults = results.slice(startIndex, endIndex)

    // Build options for current page
    const options: DivisionOption[] = currentPageResults.map(result => {
      const hierarchy = result.hierarchies?.[0]

      // Get unique hierarchy path and find the most specific entry
      const uniquePath = getUniqueHierarchyPath(result, results)
      const mostSpecificEntry = hierarchy?.[hierarchy.length - 1]

      // Build label: subtype first, then unique hierarchy path
      let label = ''
      if (mostSpecificEntry) {
        // Show subtype first in magenta
        label = kleur.magenta(mostSpecificEntry.subtype)

        // Add separator and then the unique hierarchy path
        if (uniquePath) {
          label += `: ${uniquePath}`
        }
      } else {
        // Fallback to just the unique path if no most specific entry
        label = uniquePath
      }

      // Build hint: remaining hierarchy that wasn't used in the unique path
      // We need to find which hierarchy entries were used in the unique path
      let remainingHierarchy = ''
      if (hierarchy && uniquePath) {
        // Split the unique path into individual names
        const usedNames = uniquePath.split(' / ').map(name => name.trim())

        // Find hierarchy entries that were NOT used in the unique path
        const unusedEntries = hierarchy.filter(
          hierarchyEntry =>
            !usedNames.some(
              usedName => hierarchyEntry.name.toLowerCase() === usedName.toLowerCase(),
            ),
        )

        // Build hint from unused entries (reverse order)
        remainingHierarchy = unusedEntries
          .reverse()
          .map(h => h.name)
          .join(' / ')
      }
      const hint = remainingHierarchy || ''

      return {
        value: result,
        label,
        hint: hint || '',
      }
    })

    // Add pagination option if there are more results
    if (endIndex < totalCount) {
      options.push({
        value: 'next_page',
        label: kleur.blue('→ Show more results'),
        hint: `Results ${endIndex + 1}-${Math.min(endIndex + PAGE_SIZE, totalCount)} of ${totalCount}`,
      })
    }

    // Add previous page option if not on first page
    if (currentPage > 0) {
      options.unshift({
        value: 'prev_page',
        label: kleur.blue('← Previous page'),
        hint: `Results ${startIndex - PAGE_SIZE + 1}-${startIndex} of ${totalCount}`,
      })
    }

    const message =
      totalCount > PAGE_SIZE
        ? `Select the area you're looking for: (${kleur.cyan(`${startIndex + 1}-${endIndex} of ${totalCount} results`)})`
        : "Select the area you're looking for:"

    const selected = await select({
      message,
      options: options as Option<string | Division>[], // Type assertion for clack compatibility
    })

    if (typeof selected === 'symbol') {
      successExit('Division selection cancelled')
    }

    // Handle pagination navigation
    if (selected === 'next_page') {
      currentPage++
      continue
    } else if (selected === 'prev_page') {
      currentPage--
      continue
    }

    // User selected a division
    return selected as Division
  }
}

/**
 * Finds the shortest unique hierarchy path for a result by comparing with other results
 */
function getUniqueHierarchyPath(result: Division, allResults: Division[]): string {
  if (!result.hierarchies?.[0]) return result.id

  const hierarchy = result.hierarchies[0]

  // Start with the most specific (last) entry and add parents until unique
  // Build path in REVERSE order (most specific first)
  for (let i = hierarchy.length - 1; i >= 0; i--) {
    const candidatePath = hierarchy
      .slice(i)
      .reverse()
      .map(h => h.name)
      .join(' / ')

    // Check if this path is unique among all results
    const isUnique =
      allResults.filter(other => {
        if (other.id === result.id) return true // always match self
        if (!other.hierarchies?.[0]) return false

        const otherHierarchy = other.hierarchies[0]
        const otherPath = otherHierarchy
          .slice(i)
          .reverse()
          .map(h => h.name)
          .join(' / ')

        return otherPath === candidatePath
      }).length === 1

    if (isUnique) {
      return candidatePath
    }
  }

  // Fallback to full hierarchy in REVERSE order (most specific first)
  return hierarchy
    .slice()
    .reverse()
    .map(h => h.name)
    .join(' / ')
}

/**
 * Displays selected division information to the user.
 * @param division - Selected division object
 * @param config - Config object containing locale preference
 */
export function displaySelectedDivision(division: Division, locale: string): void {
  const subtype = division.subtype || 'Unknown'

  // Helper function to get name by locale with fallbacks
  const getNameByLocale = (targetLocale: string): string | undefined => {
    return division.names?.common?.find(
      (name: { key: string; value: string }) => name.key === targetLocale,
    )?.value
  }

  // Get primary name (local language) - fallback to first common name if primary doesn't exist
  const primaryName = division.names?.primary || '-'

  // Get localized name based on config.locale
  const localizedName = getNameByLocale(locale)

  // Build reverse hierarchy, skipping the last entry
  const hierarchy =
    division.hierarchies?.[0]
      ?.slice(0, -1) // Skip the last entry
      .reverse()
      .map((h: { division_id: string; subtype: string; name: string }) => h.name)
      .join(' / ') || ''

  // Build note content
  const noteLines = []

  // Primary Name (local language)
  noteLines.push(`${kleur.bold('Name:')} ${kleur.cyan(primaryName)}`)

  // Localized name (if different from primary)
  if (localizedName && localizedName !== primaryName) {
    const localeLabel = locale.toUpperCase()
    noteLines.push(
      `${kleur.bold(`Name (${localeLabel}):`)} ${kleur.cyan(localizedName)}`,
    )
  }

  // Level : subtype (in magenta)
  noteLines.push(`${kleur.bold('Level:')} ${kleur.magenta(subtype)}`)

  // Hierarchy : Reverse hierarchy (skip the last entry)
  if (hierarchy) {
    noteLines.push(`${kleur.bold('Hierarchy:')} ${kleur.gray(hierarchy)}`)
  }

  // Id : division id
  noteLines.push(`${kleur.bold('ID:')} ${kleur.yellow(division.id)}`)

  note(noteLines.join('\n'), 'Selected Division')
}

/**
 * Displays formatted division metadata and the persisted output location.
 * @param ctx - Division info context used to save the division
 * @param division - Division payload that was written to disk
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
    selectedDivision?.hierarchies?.[0]
      ?.map((entry: { name: string }) => entry.name)
      .join(' / ') || '-'
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
 * Formats a titled inspector section.
 * @param title - Section heading
 * @param lines - Already formatted content lines
 * @returns Joined section string
 */
function formatDivisionInfoSection(title: string, lines: string[]): string {
  return [kleur.bold(title), ...lines.map(line => `  ${line}`)].join('\n')
}

/**
 * Formats common-name entries as truncated key-value rows.
 * @param division - Division payload being inspected
 * @returns Formatted lines for the common names section
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
 * Formats hierarchy paths as truncated list rows.
 * @param hierarchies - Hierarchy arrays from the division payload
 * @returns Formatted lines for the hierarchies section
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
 * Formats a single hierarchy entry as a labeled line.
 * @param entry - Hierarchy entry to format
 * @returns Formatted hierarchy line
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
 * Formats bbox coordinates compactly enough to stay on a single line in the note output.
 * @param bbox - Bounding box coordinates
 * @returns Rounded bbox string
 */
function formatSingleLineBbox(bbox: BBox): string {
  const precision = 5
  return [bbox.xmin, bbox.ymin, bbox.xmax, bbox.ymax]
    .map(value => roundCoordinate(value, precision))
    .join(', ')
}

/**
 * Rounds a coordinate while trimming trailing zeroes.
 * @param value - Coordinate value
 * @param precision - Maximum decimal precision to keep
 * @returns Compact coordinate string
 */
function roundCoordinate(value: number, precision: number): string {
  return Number(value.toFixed(precision)).toString()
}

/**
 * Truncates a list of formatted strings and appends a remainder indicator.
 * @param entries - Preformatted entries
 * @param limit - Maximum number of entries to display before truncating
 * @returns Truncated list with a remainder indicator when needed
 */
function formatTruncatedEntries(entries: string[], limit: number): string[] {
  const visibleEntries = entries.slice(0, limit).map(entry => `- ${entry}`)
  const remainder = entries.length - limit

  if (remainder > 0) {
    visibleEntries.push(kleur.gray(`...${remainder} more`))
  }

  return visibleEntries
}
