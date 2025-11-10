import { log, spinner } from "@clack/prompts";
import kleur from "kleur";
import { cacheThemeMapping, getCachedThemeMapping, getVersionsInCache } from "./cache";
import { handleThemeAction } from "./interactive";
import { getFeatureTypesForVersion } from "./s3";
import type { ReleaseData, ThemeMapping, Version } from "./types";
import { bailFromSpinner } from "./utils";
import { validateThemeMappingAgainstS3, validateThemesAndTypes } from "./validation";

/**
 * Initializes theme mapping for a given release version with comprehensive validation and fallback logic.
 * @param version - The target release version
 * @param releaseData - Release data for fallback theme mapping creation
 * @param selectedThemes - Optional array of themes to filter by
 * @param selectedTypes - Optional array of feature types to filter by
 * @returns Promise resolving to initialized and validated theme mapping
 */
export async function initializeThemeMapping(
    version: Version,
    releaseData: ReleaseData,
    selectedThemes?: string[],
    selectedTypes?: string[],
): Promise<{
    themeMapping: ThemeMapping;
    featureTypes: string[];
}> {
    // Load existing theme mapping or create if it doesn't exist
    const themeMapping = await loadOrCreateThemeMapping(version, releaseData);

    // Validate and apply filters if provided
    return await ensureValidThemeMapping(version, themeMapping, selectedThemes, selectedTypes);
}

/**
 * Updates the theme mapping file to reflect S3 availability.
 * @param s3FeatureTypes - Feature types available on S3
 * @param version - Release version to cache the theme mapping for
 * @returns Promise that resolves when the mapping has been updated
 */
export async function updateThemeMappingFromS3(
    s3FeatureTypes: { [theme: string]: string[] },
    version: string,
): Promise<ThemeMapping> {
    try {
        // Create new mapping based on S3
        const newThemeMapping: ThemeMapping = {};

        // For each theme and its types, add to mapping
        for (const theme of Object.keys(s3FeatureTypes)) {
            for (const type of s3FeatureTypes[theme]) {
                // Use the theme name as the display name
                newThemeMapping[type] = theme;
            }
        }

        // Sort the theme mapping keys alphabetically before saving
        const sortedThemeMapping: ThemeMapping = {};
        const sortedKeys = Object.keys(newThemeMapping).sort();

        for (const key of sortedKeys) {
            sortedThemeMapping[key] = newThemeMapping[key];
        }

        await cacheThemeMapping(version, sortedThemeMapping);
        log.success(`Updated with ${Object.keys(sortedThemeMapping).length} feature types from S3`);

        return sortedThemeMapping;
    } catch (error) {
        log.error(`${kleur.red("Failed")} to update theme mapping`);
        throw error;
    }
}

/**
 * Creates a theme mapping from S3 feature types for a given version.
 * @param version - The release version to create theme mapping from
 * @returns Promise resolving to ThemeMapping object
 */
async function createThemeMappingFromVersion(version: Version): Promise<ThemeMapping> {
    const s3FeatureTypes = await getFeatureTypesForVersion(version);
    const themeMapping: ThemeMapping = {};

    // Create mapping from feature types to themes
    for (const [theme, featureTypes] of Object.entries(s3FeatureTypes)) {
        for (const featureType of featureTypes) {
            themeMapping[featureType] = theme;
        }
    }

    return themeMapping;
}

/**
 * Filters feature types based on selected themes and types.
 * @param featureTypes - All available feature types
 * @param themeMapping - Mapping of feature types to themes
 * @param selectedThemes - Optional array of themes to filter by
 * @param selectedTypes - Optional array of feature types to filter by
 * @returns Filtered array of feature types
 */
function filterFeatureTypes(
    featureTypes: string[],
    themeMapping: ThemeMapping,
    selectedThemes?: string[],
    selectedTypes?: string[],
): string[] {
    const filteredTypes = new Set<string>();

    // If specific types are requested, include them
    if (selectedTypes && selectedTypes.length > 0) {
        for (const type of selectedTypes) {
            if (featureTypes.includes(type)) {
                filteredTypes.add(type);
            }
        }
    }

    // If specific themes are requested, include all types from those themes
    if (selectedThemes && selectedThemes.length > 0) {
        for (const [featureType, theme] of Object.entries(themeMapping)) {
            if (selectedThemes.includes(theme) && featureTypes.includes(featureType)) {
                filteredTypes.add(featureType);
            }
        }
    }

    // Return the union of all matching types
    return Array.from(filteredTypes);
}

/**
 * Creates a theme mapping from the second-most recent version when no theme mapping is available.
 * @param releaseData - Release data containing available releases
 * @returns Promise resolving to ThemeMapping object
 */
async function createThemeMappingFromSecondMostRecentVersion(releaseData: ReleaseData): Promise<ThemeMapping> {
    const availableVersions = releaseData.releases
        .filter((release) => release.isAvailableOnS3)
        .sort((a, b) => b.version.localeCompare(a.version)); // Sort by version, most recent first

    if (availableVersions.length < 2) {
        // If we don't have at least 2 versions, use the most recent one
        if (availableVersions.length === 1) {
            return await createThemeMappingFromVersion(availableVersions[0].version);
        }
        throw new Error("No releases available on S3 to create theme mapping from");
    }

    // Use the second-most recent version
    const secondMostRecentVersion = availableVersions[1].version;
    return await createThemeMappingFromVersion(secondMostRecentVersion);
}

/**
 * Loads the theme mapping from cache for a specific version.
 * @param version - The release version to get theme mapping for
 * @returns Promise resolving to ThemeMapping object containing feature type to name mappings
 * @throws Error if no theme mapping is available for the specified version
 */
async function loadThemeMapping(version: string): Promise<ThemeMapping> {
    // Try to load from cache first if version is provided
    const cachedMapping = await getCachedThemeMapping(version);
    if (cachedMapping) {
        return cachedMapping;
    }

    // No theme mapping available
    throw new Error("No theme mapping available");
}

/**
 * Loads the most recent theme mapping from available cached versions.
 * @returns Promise resolving to ThemeMapping object from most recent cached version, or null if no cache exists
 */
async function loadMostRecentThemeMapping(): Promise<ThemeMapping | null> {
    const cachedVersions = await getVersionsInCache();
    if (cachedVersions.length === 0) {
        return null;
    }

    // Try the most recent version first
    return await loadThemeMapping(cachedVersions[0]);
}

/**
 * Loads theme mapping for a given version or creates it if it doesn't exist.
 * @param version - The target release version
 * @param releaseData - Release data for fallback theme mapping creation
 * @returns Promise resolving to loaded or created theme mapping
 */
async function loadOrCreateThemeMapping(version: Version, releaseData: ReleaseData): Promise<ThemeMapping> {
    // Try to load existing theme mapping for the target version
    try {
        return await loadThemeMapping(version);
    } catch {
        // No cached mapping exists, create from second-most recent version
        const createSpinner = spinner();
        createSpinner.start("Creating theme mapping from second-most recent version");
        try {
            const themeMapping = await createThemeMappingFromSecondMostRecentVersion(releaseData);
            await cacheThemeMapping(version, themeMapping);
            createSpinner.stop(`Created theme mapping with ${Object.keys(themeMapping).length} feature types`);
            return themeMapping;
        } catch (error) {
            bailFromSpinner(
                createSpinner,
                "Failed to create theme mapping",
                `Theme mapping creation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
            );
        }
    }
}

/**
 * Gets a validated theme mapping, handling validation differences with user interaction.
 * @param version - The release version to validate against
 * @param themeMapping - Local theme mapping to validate
 * @param validationSpinner - Spinner instance to use for validation feedback
 * @returns Promise resolving to validated theme mapping
 */
async function getValidThemeMapping(
    version: Version,
    themeMapping: ThemeMapping,
    validationSpinner: ReturnType<typeof spinner>,
): Promise<ThemeMapping> {
    const validationResult = await validateThemeMappingAgainstS3(version, themeMapping);

    if (validationResult.isValid) {
        validationSpinner.stop("Themes and feature types validated");
        return themeMapping;
    } else {
        // Stop spinner and handle differences
        validationSpinner.stop(`${kleur.red("FAILED")} Themes and feature types validation`, 1);

        // Show UI and get user action
        const action = await promptUserForThemeAction(validationResult.differences!);

        // Handle the chosen action
        const updatedThemeMapping = await handleThemeAction(action, await getFeatureTypesForVersion(version), version);

        // Return the updated mapping if it was updated, otherwise return the original
        return updatedThemeMapping || themeMapping;
    }
}

/**
 * Ensures theme mapping is valid and applies filters if provided.
 * @param version - The release version
 * @param themeMapping - The theme mapping to validate and filter
 * @param selectedThemes - Optional array of themes to filter by
 * @param selectedTypes - Optional array of feature types to filter by
 * @returns Promise resolving to validated and filtered theme mapping with feature types
 */
async function ensureValidThemeMapping(
    version: Version,
    themeMapping: ThemeMapping,
    selectedThemes?: string[],
    selectedTypes?: string[],
): Promise<{
    themeMapping: ThemeMapping;
    featureTypes: string[];
}> {
    // Validate and potentially refresh the theme mapping for the current version
    const validationSpinner = spinner();
    validationSpinner.start("Validating theme mapping");
    const validatedThemeMapping = await getValidThemeMapping(version, themeMapping, validationSpinner);

    // Apply filters if provided
    let featureTypes = Object.keys(validatedThemeMapping);
    if (selectedThemes || selectedTypes) {
        const validationResult = await validateThemesAndTypes(
            version,
            selectedThemes,
            selectedTypes,
            validatedThemeMapping,
        );

        if (!validationResult.isValid) {
            // Refresh themes from S3 if validation fails
            const refreshSpinner = spinner();
            refreshSpinner.start("Refreshing theme mapping from S3");
            try {
                const refreshedThemeMapping = await createThemeMappingFromVersion(version);
                await cacheThemeMapping(version, refreshedThemeMapping);
                refreshSpinner.stop("Theme mapping refreshed from S3");

                // Re-validate after refresh
                const refreshResult = await validateThemesAndTypes(
                    version,
                    selectedThemes,
                    selectedTypes,
                    refreshedThemeMapping,
                );

                if (!refreshResult.isValid) {
                    throw new Error(`Invalid themes or types: ${refreshResult.errors.join(", ")}`);
                }

                return {
                    themeMapping: refreshedThemeMapping,
                    featureTypes: filterFeatureTypes(
                        Object.keys(refreshedThemeMapping),
                        refreshedThemeMapping,
                        selectedThemes,
                        selectedTypes,
                    ),
                };
            } catch (error) {
                bailFromSpinner(
                    refreshSpinner,
                    "Failed to refresh theme mapping",
                    `Theme refresh failed: ${error instanceof Error ? error.message : "Unknown error"}`,
                );
            }
        }

        featureTypes = filterFeatureTypes(featureTypes, validatedThemeMapping, selectedThemes, selectedTypes);

        if (featureTypes.length === 0) {
            throw new Error("No feature types match the specified themes and types filters");
        }
    }

    return { themeMapping: validatedThemeMapping, featureTypes };
}

/**
 * Prompts user for theme action when differences are found.
 * This function should be imported from ui.ts when needed.
 */
async function promptUserForThemeAction(differences: any): Promise<any> {
    // This function should be imported from ui.ts to avoid circular dependencies
    const { promptUserForThemeAction } = await import("./ui");
    return promptUserForThemeAction(differences);
}
