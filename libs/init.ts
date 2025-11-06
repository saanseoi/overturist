import { ensureDirectoryExists, getOutputDir } from "./fs";
import { handleDivisionSelection } from "./interactive";
import { getReleaseContext, initializeReleaseVersion } from "./releases";
import { initializeThemeMapping } from "./themes";
import type { Config, InitialConfig, ReleaseContext, ThemeMapping } from "./types";
import { calculateColumnWidths, displayBanner } from "./ui";
import { setupGracefulExit } from "./utils";

/**
 * Initializes the application by fetching releases, loading theme mapping, and setting up directories.
 * @param config - Configuration object containing application settings
 * @returns Promise resolving to object containing initialized application state
 */
export async function initialize(
    config: InitialConfig,
    selectedThemes?: string[],
    selectedTypes?: string[],
    specifiedReleaseVersion?: string,
): Promise<{
    releaseContext: ReleaseContext | null;
    themeMapping: ThemeMapping;
    featureTypes: string[];
    featureNameWidth: number;
    indexWidth: number;
    outputDir: string;
}> {
    setupGracefulExit();
    displayBanner();

    // RELEASE VERSION

    // Initialize release version with comprehensive logic
    const { releaseData, releaseVersion } = await initializeReleaseVersion(config, specifiedReleaseVersion);
    config.releaseVersion = releaseVersion;

    // THEME MAPPING

    // Initialize theme mapping with comprehensive validation and fallback logic
    const { themeMapping, featureTypes } = await initializeThemeMapping(
        config.releaseVersion,
        releaseData,
        selectedThemes,
        selectedTypes,
    );

    // DIVISION ID

    // Division selection workflow - skip if DIVISION_ID is provided
    if (!config.divisionId) {
        await handleDivisionSelection(config as Config);
    }

    const outputDir = getOutputDir(config as Config, config.releaseVersion);
    await ensureDirectoryExists(outputDir);

    const { featureNameWidth, indexWidth } = calculateColumnWidths(featureTypes);
    const releaseContext = getReleaseContext(releaseData, config.releaseVersion);

    return {
        releaseContext,
        themeMapping,
        featureTypes,
        featureNameWidth,
        indexWidth,
        outputDir,
    };
}
