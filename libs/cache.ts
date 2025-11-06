import {
    directoryHasJsonFiles,
    ensureDirectoryExists,
    ensureVersionedCacheDir,
    readDirectoryEntries,
    readJsonFile,
    writeJsonFile,
} from "./fs";
import type { Division, ReleaseData, SearchHistory, SearchHistoryItem, ThemeMapping } from "./types";

const CACHE_DIR = process.cwd() + "/.cache";

/**
 * HELPER :: PATH
 */

/**
 * Constructs cache paths dynamically based on provided parameters.
 * @param params - Object containing path parameters
 * @returns Constructed cache path string
 */
function constructCachePath(params: {
    version?: string;
    type?: "division" | "theme" | "release" | "search";
    adminLevel?: number;
    divisionId?: string;
    term?: string;
    filename?: string;
}): string {
    const parts = [CACHE_DIR];

    if (params.version) {
        parts.push(params.version);
    }

    if (params.type === "division") {
        parts.push("division");
        if (params.divisionId) {
            parts.push(`${params.divisionId}.json`);
        }
    } else if (params.type === "theme") {
        if (params.filename) {
            parts.push(params.filename);
        } else {
            parts.push("theme_mapping.json");
        }
    } else if (params.type === "release") {
        if (params.filename) {
            parts.push(params.filename);
        } else {
            parts.push("releases.json");
        }
    } else if (params.type === "search") {
        parts.push("search");
        if (params.adminLevel !== undefined) {
            parts.push(params.adminLevel.toString());
            if (params.term) {
                // Sanitize term for filename (remove filesystem-problematic characters)
                const sanitizedTerm = params.term
                    .replace(/[<>:"/\\|?*]/g, "_")
                    .replace(/[\s\p{C}]/gu, "_")
                    .toLowerCase();
                parts.push(`${sanitizedTerm}.json`);
            }
        }
    }

    return parts.join("/");
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
export async function cacheDivision(version: string, divisionId: string, division: Division): Promise<void> {
    await ensureVersionedCacheDir(version, "division");
    const cachePath = constructCachePath({ version, type: "division", divisionId });
    await writeJsonFile(cachePath, division);
}

/**
 * Retrieves a cached division record for a specific version.
 * @param version - The release version
 * @param divisionId - The division ID
 * @returns Promise<Division | null> - The cached division or null if not found
 */
export async function getCachedDivision(version: string, divisionId: string): Promise<Division | null> {
    const cachePath = constructCachePath({ version, type: "division", divisionId });
    return await readJsonFile<Division>(cachePath);
}

/**
 * THEME MAPPING
 */

/**
 * Caches a theme mapping for a specific version.
 * @param version - The release version
 * @param themeMapping - The theme mapping to cache
 */
export async function cacheThemeMapping(version: string, themeMapping: ThemeMapping): Promise<void> {
    await ensureVersionedCacheDir(version);
    const cachePath = constructCachePath({ version, type: "theme" });
    await writeJsonFile(cachePath, themeMapping);
}

/**
 * Retrieves a cached theme mapping for a specific version.
 * @param version - The release version
 * @returns Promise<ThemeMapping | null> - The cached theme mapping or null if not found
 */
export async function getCachedThemeMapping(version: string): Promise<ThemeMapping | null> {
    const cachePath = constructCachePath({ version, type: "theme" });
    return await readJsonFile<ThemeMapping>(cachePath);
}

/**
 * RELEASES
 */

/**
 * Caches release data.
 * @param releaseData - The release data to cache
 */
export async function cacheReleases(releaseData: ReleaseData): Promise<void> {
    await ensureDirectoryExists(CACHE_DIR);
    const cachePath = constructCachePath({ type: "release" });
    await writeJsonFile(cachePath, releaseData);
}

/**
 * Retrieves cached release data.
 * @returns Promise<ReleaseData | null> - The cached release data or null if not found
 */
export async function getCachedReleases(): Promise<ReleaseData | null> {
    const cachePath = constructCachePath({ type: "release" });
    return await readJsonFile<ReleaseData>(cachePath);
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
    const searchCacheDir = constructCachePath({ version, type: "search", adminLevel });
    await ensureDirectoryExists(searchCacheDir);

    await writeJsonFile(
        constructCachePath({
            version,
            type: "search",
            adminLevel,
            term,
        }),
        {
            createdAt: new Date().toISOString(),
            version,
            adminLevel,
            term,
            ...searchResults,
        },
    );
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
    return readJsonFile(
        constructCachePath({
            version,
            type: "search",
            adminLevel,
            term,
        }),
    );
}

/**
 * Gets all cached search histories across all versions and admin levels.
 * @returns Promise<Array> of search history entries sorted by createdAt (newest first)
 */
export async function getSearchHistory(): Promise<SearchHistory> {
    const histories: SearchHistory = [];

    async function processVersionSearchDir(version: string) {
        const searchPath = constructCachePath({ version, type: "search" });

        try {
            const adminLevelDirs = await readDirectoryEntries(searchPath);

            for (const adminLevelDir of adminLevelDirs) {
                if (!adminLevelDir.isDirectory) continue;

                const adminLevel = parseInt(adminLevelDir.name);
                if (isNaN(adminLevel)) continue;

                const adminLevelPath = constructCachePath({
                    version,
                    type: "search",
                    adminLevel,
                });
                const searchFiles = await readDirectoryEntries(adminLevelPath);

                for (const searchFile of searchFiles) {
                    if (searchFile.isDirectory || !searchFile.name.endsWith(".json")) continue;

                    const searchFilePath = `${adminLevelPath}/${searchFile.name}`;
                    const parsed = (await readJsonFile(searchFilePath)) as SearchHistoryItem;

                    if (parsed) {
                        histories.push({
                            createdAt: parsed.createdAt,
                            version: parsed.version,
                            adminLevel: parsed.adminLevel,
                            term: parsed.term,
                            totalCount: parsed.totalCount,
                            results: parsed.results,
                            cachePath: searchFilePath,
                        });
                    }
                }
            }
        } catch {
            // Search directory doesn't exist for this version
            return;
        }
    }

    try {
        const versionDirs = await readDirectoryEntries(CACHE_DIR);

        await Promise.all(versionDirs.filter((dir) => dir.isDirectory).map((dir) => processVersionSearchDir(dir.name)));
    } catch {
        // Cache directory doesn't exist or can't be read
    }

    return histories.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

/**
 * Checks if there are any cached search results in the search cache directory.
 * @returns Promise resolving to true if there are cached searches, false otherwise
 */
export async function hasCachedSearches(): Promise<boolean> {
    try {
        const entries = await readDirectoryEntries(CACHE_DIR);

        // Check if there are any version directories with search subdirectories
        for (const entry of entries) {
            if (entry.isDirectory) {
                const searchPath = constructCachePath({ version: entry.name, type: "search" });

                // Check if search subdirectory exists and has admin level directories with JSON files
                try {
                    const searchEntries = await readDirectoryEntries(searchPath);
                    for (const searchEntry of searchEntries) {
                        if (searchEntry.isDirectory) {
                            const adminPath = constructCachePath({
                                version: entry.name,
                                type: "search",
                                adminLevel: parseInt(searchEntry.name),
                            });
                            if (await directoryHasJsonFiles(adminPath)) {
                                return true;
                            }
                        }
                    }
                } catch {}
            }
        }

        return false;
    } catch {
        // Cache directory doesn't exist or can't be accessed
        return false;
    }
}

/**
 * HELPER :: PATH
 */

/**
 * Gets all available cached versions.
 * @returns Promise<string[]> - Array of version strings that have cache data
 */
export async function getVersionsInCache(): Promise<string[]> {
    try {
        const entries = await readDirectoryEntries(CACHE_DIR);
        return entries
            .filter((entry) => entry.isDirectory)
            .map((entry) => entry.name)
            .sort()
            .reverse(); // Most recent first
    } catch {
        return [];
    }
}
