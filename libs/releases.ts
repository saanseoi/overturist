import { log, spinner } from "@clack/prompts";
import kleur from "kleur";
import { cacheReleases, getCachedReleases } from "./cache";
import { ADMIN_LEVELS_BY_VERSION } from "./constants";
import { getS3Releases } from "./s3";
import type { InitialConfig, OvertureRelease, ReleaseContext, ReleaseData, ThemeMapping, Version } from "./types";
import { bail, bailFromSpinner, successExit } from "./utils";
import { scrapeReleaseCalendar } from "./web";

/**
 * Initializes release version by fetching latest versions and determining which version to use.
 * @param config - Initial configuration object
 * @param specifiedReleaseVersion - Optional specific release version to use
 * @returns Promise resolving to object with releaseData and selected releaseVersion
 */
export async function initializeReleaseVersion(
    config: InitialConfig,
    specifiedReleaseVersion?: Version,
): Promise<{
    releaseData: ReleaseData;
    releaseVersion: Version;
}> {
    const s = spinner();
    s.start("Fetching Versions");
    const releaseData = await fetchLatestVersions(config);

    let releaseVersion: Version;

    if (specifiedReleaseVersion) {
        // Use the specified release version
        releaseVersion = specifiedReleaseVersion;
    } else if (!releaseData) {
        bailFromSpinner(s, "Could not determine the latest release");
    } else {
        // Use historic or latest mode selection
        releaseVersion = releaseData.latest;
    }

    s.stop(`Using ${specifiedReleaseVersion ? "specified" : "latest"} release: ${kleur.cyan(releaseVersion)}`);

    return { releaseData, releaseVersion };
}

/**
 * Gets the release context for a specific version.
 * @param data - ReleaseData containing releases information
 * @param version - Version string to find the context for
 * @returns ReleaseContext object for the specified version or null if not found
 */
export function getReleaseContext(data: ReleaseData, version: Version): ReleaseContext | null {
    const release = findRelease(data, version);
    if (!release) {
        return null;
    }

    const contexts = buildReleaseContexts(data);
    return contexts.find((context) => context.version === version) ?? null;
}

/**
 * ADMIN LEVELS
 */

/**
 * Returns the admin levels configuration for a specific version.
 * If no version is defined as a key, we assume the ADMIN_LEVELS mapping hasn't changed in that version.
 * @param version - The Overture Maps release version
 * @returns Admin levels configuration object
 */
export function getAdminLevels(
    version: string,
): (typeof ADMIN_LEVELS_BY_VERSION)[keyof typeof ADMIN_LEVELS_BY_VERSION] {
    // Return the specific version if it exists
    if (version in ADMIN_LEVELS_BY_VERSION) {
        return ADMIN_LEVELS_BY_VERSION[version as keyof typeof ADMIN_LEVELS_BY_VERSION];
    }

    // Sort versions and find the first version where provided version is NOT less than the key
    const sortedVersions = Object.keys(ADMIN_LEVELS_BY_VERSION).sort();

    for (const availableVersion of sortedVersions) {
        if (version >= availableVersion) {
            return ADMIN_LEVELS_BY_VERSION[availableVersion as keyof typeof ADMIN_LEVELS_BY_VERSION];
        }
    }

    // If provided version is older than all available versions, return the oldest
    return ADMIN_LEVELS_BY_VERSION[sortedVersions[0] as keyof typeof ADMIN_LEVELS_BY_VERSION];
}

/**
 * UTILS
 */

/**
 * Fetches the latest release versions and persists it by merging S3 data with releases published on the blog.
 * @param config - Configuration object containing output directory, release file name, and release URL
 * @returns Promise resolving to ReleaseData containing merged releases information
 */
async function fetchLatestVersions(config: InitialConfig): Promise<ReleaseData> {
    const existingData = await loadExistingReleases();

    try {
        const { latest: latestS3Release, s3Releases } = await getS3Releases();

        if (!s3Releases.length) {
            log.warning("No releases found on S3.");
            successExit();
        }

        let webReleases: OvertureRelease[] = [];
        try {
            webReleases = await scrapeReleaseCalendar(config);
        } catch (webError) {
            log.warning(`Web scraping failed: ${(webError as Error).message}. Using S3 data as fallback.`);
        }

        const { releases, isUpdated } = mergeReleases(existingData.releases ?? [], s3Releases, webReleases);

        const data = mergeReleaseInfo(isUpdated, releases, existingData, latestS3Release, config.releaseUrl);

        await cacheReleases(data);

        return data;
    } catch (error) {
        bail(`Error updating releases: ${(error as Error).message}`);
    }
}
/**
 * Loads existing releases data from cache if available, falls back to disk.
 * @param config - Configuration object containing output directory and release file name
 * @returns Promise resolving to Partial<ReleaseData> with existing releases or empty data
 */
async function loadExistingReleases(): Promise<Partial<ReleaseData>> {
    // Load from cache only
    const cachedReleases = await getCachedReleases();
    return cachedReleases ?? createEmptyData();
}

/**
 * Creates an empty ReleaseData object with default values.
 * @returns ReleaseData object with empty releases array and default metadata
 */
function createEmptyData(): ReleaseData {
    return {
        lastUpdated: new Date().toISOString(),
        lastChecked: new Date().toISOString(),
        source: "Unknown",
        latest: "Unknown",
        totalReleases: 0,
        releases: [],
    };
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
    const availableVersions = new Set(s3Releases);
    const merged = new Map<Version, OvertureRelease>();
    let isUpdated = false;

    // Initialize merged map with existing releases, update availability
    for (const release of existing) {
        const validatedRelease = ensureAvailability(release, availableVersions);
        // Either it has become available, or it has been removed
        if (release.isAvailableOnS3 !== validatedRelease.isAvailableOnS3) {
            isUpdated = true;
        }
        merged.set(release.version, validatedRelease);
    }

    for (const release of webReleases) {
        if (
            !merged.has(release.version) ||
            merged.get(release.version)?.schema === "Unknown" ||
            merged.get(release.version)?.versionReleaseUrl === undefined ||
            merged.get(release.version)?.schemaReleaseUrl === undefined
        ) {
            // Upcoming releases are published on the web first, merge them in, or if the schema was previously unknown, update it
            merged.set(release.version, ensureAvailability(release, availableVersions));
            isUpdated = true;
        } else if (merged.get(release.version)?.date !== release.date) {
            merged.set(release.version, ensureAvailability(release, availableVersions));
            isUpdated = true;
        }
    }

    // In the unlikely event that a release is only available on S3, merge it in
    for (const version of s3Releases) {
        if (!merged.has(version)) {
            const releaseData: OvertureRelease = {
                date: version.split(".")[0] || "Unknown",
                version,
                schema: "Unknown",
                isReleased: true,
                isAvailableOnS3: true,
            };
            merged.set(version, releaseData);
            isUpdated = true;
        }
    }

    return {
        isUpdated,
        releases: Array.from(merged.values()),
    };
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
    return {
        lastUpdated: isUpdated ? new Date().toISOString() : (existing.lastUpdated ?? new Date().toISOString()),
        lastChecked: new Date().toISOString(),
        source,
        latest: latestS3Release ?? getLatestRelease(releases),
        totalReleases: releases.length,
        releases,
    };
}

/**
 * Updates a release object with availability flags based on available versions.
 * @param release - OvertureRelease object to update
 * @param availableVersions - Set of available version strings
 * @returns Updated OvertureRelease object with correct availability flags
 */
function ensureAvailability(release: OvertureRelease, availableVersions: Set<Version>): OvertureRelease {
    return {
        ...release,
        isReleased: availableVersions.has(release.version),
        isAvailableOnS3: availableVersions.has(release.version),
    };
}

/**
 * Builds an array of release contexts from release data, ordered by date descending.
 * @param data - ReleaseData containing releases information
 * @returns Array of ReleaseContext objects with additional metadata like schema changes
 */
function buildReleaseContexts(data: ReleaseData): ReleaseContext[] {
    const sorted = [...data.releases].sort(sortByVersion);

    return sorted.map((release, index) => {
        const previousRelease = sorted[index + 1];
        const isNewSchema =
            previousRelease != null &&
            previousRelease.schema !== release.schema &&
            previousRelease.schema !== "Unknown" &&
            release.schema !== "Unknown";

        return {
            version: release.version,
            schema: release.schema,
            date: release.date,
            isNewSchema,
            isLatest: data.latest === release.version,
            previousVersion: previousRelease?.version,
            previousSchema: previousRelease?.schema,
        };
    });
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
function findRelease(data: ReleaseData, version: Version | null | undefined): OvertureRelease | null {
    if (!version) {
        return null;
    }
    return data.releases.find((release) => release.version === version) ?? null;
}

/**
 * Gets the latest released version from an array of releases.
 * @param releases - Array of OvertureRelease objects to search through
 * @returns Version string of the latest released version or "Unknown" if no releases found
 */
function getLatestRelease(releases: OvertureRelease[]): Version {
    const latestReleaseVersion = releases
        .filter((release) => release.isReleased)
        .sort(sortByVersion)
        .pop()?.version;
    return latestReleaseVersion ?? "Unknown";
}

/**
 * HELPERS :: SORTING
 */

/**
 * Sorts releases by date in descending order.
 * @param releases - Array of OvertureRelease objects to sort
 * @returns New array sorted by date descending (newest first)
 */

/**
 * Sorts two releases by version in descending order.
 * @param a - First OvertureRelease object
 * @param b - Second OvertureRelease object
 * @returns Number indicating sort order (negative if b > a, positive if a > b)
 */
function sortByVersion(a: OvertureRelease, b: OvertureRelease): number {
    return b.version.localeCompare(a.version);
}
