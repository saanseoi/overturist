import path from 'node:path'
import { log } from '@clack/prompts'
import type { DuckDBConnection } from '@duckdb/node-api'
import { cacheDivisions, getCachedDivision, getTempCachePath } from './cache'
import { countryCodes } from './constants'
import { runDuckDBQuery } from './db'
import { getOutputDir, isParquetExists } from './fs'
import type { BBox, ControlContext, Division, GERS, Version } from './types'
import { bail } from './utils'
import { normalizeDivisionBBox } from './validation'

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
      const fileExists = await isParquetExists(previousVersionOutputDir, featureType)

      if (fileExists) {
        const previousFile = path.join(
          previousVersionOutputDir,
          `${featureType}.parquet`,
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
 * Extracts features for a bounding box from S3 and saves to the output file.
 * Used when target is 'bbox' or when the division boundary filter is skipped.
 * @param ctx - Control context containing release and bbox settings
 * @param featureType - The feature type to extract
 * @param theme - The theme for the feature type
 * @param outputFile - Path to save the final output file
 * @param progressCallback - Optional callback for progress updates
 * @returns Promise resolving to success status and feature count
 */
export async function getFeaturesForBbox(
  ctx: ControlContext,
  featureType: string,
  theme: string,
  outputFile: string,
  progressCallback?: () => void,
): Promise<{ success: boolean; count: number }> {
  const s3Path = `'s3://overturemaps-us-west-2/release/${ctx.releaseVersion}/theme=${theme}/type=${featureType}/*.parquet'`

  if (!ctx.bbox) {
    bail('Bbox is required')
  }

  // Materialize bbox-filtered features once so the output copy and count share the same snapshot.
  const bboxQuery = `
       ${DUCK_DB_REMOTE_SETUP}

       CREATE TEMP TABLE bbox_features AS
           SELECT * FROM read_parquet(${s3Path})
           WHERE bbox.xmin >= ${ctx.bbox.xmin} AND bbox.xmax <= ${ctx.bbox.xmax}
             AND bbox.ymin >= ${ctx.bbox.ymin} AND bbox.ymax <= ${ctx.bbox.ymax};

       COPY bbox_features TO '${outputFile}' (FORMAT PARQUET, COMPRESSION 'ZSTD');

       SELECT COUNT(*) as count FROM bbox_features;
   `

  try {
    const result = await runDuckDBQuery(bboxQuery, {
      progressCallback,
    })

    if (result.exitCode === 0 && result.stdout) {
      const count = JSON.parse(result.stdout)[0].count
      return { success: true, count }
    } else {
      return { success: false, count: 0 }
    }
  } catch (_error) {
    return { success: false, count: 0 }
  }
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
  progressCallback?: () => void,
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
    const result = await runDuckDBQuery(worldQuery, {
      progressCallback,
    })

    if (result.exitCode === 0 && result.stdout) {
      const count = JSON.parse(result.stdout)[0].count
      return { success: true, count }
    } else {
      return { success: false, count: 0 }
    }
  } catch (_error) {
    return { success: false, count: 0 }
  }
}

/**
 * Filters features by geometry using division boundaries after initial bbox filtering.
 * @param connection - Shared DuckDB connection with boundary geometry already prepared
 * @param ctx - Control context containing release, bbox, and division settings
 * @param featureType - The feature type being processed
 * @param theme - The theme for the feature type
 * @param outputFile - Path where filtered output should be written
 * @param progressCallback - Optional progress callback for both bbox and geometry steps
 * @returns Promise resolving to success status and the intermediate/final feature counts
 * @remarks This function assumes `boundary_geom` and bbox variables are already present on the connection.
 */
export async function getFeaturesForGeomWithConnection(
  connection: DuckDBConnection,
  ctx: ControlContext,
  featureType: string,
  theme: string,
  outputFile: string,
  progressCallback?: (stage: string, progress?: number) => void,
): Promise<{ success: boolean; bboxCount: number; finalCount: number }> {
  const s3Path = `'s3://overturemaps-us-west-2/release/${ctx.releaseVersion}/theme=${theme}/type=${featureType}/*.parquet'`
  const cacheFile = await getTempCachePath(outputFile)

  if (!ctx.bbox || !ctx.divisionId) {
    bail('Bbox and division ID are required')
  }

  try {
    // Skip setup progress - connection is already set up with extensions and variables
    progressCallback?.('setup', 100)

    // Step 1: Filter features by bbox only (fast operation on S3)
    progressCallback?.('bbox-filtering', 0)
    log.info(`Starting bbox filtering for ${featureType} features from ${theme} theme`)

    const bboxFilterQuery = `
            COPY (
                SELECT *
                FROM read_parquet(${s3Path})
                WHERE
                    bbox.xmin < getvariable('xmax')
                    AND bbox.xmax > getvariable('xmin')
                    AND bbox.ymin < getvariable('ymax')
                    AND bbox.ymax > getvariable('ymin')
            ) TO '${cacheFile}' (FORMAT PARQUET, COMPRESSION 'ZSTD');
        `

    await connection.run(bboxFilterQuery)
    progressCallback?.('bbox-filtering', 90)

    // Count bbox-filtered features on the shared connection to avoid extra DuckDB startup work.
    const bboxCount = await getCountWithConnection(connection, cacheFile)
    progressCallback?.('bbox-filtering', 100)
    log.info(`Features found in bbox: ${bboxCount}`)

    // Step 2: Apply geometry intersection filter on local cache file (fast operation)
    if (bboxCount > 0) {
      progressCallback?.('geom-filtering', 0)
      log.info(`Starting geometry intersection filtering on ${bboxCount} features`)

      const geomFilterQuery = `
                COPY (
                    SELECT *
                    FROM read_parquet('${cacheFile}')
                    WHERE ST_INTERSECTS((SELECT geom FROM boundary_geom), geometry)
                ) TO '${outputFile}' (FORMAT PARQUET, COMPRESSION 'ZSTD');
            `

      await connection.run(geomFilterQuery)
      progressCallback?.('geom-filtering', 90)

      // Count the final output on the shared connection to avoid extra DuckDB startup work.
      const finalCount = await getCountWithConnection(connection, outputFile)
      progressCallback?.('geom-filtering', 100)

      log.info(`Features after geometry filtering: ${finalCount}`)
      return { success: true, bboxCount, finalCount }
    } else {
      // No features in bbox, create empty output file
      await connection.run(
        `COPY (SELECT * FROM read_parquet('${cacheFile}') LIMIT 0) TO '${outputFile}' (FORMAT PARQUET, COMPRESSION 'ZSTD');`,
      )
      return { success: true, bboxCount: 0, finalCount: 0 }
    }
  } catch (error) {
    log.error(`Error in getFeaturesForGeomWithConnection: ${error}`)
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
