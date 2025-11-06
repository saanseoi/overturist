import { getFeatureTypesForVersion } from "./s3";
import type { ThemeDifferences, ThemeMapping, Version } from "./types";

/**
 * RELEASES
 */

/**
 * Validates that a release version is available on S3.
 * @param version - The version to validate
 * @param availableVersions - Array of available versions from S3
 * @returns Object indicating if version is valid and available versions
 */
export function validateReleaseVersion(
    version: string,
    availableVersions: string[],
): { isValid: boolean; availableVersions: string[]; message?: string } {
    if (!version) {
        return {
            isValid: false,
            availableVersions,
            message: "No version specified",
        };
    }

    if (availableVersions.length === 0) {
        return {
            isValid: false,
            availableVersions,
            message: "No versions available on S3",
        };
    }

    if (!availableVersions.includes(version)) {
        return {
            isValid: false,
            availableVersions,
            message: `Version "${version}" is not available on S3. Available versions: ${availableVersions.join(", ")}`,
        };
    }

    return {
        isValid: true,
        availableVersions,
    };
}

/**
 * THEME MAPPING
 */

/**
 * Validates selected themes and types against the current theme mapping.
 * @param version - The release version to validate against
 * @param selectedThemes - Optional array of themes to validate
 * @param selectedTypes - Optional array of feature types to validate
 * @param themeMapping - Current theme mapping
 * @returns Promise resolving to validation result
 */
export async function validateThemesAndTypes(
    _version: Version,
    selectedThemes?: string[],
    selectedTypes?: string[],
    themeMapping?: ThemeMapping,
): Promise<{ isValid: boolean; errors: string[] }> {
    const errors: string[] = [];

    if (!themeMapping) {
        return { isValid: false, errors: ["No theme mapping available"] };
    }

    // Get available themes and types from current mapping
    const availableThemes = new Set(Object.values(themeMapping));
    const availableTypes = new Set(Object.keys(themeMapping));

    // Validate selected themes
    if (selectedThemes) {
        for (const theme of selectedThemes) {
            if (!availableThemes.has(theme)) {
                errors.push(`Invalid theme: ${theme}`);
            }
        }
    }

    // Validate selected types
    if (selectedTypes) {
        for (const type of selectedTypes) {
            if (!availableTypes.has(type)) {
                errors.push(`Invalid feature type: ${type}`);
            }
        }
    }

    return {
        isValid: errors.length === 0,
        errors,
    };
}

/**
 * Validates the local theme mapping against what's available on S3 for a given version.
 * @param version - The release version to validate against
 * @param localThemeMapping - Local theme mapping from theme_mapping.json
 * @returns Promise resolving to validation result with isValid flag and differences if invalid
 */
export async function validateThemeMappingAgainstS3(
    version: Version,
    localThemeMapping: ThemeMapping,
): Promise<{
    isValid: boolean;
    themeMapping: ThemeMapping;
    differences?: ThemeDifferences;
}> {
    try {
        // Fetch feature types from S3
        const s3FeatureTypes = await getFeatureTypesForVersion(version);

        // Compare local mapping with S3 availability
        const differences = compareThemesWithS3(localThemeMapping, s3FeatureTypes);

        // Return validation result
        return {
            isValid: !differences.hasDifferences,
            themeMapping: localThemeMapping,
            differences: differences.hasDifferences ? differences : undefined,
        };
    } catch (error) {
        throw new Error(`Theme validation failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
}

/**
 * Compares local theme mapping with S3 feature types and identifies differences.
 * @param localThemeMapping - Local theme mapping from theme_mapping.json
 * @param s3FeatureTypes - Feature types available on S3
 * @returns Object containing differences and whether any exist
 */
export function compareThemesWithS3(
    localThemeMapping: ThemeMapping,
    s3FeatureTypes: { [theme: string]: string[] },
): ThemeDifferences {
    const localTypes = Object.keys(localThemeMapping);
    const s3Types: string[] = [];

    // Flatten all feature types from all themes on S3
    for (const theme of Object.keys(s3FeatureTypes)) {
        s3Types.push(...s3FeatureTypes[theme]);
    }

    // Find differences
    const missingFromLocal = s3Types.filter((type) => !localTypes.includes(type));
    const missingFromS3 = localTypes.filter((type) => !s3Types.includes(type));

    return {
        missingFromLocal,
        missingFromS3,
        hasDifferences: missingFromLocal.length > 0 || missingFromS3.length > 0,
    };
}
