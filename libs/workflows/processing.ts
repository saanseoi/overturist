import fs from 'node:fs/promises'
import path from 'node:path'
import { log, spinner } from '@clack/prompts'
import type { DuckDBConnection } from '@duckdb/node-api'
import kleur from 'kleur'
import {
  cacheDivisions,
  cacheSearchResults,
  getCachedDivision,
  getCachedSearchResults,
} from '../data/cache'
import { DuckDBManager } from '../data/db'
import { fileExists, getFeatureOutputFilename } from '../core/fs'
import {
  extractBoundsFromDivision,
  getFeatureStats,
  getDivisionsByIds,
  getDivisionsByName,
  getDivisionsBySourceRecordId,
  getFeaturesForSpatialWithConnection,
  getFeaturesForWorld,
  getLastReleaseFeatureStats,
  localizeDivisionHierarchiesForRelease,
  normalizeOsmRelationRecordId,
} from '../data/queries'
import { downloadParquetFiles } from '../data/s3'
import type {
  BBox,
  ControlContext,
  Division,
  FeatureStats,
  GERS,
  Geometry,
  ProgressState,
  ProgressUpdate,
  Version,
} from '../core/types'
import {
  applyProgressUpdate,
  completeProgressDisplay,
  finalizeProgressDisplay,
  handleSkippedFeature,
  updateProgressDisplay,
  updateProgressStatus,
} from '../ui'
import { bail, bailFromSpinner, getDiffCount } from '../core/utils'

/**
 * Identifies targets that require a bounded spatial pass.
 * @param ctx - Resolved extraction context
 * @returns True for bounded targets
 */
function hasExactSpatialPass(ctx: ControlContext): boolean {
  return ctx.target !== 'world'
}

type FeatureProcessingResult = {
  success: boolean
  error?: string
  pendingStats?: Promise<void>
}

/**
 * FEATURES
 */

/**
 * Processes every selected feature type for the active target.
 * @param ctx - Control context
 * @returns Promise that resolves when all feature types have been processed
 * @throws Error when any selected feature fails to download
 */
export async function processFeatureTypes(ctx: ControlContext): Promise<void> {
  const dbManager = new DuckDBManager()
  const pendingStatsTasks: Promise<void>[] = []
  const failedFeatureTypes: string[] = []
  try {
    // Reuse one DuckDB connection so geometry-constrained runs share setup cost.
    const connection = await dbManager.getConnection()
    const extensionQuery = `
          INSTALL httpfs; LOAD httpfs;
              INSTALL spatial; LOAD spatial;
            SET s3_region='us-west-2';
            SET enable_object_cache=true;
        `
    await connection.run(extensionQuery)
    if (hasExactSpatialPass(ctx) && ctx.bbox) {
      const boundsQuery = `
                -- Build the exact frame geometry once so every feature type shares the same mask.
                CREATE OR REPLACE TEMP TABLE frame_geom AS
                SELECT ${
                  ctx.spatialFrame === 'bbox'
                    ? `ST_MakeEnvelope(${ctx.bbox.xmin}, ${ctx.bbox.ymin}, ${ctx.bbox.xmax}, ${ctx.bbox.ymax})`
                    : `ST_GeomFromHEXWKB('${ctx.geometry}')`
                } AS geom;
            `
      await connection.run(boundsQuery)
    }

    for (const [index, featureType] of ctx.featureTypes.entries()) {
      const result = await processFeatureType(ctx, featureType, index, connection)
      if (!result.success) {
        failedFeatureTypes.push(
          result.error ? `${featureType}: ${result.error}` : featureType,
        )
      }
      if (result.pendingStats) {
        pendingStatsTasks.push(result.pendingStats)
      }
    }

    await Promise.all(pendingStatsTasks)
    if (failedFeatureTypes.length > 0) {
      const message = `Download failed for: ${failedFeatureTypes.join(', ')}`
      completeProgressDisplay(kleur.red(message))
      throw new Error(message)
    }
    const { bytes, fileCount } = await getCombinedOutputSize(ctx)
    completeProgressDisplay(
      kleur.green(
        `Download completed (${formatDataSize(bytes)} across ${fileCount} ${fileCount === 1 ? 'file' : 'files'})`,
      ),
    )
  } finally {
    // Drain background updates before tearing down the progress display, even on errors.
    await Promise.allSettled(pendingStatsTasks)
    finalizeProgressDisplay()
    await dbManager.close()
  }
}

/**
 * Totals the written Parquet outputs for the selected feature types.
 * @param ctx - Control context that defines the output paths to inspect
 * @returns Combined byte size and number of outputs currently present
 */
async function getCombinedOutputSize(
  ctx: ControlContext,
): Promise<{ bytes: number; fileCount: number }> {
  // Inspect only this run's deterministic output paths, excluding unrelated files in the directory.
  const outputStats = await Promise.all(
    ctx.featureTypes.map(async featureType => {
      const outputPath = path.join(
        ctx.outputDir,
        getFeatureOutputFilename(
          featureType,
          ctx.target,
          ctx.spatialFrame,
          ctx.spatialPredicate,
          ctx.spatialGeometry,
        ),
      )

      try {
        return await fs.stat(outputPath)
      } catch (_error) {
        return null
      }
    }),
  )

  return outputStats.reduce(
    (total, outputStat) => {
      if (!outputStat?.isFile()) {
        return total
      }

      return {
        bytes: total.bytes + outputStat.size,
        fileCount: total.fileCount + 1,
      }
    },
    { bytes: 0, fileCount: 0 },
  )
}

/**
 * Formats a byte count for the final download summary.
 * @param bytes - Byte count to display
 * @returns Human-readable binary size
 */
function formatDataSize(bytes: number): string {
  if (bytes === 0) {
    return '0 B'
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const unitIndex = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  )
  const value = bytes / 1024 ** unitIndex

  return `${Number(value.toFixed(1))} ${units[unitIndex]}`
}

/**
 * Formats the theme/feature subject used in progress status updates.
 * @param theme - Theme bucket associated with the feature type
 * @param featureType - Concrete feature type being processed
 * @returns Styled subject string for progress messages
 */
function formatProgressSubject(theme: string | undefined, featureType: string): string {
  return kleur.cyan(theme ? `${theme}/${featureType}` : featureType)
}

/**
 * Initializes progress tracking for a feature type.
 * @param ctx - Control context
 * @param featureType - Feature type being processed
 * @param index - Index of the feature type in the array
 * @param featureTypes - Total number of feature types
 * @param featureNameWidth - Width for feature name display
 * @param indexWidth - Width for index display
 * @returns Previous-release stats and fresh progress state for the feature row
 */
async function initProgressTracker(
  ctx: ControlContext,
  featureType: string,
  index: number,
  featureTypes: string[],
  featureNameWidth: number,
  indexWidth: number,
) {
  const lastReleaseStats = await getLastReleaseFeatureStats(ctx, featureType)
  const hasGeometryPass = hasExactSpatialPass(ctx)
  const progressSubject = formatProgressSubject(
    ctx.themeMapping[featureType],
    featureType,
  )

  const progressState: ProgressState = {
    bboxComplete: false,
    geomComplete: false,
    hasGeometryPass,
    isProcessing: true,
    activeStage: 'bbox',
    hasCountMetric: false,
    featureCount: 0,
    diffCount: null,
    hasAreaMetric: lastReleaseStats?.hasArea ?? false,
    featureAreaKm2: null,
    diffAreaKm2: null,
    currentMessage: `${kleur.white('Preparing')} ${progressSubject}`,
  }

  updateProgressDisplay(
    featureType,
    index,
    featureTypes.length,
    progressState,
    featureNameWidth,
    indexWidth,
    ctx.target === 'division' ? 7 : 9,
  )

  return { lastReleaseStats, progressState }
}

/**
 * Marks the completed stages and stores the final feature stats for a row.
 * @param stats - Final feature count and area statistics
 * @param progressState - Current progress state to update
 * @param lastReleaseStats - Previous release stats for diff calculation
 * @param theme - Theme bucket associated with the feature
 * @param featureType - Feature type name for status messages
 * @param completedStage - Final stage completed by the processing path
 * @returns Nothing. Updates the existing row state.
 */
function updateProgressForCompletedFeature(
  stats: FeatureStats,
  progressState: ProgressState,
  lastReleaseStats: FeatureStats | null,
  theme: string | undefined,
  featureType: string,
  completedStage: 'bbox' | 'geometry' = 'bbox',
): void {
  progressState.bboxComplete = true
  progressState.geomComplete = completedStage === 'geometry'
  progressState.isProcessing = false
  progressState.activeStage = null

  const { count, hasArea } = stats
  const areaKm2 = hasArea ? stats.areaKm2 : null

  progressState.featureCount = count
  progressState.hasCountMetric = true
  progressState.diffCount = getDiffCount(count, lastReleaseStats?.count ?? null)
  progressState.hasAreaMetric = hasArea || (lastReleaseStats?.hasArea ?? false)
  progressState.featureAreaKm2 = areaKm2
  progressState.diffAreaKm2 =
    progressState.hasAreaMetric && areaKm2 !== null
      ? getDiffCount(areaKm2, lastReleaseStats?.areaKm2 ?? null)
      : null
  progressState.currentMessage = `${kleur.white('Completed')} ${formatProgressSubject(theme, featureType)} ${kleur.white(`(${count} features)`)}`
}

/**
 * Marks a spatial feature as fully written while final stats are still resolving in the background.
 * @param progressState - Current progress state to update
 * @param lastReleaseStats - Previous release stats used to preserve area applicability
 * @param theme - Theme bucket associated with the feature
 * @param featureType - Feature type name for status messaging
 */
function updateProgressForDeferredStats(
  progressState: ProgressState,
  lastReleaseStats: FeatureStats | null,
  theme: string | undefined,
  featureType: string,
): void {
  progressState.bboxComplete = true
  progressState.geomComplete = true
  progressState.isProcessing = false
  progressState.activeStage = null
  progressState.hasCountMetric = false
  progressState.featureCount = 0
  progressState.diffCount = null
  progressState.hasAreaMetric = lastReleaseStats?.hasArea ?? false
  progressState.featureAreaKm2 = null
  progressState.diffAreaKm2 = null
  progressState.currentMessage = `${kleur.white('Completed')} ${formatProgressSubject(theme, featureType)} ${kleur.gray('(stats pending)')}`
}

/**
 * Creates a progress callback that updates the active stage before re-rendering.
 * @param featureType - Feature type being processed
 * @param index - Index in the feature array
 * @param featureTypes - Total number of feature types
 * @param progressState - Progress state object to update
 * @param featureNameWidth - Width for feature name display
 * @param indexWidth - Width for index display
 * @param countWidth - Width for the progress count column
 * @param fallbackStage - Stage represented by the callback
 * @returns Progress callback function
 */
function createProgressCallback(
  featureType: string,
  index: number,
  featureTypes: string[],
  progressState: ProgressState,
  featureNameWidth: number,
  indexWidth: number,
  countWidth: number,
  fallbackStage: 'bbox' | 'geometry',
) {
  return (update?: ProgressUpdate) => {
    applyProgressUpdate(progressState, {
      stage: update?.stage === 'geometry' ? 'geometry' : fallbackStage,
      message: update?.message,
      count: update?.count,
      areaApplicable: update?.areaApplicable,
      areaKm2: update?.areaKm2,
    })
    updateProgressDisplay(
      featureType,
      index,
      featureTypes.length,
      progressState,
      featureNameWidth,
      indexWidth,
      countWidth,
    )
  }
}

/**
 * Executes the configured extraction path for a single feature type.
 * @param ctx - Control context
 * @param featureType - Feature type to process
 * @param index - Zero-based feature index for progress rendering
 * @param outputPath - Output file path
 * @param progressState - Progress state object
 * @param lastReleaseStats - Previous release stats for diff calculation
 * @param connection - Shared DuckDB connection for geometry-constrained runs
 * @returns Extraction result containing any background statistics task
 * @remarks Wrap the statistics promise so async return-value adoption does not await it.
 */
async function runFeatureExtraction(
  ctx: ControlContext,
  featureType: string,
  index: number,
  outputPath: string,
  progressState: ProgressState,
  lastReleaseStats: FeatureStats | null,
  connection?: DuckDBConnection,
): Promise<FeatureProcessingResult> {
  const { featureTypes, featureNameWidth, indexWidth, target } = ctx
  const theme = ctx.themeMapping[featureType]
  const progressSubject = formatProgressSubject(theme, featureType)
  const countWidth = ctx.target === 'division' ? 7 : 9
  const bboxProgressCallback = createProgressCallback(
    featureType,
    index,
    featureTypes,
    progressState,
    featureNameWidth,
    indexWidth,
    countWidth,
    'bbox',
  )
  const geometryProgressCallback = createProgressCallback(
    featureType,
    index,
    featureTypes,
    progressState,
    featureNameWidth,
    indexWidth,
    countWidth,
    'geometry',
  )

  if (target === 'world') {
    const result = await getFeaturesForWorld(
      featureType,
      ctx.themeMapping[featureType],
      ctx.releaseVersion,
      outputPath,
      (update?: ProgressUpdate) =>
        bboxProgressCallback(
          update ?? {
            stage: 'bbox',
            message: `${kleur.white('Downloading')} ${progressSubject}`,
          },
        ),
    )
    if (!result.success) {
      throw new Error(`Failed to process dataset for ${featureType}`)
    }
    updateProgressForCompletedFeature(
      result,
      progressState,
      lastReleaseStats,
      theme,
      featureType,
      'bbox',
    )
    return { success: true }
  }

  if (!ctx.bbox) {
    bail('❌ Spatial filtering requires Bbox')
  }
  if (!connection) {
    bail('❌ Spatial filtering requires an active DuckDB connection')
  }

  // Every bounded extraction path uses bbox prefiltering, exact spatial filtering, and optional clipping.
  const result = await getFeaturesForSpatialWithConnection(
    connection,
    ctx,
    featureType,
    ctx.themeMapping[featureType],
    outputPath,
    (update: ProgressUpdate) => {
      if (update.stage === 'geometry') {
        geometryProgressCallback(update)
        return
      }

      bboxProgressCallback(update)
    },
    'defer',
  )

  if (!result.success) {
    throw new Error(result.error ?? `Failed to process dataset for ${featureType}`)
  }

  if (result.finalStatsDeferred) {
    updateProgressForDeferredStats(progressState, lastReleaseStats, theme, featureType)

    const pendingStats = (async () => {
      try {
        const finalStats = await getFeatureStats(outputPath)
        updateProgressForCompletedFeature(
          finalStats,
          progressState,
          lastReleaseStats,
          theme,
          featureType,
          'geometry',
        )
        updateProgressStatus(progressState.currentMessage ?? kleur.green('Completed'))
      } catch (_error) {
        progressState.currentMessage = `${kleur.yellow('Completed')} ${formatProgressSubject(theme, featureType)} ${kleur.red('(stats unavailable)')}`
        updateProgressStatus(progressState.currentMessage, true)
      }
    })()
    return { success: true, pendingStats }
  }

  updateProgressForCompletedFeature(
    {
      count: result.finalCount,
      hasArea: result.finalHasArea,
      areaKm2: result.finalAreaKm2,
    },
    progressState,
    lastReleaseStats,
    theme,
    featureType,
    'geometry',
  )
  return { success: true }
}

/**
 * Processes one feature type, including file-exists handling and progress initialization.
 * @param ctx - Control context
 * @param featureType - Feature type to process
 * @param index - Index of the feature type in the array
 * @param connection - Shared DuckDB connection for geometry-constrained runs
 * @returns Success status and any background statistics task
 */
async function processFeatureType(
  ctx: ControlContext,
  featureType: string,
  index: number,
  connection?: DuckDBConnection,
): Promise<FeatureProcessingResult> {
  const { featureTypes, featureNameWidth, indexWidth } = ctx
  const countWidth = ctx.target === 'division' ? 7 : 9

  const outputPath = path.join(
    ctx.outputDir,
    getFeatureOutputFilename(
      featureType,
      ctx.target,
      ctx.spatialFrame,
      ctx.spatialPredicate,
      ctx.spatialGeometry,
    ),
  )

  const outputFileExists = await fileExists(outputPath)
  if (outputFileExists && ctx.onFileExists === 'skip') {
    await handleSkippedFeature(ctx, featureType, index, outputPath)
    return { success: true }
  }

  const { lastReleaseStats, progressState } = await initProgressTracker(
    ctx,
    featureType,
    index,
    featureTypes,
    featureNameWidth,
    indexWidth,
  )

  try {
    // Route each feature through the single-stage or two-stage extraction path.
    const result = await runFeatureExtraction(
      ctx,
      featureType,
      index,
      outputPath,
      progressState,
      lastReleaseStats,
      connection,
    )
    updateProgressDisplay(
      featureType,
      index,
      featureTypes.length,
      progressState,
      featureNameWidth,
      indexWidth,
      countWidth,
    )
    return result
  } catch (error) {
    progressState.isProcessing = false
    progressState.activeStage = null
    progressState.currentMessage = `${kleur.red('Failed')} ${formatProgressSubject(ctx.themeMapping[featureType], featureType)}${error instanceof Error ? `: ${kleur.white(error.message)}` : ''}`
    updateProgressDisplay(
      featureType,
      index,
      featureTypes.length,
      progressState,
      featureNameWidth,
      indexWidth,
      countWidth,
    )
    updateProgressStatus(progressState.currentMessage, true)
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Parses a comma-separated hierarchical query into individual segments.
 * @param queryString - The search string that may contain commas
 * @returns Array of trimmed query segments
 */
function parseHierarchicalQuery(queryString: string): string[] {
  return queryString
    .split(',')
    .map(segment => segment.trim())
    .filter(segment => segment.length > 0)
}

/**
 * Filters divisions based on hierarchical query segments.
 * @param divisions - Array of divisions to filter
 * @param querySegments - Array of query segments (excluding the first one which was already matched)
 * @param hierarchyData - Complete hierarchy data for all parent divisions
 * @returns Array of divisions that match the hierarchical criteria
 */
function filterByHierarchy(
  divisions: Division[],
  querySegments: string[],
  hierarchyData: Division[],
): Division[] {
  if (querySegments.length === 0) return divisions

  const hierarchyMap = new Map(hierarchyData.map(d => [d.id, d]))

  // A division matches when one of its hierarchies can satisfy every remaining segment
  // against any ancestor name in that hierarchy chain.
  return divisions.filter(division => {
    if (!division.hierarchies || division.hierarchies.length === 0) return false

    return division.hierarchies.some(hierarchy => {
      for (let i = 0; i < querySegments.length; i++) {
        const segment = querySegments[i]
        let found = false

        for (const hierarchyEntry of hierarchy) {
          const parentDivision = hierarchyMap.get(hierarchyEntry.division_id)
          if (!parentDivision) continue

          const parentNames = parentDivision.names?.common || []
          const nameMatch = parentNames.some(
            (name: { key: string; value: string }) =>
              name.value.toLowerCase().includes(segment.toLowerCase()) ||
              parentDivision.names.primary
                ?.toLowerCase()
                .includes(segment.toLowerCase()),
          )

          if (nameMatch) {
            found = true
            break
          }
        }

        if (!found) {
          break
        }

        if (i === querySegments.length - 1) {
          return true
        }
      }

      return false
    })
  })
}

/**
 * Loads localized cached search results when a cache key is available.
 * @param useCache - Whether cache lookups are enabled for this search
 * @param releaseVersion - Release version associated with the search
 * @param adminLevel - Administrative level used as part of the search key
 * @param queryString - Original search string
 * @param locale - Preferred locale for hierarchy localization
 * @returns Localized cached results, or false when no cache entry applies
 */
async function attemptToGetCachedSearchResults(
  useCache: boolean,
  releaseVersion: Version,
  adminLevel: number | undefined,
  queryString: string,
  locale: string,
): Promise<{ results: Division[]; totalCount: number } | false> {
  if (useCache && adminLevel) {
    const cachedResults = await getCachedSearchResults(
      releaseVersion,
      adminLevel,
      queryString,
    )
    if (cachedResults) {
      return {
        results: await localizeDivisionHierarchiesForRelease(
          releaseVersion,
          cachedResults.results,
          locale,
        ),
        totalCount: cachedResults.totalCount,
      }
    }
  }
  return false
}

/**
 * Searches for divisions by name and subtype with hierarchical filtering support.
 * @param releaseVersion - The release version to search within
 * @param queryString - The search string (name or country code, can contain commas for hierarchical search)
 * @param subtypes - Array of subtypes to search within
 * @param adminLevel - The admin level to search within (i.e. 1-4)
 * @param locale - Preferred locale for localized hierarchy names in the results
 * @param useCache - Whether to use cached results (default: true)
 * @returns Promise resolving to array of matching divisions (max 10)
 */
export async function searchDivisions(
  releaseVersion: Version,
  queryString: string,
  subtypes: string[],
  adminLevel: number,
  locale: string,
  useCache: boolean = true,
): Promise<{
  results: Division[]
  totalCount: number
}> {
  const emptyResult = { results: [], totalCount: 0 }

  // Reuse cached localized search results when the query can be keyed safely.
  const cachedResult = await attemptToGetCachedSearchResults(
    useCache,
    releaseVersion,
    adminLevel,
    queryString,
    locale,
  )
  if (cachedResult) {
    return cachedResult
  }

  const querySegments = parseHierarchicalQuery(queryString)
  if (querySegments.length === 0) {
    return emptyResult
  }

  // Prefer direct OSM-relation lookups before falling back to name-based searches.
  const sourceRecordIdPattern = normalizeOsmRelationRecordId(queryString)
  if (sourceRecordIdPattern) {
    const sourceMatchedResults = await getDivisionsBySourceRecordId(
      releaseVersion,
      sourceRecordIdPattern,
      subtypes,
      locale,
    )

    if (sourceMatchedResults.length === 0) {
      return emptyResult
    }

    await cacheDivisionSearchResults(
      releaseVersion,
      adminLevel,
      queryString,
      sourceMatchedResults,
    )

    return {
      results: sourceMatchedResults,
      totalCount: sourceMatchedResults.length,
    }
  }

  // Search the leaf division name first, then optionally constrain by ancestor segments.
  const initialResults = await getDivisionsByName(
    releaseVersion,
    querySegments[0],
    subtypes,
    locale,
  )

  if (initialResults.length === 0) {
    return emptyResult
  }

  if (querySegments.length === 1) {
    await cacheDivisionSearchResults(
      releaseVersion,
      adminLevel,
      queryString,
      initialResults,
    )
    return { results: initialResults, totalCount: initialResults.length }
  }

  const filteredResults = await processHierarchicalResults(
    releaseVersion,
    initialResults,
    querySegments,
  )

  await cacheDivisionSearchResults(
    releaseVersion,
    adminLevel,
    queryString,
    filteredResults,
    true,
  )

  return { results: filteredResults, totalCount: filteredResults.length }
}

/**
 * Caches division search results and optionally persists the division records too.
 * @param releaseVersion - Release version the search was performed against
 * @param adminLevel - Administrative level used in the search cache key
 * @param queryString - Original user query string
 * @param results - Search results to cache
 * @param shouldCacheDivisions - Whether to also cache individual division records
 * @returns Promise that resolves when all requested cache writes are complete
 */
async function cacheDivisionSearchResults(
  releaseVersion: Version,
  adminLevel: number,
  queryString: string,
  results: Division[],
  shouldCacheDivisions: boolean = false,
): Promise<void> {
  const result = {
    results,
    totalCount: results.length,
  }
  await cacheSearchResults(releaseVersion, adminLevel, queryString, result)

  if (shouldCacheDivisions) {
    await cacheDivisions(releaseVersion, results)
  }
}

/**
 * Collects parent division IDs from initial results across all hierarchies.
 * @param initialResults - First-pass search results matched on the leaf segment
 * @returns Unique parent division ids needed to evaluate ancestor segments
 */
function collectParentDivisionIds(initialResults: Division[]): Set<string> {
  const parentDivisionIds = new Set<string>()
  for (const division of initialResults) {
    if (division.hierarchies) {
      for (const hierarchy of division.hierarchies) {
        for (const hierarchyEntry of hierarchy) {
          parentDivisionIds.add(hierarchyEntry.division_id)
        }
      }
    }
  }
  return parentDivisionIds
}

/**
 * Processes hierarchical search results, including fetching missing parent divisions and caching.
 * @param releaseVersion - Release version used to load uncached hierarchy records
 * @param initialResults - First-pass matches from the leaf-name search
 * @param querySegments - Parsed hierarchy segments from the user query
 * @returns Filtered divisions whose ancestors match the remaining query segments
 */
async function processHierarchicalResults(
  releaseVersion: Version,
  initialResults: Division[],
  querySegments: string[],
): Promise<Division[]> {
  const parentDivisionIds = collectParentDivisionIds(initialResults)

  const cachedDivisions: Division[] = []
  const uncachedDivisionIds: string[] = []

  for (const divisionId of parentDivisionIds) {
    const cachedDivision = await getCachedDivision(releaseVersion, divisionId)
    if (cachedDivision) {
      cachedDivisions.push(cachedDivision)
    } else {
      uncachedDivisionIds.push(divisionId)
    }
  }

  const fetchedDivisions =
    uncachedDivisionIds.length > 0
      ? await getDivisionsByIds(releaseVersion, uncachedDivisionIds)
      : []

  if (fetchedDivisions.length > 0) {
    await cacheDivisions(releaseVersion, fetchedDivisions)
  }

  const hierarchyData = [...cachedDivisions, ...fetchedDivisions]

  // The first segment was already matched by name, so only ancestors remain to be checked.
  const remainingSegments = querySegments.slice(1)
  return filterByHierarchy(initialResults, remainingSegments, hierarchyData)
}

/**
 * Extracts bbox and geometry for a division, falling back to parent divisions when needed.
 * @param releaseVersion - Release version used for cache lookups and boundary extraction
 * @param division - Selected division record with hierarchy information
 * @param divisionId - Selected division id
 * @returns Extracted bounds metadata or null when no usable geometry is available
 */
export async function extractBoundsFromDivisionGeometry(
  releaseVersion: Version,
  division: Division | null,
  divisionId: GERS | null,
): Promise<{
  bbox: BBox | null
  geometry: Geometry | null
  foundForDivisionId: GERS
} | null> {
  const s = spinner()

  try {
    const selectedDivision = division
    if (!selectedDivision?.hierarchies?.[0]) {
      log.warn(`⚠️  No hierarchy information available for division ${divisionId}`)
      return null
    }
    const hierarchy = selectedDivision.hierarchies[0]

    const targetName = hierarchy[hierarchy.length - 1]?.name || divisionId || 'Unknown'
    s.start(
      `Investigating boundaries for ${kleur.bold(kleur.cyan(targetName))} ${kleur.gray('(~1 min)')}`,
    )

    if (!divisionId) {
      return null
    }

    // Reuse a cached extraction tied to the originally selected division when available.
    const cachedSelectedDivision = await getCachedDivision(releaseVersion, divisionId)

    if (
      cachedSelectedDivision?.bboxExtraction &&
      cachedSelectedDivision.geometryExtraction &&
      cachedSelectedDivision?.boundsExtractionDivisionId === divisionId
    ) {
      s.stop(
        `Boundaries drawn: ${kleur.bold(kleur.cyan(targetName))} ${kleur.gray('cache')}`,
      )
      return {
        bbox: cachedSelectedDivision.bboxExtraction,
        geometry: cachedSelectedDivision.geometryExtraction,
        foundForDivisionId: divisionId,
      }
    }

    // Walk up the hierarchy until one division has usable boundary geometry.
    for (let i = hierarchy.length - 1; i >= 0; i--) {
      const selectedDivisionId = hierarchy[i].division_id
      const currentDivision = hierarchy[i]
      const currentName = currentDivision?.name || selectedDivisionId

      if (i < hierarchy.length - 1) {
        s.message(
          `${kleur.red('Boundary unavailable:')} Expanding to ${kleur.bold(kleur.cyan(currentName))}`,
        )
      }

      const bounds = await extractBoundsFromDivision(selectedDivisionId, releaseVersion)
      if (bounds) {
        // Persist the fallback extraction on the selected division so future runs reuse it.
        if (cachedSelectedDivision) {
          cachedSelectedDivision.bboxExtraction = bounds.bbox
          cachedSelectedDivision.boundsExtractionDivisionId = divisionId
          cachedSelectedDivision.geometryExtraction = bounds.geometry
          await cacheDivisions(releaseVersion, [cachedSelectedDivision])
        }

        if (selectedDivisionId === divisionId) {
          s.stop(`Boundaries drawn: ${kleur.bold(kleur.cyan(currentName))}`)
        } else {
          const parentDivision = hierarchy.find(
            h => h.division_id === selectedDivisionId,
          )
          const parentName = parentDivision?.name || selectedDivisionId
          s.stop(`Boundaries drawn for ${kleur.bold(kleur.cyan(parentName))}`)
          log.warn(
            `Boundaries of ${kleur.bold(kleur.cyan(targetName))} were unavailable`,
          )
          log.warn(`The extracted parent area will include your selected area`)
        }
        return {
          bbox: bounds.bbox,
          geometry: bounds.geometry as Geometry,
          foundForDivisionId: selectedDivisionId,
        }
      }
    }

    s.stop(
      `No boundaries found for ${kleur.bold(kleur.red(targetName))} or its parent areas`,
    )
    return null
  } catch (error) {
    return bailFromSpinner(
      s,
      'Boundary extraction failed',
      `Failed to extract boundaries: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Downloads full dataset parquet files directly from S3 without DuckDB processing.
 * @param ctx - Control context containing all necessary information
 * @returns Promise that resolves when the download loop finishes
 */
export async function downloadFullDataset(ctx: ControlContext): Promise<void> {
  const { releaseContext, themeMapping, featureTypes, outputDir, onFileExists } = ctx
  const s = spinner()
  s.start('Starting full dataset download')

  try {
    for (const [index, featureType] of featureTypes.entries()) {
      const progress = `(${index + 1}/${featureTypes.length})`
      const outputPath = path.join(
        outputDir,
        getFeatureOutputFilename(
          featureType,
          ctx.target,
          ctx.spatialFrame,
          ctx.spatialPredicate,
          ctx.spatialGeometry,
        ),
      )

      // Check if file exists and handle according to onFileExists.
      if (await fileExists(outputPath)) {
        if (onFileExists === 'skip') {
          log.info(`${progress} Skipping ${featureType} (file already exists)`)
          continue
        } else if (onFileExists === 'abort') {
          s.stop('Download aborted due to existing files')
          return
        }
        // If "Replace", continue with download
      }

      // Find the theme for this feature type
      const theme = themeMapping[featureType]
      if (!theme) {
        log.warn(
          `${progress} Warning: No theme found for feature type ${featureType}, skipping`,
        )
        continue
      }

      s.message(`${progress} Downloading ${theme}/${featureType}...`)

      try {
        await downloadParquetFiles(
          releaseContext.version,
          theme,
          featureType,
          outputPath,
        )

        const fileStats = await fs.stat(outputPath)
        const fileSizeMB = (fileStats.size / (1024 * 1024)).toFixed(1)
        log.success(`${progress} Downloaded ${featureType} (${fileSizeMB} MB)`)
      } catch (error) {
        log.error(
          `${progress} Failed to download ${featureType}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        )
      }
    }

    s.stop(`Full dataset download completed`)
    log.success(`Files saved to: ${outputDir}`)
  } catch (error) {
    bailFromSpinner(
      s,
      'Full dataset download failed',
      `Failed to download full dataset: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}
