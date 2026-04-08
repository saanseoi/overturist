import path from 'node:path'
import type { DuckDBConnection } from '@duckdb/node-api'
import kleur from 'kleur'
import { cacheDivisions, getCachedDivision, getTempCachePath } from './cache'
import { countryCodes } from '../core/constants'
import { runDuckDBQuery } from './db'
import { getFeatureOutputFilename, getOutputDir, isParquetExists } from '../core/fs'
import type {
  BBox,
  ControlContext,
  Division,
  GERS,
  ProgressUpdate,
  SpatialGeometryMode,
  Version,
} from '../core/types'
import { bail } from '../core/utils'
import { normalizeDivisionBBox } from '../core/validation'

const DIVISION_METADATA_COLUMNS = `
  id,
  names,
  subtype,
  country,
  hierarchies,
  bbox
`

const DUCK_DB_REMOTE_SETUP = `
  INSTALL httpfs; LOAD httpfs;
  INSTALL spatial; LOAD spatial;
  SET s3_region='us-west-2';
`

const SUBTYPE_PRIORITY_CASE = `
  CASE subtype
    WHEN 'country' THEN 1
    WHEN 'dependency' THEN 2
    WHEN 'macroregion' THEN 3
    WHEN 'region' THEN 4
    WHEN 'macrocounty' THEN 5
    WHEN 'county' THEN 6
    WHEN 'localadmin' THEN 7
    WHEN 'locality' THEN 8
    WHEN 'macrohood' THEN 9
    WHEN 'neighborhood' THEN 10
    WHEN 'microhood' THEN 11
    ELSE 12
  END
`

const SMART_CLIP_FEATURE_TYPES = new Set([
  'bathymetry',
  'land_cover',
  'water',
  'division_area',
  'division_boundary',
  'land',
  'land_use',
])

/**
 * Decides whether a feature type should have its geometry clipped to the frame.
 * @param featureType - Feature type currently being processed
 * @param geometryMode - Active spatial geometry mode
 * @returns True when the geometry should be modified via intersection
 */
function shouldClipFeatureGeometry(
  featureType: string,
  geometryMode: SpatialGeometryMode,
): boolean {
  if (geometryMode === 'clip-all') {
    return true
  }

  if (geometryMode === 'clip-smart') {
    return SMART_CLIP_FEATURE_TYPES.has(featureType)
  }

  return false
}

/**
 * Reports whether the resolved context requires an exact spatial-filter stage after bbox prefiltering.
 * @param ctx - Active control context
 * @returns True when the run should execute the exact geometry predicate
 */
export function requiresExactSpatialFilter(ctx: ControlContext): boolean {
  return ctx.target !== 'world'
}

/**
 * Normalizes an OSM relation reference into a DuckDB LIKE pattern for `record_id`.
 * @param value - User-provided relation reference or numeric relation ID
 * @returns LIKE-ready record ID pattern, or null when the value is not a relation reference
 */
export function normalizeOsmRelationRecordId(value: string): string | null {
  const trimmedValue = value.trim()

  if (/^\d+$/.test(trimmedValue)) {
    return `r${trimmedValue}@%`
  }

  if (/^r\d+$/.test(trimmedValue)) {
    return `${trimmedValue}@%`
  }

  if (/^r\d+@%$/.test(trimmedValue) || /^r\d+@[^%]+$/.test(trimmedValue)) {
    return trimmedValue
  }

  return null
}

function escapeSqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

/**
 * Escapes a value for use inside a DuckDB `LIKE` expression.
 * @param value - Raw search term supplied by the caller
 * @returns LIKE-safe pattern fragment with wildcard metacharacters escaped
 */
function escapeSqlLikePattern(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')
}

/**
 * Normalizes a locale key into the JSON path used by division common names.
 * @param locale - Optional locale key from config or CLI input
 * @returns DuckDB JSON path when the locale is safe to interpolate, otherwise null
 */
function normalizeLocalePath(locale?: string): string | null {
  if (!locale) {
    return null
  }

  return /^[A-Za-z0-9_-]+$/.test(locale) ? `$.common.${locale}` : null
}

/**
 * Builds the S3 path for division parquet files for a release.
 * @param releaseVersion - Release version used to resolve the remote parquet path
 * @returns S3 glob for division parquet files
 */
function getDivisionPath(releaseVersion: Version): string {
  return `s3://overturemaps-us-west-2/release/${releaseVersion}/theme=divisions/type=division/*.parquet`
}

/**
 * Builds the S3 path for division area parquet files for a release.
 * @param releaseVersion - Release version used to resolve the remote parquet path
 * @returns S3 glob for division area parquet files
 */
function getDivisionAreaPath(releaseVersion: Version): string {
  return `s3://overturemaps-us-west-2/release/${releaseVersion}/theme=divisions/type=division_area/*.parquet`
}

/**
 * Builds the S3 path for division boundary parquet files for a release.
 * @param releaseVersion - Release version used to resolve the remote parquet path
 * @returns S3 glob for division boundary parquet files
 */
function getDivisionBoundaryPath(releaseVersion: Version): string {
  return `s3://overturemaps-us-west-2/release/${releaseVersion}/theme=divisions/type=division_boundary/*.parquet`
}

/**
 * Builds the SQL predicate for subtype filtering.
 * @param subtypes - Division subtypes allowed by the caller
 * @returns SQL predicate that is always valid, even when no subtype filter is required
 */
function buildSubtypeFilter(subtypes: string[]): string {
  if (subtypes.length === 0) {
    return 'TRUE'
  }

  return subtypes.map(subtype => `subtype = ${escapeSqlLiteral(subtype)}`).join(' OR ')
}

/**
 * Resolves the preferred display name for a division using locale fallbacks.
 * @param division - Division metadata used to derive a display name
 * @param locale - Preferred locale key from config or CLI
 * @returns Best available display name for the division
 */
export function getDivisionNameForLocale(
  division: Pick<Division, 'id' | 'names'>,
  locale?: string,
): string {
  const localizedName = locale
    ? division.names?.common?.find(name => name.key === locale)?.value
    : undefined
  const englishName = division.names?.common?.find(name => name.key === 'en')?.value

  return localizedName || englishName || division.names?.primary || division.id
}

/**
 * Rewrites hierarchy entry names using division metadata looked up by hierarchy IDs.
 * @param divisions - Division records whose hierarchy labels should be localized
 * @param hierarchyLookup - Division metadata keyed by division id
 * @param locale - Preferred locale key from config or CLI
 * @returns Copies of the divisions with hierarchy names rewritten from metadata
 */
export function localizeDivisionHierarchies(
  divisions: Division[],
  hierarchyLookup: Map<GERS, Division>,
  locale?: string,
): Division[] {
  return divisions.map(division => ({
    ...division,
    hierarchies:
      division.hierarchies?.map(hierarchy =>
        hierarchy.map(entry => {
          const hierarchyDivision =
            hierarchyLookup.get(entry.division_id) ||
            (division.id === entry.division_id ? division : undefined)

          if (!hierarchyDivision) {
            return entry
          }

          return {
            ...entry,
            name: getDivisionNameForLocale(hierarchyDivision, locale),
          }
        }),
      ) || [],
  }))
}

/**
 * Loads the division metadata referenced by hierarchy entries and localizes hierarchy labels.
 * @param releaseVersion - Release version used to resolve hierarchy ids
 * @param divisions - Division records to localize
 * @param locale - Preferred locale key from config or CLI
 * @returns Divisions with hierarchy names rewritten from the localized metadata
 */
export async function localizeDivisionHierarchiesForRelease(
  releaseVersion: Version,
  divisions: Division[],
  locale?: string,
): Promise<Division[]> {
  if (divisions.length === 0) {
    return divisions
  }

  const hierarchyIds = new Set<GERS>()

  for (const division of divisions) {
    for (const hierarchy of division.hierarchies || []) {
      for (const entry of hierarchy) {
        hierarchyIds.add(entry.division_id)
      }
    }
  }

  if (hierarchyIds.size === 0) {
    return divisions
  }

  const hierarchyLookup = new Map<GERS, Division>()
  const localDivisionLookup = new Map(
    divisions.map(division => [division.id, division]),
  )
  const uncachedHierarchyIds: GERS[] = []

  for (const hierarchyId of hierarchyIds) {
    const localDivision = localDivisionLookup.get(hierarchyId)
    if (localDivision) {
      hierarchyLookup.set(hierarchyId, localDivision)
      continue
    }

    uncachedHierarchyIds.push(hierarchyId)
  }

  if (uncachedHierarchyIds.length > 0) {
    const cachedHierarchyDivisions = await Promise.all(
      uncachedHierarchyIds.map(async hierarchyId => ({
        hierarchyId,
        division: await getCachedDivision(releaseVersion, hierarchyId),
      })),
    )

    const missingHierarchyIds: GERS[] = []

    for (const { hierarchyId, division } of cachedHierarchyDivisions) {
      if (division) {
        hierarchyLookup.set(hierarchyId, division)
      } else {
        missingHierarchyIds.push(hierarchyId)
      }
    }

    if (missingHierarchyIds.length > 0) {
      const fetchedHierarchyDivisions = await getDivisionsByIds(
        releaseVersion,
        missingHierarchyIds,
        false,
      )

      if (fetchedHierarchyDivisions.length > 0) {
        await cacheDivisions(releaseVersion, fetchedHierarchyDivisions)
        for (const hierarchyDivision of fetchedHierarchyDivisions) {
          hierarchyLookup.set(hierarchyDivision.id, hierarchyDivision)
        }
      }
    }
  }

  return localizeDivisionHierarchies(divisions, hierarchyLookup, locale)
}

/**
 * Normalizes division search results before they enter the cache or application flow.
 * @param divisions - Raw division records returned by DuckDB JSON output
 * @returns Divisions with canonical bbox keys
 */
function normalizeDivisions(divisions: Division[]): Division[] {
  return divisions.map(normalizeDivisionBBox)
}

/**
 * Counts rows from a parquet file using an existing DuckDB connection.
 * @param connection - Open DuckDB connection used for the surrounding workflow
 * @param filePath - Path to the parquet file to count
 * @returns Row count for the parquet file
 */
async function getCountWithConnection(
  connection: DuckDBConnection,
  filePath: string,
): Promise<number> {
  const reader = await connection.runAndReadAll(
    `SELECT COUNT(*) AS count FROM '${filePath}';`,
  )
  const result = reader.getRowObjectsJson() as Array<{ count: number }>

  return result[0]?.count ?? 0
}

/**
 * COUNTING QUERIES
 */

/**
 * Gets the count of features in a Parquet file using DuckDB.
 * @param filePath - Path to the Parquet file
 * @returns Promise resolving to the count of features
 */
export async function getCount(filePath: string): Promise<number> {
  const { stdout: countStdout } = await runDuckDBQuery(
    `SELECT COUNT(*) as count FROM '${filePath}';`,
  )
  // Parse the JSON result and return the count
  return JSON.parse(countStdout)[0].count
}

/**
 * Retrieves the feature count from the previous release output for diff reporting.
 * @param ctx - Control context containing target, source, and release settings
 * @param featureType - The type of feature being processed (e.g., "address", "building")
 * @returns Count from the previous release output, or null when no comparable file is available
 * @remarks Missing files and query failures are treated as "no previous count" so diff reporting can continue.
 */
export async function getLastReleaseCount(
  ctx: ControlContext,
  featureType: string,
): Promise<number | null> {
  try {
    if (ctx.releaseContext.previousVersion) {
      const previousVersionOutputDir = getOutputDir(
        ctx.target,
        ctx.source.env,
        ctx.releaseContext.previousVersion,
        ctx.division,
        ctx.bbox,
      )
      const fileExists = await isParquetExists(
        previousVersionOutputDir,
        featureType,
        ctx.target,
        ctx.spatialFrame,
        ctx.spatialPredicate,
        ctx.spatialGeometry,
      )

      if (fileExists) {
        const previousFile = path.join(
          previousVersionOutputDir,
          getFeatureOutputFilename(
            featureType,
            ctx.target,
            ctx.spatialFrame,
            ctx.spatialPredicate,
            ctx.spatialGeometry,
          ),
        )
        return await getCount(previousFile)
      }
    }

    return null
  } catch (_error) {
    return null
  }
}

/**
 * DIVISION SEARCH QUERIES
 */

/**
 * Searches for divisions by name and subtype using DuckDB.
 * @param releaseVersion - Release version used to query the division dataset
 * @param querySegment - The search query segment
 * @param subtypes - Array of subtypes to search within
 * @param locale - Preferred locale used for localized common-name matching
 * @param cacheResult - Whether matching divisions should be written to the local cache
 * @returns Promise resolving to array of matching divisions
 * @remarks Country-code queries use a dedicated exact-match path instead of name search ranking.
 */
export async function getDivisionsByName(
  releaseVersion: Version,
  querySegment: string,
  subtypes: string[],
  locale?: string,
  cacheResult: boolean = true,
): Promise<Division[]> {
  const divisionPath = getDivisionPath(releaseVersion)
  const localePath = normalizeLocalePath(locale)
  const normalizedQuery = querySegment.trim()
  const queryLiteral = escapeSqlLiteral(normalizedQuery)
  const queryLikeLiteral = escapeSqlLiteral(
    `%${escapeSqlLikePattern(normalizedQuery)}%`,
  )
  const subtypeFilter = buildSubtypeFilter(subtypes)
  const isCountryCodeQuery = countryCodes.includes(normalizedQuery.toUpperCase())
  const localeCommonNameSelect = localePath
    ? `json_extract_string(names, ${escapeSqlLiteral(localePath)}) AS locale_common_name,`
    : `NULL AS locale_common_name,`
  const commonMatchExpression = localePath
    ? `
        LOWER(locale_common_name) LIKE LOWER(${queryLikeLiteral}) ESCAPE '\\'
      `
    : `
        EXISTS (
          SELECT 1
          FROM (
            SELECT json_extract(names, '$.common[*]') AS common_entries
          ) common_name_rows,
          unnest(common_entries) AS entry(entry)
          WHERE LOWER(json_extract_string(entry, '$.value')) LIKE LOWER(${queryLikeLiteral}) ESCAPE '\\'
        )
      `
  const exactCommonMatchExpression = localePath
    ? `
        LOWER(locale_common_name) = LOWER(${queryLiteral})
      `
    : `
        EXISTS (
          SELECT 1
          FROM (
            SELECT json_extract(names, '$.common[*]') AS common_entries
          ) common_name_rows,
          unnest(common_entries) AS entry(entry)
          WHERE LOWER(json_extract_string(entry, '$.value')) = LOWER(${queryLiteral})
        )
      `

  // Compute match and ranking columns once so DuckDB does not have to repeat JSON extraction in WHERE and ORDER BY.
  const searchQuery = `
    ${DUCK_DB_REMOTE_SETUP}
    WITH base_divisions AS (
      SELECT
        ${DIVISION_METADATA_COLUMNS},
        json_valid(names) AS has_valid_names,
        json_extract_string(names, '$.primary') AS primary_name,
        ${localeCommonNameSelect}
        LOWER(country) AS country_lower
      FROM read_parquet('${divisionPath}')
      WHERE (${subtypeFilter})
    ),
    ranked_divisions AS (
      SELECT
        ${DIVISION_METADATA_COLUMNS},
        country_lower = LOWER(${queryLiteral}) AS matches_country,
        has_valid_names
          AND LOWER(primary_name) LIKE LOWER(${queryLikeLiteral}) ESCAPE '\\' AS matches_primary,
        has_valid_names
          AND ${commonMatchExpression} AS matches_common,
        CASE
          WHEN has_valid_names AND LOWER(primary_name) = LOWER(${queryLiteral}) THEN 1
          WHEN has_valid_names AND ${exactCommonMatchExpression} THEN 2
          ELSE 3
        END AS name_match_rank
      FROM base_divisions
    )
    SELECT
      ${DIVISION_METADATA_COLUMNS}
    FROM ranked_divisions
    WHERE ${
      isCountryCodeQuery ? 'matches_country' : '(matches_primary OR matches_common)'
    }
    ORDER BY
      ${isCountryCodeQuery ? '1' : 'name_match_rank'},
      ${SUBTYPE_PRIORITY_CASE};
  `

  const result = await runDuckDBQuery(searchQuery)

  if (result.exitCode !== 0) {
    throw new Error(`Division search failed: ${result.stderr}`)
  }

  const results = await localizeDivisionHierarchiesForRelease(
    releaseVersion,
    normalizeDivisions(JSON.parse(result.stdout) as Division[]),
    locale,
  )

  if (cacheResult) {
    await cacheDivisions(releaseVersion, results)
  }

  return results
}

/**
 * Retrieves detailed hierarchy information for specific division IDs.
 * @param releaseVersion - Release version used to query the division dataset
 * @param divisionIds - Array of division IDs to fetch
 * @param localizeHierarchyNames - Whether hierarchy entry names should be localized after loading
 * @param locale - Preferred locale used when localizing hierarchy names
 * @returns Promise resolving to array of divisions with complete hierarchy data
 */
export async function getDivisionsByIds(
  releaseVersion: Version,
  divisionIds: GERS[],
  localizeHierarchyNames: boolean = true,
  locale?: string,
): Promise<Division[]> {
  if (divisionIds.length === 0) return []

  const divisionPath = getDivisionPath(releaseVersion)
  const idList = divisionIds.map(id => escapeSqlLiteral(id)).join(',')

  // Load the requested divisions in one pass before optional hierarchy localization.
  const hierarchyQuery = `
    ${DUCK_DB_REMOTE_SETUP}
    SELECT
      ${DIVISION_METADATA_COLUMNS}
    FROM read_parquet('${divisionPath}')
    WHERE id IN (${idList});
  `

  const result = await runDuckDBQuery(hierarchyQuery)

  if (result.exitCode !== 0) {
    throw new Error(`Hierarchy data fetch failed: ${result.stderr}`)
  }

  const divisions = normalizeDivisions(JSON.parse(result.stdout) as Division[])

  return localizeHierarchyNames
    ? await localizeDivisionHierarchiesForRelease(releaseVersion, divisions, locale)
    : divisions
}

/**
 * Retrieves divisions by matching an OSM relation `record_id` in division area sources.
 * @param releaseVersion - The release version to search within
 * @param relationReference - OSM relation reference, such as `10268797`, `r10268797`, or `r10268797@%`
 * @param subtypes - Optional subtype filter applied after loading the divisions
 * @param locale - Preferred locale used when localizing hierarchy names
 * @returns Promise resolving to matching divisions
 * @remarks This resolves relation references through `division_area.sources[*].record_id`
 *          and then loads the corresponding division records by `division_id`.
 */
export async function getDivisionsBySourceRecordId(
  releaseVersion: Version,
  relationReference: string,
  subtypes: string[] = [],
  locale?: string,
): Promise<Division[]> {
  const recordIdPattern = normalizeOsmRelationRecordId(relationReference)

  if (!recordIdPattern) {
    return []
  }

  const divisionAreaPath = getDivisionAreaPath(releaseVersion)
  const recordIdLikeLiteral = escapeSqlLiteral(recordIdPattern)

  // Resolve division IDs from the source relation reference before loading full division records.
  const sourceLookupQuery = `
    ${DUCK_DB_REMOTE_SETUP}
    SELECT DISTINCT
      division_id
    FROM read_parquet('${divisionAreaPath}', filename=true, hive_partitioning=1),
      unnest(sources) AS source(source)
    WHERE source.record_id LIKE ${recordIdLikeLiteral} ESCAPE '\\';
  `

  const result = await runDuckDBQuery(sourceLookupQuery)

  if (result.exitCode !== 0) {
    throw new Error(`Division source lookup failed: ${result.stderr}`)
  }

  const divisionIds = (JSON.parse(result.stdout) as Array<{ division_id: GERS }>)
    .map(row => row.division_id)
    .filter(Boolean)

  if (divisionIds.length === 0) {
    return []
  }

  const divisions = await getDivisionsByIds(releaseVersion, divisionIds, true, locale)
  await cacheDivisions(releaseVersion, divisions)

  if (subtypes.length === 0) {
    return divisions
  }

  const subtypeSet = new Set(subtypes)
  return divisions.filter(division => subtypeSet.has(division.subtype))
}

/**
 * FEATURE EXTRACTION QUERIES
 */

/**
 * Builds the fast bbox prefilter predicate used before exact spatial filtering.
 * @param bbox - Bbox envelope of the active frame
 * @param predicate - Exact predicate selected for the run
 * @returns SQL fragment for broad-phase feature bbox filtering
 */
function buildPrefilterWhereClause(ctx: ControlContext): string {
  if (!ctx.bbox) {
    bail('Bbox is required for spatial filtering')
  }

  if (ctx.spatialPredicate === 'within') {
    return `
      bbox.xmin >= ${ctx.bbox.xmin}
      AND bbox.xmax <= ${ctx.bbox.xmax}
      AND bbox.ymin >= ${ctx.bbox.ymin}
      AND bbox.ymax <= ${ctx.bbox.ymax}
    `
  }

  return `
    bbox.xmin < ${ctx.bbox.xmax}
    AND bbox.xmax > ${ctx.bbox.xmin}
    AND bbox.ymin < ${ctx.bbox.ymax}
    AND bbox.ymax > ${ctx.bbox.ymin}
  `
}

/**
 * Builds the exact geometry predicate applied to candidates that pass the bbox prefilter.
 * @param ctx - Active control context
 * @returns SQL fragment for the exact geometry predicate
 */
function buildExactPredicate(ctx: ControlContext): string {
  if (ctx.spatialPredicate === 'within') {
    return `ST_Within(geometry, (SELECT geom FROM frame_geom))`
  }

  return `ST_Intersects((SELECT geom FROM frame_geom), geometry)`
}

/**
 * Downloads all features for the entire world dataset.
 * Used when target is 'world' - no filtering required.
 * @param featureType - The feature type to download
 * @param theme - The theme for the feature type
 * @param version - The release version to download
 * @param outputFile - Path to save the final output file
 * @param progressCallback - Optional callback for progress updates
 * @returns Promise resolving to success status and feature count
 */
export async function getFeaturesForWorld(
  featureType: string,
  theme: string,
  version: string,
  outputFile: string,
  progressCallback?: (update: ProgressUpdate) => void,
): Promise<{ success: boolean; count: number }> {
  const s3Path = `s3://overturemaps-us-west-2/release/${version}/theme=${theme}/type=${featureType}/`

  const worldQuery = `
        ${DUCK_DB_REMOTE_SETUP}

        COPY (
            SELECT * FROM read_parquet('${s3Path}*.parquet')
        ) TO '${outputFile}' (FORMAT PARQUET, COMPRESSION 'ZSTD');

        SELECT COUNT(*) as count FROM read_parquet('${outputFile}');
  `

  try {
    progressCallback?.({
      stage: 'bbox',
      message: `${kleur.white('Downloading all')} ${kleur.cyan(featureType)} ${kleur.white('from')} ${kleur.magenta(theme)}`,
    })

    const result = await runDuckDBQuery(worldQuery, {
      progressCallback: () => progressCallback?.({ stage: 'bbox' }),
    })

    if (result.exitCode === 0 && result.stdout) {
      const count = JSON.parse(result.stdout)[0].count
      progressCallback?.({
        stage: 'bbox',
        count,
      })
      return { success: true, count }
    } else {
      return { success: false, count: 0 }
    }
  } catch (_error) {
    return { success: false, count: 0 }
  }
}

/**
 * Filters features using the configured spatial frame, predicate, and geometry mode.
 * @param connection - Shared DuckDB connection with frame geometry already prepared
 * @param ctx - Control context containing release and spatial settings
 * @param featureType - The feature type being processed
 * @param theme - The theme for the feature type
 * @param outputFile - Path where filtered output should be written
 * @param progressCallback - Optional progress callback for both bbox and geometry steps
 * @returns Promise resolving to success status and the intermediate/final feature counts
 * @remarks This function assumes `frame_geom` has already been created on the connection.
 */
export async function getFeaturesForSpatialWithConnection(
  connection: DuckDBConnection,
  ctx: ControlContext,
  featureType: string,
  theme: string,
  outputFile: string,
  progressCallback?: (update: ProgressUpdate) => void,
): Promise<{ success: boolean; bboxCount: number; finalCount: number }> {
  const s3Path = `'s3://overturemaps-us-west-2/release/${ctx.releaseVersion}/theme=${theme}/type=${featureType}/*.parquet'`
  const cacheFile = await getTempCachePath(outputFile)

  if (!ctx.bbox) {
    bail('Bbox is required for spatial filtering')
  }

  try {
    // Skip setup progress - connection is already set up with extensions and variables
    progressCallback?.({ stage: 'setup' })

    // Step 1: Filter features by bbox only (fast operation on S3)
    progressCallback?.({
      stage: 'bbox',
      message: `${kleur.white('Filtering')} ${kleur.cyan('bbox')} ${kleur.white('for')} ${kleur.cyan(featureType)} ${kleur.white('from')} ${kleur.magenta(theme)}`,
    })

    const bboxFilterQuery = `
            COPY (
                SELECT *
                FROM read_parquet(${s3Path})
                WHERE ${buildPrefilterWhereClause(ctx)}
            ) TO '${cacheFile}' (FORMAT PARQUET, COMPRESSION 'ZSTD');
        `

    await connection.run(bboxFilterQuery)

    // Count bbox-filtered features on the shared connection to avoid extra DuckDB startup work.
    const bboxCount = await getCountWithConnection(connection, cacheFile)
    progressCallback?.({
      stage: 'bbox',
      count: bboxCount,
    })

    // Step 2: Apply geometry intersection filter on local cache file (fast operation)
    if (bboxCount > 0) {
      progressCallback?.({
        stage: 'geometry',
        message: `${kleur.white('Filtering')} ${kleur.cyan('geometry')} ${kleur.white('for')} ${kleur.cyan(featureType)} ${kleur.white('from')} ${kleur.magenta(theme)}`,
        count: bboxCount,
      })

      const clipFeatureGeometry = shouldClipFeatureGeometry(
        featureType,
        ctx.spatialGeometry,
      )
      const exactPredicate = buildExactPredicate(ctx)

      // Preserve full features by default, or clip selected feature types to the frame when configured.
      const geomFilterQuery = clipFeatureGeometry
        ? `
                COPY (
                    WITH matching_features AS (
                        SELECT
                            *,
                            ST_Intersection(geometry, (SELECT geom FROM frame_geom)) AS clipped_geometry
                        FROM read_parquet('${cacheFile}')
                        WHERE ${exactPredicate}
                    )
                    SELECT
                        * EXCLUDE (clipped_geometry)
                        REPLACE (
                            clipped_geometry AS geometry,
                            struct_pack(
                                xmin := ST_XMin(clipped_geometry),
                                ymin := ST_YMin(clipped_geometry),
                                xmax := ST_XMax(clipped_geometry),
                                ymax := ST_YMax(clipped_geometry)
                            ) AS bbox
                        )
                    FROM matching_features
                    WHERE clipped_geometry IS NOT NULL AND NOT ST_IsEmpty(clipped_geometry)
                ) TO '${outputFile}' (FORMAT PARQUET, COMPRESSION 'ZSTD');
            `
        : `
                COPY (
                    SELECT *
                    FROM read_parquet('${cacheFile}')
                    WHERE ${exactPredicate}
                ) TO '${outputFile}' (FORMAT PARQUET, COMPRESSION 'ZSTD');
            `

      await connection.run(geomFilterQuery)

      // Count the final output on the shared connection to avoid extra DuckDB startup work.
      const finalCount = await getCountWithConnection(connection, outputFile)
      progressCallback?.({
        stage: 'geometry',
        count: finalCount,
      })
      return { success: true, bboxCount, finalCount }
    } else {
      // No features in bbox, create empty output file
      await connection.run(
        `COPY (SELECT * FROM read_parquet('${cacheFile}') LIMIT 0) TO '${outputFile}' (FORMAT PARQUET, COMPRESSION 'ZSTD');`,
      )
      progressCallback?.({
        stage: 'bbox',
        count: 0,
      })
      return { success: true, bboxCount: 0, finalCount: 0 }
    }
  } catch (_error) {
    return { success: false, bboxCount: 0, finalCount: 0 }
  }
}

/**
 * GEOMETRY EXTRACTION QUERIES
 */

/**
 * Extracts bbox and geometry directly from remote S3 data using DuckDB.
 * @param divisionId - The division ID to extract geometry for
 * @param releaseVersion - The release version to use
 * @returns Promise resolving to bbox data and geometry or null if not found
 */
export async function extractBoundsFromDivision(
  divisionId: string,
  releaseVersion: string,
): Promise<{
  bbox: BBox
  geometry: string // Hex-encoded WKB binary
} | null> {
  const divisionAreaPath = `'${getDivisionAreaPath(releaseVersion)}'`
  const divisionBoundaryPath = `'${getDivisionBoundaryPath(releaseVersion)}'`

  // Combine area and boundary geometries so bbox extraction and final geometry are derived from the same union.
  const bboxQuery = `
        ${DUCK_DB_REMOTE_SETUP}
        WITH combined_geoms AS (
            SELECT geometry as geom
            FROM read_parquet(${divisionAreaPath})
            WHERE division_id = '${divisionId}' AND geometry IS NOT NULL
            UNION ALL
            SELECT geometry as geom
            FROM read_parquet(${divisionBoundaryPath})
            WHERE list_contains(division_ids, '${divisionId}') AND geometry IS NOT NULL
        ),
        bounds_query AS (
            SELECT
                ST_XMin(ST_Union_Agg(geom)) as xmin,
                ST_XMax(ST_Union_Agg(geom)) as xmax,
                ST_YMin(ST_Union_Agg(geom)) as ymin,
                ST_YMax(ST_Union_Agg(geom)) as ymax
            FROM combined_geoms
            WHERE geom IS NOT NULL
        )
        SELECT
            b.*,
            ST_AsHEXWKB(ST_Union_Agg(geom)) as geometry
        FROM bounds_query b, combined_geoms
        WHERE geom IS NOT NULL
        GROUP BY b.xmin, b.xmax, b.ymin, b.ymax;
    `

  try {
    const result = await runDuckDBQuery(bboxQuery)

    if (result.exitCode === 0 && result.stdout) {
      const bboxResults = JSON.parse(result.stdout)

      if (bboxResults.length > 0) {
        const bounds = bboxResults[0]

        // Check if we got valid coordinates
        if (
          bounds.xmin !== null &&
          bounds.xmax !== null &&
          bounds.ymin !== null &&
          bounds.ymax !== null
        ) {
          return {
            bbox: {
              xmin: bounds.xmin,
              ymin: bounds.ymin,
              xmax: bounds.xmax,
              ymax: bounds.ymax,
            },
            geometry: bounds.geometry, // Hex-encoded WKB binary
          }
        }
      }
    }
  } catch (_error) {
    // Return null if there's any error
  }

  return null
}
