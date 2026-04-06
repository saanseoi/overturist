import { log, spinner } from '@clack/prompts'
import kleur from 'kleur'
import { cacheReleases, getCachedReleases } from './cache'
import { ADMIN_LEVELS_BY_VERSION } from './constants'
import { getS3Releases } from './s3'
import type {
  CliArgs,
  Config,
  InteractiveOptions,
  OvertureRelease,
  ReleaseContext,
  ReleaseData,
  Version,
} from './types'
import { selectReleaseVersion } from './ui'
import { bail, bailFromSpinner, successExit } from './utils'
import { scrapeReleaseCalendar } from './web'

/**
 * Initializes release version by fetching latest versions and determining which version to use.
 * @param config - Initial configuration object
 * @param cliArgs - Command line arguments
 * @param interactiveOpts - Interactive options (undefined = use defaults, false = non-interactive)
 * @returns Promise resolving to object with releaseData and selected releaseVersion
 * @remarks Version precedence is CLI, then environment, then interactive selection, then latest S3 release.
 */
export async function initializeReleaseVersion(
  config: Config,
  cliArgs: CliArgs,
  interactiveOpts?: InteractiveOptions | false,
): Promise<{
  releaseVersion: Version
  releaseData: ReleaseData
  releaseContext: ReleaseContext
}> {
  const s = spinner()
  s.start('Resolving versions')

  const releaseData = await fetchLatestVersions(config)

  // Count the number of releases available on S3
  const availableOnS3Count = releaseData.releases.filter(
    release => release.isAvailableOnS3,
  ).length
  s.stop(
    `Found ${kleur.green(releaseData.releases.length)} releases (${kleur.green(availableOnS3Count)} available on S3)`,
  )

  let releaseVersion: Version
  let versionSource: string

  // Determine version based on precedence: CLI args > config > interactive > latest
  if (cliArgs.releaseVersion) {
    // CLI args take precedence
    releaseVersion = cliArgs.releaseVersion
    versionSource = 'CLI'
  } else if (config.releaseVersion) {
    // Config takes precedence over interactive
    releaseVersion = config.releaseVersion
    versionSource = 'Env'
  } else if (interactiveOpts === false || interactiveOpts === undefined) {
    // Non-interactive or default mode: use latest
    releaseVersion = releaseData.latest
    versionSource = 'latest'
  } else if (interactiveOpts.releaseVersion === null) {
    // Interactive mode: user needs to select from S3-available releases
    releaseVersion = await selectReleaseVersion(releaseData)
    versionSource = 'selected'
  } else if (interactiveOpts.releaseVersion) {
    // Interactive mode has a pre-selected version -- should never happen
    releaseVersion = interactiveOpts.releaseVersion
    versionSource = 'selected'
  } else {
    // Default to latest
    releaseVersion = releaseData.latest
    versionSource = 'latest'
  }

  // Validate that the selected version is available on S3
  const selectedRelease = findRelease(releaseData, releaseVersion)
  if (!selectedRelease?.isAvailableOnS3) {
    const availableVersions = releaseData.releases
      .filter(release => release.isAvailableOnS3)
      .map(release => kleur.green(release.version))
      .slice(0, 10)
      .join(', ')
    bailFromSpinner(
      s,
      'Selected version not available',
      `Version "${kleur.red(releaseVersion)}" is not available on S3. Available versions: ${availableVersions}${availableOnS3Count > 10 ? '...' : ''}`,
    )
  }

  if (versionSource !== 'selected') {
    log.message(
      `Using release: ${kleur.cyan(releaseVersion)} ${kleur.gray(versionSource)}`,
    )
  }

  const releaseContext = getReleaseContext(releaseData, releaseVersion)

  if (!releaseContext) {
    bail('Could not determine release context')
  }

  return { releaseVersion, releaseData, releaseContext }
}

/**
 * Gets the release context for a specific version.
 * @param data - ReleaseData containing releases information
 * @param version - Version string to find the context for
 * @returns ReleaseContext object for the specified version or null if not found
 */
export function getReleaseContext(
  data: ReleaseData,
  version: Version,
): ReleaseContext | null {
  return buildReleaseContexts(data).find(context => context.version === version) ?? null
}

/**
 * ADMIN LEVELS
 */

/**
 * Returns the admin levels configuration for a specific version.
 * If no version is defined as a key, we assume the ADMIN_LEVELS mapping hasn't changed in that version.
 * @param version - The Overture Maps release version
 * @returns Admin levels configuration object
 * @remarks This falls back to the most recent mapping not newer than the requested version.
 */
export function getAdminLevels(
  version: Version,
): (typeof ADMIN_LEVELS_BY_VERSION)[keyof typeof ADMIN_LEVELS_BY_VERSION] {
  // Return the specific version if it exists
  if (version in ADMIN_LEVELS_BY_VERSION) {
    return ADMIN_LEVELS_BY_VERSION[version as keyof typeof ADMIN_LEVELS_BY_VERSION]
  }

  const sortedVersions = getSortedAdminLevelVersions()

  for (const availableVersion of sortedVersions) {
    if (version >= availableVersion) {
      return ADMIN_LEVELS_BY_VERSION[
        availableVersion as keyof typeof ADMIN_LEVELS_BY_VERSION
      ]
    }
  }

  // If provided version is older than all available versions, return the oldest
  return ADMIN_LEVELS_BY_VERSION[
    sortedVersions[sortedVersions.length - 1] as keyof typeof ADMIN_LEVELS_BY_VERSION
  ]
}

/**
 * UTILS
 */

/**
 * Fetches the latest release versions and persists it by merging S3 data with releases published on the blog.
 * @param config - Configuration object containing output directory, release file name, and release URL
 * @returns Promise resolving to ReleaseData containing merged releases information
 */
async function fetchLatestVersions(config: Config): Promise<ReleaseData> {
  const existingData = await loadExistingReleases()

  try {
    const { latest: latestS3Release, s3Releases } = await getS3Releases()

    if (!s3Releases.length) {
      log.warning('No releases found on S3.')
      successExit()
    }

    // Only scrape the release calendar if S3 has a newer version than we've cached
    let webReleases: OvertureRelease[] = []
    const shouldScrape = latestS3Release && existingData.latest !== latestS3Release

    if (shouldScrape) {
      try {
        webReleases = await scrapeReleaseCalendar(config)
      } catch (webError) {
        log.warning(
          `Web scraping failed: ${(webError as Error).message}. Using S3 data as fallback.`,
        )
      }
    }

    const { releases, isUpdated } = mergeReleases(
      existingData.releases ?? [],
      s3Releases,
      webReleases,
    )

    const data = mergeReleaseInfo(
      isUpdated,
      releases,
      existingData,
      latestS3Release,
      config.releaseUrl,
    )

    await cacheReleases(data)

    return data
  } catch (error) {
    bail(`Error updating releases: ${(error as Error).message}`)
  }
}

/**
 * Loads existing releases data from cache if available.
 * @returns Promise resolving to Partial<ReleaseData> with existing releases or empty data
 */
async function loadExistingReleases(): Promise<Partial<ReleaseData>> {
  // Load from cache only
  const cachedReleases = await getCachedReleases()
  return cachedReleases ?? createEmptyData()
}

/**
 * Creates an empty ReleaseData object with default values.
 * @returns ReleaseData object with empty releases array and default metadata
 */
function createEmptyData(): ReleaseData {
  return {
    lastUpdated: new Date().toISOString(),
    lastChecked: new Date().toISOString(),
    source: 'Unknown',
    latest: 'Unknown',
    totalReleases: 0,
    releases: [],
  }
}

/**
 * Gets the preceding S3-available release version.
 * @param releaseVersion - Current release version
 * @param releaseData - Release data containing all releases
 * @returns Previous release version or null if not available
 * @remarks Unreleased blog-only entries are ignored because downstream schema comparisons
 * depend on release contents that are already available on S3.
 */
export function getPrecedingReleaseVersion(
  releaseVersion: Version,
  releaseData: ReleaseData,
): Version | null {
  const s3AvailableReleases = getSortedS3AvailableReleases(releaseData.releases)
  const currentReleaseIndex = s3AvailableReleases.findIndex(
    release => release.version === releaseVersion,
  )

  if (
    currentReleaseIndex === -1 ||
    currentReleaseIndex === s3AvailableReleases.length - 1
  ) {
    return null
  }

  const previousRelease = s3AvailableReleases[currentReleaseIndex + 1]
  return previousRelease.version
}

/**
 * HELPERS :: PROCESSING
 */

/**
 * Merges existing, S3, and web releases into a unified array with deduplication.
 * @param existing - Array of existing OvertureRelease objects from cache
 * @param s3Releases - Array of version strings available on S3
 * @param webReleases - Array of OvertureRelease objects from web scraping
 * @returns Object containing merged releases array and update status flag
 */
function mergeReleases(
  existing: OvertureRelease[],
  s3Releases: Version[],
  webReleases: OvertureRelease[],
): { releases: OvertureRelease[]; isUpdated: boolean } {
  const availableVersions = new Set(s3Releases)
  const merged = new Map<Version, OvertureRelease>()
  let isUpdated = false

  // Initialize merged map with existing releases, update availability
  for (const release of existing) {
    const validatedRelease = ensureAvailability(release, availableVersions)
    // Either it has become available, or it has been removed
    if (release.isAvailableOnS3 !== validatedRelease.isAvailableOnS3) {
      isUpdated = true
    }
    merged.set(release.version, validatedRelease)
  }

  for (const release of webReleases) {
    if (
      !merged.has(release.version) ||
      merged.get(release.version)?.schema === 'Unknown' ||
      merged.get(release.version)?.versionReleaseUrl === undefined ||
      merged.get(release.version)?.schemaReleaseUrl === undefined
    ) {
      // Upcoming releases are published on the web first, merge them in, or if the schema was previously unknown, update it
      merged.set(release.version, ensureAvailability(release, availableVersions))
      isUpdated = true
    } else if (merged.get(release.version)?.date !== release.date) {
      merged.set(release.version, ensureAvailability(release, availableVersions))
      isUpdated = true
    }
  }

  // In the unlikely event that a release is only available on S3, merge it in
  for (const version of s3Releases) {
    if (!merged.has(version)) {
      const releaseData: OvertureRelease = {
        date: version.split('.')[0] || 'Unknown',
        version,
        schema: 'Unknown',
        isReleased: true,
        isAvailableOnS3: true,
      }
      merged.set(version, releaseData)
      isUpdated = true
    }
  }

  return {
    isUpdated,
    releases: Array.from(merged.values()).sort(sortByVersion),
  }
}

/**
 * Merges release information into a complete ReleaseData object.
 * @param isUpdated - Boolean indicating if any field was updated
 * @param releases - Array of merged OvertureRelease objects
 * @param existing - Existing ReleaseData to merge with
 * @param latestS3Release - Latest release version from S3 or null
 * @param source - Source string indicating where releases came from
 * @returns Complete ReleaseData object with merged information
 */
function mergeReleaseInfo(
  isUpdated: boolean,
  releases: OvertureRelease[],
  existing: Partial<ReleaseData>,
  latestS3Release: Version | null,
  source: string,
): ReleaseData {
  const now = new Date().toISOString()

  return {
    lastUpdated: isUpdated ? now : (existing.lastUpdated ?? now),
    lastChecked: now,
    source,
    latest: latestS3Release ?? getLatestRelease(releases),
    totalReleases: releases.length,
    releases,
  }
}

/**
 * Updates a release object with availability flags based on available versions.
 * @param release - OvertureRelease object to update
 * @param availableVersions - Set of available version strings
 * @returns Updated OvertureRelease object with correct availability flags
 */
function ensureAvailability(
  release: OvertureRelease,
  availableVersions: Set<Version>,
): OvertureRelease {
  return {
    ...release,
    isReleased: availableVersions.has(release.version),
    isAvailableOnS3: availableVersions.has(release.version),
  }
}

/**
 * Builds an array of release contexts from release data, ordered by date descending.
 * @param data - ReleaseData containing releases information
 * @returns Array of ReleaseContext objects with additional metadata like schema changes
 */
function buildReleaseContexts(data: ReleaseData): ReleaseContext[] {
  const sorted = [...data.releases].sort(sortByVersion)

  return sorted.map((release, index) => {
    const previousRelease = sorted[index + 1]
    // A schema change only becomes meaningful once both adjacent releases have known schemas.
    const isNewSchema =
      previousRelease != null &&
      previousRelease.schema !== release.schema &&
      previousRelease.schema !== 'Unknown' &&
      release.schema !== 'Unknown'

    return {
      version: release.version,
      schema: release.schema,
      date: release.date,
      isNewSchema,
      isLatest: data.latest === release.version,
      previousVersion: previousRelease?.version,
      previousSchema: previousRelease?.schema,
    }
  })
}

/**
 * HELPERS :: LOOKUPS
 */

/**
 * Finds a specific release by version in the releases data.
 * @param data - ReleaseData object containing releases array
 * @param version - Version string to find, or null/undefined
 * @returns OvertureRelease object if found, null otherwise
 */
function findRelease(
  data: ReleaseData,
  version: Version | null | undefined,
): OvertureRelease | null {
  if (!version) {
    return null
  }
  return data.releases.find(release => release.version === version) ?? null
}

/**
 * Gets the latest released version from an array of releases.
 * @param releases - Array of OvertureRelease objects to search through
 * @returns Version string of the latest released version or "Unknown" if no releases found
 */
function getLatestRelease(releases: OvertureRelease[]): Version {
  const latestReleaseVersion = getSortedS3AvailableReleases(releases)[0]?.version
  return latestReleaseVersion ?? 'Unknown'
}

/**
 * HELPERS :: SORTING
 */

/**
 * Sorts two releases by version in descending order.
 * @param a - First OvertureRelease object
 * @param b - Second OvertureRelease object
 * @returns Number indicating sort order (negative if b > a, positive if a > b)
 */
function sortByVersion(a: OvertureRelease, b: OvertureRelease): number {
  return b.version.localeCompare(a.version)
}

/**
 * Returns admin-level mapping versions in descending order.
 * @returns Sorted admin-level mapping version keys, newest first
 */
function getSortedAdminLevelVersions(): Version[] {
  return Object.keys(ADMIN_LEVELS_BY_VERSION).sort().reverse()
}

/**
 * Returns S3-available releases sorted by version descending.
 * @param releases - Release entries to filter and sort
 * @returns S3-available releases ordered from newest to oldest
 */
function getSortedS3AvailableReleases(releases: OvertureRelease[]): OvertureRelease[] {
  return releases.filter(release => release.isAvailableOnS3).sort(sortByVersion)
}
