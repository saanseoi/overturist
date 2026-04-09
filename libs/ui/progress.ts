import readline from 'node:readline'
import kleur from 'kleur'
import stringWidth from 'string-width'
import { note } from '../core/note'
import { getFeatureStats, getLastReleaseFeatureStats } from '../data/queries'
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
const AREA_COLUMN_WIDTH = 11
const AREA_DIFF_COLUMN_WIDTH = 10

type ProgressTableState = {
  isActive: boolean
  renderMode: 'live' | 'snapshot'
  rowStates: Array<{
    featureType: string
    index: number
    total: number
    progress: ProgressState
    featureNameWidth: number
    indexWidth: number
    countWidth: number
    renderedLine?: string
  } | null>
  featureNameWidth: number
  indexWidth: number
  countWidth: number
  statusMessage: string
  renderScheduled: boolean
  pendingForceRender: boolean
  lastRenderedTable: string | null
  lastRenderedSnapshot: string | null
  lineCount: number
  spinnerTimer: ReturnType<typeof setInterval> | null
}

const progressTableState: ProgressTableState = {
  isActive: false,
  renderMode: 'snapshot',
  rowStates: [],
  featureNameWidth: 0,
  indexWidth: 0,
  countWidth: 7,
  statusMessage: 'Waiting to start',
  renderScheduled: false,
  pendingForceRender: false,
  lastRenderedTable: null,
  lastRenderedSnapshot: null,
  lineCount: 0,
  spinnerTimer: null,
}

function hasExactSpatialPass(ctx: ControlContext): boolean {
  return ctx.target !== 'world'
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
  const divisionName = ctx.division?.names?.primary || ctx.divisionId || '-'
  const divisionId = ctx.divisionId || ctx.division?.id || '-'
  const divisionSubtype = ctx.division?.subtype || '-'
  const divisionLines =
    ctx.target === 'division'
      ? [
          `${kleur.bold('Division')}     ${kleur.cyan(divisionName)}`,
          `${kleur.bold('GERS ID')}      ${kleur.yellow(divisionId)}`,
          `${kleur.bold('Subtype')}      ${kleur.magenta(divisionSubtype)}`,
        ]
      : []

  note(
    [
      `${kleur.bold('Release')}      ${kleur.bold(kleur.cyan(version))}${isLatest ? ` ${kleur.red('(latest)')}` : ''}`,
      `${kleur.bold('Schema')}       ${kleur.bold(kleur.cyan(schema))}${isNewSchema ? ` ${kleur.red('(new)')}` : ''}`,
      ...divisionLines,
      `${kleur.bold('Frame')}        ${kleur.cyan(ctx.spatialFrame)}`,
      `${kleur.bold('Predicate')}    ${kleur.cyan(ctx.spatialPredicate)}`,
      `${kleur.bold('Geometry')}     ${kleur.cyan(ctx.spatialGeometry)}`,
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

  // Reset transient renderer state so a new run cannot inherit a queued flush.
  if (progressTableState.spinnerTimer) {
    clearInterval(progressTableState.spinnerTimer)
  }

  progressTableState.isActive = true
  progressTableState.renderMode = shouldUseLiveProgressMode() ? 'live' : 'snapshot'
  progressTableState.featureNameWidth = ctx.featureNameWidth
  progressTableState.indexWidth = ctx.indexWidth
  progressTableState.countWidth = countWidth
  progressTableState.rowStates = ctx.featureTypes.map((featureType, index) => {
    const progress: ProgressState = {
      bboxComplete: false,
      geomComplete: false,
      hasGeometryPass: hasExactSpatialPass(ctx),
      isProcessing: false,
      activeStage: null,
      hasCountMetric: false,
      featureCount: 0,
      diffCount: null,
      hasAreaMetric: false,
      featureAreaKm2: null,
      diffAreaKm2: null,
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
  progressTableState.statusMessage = 'Waiting to start'
  progressTableState.renderScheduled = false
  progressTableState.pendingForceRender = false
  progressTableState.lastRenderedTable = null
  progressTableState.lastRenderedSnapshot = null
  progressTableState.lineCount = 0
  progressTableState.spinnerTimer = null

  if (progressTableState.renderMode === 'live') {
    progressTableState.spinnerTimer = setInterval(() => {
      renderLiveProgressTable()
    }, 250)
    renderLiveProgressTable()
  }
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
  if (!progressTableState.isActive) {
    const table = buildProgressTable(
      [
        {
          featureType,
          index,
          total,
          progress,
          featureNameWidth,
          indexWidth,
          countWidth,
        },
      ],
      featureNameWidth,
      indexWidth,
      countWidth,
    )
    console.log(`${table}\n${buildStatusLine(formatStatusLine(progress))}`)
    return
  }

  progressTableState.featureNameWidth = featureNameWidth
  progressTableState.indexWidth = indexWidth
  progressTableState.countWidth = countWidth
  progressTableState.rowStates[index] = {
    featureType,
    index,
    total,
    progress,
    featureNameWidth,
    indexWidth,
    countWidth,
  }
  progressTableState.statusMessage = formatStatusLine(progress)
  scheduleProgressRender()
}

/**
 * Updates the footer status line below the table.
 * @param message - User-facing status message
 * @returns Nothing. Re-renders the progress block.
 */
export function updateProgressStatus(message: string, forceRender = false): void {
  if (!progressTableState.isActive) {
    return
  }

  progressTableState.statusMessage = message
  scheduleProgressRender(forceRender)
}

/**
 * Stops the live progress renderer.
 * @returns Nothing. Restores normal terminal output.
 */
export function finalizeProgressDisplay(): void {
  if (!progressTableState.isActive) {
    return
  }

  if (progressTableState.spinnerTimer) {
    clearInterval(progressTableState.spinnerTimer)
  }

  if (progressTableState.renderMode === 'live' && progressTableState.lineCount > 0) {
    process.stdout.write('\n')
  }

  progressTableState.isActive = false
  progressTableState.renderMode = 'snapshot'
  progressTableState.rowStates = []
  progressTableState.featureNameWidth = 0
  progressTableState.indexWidth = 0
  progressTableState.countWidth = 7
  progressTableState.statusMessage = 'Waiting to start'
  progressTableState.renderScheduled = false
  progressTableState.pendingForceRender = false
  progressTableState.lastRenderedTable = null
  progressTableState.lastRenderedSnapshot = null
  progressTableState.lineCount = 0
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
    progress.hasCountMetric = true
    progress.featureCount = update.count
  }

  if (typeof update.areaApplicable === 'boolean') {
    progress.hasAreaMetric = update.areaApplicable
    if (!update.areaApplicable) {
      progress.featureAreaKm2 = null
      progress.diffAreaKm2 = null
    }
  }

  if (typeof update.areaKm2 === 'number' || update.areaKm2 === null) {
    progress.featureAreaKm2 = update.areaKm2
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
  let existingStats = { count: 0, hasArea: false, areaKm2: null as number | null }
  try {
    existingStats = await getFeatureStats(outputPath)
  } catch (_error) {
    existingStats = { count: 0, hasArea: false, areaKm2: null }
  }

  const lastReleaseStats = await getLastReleaseFeatureStats(controlContext, featureType)
  const hasAreaMetric = existingStats.hasArea || (lastReleaseStats?.hasArea ?? false)
  const diffText = toDiffText(
    getDiffCount(existingStats.count, lastReleaseStats?.count ?? null),
  )
  const areaText = toAreaText(existingStats.areaKm2, existingStats.hasArea)
  const areaDiffText = toAreaDiffText(
    hasAreaMetric
      ? getDiffCount(existingStats.areaKm2 ?? 0, lastReleaseStats?.areaKm2 ?? null)
      : null,
    hasAreaMetric,
  )
  const geomState = hasExactSpatialPass(controlContext) ? 'skipped' : 'na'

  const skippedProgress = buildProgressLine({
    featureType,
    index,
    total: controlContext.featureTypes.length,
    featureNameWidth: controlContext.featureNameWidth,
    indexWidth: controlContext.indexWidth,
    countWidth,
    bboxCell: renderCell('skipped'),
    geomCell: renderCell(geomState),
    countText: toCountText(existingStats.count, true),
    diffText,
    areaText,
    areaDiffText,
  })

  if (progressTableState.isActive) {
    progressTableState.featureNameWidth = controlContext.featureNameWidth
    progressTableState.indexWidth = controlContext.indexWidth
    progressTableState.countWidth = countWidth
    progressTableState.rowStates[index] = {
      featureType,
      index,
      total: controlContext.featureTypes.length,
      progress: createSkippedProgressState(controlContext),
      featureNameWidth: controlContext.featureNameWidth,
      indexWidth: controlContext.indexWidth,
      countWidth,
      renderedLine: skippedProgress,
    }
    progressTableState.statusMessage = `Skipping ${kleur.cyan(`${controlContext.themeMapping[featureType]}/${featureType}`)}`
    scheduleProgressRender()
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
 * Formats a count value for the progress table.
 * @param count - Count value for the current row
 * @param hasCount - Whether a real count has been calculated
 * @returns Styled count cell text.
 */
export function toCountText(count: number, hasCount: boolean): string {
  if (!hasCount) {
    return kleur.gray('n/a')
  }

  return kleur.white(count.toString())
}

/**
 * Formats an area value for the progress table.
 * @param areaKm2 - Area in square kilometers, or null when unavailable
 * @param hasArea - Whether area applies to the feature type
 * @returns Styled area cell text.
 */
export function toAreaText(areaKm2: number | null, hasArea: boolean): string {
  if (!hasArea || areaKm2 === null) {
    return kleur.gray('n/a'.padStart(AREA_COLUMN_WIDTH))
  }

  const absArea = Math.abs(areaKm2)
  let value: string

  if (absArea >= 1_000_000) {
    value = `${(areaKm2 / 1_000_000).toFixed(1)}M`
  } else if (absArea >= 10_000) {
    value = `${(areaKm2 / 1_000).toFixed(1)}k`
  } else if (absArea >= 100) {
    value = areaKm2.toFixed(0)
  } else if (absArea >= 10) {
    value = areaKm2.toFixed(1)
  } else {
    value = areaKm2.toFixed(2)
  }

  return kleur.white(value.padStart(AREA_COLUMN_WIDTH))
}

/**
 * Formats an area diff for the progress table.
 * @param diffAreaKm2 - Difference in square kilometers from the previous release
 * @param hasArea - Whether area applies to the feature type
 * @returns Styled area-diff cell text.
 */
export function toAreaDiffText(diffAreaKm2: number | null, hasArea: boolean): string {
  if (!hasArea) {
    return kleur.gray('n/a'.padStart(AREA_DIFF_COLUMN_WIDTH))
  }

  if (diffAreaKm2 === null) {
    return kleur.yellow('NEW'.padStart(AREA_DIFF_COLUMN_WIDTH))
  }

  if (diffAreaKm2 === 0) {
    return kleur.white('-'.padStart(AREA_DIFF_COLUMN_WIDTH))
  }

  const prefix = diffAreaKm2 > 0 ? '+' : ''
  const value = stripTrailingZeros(Math.abs(diffAreaKm2).toFixed(2))
  const text = `${prefix}${diffAreaKm2 < 0 ? '-' : ''}${value}`

  return diffAreaKm2 > 0
    ? kleur.green(text.padStart(AREA_DIFF_COLUMN_WIDTH))
    : kleur.red(text.padStart(AREA_DIFF_COLUMN_WIDTH))
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
  const headerLine = `${kleur.white(''.padEnd(indexWidth + 1))} ${kleur.cyan('FEATURE'.padEnd(featureNameWidth + 1))} ${kleur.white('BBOX'.padEnd(CELL_COLUMN_WIDTH))} ${kleur.white('GEOM'.padEnd(CELL_COLUMN_WIDTH))} ${kleur.white('COUNT'.padEnd(countColumnWidth))} ${kleur.white('C.DIFF'.padEnd(DIFF_COLUMN_WIDTH))} ${kleur.white('AREA(KM²)'.padEnd(AREA_COLUMN_WIDTH))} ${kleur.white('A.DIFF'.padEnd(AREA_DIFF_COLUMN_WIDTH))}`
  const separatorLine = ` ${kleur.gray('─'.repeat(indexWidth + 2))}${kleur.gray('─'.repeat(featureNameWidth))} ${kleur.gray('─'.repeat(CELL_COLUMN_WIDTH))} ${kleur.gray('─'.repeat(CELL_COLUMN_WIDTH))} ${kleur.gray('─'.repeat(countColumnWidth))} ${kleur.gray('─'.repeat(DIFF_COLUMN_WIDTH))} ${kleur.gray('─'.repeat(AREA_COLUMN_WIDTH))} ${kleur.gray('─'.repeat(AREA_DIFF_COLUMN_WIDTH))}`
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
    countText: toCountText(progress.featureCount, progress.hasCountMetric),
    diffText: progress.hasCountMetric
      ? toDiffText(progress.diffCount)
      : kleur.gray('n/a'.padStart(DIFF_COLUMN_WIDTH)),
    areaText: toAreaText(progress.featureAreaKm2, progress.hasAreaMetric),
    areaDiffText: toAreaDiffText(progress.diffAreaKm2, progress.hasAreaMetric),
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
  areaText: string
  areaDiffText: string
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
    areaText,
    areaDiffText,
  } = params
  const indexNum = index + 1
  const progressPrefix =
    total > 9 && indexNum < 10
      ? `[${indexNum}/${total}]`.padStart(indexWidth + 1)
      : `[${indexNum}/${total}]`.padStart(indexWidth)

  return (
    `${kleur.white(progressPrefix)} ${kleur.cyan(featureType.padEnd(featureNameWidth))} │ ` +
    `${padDisplayEnd(bboxCell, CELL_COLUMN_WIDTH)} ${padDisplayEnd(geomCell, CELL_COLUMN_WIDTH)} ` +
    `${padDisplayStart(countText, countWidth)} ${padDisplayStart(diffText, DIFF_COLUMN_WIDTH)} ` +
    `${padDisplayStart(areaText, AREA_COLUMN_WIDTH)} ${padDisplayStart(areaDiffText, AREA_DIFF_COLUMN_WIDTH)}`
  )
}

/**
 * Removes insignificant decimal suffixes from a numeric string.
 * @param value - Decimal string produced by `toFixed`
 * @returns Compact decimal string without trailing zero padding
 */
function stripTrailingZeros(value: string): string {
  return value.replace(/\.?0+$/, '')
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
    if (progressTableState.renderMode === 'live') {
      const frameIndex = Math.floor(Date.now() / 250) % ACTIVE_CELL_FRAMES.length
      return kleur.yellow(ACTIVE_CELL_FRAMES[frameIndex])
    }

    return kleur.yellow(ACTIVE_CELL_FRAMES[ACTIVE_CELL_FRAMES.length - 1])
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
  if (progressTableState.renderMode === 'live') {
    const frameIndex = Math.floor(Date.now() / 250) % STATUS_SPINNER_FRAMES.length
    return `${kleur.yellow(STATUS_SPINNER_FRAMES[frameIndex])} ${message}`
  }

  return `${kleur.yellow('•')} ${message}`
}

/**
 * Creates a placeholder progress state for skipped rows retained in the shared table model.
 * @param controlContext - Control context for the active run
 * @returns Progress state that renders as skipped outside the normal active/completed flow
 */
function createSkippedProgressState(controlContext: ControlContext): ProgressState {
  return {
    bboxComplete: false,
    geomComplete: false,
    hasGeometryPass: hasExactSpatialPass(controlContext),
    isProcessing: false,
    activeStage: null,
    hasCountMetric: false,
    featureCount: 0,
    diffCount: null,
    hasAreaMetric: false,
    featureAreaKm2: null,
    diffAreaKm2: null,
    currentMessage: null,
  }
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
 * Requests an in-place refresh of the current progress table without changing row ownership.
 * @returns Nothing. Schedules a redraw when the table is active.
 */
export function refreshProgressDisplay(): void {
  if (!progressTableState.isActive) {
    return
  }

  scheduleProgressRender(true)
}

/**
 * Schedules a single serialized snapshot flush for the current table state.
 * @returns Nothing. Coalesces repeated row updates into one snapshot render.
 */
function scheduleProgressRender(forceRender = false): void {
  if (progressTableState.renderMode === 'live') {
    if (progressTableState.renderScheduled) {
      return
    }

    progressTableState.renderScheduled = true
    queueMicrotask(() => {
      progressTableState.renderScheduled = false

      if (!progressTableState.isActive) {
        return
      }

      renderLiveProgressTable()
    })
    return
  }

  progressTableState.pendingForceRender =
    progressTableState.pendingForceRender || forceRender

  if (progressTableState.renderScheduled) {
    return
  }

  progressTableState.renderScheduled = true
  queueMicrotask(() => {
    progressTableState.renderScheduled = false

    if (!progressTableState.isActive) {
      return
    }

    const table = buildProgressTable(
      progressTableState.rowStates,
      progressTableState.featureNameWidth,
      progressTableState.indexWidth,
      progressTableState.countWidth,
    )
    const forceSnapshot = progressTableState.pendingForceRender
    progressTableState.pendingForceRender = false

    if (table === progressTableState.lastRenderedTable && !forceSnapshot) {
      return
    }

    const snapshot = `${table}\n${buildStatusLine(progressTableState.statusMessage)}`
    if (snapshot === progressTableState.lastRenderedSnapshot) {
      return
    }

    progressTableState.lastRenderedTable = table
    progressTableState.lastRenderedSnapshot = snapshot
    console.log(snapshot)
  })
}

/**
 * Re-renders the active progress table in place for trusted TTY terminals.
 * @returns Nothing. Writes directly to stdout.
 */
function renderLiveProgressTable(): void {
  if (!progressTableState.isActive || progressTableState.renderMode !== 'live') {
    return
  }

  const sections = [
    buildProgressTable(
      progressTableState.rowStates,
      progressTableState.featureNameWidth,
      progressTableState.indexWidth,
      progressTableState.countWidth,
    ),
    '',
    buildStatusLine(progressTableState.statusMessage),
  ]
  const output = `${sections.join('\n')}\n`

  if (progressTableState.lineCount > 0) {
    readline.moveCursor(process.stdout, 0, -progressTableState.lineCount)
    readline.cursorTo(process.stdout, 0)
    readline.clearScreenDown(process.stdout)
  }

  process.stdout.write(output)
  progressTableState.lineCount = output.trimEnd().split('\n').length
}

/**
 * Detects whether the current terminal can safely use the in-place live renderer.
 * @returns True when stdout is a TTY we can redraw in place
 */
function shouldUseLiveProgressMode(): boolean {
  return Boolean(process.stdout.isTTY)
}

/**
 * Builds the table portion of the current progress snapshot.
 * @param rowStates - Ordered row-state slots for the current run
 * @param featureNameWidth - Width of the feature-name column
 * @param indexWidth - Width of the queue-index column
 * @param countWidth - Width of the count column
 * @returns Table block ready to be combined with a footer line
 */
function buildProgressTable(
  rowStates: ProgressTableState['rowStates'],
  featureNameWidth: number,
  indexWidth: number,
  countWidth: number,
): string {
  const [headerLine, separatorLine] = buildProgressHeader(
    featureNameWidth,
    indexWidth,
    countWidth,
  )
  const rowLines = rowStates.map(rowState => {
    if (!rowState) {
      return ''
    }

    if (rowState.renderedLine) {
      return rowState.renderedLine
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
  })

  return [headerLine, separatorLine, ...rowLines].join('\n')
}
