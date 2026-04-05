import path from 'node:path'
import {
  CACHE_DIR,
  directoryHasJsonFiles,
  ensureDirectoryExists,
  readDirectoryEntries,
  readJsonFile,
  writeJsonFile,
} from './fs'
import type {
  CachedSearchResults,
  Division,
  DivisionArea,
  DivisionBoundary,
  ExtendedDivision,
  GERS,
  ReleaseData,
  SearchHistory,
  SearchHistoryItem,
  ThemeMapping,
  Version,
} from './types'
import { normalizeDivisionBBox } from './validation'

type CacheRecord = Record<string, unknown>

/**
 * TEMP FILES
 */

/**
 * Constructs a cache path for temporary files by replacing the output directory with cache directory
 * and ensures the cache directory exists.
 * @param outputFilePath - The original output file path (e.g., "data/v1/country/feature.parquet")
 * @param filename - Optional custom filename (defaults to original filename)
 * @returns Promise resolving to cache path for temporary file (e.g., ".cache/v1/country/feature.parquet")
 * @remarks The first relative path segment is replaced with `.cache` so temp files mirror output structure.
 */
export async function getTempCachePath(
  outputFilePath: string,
  filename?: string,
): Promise<string> {
  const workspaceRelativePath = path.isAbsolute(outputFilePath)
    ? path.relative(process.cwd(), outputFilePath)
    : outputFilePath
  const normalizedRelativePath = path.normalize(workspaceRelativePath)

  if (
    path.isAbsolute(normalizedRelativePath) ||
    normalizedRelativePath === '..' ||
    normalizedRelativePath.startsWith(`..${path.sep}`)
  ) {
    throw new Error(
      `Cannot derive cache path outside workspace from "${outputFilePath}"`,
    )
  }

  const pathSegments = path
    .normalize(normalizedRelativePath)
    .split(path.sep)
    .filter(Boolean)

  if (pathSegments.length === 0) {
    throw new Error(`Cannot derive cache path from "${outputFilePath}"`)
  }

  pathSegments[0] = '.cache'

  const parsedPath = path.parse(path.join(...pathSegments))
  const cachePath = filename
    ? path.join(parsedPath.dir, filename)
    : path.join(parsedPath.dir, parsedPath.base)

  // Ensure cache directory exists (strip filename for directory creation)
  await ensureDirectoryExists(path.dirname(cachePath))

  return cachePath
}

/**
 * JSON CACHE HELPERS
 */

/**
 * Write data to JSON cache file
 * @param cachePath - Path to the cache file
 * @param data - Data to cache
 */
export async function writeJsonCache(cachePath: string, data: unknown): Promise<void> {
  await ensureDirectoryExists(path.dirname(cachePath))
  await writeJsonFile(cachePath, data)
}

/**
 * Read data from JSON cache file
 * @param cachePath - Path to the cache file
 * @returns Promise resolving to the cached data
 */
export async function readJsonCache<T>(cachePath: string): Promise<T | null> {
  return await readJsonFile<T>(cachePath)
}

/**
 * Checks whether a value is a non-null object record.
 * @param value - Value to inspect
 * @returns True when the value can be treated as a record
 */
function isRecord(value: unknown): value is CacheRecord {
  return typeof value === 'object' && value !== null
}

/**
 * Checks whether a value is an array of divisions.
 * @param value - Value to validate
 * @returns True when the value is an array of minimally valid division records
 */
function isDivisionArray(value: unknown): value is Division[] {
  return (
    Array.isArray(value) &&
    value.every(
      item =>
        isRecord(item) &&
        typeof item.id === 'string' &&
        typeof item.subtype === 'string' &&
        typeof item.country === 'string',
    )
  )
}

/**
 * Checks whether a value is a cached division record.
 * @param value - Value to validate
 * @returns True when the value matches the minimum cached division shape
 */
function isExtendedDivision(value: unknown): value is ExtendedDivision {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.subtype === 'string' &&
    typeof value.country === 'string'
  )
}

/**
 * Normalizes a cached division after validation so downstream code sees canonical bbox keys.
 * @param division - Cached division record
 * @returns Division with bbox normalized when present
 */
function normalizeCachedDivision(division: ExtendedDivision): ExtendedDivision {
  return normalizeDivisionBBox(division)
}

/**
 * Checks whether a value is a theme mapping cache payload.
 * @param value - Value to validate
 * @returns True when the value is a string-to-string mapping
 */
function isThemeMapping(value: unknown): value is ThemeMapping {
  return (
    isRecord(value) &&
    Object.values(value).every(mappingValue => typeof mappingValue === 'string')
  )
}

/**
 * Checks whether a value is release metadata cache payload.
 * @param value - Value to validate
 * @returns True when the value matches the minimum release data shape
 */
function isReleaseData(value: unknown): value is ReleaseData {
  return (
    isRecord(value) &&
    typeof value.lastUpdated === 'string' &&
    typeof value.lastChecked === 'string' &&
    typeof value.source === 'string' &&
    typeof value.latest === 'string' &&
    typeof value.totalReleases === 'number' &&
    Array.isArray(value.releases)
  )
}

/**
 * Checks whether a value is cached search results payload.
 * @param value - Value to validate
 * @returns True when the value matches the expected search cache shape
 */
function isCachedSearchResults(value: unknown): value is CachedSearchResults {
  return (
    isRecord(value) &&
    typeof value.createdAt === 'string' &&
    typeof value.version === 'string' &&
    typeof value.adminLevel === 'number' &&
    typeof value.term === 'string' &&
    typeof value.totalCount === 'number' &&
    isDivisionArray(value.results)
  )
}

/**
 * Reads a cache file and validates its payload before returning it.
 * @param cachePath - Full path to the cache file
 * @param validator - Type guard used to validate parsed JSON
 * @returns Parsed cache value or null when the cache entry is missing or invalid
 */
async function readValidatedCache<T>(
  cachePath: string,
  validator: (value: unknown) => value is T,
): Promise<T | null> {
  const parsed = await readJsonCache<unknown>(cachePath)
  return parsed && validator(parsed) ? parsed : null
}

/**
 * Converts a search term into a cache-safe filename segment.
 * @param term - Raw search term
 * @returns Sanitized lowercase filename segment without path separators
 */
function sanitizeSearchTerm(term: string): string {
  return term
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/[\s\p{C}]/gu, '_')
    .toLowerCase()
}

/**
 * Gets the cache directory for a release version.
 * @param version - Release version directory name
 * @returns Absolute cache directory for the version
 */
function getVersionCacheDir(version: string): string {
  return path.join(CACHE_DIR, version)
}

/**
 * Gets the cache directory for division records for a release version.
 * @param version - Release version directory name
 * @returns Absolute cache directory for versioned division records
 */
function getDivisionCacheDir(version: string): string {
  return path.join(getVersionCacheDir(version), 'division')
}

/**
 * Gets the cache path for a division record.
 * @param version - Release version directory name
 * @param divisionId - Division identifier for the cached record
 * @returns Absolute cache file path for the division JSON payload
 */
function getDivisionCachePath(version: string, divisionId: string): string {
  return path.join(getDivisionCacheDir(version), `${divisionId}.json`)
}

/**
 * Gets the cache directory for division area records.
 * @param version - Release version directory name
 * @param divisionId - Division identifier used as a nested cache directory
 * @returns Absolute cache directory for division area payloads
 */
function getDivisionAreaCacheDir(version: string, divisionId: string): string {
  return path.join(getDivisionCacheDir(version), 'area', divisionId)
}

/**
 * Gets the cache directory for division boundary records.
 * @param version - Release version directory name
 * @param divisionId - Division identifier used as a nested cache directory
 * @returns Absolute cache directory for division boundary payloads
 */
function getDivisionBoundaryCacheDir(version: string, divisionId: string): string {
  return path.join(getDivisionCacheDir(version), 'boundary', divisionId)
}

/**
 * Gets the cache path for the theme mapping payload for a release version.
 * @param version - Release version directory name
 * @returns Absolute cache file path for the theme mapping JSON payload
 */
function getThemeMappingCachePath(version: string): string {
  return path.join(getVersionCacheDir(version), 'theme_mapping.json')
}

/**
 * Gets the cache path for release metadata.
 * @returns Absolute cache file path for cached release metadata
 */
function getReleaseCachePath(): string {
  return path.join(CACHE_DIR, 'releases.json')
}

/**
 * Builds a cache path for versioned search results.
 * @param version - Release version for the cached search
 * @param adminLevel - Administrative level segment in the cache tree
 * @param term - Optional search term when targeting a specific cache file
 * @returns Versioned search cache directory or file path
 */
function getSearchCachePath(
  version: string,
  adminLevel?: number,
  term?: string,
): string {
  const searchDir = path.join(getVersionCacheDir(version), 'search')

  if (adminLevel === undefined) {
    return searchDir
  }

  const adminLevelDir = path.join(searchDir, adminLevel.toString())

  if (!term) {
    return adminLevelDir
  }

  return path.join(adminLevelDir, `${sanitizeSearchTerm(term)}.json`)
}

/**
 * Reads a cached search entry and attaches its originating cache path.
 * @param cachePath - Full path to the cached search JSON file
 * @returns Parsed search history item, or null when unavailable
 */
async function readSearchHistoryItem(
  cachePath: string,
): Promise<SearchHistoryItem | null> {
  return await readValidatedCacheWithPath<CachedSearchResults>(
    cachePath,
    isCachedSearchResults,
  )
}

/**
 * Writes a collection of JSON cache records into a shared directory.
 * @param cacheDir - Directory that will contain the JSON records
 * @param records - Records paired with cache filenames
 * @returns Promise that resolves when all records have been written
 */
async function writeJsonCacheRecords<T>(
  cacheDir: string,
  records: Array<{ filename: string; data: T }>,
): Promise<void> {
  await ensureDirectoryExists(cacheDir)

  for (const record of records) {
    await writeJsonCache(path.join(cacheDir, record.filename), record.data)
  }
}

/**
 * Reads a cache file, validates it, and annotates the payload with its source path.
 * @param cachePath - Full path to the cache file
 * @param validator - Type guard used to validate parsed JSON
 * @returns Parsed cache value with `cachePath`, or null when missing or invalid
 */
async function readValidatedCacheWithPath<T extends CacheRecord>(
  cachePath: string,
  validator: (value: unknown) => value is T,
): Promise<(T & { cachePath: string }) | null> {
  const parsed = await readValidatedCache<T>(cachePath, validator)
  return parsed ? { ...parsed, cachePath } : null
}

/**
 * DIVISION
 */

/**
 * Caches a division record for a specific version.
 * @param version - The release version
 * @param divisionId - The division ID
 * @param division - The division data to cache
 */
export async function cacheDivision(
  version: string,
  divisionId: string,
  division: Division,
): Promise<void> {
  const cachePath = getDivisionCachePath(version, divisionId)
  await writeJsonCache(cachePath, normalizeDivisionBBox(division))
}

/**
 * Caches multiple division records for a specific version.
 * @param releaseVersion - The release version
 * @param divisions - Division records to cache
 * @returns Promise that resolves when all divisions have been cached
 */
export async function cacheDivisions(
  releaseVersion: string,
  divisions: Division[],
): Promise<void> {
  const divisionCacheDir = getDivisionCacheDir(releaseVersion)
  await writeJsonCacheRecords(
    divisionCacheDir,
    divisions.map(division => ({
      filename: `${division.id}.json`,
      data: normalizeDivisionBBox(division),
    })),
  )
}

/**
 * Retrieves a cached division record for a specific version.
 * @param version - The release version
 * @param divisionId - The division ID
 * @returns Promise<ExtendedDivision | null> - The cached division or null if not found
 */
export async function getCachedDivision(
  version: Version,
  divisionId: GERS,
): Promise<ExtendedDivision | null> {
  const cachePath = getDivisionCachePath(version, divisionId)
  const division = await readValidatedCache<ExtendedDivision>(
    cachePath,
    isExtendedDivision,
  )
  return division ? normalizeCachedDivision(division) : null
}

/**
 * Caches division area geometries for a specific version.
 * @param version - The release version
 * @param divisionId - The division ID
 * @param areas - Array of division area records to cache
 */
export async function cacheDivisionAreas(
  version: string,
  divisionId: string,
  areas: DivisionArea[],
): Promise<void> {
  const cacheDir = getDivisionAreaCacheDir(version, divisionId)
  await writeJsonCacheRecords(
    cacheDir,
    areas.map(area => ({
      filename: `${area.id}.json`,
      data: area,
    })),
  )
}

/**
 * Caches division boundary geometries for a specific version.
 * @param version - The release version
 * @param divisionId - The division ID
 * @param boundaries - Array of division boundary records to cache
 */
export async function cacheDivisionBoundaries(
  version: string,
  divisionId: string,
  boundaries: DivisionBoundary[],
): Promise<void> {
  const cacheDir = getDivisionBoundaryCacheDir(version, divisionId)
  await writeJsonCacheRecords(
    cacheDir,
    boundaries.map(boundary => ({
      filename: `${boundary.id}.json`,
      data: boundary,
    })),
  )
}

/**
 * THEME MAPPING
 */

/**
 * Caches a theme mapping for a specific version.
 * @param version - The release version
 * @param themeMapping - The theme mapping to cache
 */
export async function cacheThemeMapping(
  version: string,
  themeMapping: ThemeMapping,
): Promise<void> {
  const cachePath = getThemeMappingCachePath(version)
  await writeJsonCache(cachePath, themeMapping)
}

/**
 * Retrieves a cached theme mapping for a specific version.
 * @param version - The release version
 * @returns Promise<ThemeMapping | null> - The cached theme mapping or null if not found
 */
export async function getCachedThemeMapping(
  version: string,
): Promise<ThemeMapping | null> {
  const cachePath = getThemeMappingCachePath(version)
  return await readValidatedCache<ThemeMapping>(cachePath, isThemeMapping)
}

/**
 * RELEASES
 */

/**
 * Caches release data.
 * @param releaseData - The release data to cache
 */
export async function cacheReleases(releaseData: ReleaseData): Promise<void> {
  const cachePath = getReleaseCachePath()
  await writeJsonCache(cachePath, sortReleaseDataForCache(releaseData))
}

/**
 * Retrieves cached release data.
 * @returns Promise<ReleaseData | null> - The cached release data or null if not found
 */
export async function getCachedReleases(): Promise<ReleaseData | null> {
  const cachePath = getReleaseCachePath()
  return await readValidatedCache<ReleaseData>(cachePath, isReleaseData)
}

/**
 * Sorts cached release metadata into a stable version order before serialization.
 * @param releaseData - Release metadata to normalize for cache storage
 * @returns Release data with `releases` sorted by version ascending
 * @remarks This assumes Overture version strings remain lexically sortable.
 */
export function sortReleaseDataForCache(releaseData: ReleaseData): ReleaseData {
  return {
    ...releaseData,
    releases: [...releaseData.releases].sort((a, b) =>
      a.version.localeCompare(b.version),
    ),
  }
}

/**
 * SEARCH RESULTS
 */

/**
 * Caches search results for a specific version, admin level, and term.
 * @param version - The release version
 * @param adminLevel - The administrative level (1-4)
 * @param term - The search term
 * @param searchResults - The search results to cache
 */
export async function cacheSearchResults(
  version: string,
  adminLevel: number,
  term: string,
  searchResults: { results: Division[]; totalCount: number },
): Promise<void> {
  const searchCacheDir = getSearchCachePath(version, adminLevel)
  const payload: CachedSearchResults = {
    createdAt: new Date().toISOString(),
    version,
    adminLevel,
    term,
    ...searchResults,
  }

  await writeJsonCacheRecords(searchCacheDir, [
    {
      filename: `${sanitizeSearchTerm(term)}.json`,
      data: payload,
    },
  ])
}

/**
 * Retrieves cached search results for a specific version, admin level, and term.
 * @param version - The release version
 * @param adminLevel - The administrative level (1-4)
 * @param term - The search term
 * @returns Promise with cached search data or null if not found
 */
export async function getCachedSearchResults(
  version: string,
  adminLevel: number,
  term: string,
): Promise<SearchHistoryItem | null> {
  const cachePath = getSearchCachePath(version, adminLevel, term)
  return await readValidatedCacheWithPath<CachedSearchResults>(
    cachePath,
    isCachedSearchResults,
  )
}

/**
 * Gets all cached search histories across all versions and admin levels.
 * @returns Promise<Array> of search history entries sorted by createdAt (newest first)
 */
export async function getSearchHistory(): Promise<SearchHistory> {
  const histories: SearchHistory = []

  /**
   * Collects cached search entries for a single release version.
   * @param version - Release version directory to inspect
   * @returns Promise that resolves when the version directory has been processed
   */
  async function processVersionSearchDir(version: string) {
    const adminLevelDirs = await readDirectoryEntries(getSearchCachePath(version))

    for (const adminLevelDir of adminLevelDirs) {
      if (!adminLevelDir.isDirectory) continue

      const adminLevel = parseInt(adminLevelDir.name, 10)
      if (Number.isNaN(adminLevel)) continue

      const adminLevelPath = getSearchCachePath(version, adminLevel)
      const searchFiles = await readDirectoryEntries(adminLevelPath)

      for (const searchFile of searchFiles) {
        if (searchFile.isDirectory || !searchFile.name.endsWith('.json')) continue

        const searchFilePath = path.join(adminLevelPath, searchFile.name)

        // Rehydrate cache entries with the source path so the UI can inspect or reuse them.
        const historyItem = await readSearchHistoryItem(searchFilePath)
        if (historyItem) {
          histories.push(historyItem)
        }
      }
    }
  }
  const versionDirs = await readDirectoryEntries(CACHE_DIR)

  await Promise.all(
    versionDirs
      .filter(dir => dir.isDirectory)
      .map(dir => processVersionSearchDir(dir.name)),
  )

  return histories.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )
}

/**
 * Checks if there are any cached search results in the search cache directory.
 * @returns Promise resolving to true if there are cached searches, false otherwise
 */
export async function hasCachedSearches(): Promise<boolean> {
  const entries = await readDirectoryEntries(CACHE_DIR)

  // Walk versioned search directories until the first cached JSON file is found.
  for (const entry of entries) {
    if (!entry.isDirectory) {
      continue
    }

    const searchEntries = await readDirectoryEntries(getSearchCachePath(entry.name))
    for (const searchEntry of searchEntries) {
      if (!searchEntry.isDirectory) {
        continue
      }

      const adminLevel = parseInt(searchEntry.name, 10)
      if (Number.isNaN(adminLevel)) {
        continue
      }

      const adminPath = getSearchCachePath(entry.name, adminLevel)
      if (await directoryHasJsonFiles(adminPath)) {
        return true
      }
    }
  }

  return false
}

/**
 * HELPER :: PATH
 */

/**
 * Gets all available cached versions.
 * @returns Promise<string[]> - Array of version strings that have cache data
 */
export async function getVersionsInCache(): Promise<string[]> {
  const entries = await readDirectoryEntries(CACHE_DIR)
  return entries
    .filter(entry => entry.isDirectory)
    .map(entry => entry.name)
    .sort()
    .reverse() // Most recent first
}
