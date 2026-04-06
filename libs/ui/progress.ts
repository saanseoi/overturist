import readline from 'node:readline'
import kleur from 'kleur'
import stringWidth from 'string-width'
import { note } from '../core/note'
import { getCount, getLastReleaseCount } from '../data/queries'
import type { ControlContext, ProgressState, ProgressUpdate } from '../core/types'
import { getDiffCount } from '../core/utils'
import { formatBboxPath, formatPath } from './format'

const ACTIVE_CELL_FRAMES = ['🟨', '🟩', '🟦', '🟪']
const STATUS_SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧']
const PLANNED_CELL = '⬜'
const COMPLETE_CELL = '☑️'
const NOT_APPLICABLE_CELL = '⬚'
const SKIPPED_CELL = '⏭️'
const CELL_COLUMN_WIDTH = 6
const DIFF_COLUMN_WIDTH = 9

type ProgressTableState = {
  isActive: boolean
  headerLines: string[]
  rowLines: string[]
  rowStates: Array<{
    featureType: string
    index: number
    total: number
    progress: ProgressState
    featureNameWidth: number
    indexWidth: number
    countWidth: number
  } | null>
  lineCount: number
  statusMessage: string
  spinnerTimer: ReturnType<typeof setInterval> | null
}

const progressTableState: ProgressTableState = {
  isActive: false,
  headerLines: [],
  rowLines: [],
  rowStates: [],
  lineCount: 0,
  statusMessage: 'Waiting to start',
  spinnerTimer: null,
}

/**
 * Displays the extraction plan note for the current run.
 * @param ctx - Resolved control context
 * @returns Nothing. Writes a note to stdout.
 */
export function displayExtractionPlan(ctx: ControlContext): void {
  const { releaseContext, outputDir, bbox } = ctx
  const { version, schema, isLatest, isNewSchema } = releaseContext
  const bboxText = bbox ? formatBboxPath(bbox) : 'No bounding box (full dataset)'
  const outputDirText = outputDir ? formatPath(outputDir) : 'No output directory'

  note(
    [
      `${kleur.bold('Release')}      ${kleur.bold(kleur.cyan(version))}${isLatest ? ` ${kleur.red('(latest)')}` : ''}`,
      `${kleur.bold('Schema')}       ${kleur.bold(kleur.cyan(schema))}${isNewSchema ? ` ${kleur.red('(new)')}` : ''}`,
      `${kleur.bold('Target')}       ${kleur.bold(kleur.cyan(ctx.target))}${ctx.skipBoundaryClip ? ` ${kleur.red('(skipBoundaryClip)')}` : ''}`,
      `${kleur.bold('Clip Mode')}    ${kleur.cyan(ctx.clipMode)}`,
      `${kleur.bold('BBox')}         ${kleur.cyan(bboxText)}`,
      `${kleur.bold('Output')}       ${kleur.cyan(outputDirText)}`,
    ].join('\n'),
    'Extraction Plan',
  )
}

/**
 * Initializes the live progress table.
 * @param ctx - Control context containing column widths and feature list
 * @returns Nothing. Starts the in-place renderer.
 */
export function displayTableHeader(ctx: ControlContext): void {
  const countWidth = getCountColumnWidth(ctx.target)

  progressTableState.isActive = true
  progressTableState.headerLines = buildProgressHeader(
    ctx.featureNameWidth,
    ctx.indexWidth,
    countWidth,
  )
  progressTableState.rowStates = ctx.featureTypes.map((featureType, index) => {
    const progress: ProgressState = {
      bboxComplete: false,
      geomComplete: false,
      hasGeometryPass: ctx.target === 'division' && !ctx.skipBoundaryClip,
      isProcessing: false,
      activeStage: null,
      featureCount: 0,
      diffCount: null,
      currentMessage: null,
    }

    return {
      featureType,
      index,
      total: ctx.featureTypes.length,
      progress,
      featureNameWidth: ctx.featureNameWidth,
      indexWidth: ctx.indexWidth,
      countWidth,
    }
  })
  progressTableState.rowLines = progressTableState.rowStates.map(rowState =>
    rowState
      ? renderProgressRow(
          rowState.featureType,
          rowState.index,
          rowState.total,
          rowState.progress,
          rowState.featureNameWidth,
          rowState.indexWidth,
          rowState.countWidth,
        )
      : '',
  )
  progressTableState.statusMessage = 'Waiting to start'

  if (!progressTableState.spinnerTimer && process.stdout.isTTY) {
    progressTableState.spinnerTimer = setInterval(() => {
      renderProgressTable()
    }, 250)
  }

  renderProgressTable()
}

/**
 * Updates a single feature row in the live progress table.
 * @param featureType - Feature type being processed
 * @param index - Zero-based index in the queue
 * @param total - Total feature count in the queue
 * @param progress - Current progress state for the feature
 * @param featureNameWidth - Width of the feature name column
 * @param indexWidth - Width of the index column
 * @returns Nothing. Re-renders the progress block.
 */
export function updateProgressDisplay(
  featureType: string,
  index: number,
  total: number,
  progress: ProgressState,
  featureNameWidth: number,
  indexWidth: number,
  countWidth = 7,
): void {
  const line = renderProgressRow(
    featureType,
    index,
    total,
    progress,
    featureNameWidth,
    indexWidth,
    countWidth,
  )

  if (!progressTableState.isActive) {
    const [headerLine, separatorLine] = buildProgressHeader(
      featureNameWidth,
      indexWidth,
      countWidth,
    )
    console.log(headerLine)
    console.log(separatorLine)
    console.log(line)
    return
  }

  progressTableState.rowStates[index] = {
    featureType,
    index,
    total,
    progress,
    featureNameWidth,
    indexWidth,
    countWidth,
  }
  progressTableState.rowLines[index] = line
  progressTableState.statusMessage = formatStatusLine(progress)
  renderProgressTable()
}

/**
 * Updates the footer status line below the table.
 * @param message - User-facing status message
 * @returns Nothing. Re-renders the progress block.
 */
export function updateProgressStatus(message: string): void {
  if (!progressTableState.isActive) {
    return
  }

  progressTableState.statusMessage = message
  renderProgressTable()
}

/**
 * Stops the live progress renderer.
 * @returns Nothing. Restores normal terminal output.
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
  progressTableState.rowStates = []
  progressTableState.lineCount = 0
  progressTableState.statusMessage = 'Waiting to start'
  progressTableState.spinnerTimer = null
}

/**
 * Applies an incremental progress update to a mutable progress state.
 * @param progress - Active progress state object
 * @param update - Update emitted by the extraction workflow
 * @returns Nothing. Mutates the supplied state in place.
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
 * Writes a skipped row using the same table layout as active rows.
 * @param controlContext - Control context with display widths
 * @param featureType - Feature type being skipped
 * @param index - Zero-based feature index
 * @param outputPath - Existing output path
 * @returns Promise resolving when the row has been updated.
 */
export async function handleSkippedFeature(
  controlContext: ControlContext,
  featureType: string,
  index: number,
  outputPath: string,
): Promise<void> {
  const countWidth = getCountColumnWidth(controlContext.target)
  let existingCount = 0
  try {
    existingCount = await getCount(outputPath)
  } catch (_error) {
    existingCount = 0
  }

  const lastReleaseCount = await getLastReleaseCount(controlContext, featureType)
  const diffText = toDiffText(getDiffCount(existingCount, lastReleaseCount))
  const geomState =
    controlContext.target === 'division' && !controlContext.skipBoundaryClip
      ? 'skipped'
      : 'na'

  const skippedProgress = buildProgressLine({
    featureType,
    index,
    total: controlContext.featureTypes.length,
    featureNameWidth: controlContext.featureNameWidth,
    indexWidth: controlContext.indexWidth,
    countWidth,
    bboxCell: renderCell('skipped'),
    geomCell: renderCell(geomState),
    countText: existingCount.toString(),
    diffText,
  })

  if (progressTableState.isActive) {
    progressTableState.rowStates[index] = null
    progressTableState.rowLines[index] = skippedProgress
    progressTableState.statusMessage = `Skipping ${kleur.cyan(`${controlContext.themeMapping[featureType]}/${featureType}`)}`
    renderProgressTable()
    return
  }

  console.log(skippedProgress)
}

/**
 * Formats a diff count for the progress table.
 * @param diffCount - Difference from the previous release
 * @returns Styled diff cell text.
 */
export function toDiffText(diffCount: number | null): string {
  if (diffCount === null) {
    return kleur.yellow('NEW'.padStart(9))
  }

  if (diffCount === 0) {
    return kleur.white('-'.padStart(9))
  }

  if (diffCount > 0) {
    return kleur.green(`+${diffCount}`.padStart(9))
  }

  return kleur.red(diffCount.toString().padStart(9))
}

/**
 * Calculates progress-table column widths for the selected feature types.
 * @param featureTypes - Feature type names to display
 * @returns Computed column widths.
 */
export function calculateColumnWidths(featureTypes: string[]): {
  featureNameWidth: number
  indexWidth: number
} {
  const maxFeatureLength = Math.max(
    ...featureTypes.map(featureType => featureType.length),
  )
  return {
    featureNameWidth: Math.max(maxFeatureLength, 15) + 1,
    indexWidth: featureTypes.length >= 10 ? 6 : 5,
  }
}

/**
 * Builds the static header lines for the progress table.
 * @param featureNameWidth - Width of the feature-name column
 * @param indexWidth - Width of the queue-index column
 * @returns Header and separator lines.
 */
function buildProgressHeader(
  featureNameWidth: number,
  indexWidth: number,
  countWidth: number,
): [string, string] {
  const countColumnWidth = Math.max(countWidth, stringWidth('COUNT'))
  const headerLine = `${kleur.white(''.padEnd(indexWidth + 1))} ${kleur.cyan('FEATURE'.padEnd(featureNameWidth + 1))} ${kleur.white('BBOX'.padEnd(CELL_COLUMN_WIDTH))} ${kleur.white('GEOM'.padEnd(CELL_COLUMN_WIDTH))} ${kleur.white('COUNT'.padEnd(countColumnWidth))} ${kleur.white('DIFF'.padEnd(DIFF_COLUMN_WIDTH - 1))}`
  const separatorLine = ` ${kleur.gray('─'.repeat(indexWidth + 2))}${kleur.gray('─'.repeat(featureNameWidth))} ${kleur.gray('─'.repeat(CELL_COLUMN_WIDTH))} ${kleur.gray('─'.repeat(CELL_COLUMN_WIDTH))} ${kleur.gray('─'.repeat(countColumnWidth))} ${kleur.gray('─'.repeat(DIFF_COLUMN_WIDTH))}`
  return [headerLine, separatorLine]
}

/**
 * Renders a single feature row.
 * @param featureType - Feature type displayed by the row
 * @param index - Zero-based queue index
 * @param total - Total queue size
 * @param progress - Progress state for the row
 * @param featureNameWidth - Width of the feature-name column
 * @param indexWidth - Width of the queue-index column
 * @returns Rendered row string.
 */
function renderProgressRow(
  featureType: string,
  index: number,
  total: number,
  progress: ProgressState,
  featureNameWidth: number,
  indexWidth: number,
  countWidth: number,
): string {
  const bboxState = progress.bboxComplete
    ? 'complete'
    : progress.isProcessing && progress.activeStage === 'bbox'
      ? 'active'
      : 'planned'

  const geomState = !progress.hasGeometryPass
    ? 'na'
    : progress.geomComplete
      ? 'complete'
      : progress.isProcessing && progress.activeStage === 'geometry'
        ? 'active'
        : 'planned'

  return buildProgressLine({
    featureType,
    index,
    total,
    featureNameWidth,
    indexWidth,
    countWidth,
    bboxCell: renderCell(bboxState),
    geomCell: renderCell(geomState),
    countText: (progress.featureCount || 0).toString(),
    diffText: toDiffText(progress.diffCount),
  })
}

/**
 * Builds a row string from already-rendered cell values.
 * @param params - Row data and preformatted cells
 * @returns Fully formatted row string.
 */
function buildProgressLine(params: {
  featureType: string
  index: number
  total: number
  featureNameWidth: number
  indexWidth: number
  countWidth: number
  bboxCell: string
  geomCell: string
  countText: string
  diffText: string
}): string {
  const {
    featureType,
    index,
    total,
    featureNameWidth,
    indexWidth,
    countWidth,
    bboxCell,
    geomCell,
    countText,
    diffText,
  } = params
  const indexNum = index + 1
  const progressPrefix =
    total > 9 && indexNum < 10
      ? `[${indexNum}/${total}]`.padStart(indexWidth + 1)
      : `[${indexNum}/${total}]`.padStart(indexWidth)

  return (
    `${kleur.white(progressPrefix)} ${kleur.cyan(featureType.padEnd(featureNameWidth))} │ ` +
    `${padDisplayEnd(bboxCell, CELL_COLUMN_WIDTH)} ${padDisplayEnd(geomCell, CELL_COLUMN_WIDTH)} ` +
    `${padDisplayStart(kleur.white(countText), countWidth)} ${padDisplayStart(diffText, DIFF_COLUMN_WIDTH)}`
  )
}

/**
 * Renders one table-status cell.
 * @param state - Visual state for the cell
 * @returns Styled cell string.
 */
function renderCell(
  state: 'planned' | 'active' | 'complete' | 'na' | 'skipped',
): string {
  if (state === 'complete') {
    return kleur.green(COMPLETE_CELL)
  }

  if (state === 'na') {
    return kleur.gray(NOT_APPLICABLE_CELL)
  }

  if (state === 'skipped') {
    return kleur.yellow(SKIPPED_CELL)
  }

  if (state === 'active') {
    const frameIndex = Math.floor(Date.now() / 250) % ACTIVE_CELL_FRAMES.length
    return kleur.yellow(ACTIVE_CELL_FRAMES[frameIndex])
  }

  return kleur.white(PLANNED_CELL)
}

/**
 * Formats the footer line for the current active row.
 * @param progress - Progress state that owns the footer message
 * @returns Styled footer line.
 */
function formatStatusLine(progress: ProgressState): string {
  if (!progress.currentMessage) {
    return 'Waiting for the next update'
  }

  return progress.currentMessage
}

/**
 * Builds the footer line with a rotating spinner.
 * @param message - Footer message without the `Currently:` prefix
 * @returns Styled footer line.
 */
function buildStatusLine(message: string): string {
  const frameIndex = Math.floor(Date.now() / 250) % STATUS_SPINNER_FRAMES.length
  const frame = STATUS_SPINNER_FRAMES[frameIndex]
  return `${kleur.yellow(frame)} ${message}`
}

/**
 * Selects the count-column width for the active target granularity.
 * @param target - Extraction target for the current run
 * @returns Width used to align numeric counts in the table
 */
function getCountColumnWidth(target: ControlContext['target']): number {
  return target === 'division' ? 7 : 9
}

/**
 * Pads text to a visual width while preserving ANSI colors.
 * @param value - Styled or unstyled text
 * @param width - Desired visual width
 * @returns Right-padded text aligned by terminal display width
 */
function padDisplayEnd(value: string, width: number): string {
  const padding = Math.max(width - stringWidth(value), 0)
  return `${value}${' '.repeat(padding)}`
}

/**
 * Left-pads text to a visual width while preserving ANSI colors.
 * @param value - Styled or unstyled text
 * @param width - Desired visual width
 * @returns Left-padded text aligned by terminal display width
 */
function padDisplayStart(value: string, width: number): string {
  const padding = Math.max(width - stringWidth(value), 0)
  return `${' '.repeat(padding)}${value}`
}

/**
 * Re-renders the entire progress block in place.
 * @returns Nothing. Writes directly to stdout.
 */
function renderProgressTable(): void {
  if (!progressTableState.isActive) {
    return
  }

  const sections = [
    ...progressTableState.headerLines,
    ...progressTableState.rowLines.map((line, index) => {
      const rowState = progressTableState.rowStates[index]
      if (!rowState) {
        return line
      }

      return renderProgressRow(
        rowState.featureType,
        rowState.index,
        rowState.total,
        rowState.progress,
        rowState.featureNameWidth,
        rowState.indexWidth,
        rowState.countWidth,
      )
    }),
    '',
    buildStatusLine(progressTableState.statusMessage),
  ]

  // Rewind to the start of the existing block so the whole table can be redrawn in place.
  if (process.stdout.isTTY && progressTableState.lineCount > 0) {
    readline.moveCursor(process.stdout, 0, -progressTableState.lineCount)
    readline.cursorTo(process.stdout, 0)
    readline.clearScreenDown(process.stdout)
  }

  process.stdout.write(`${sections.join('\n')}\n`)
  progressTableState.lineCount = sections.length
}
