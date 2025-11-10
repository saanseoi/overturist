import { log, outro, spinner } from "@clack/prompts";
import kleur from "kleur";
import { getCachedSearchResults } from "./cache";
import { checkForExistingFiles } from "./fs";
import { initialize } from "./init";
import { processFeatures, searchDivisions } from "./processing";
import { getAdminLevels } from "./releases";
import { getS3Releases } from "./s3";
import { updateThemeMappingFromS3 } from "./themes";
import type {
    CliArgs,
    Config,
    InitialConfig,
    OnExistingFilesAction,
    ReleaseContext,
    ThemeMapping,
    Version,
} from "./types";
import {
    determineActionOnExistingFiles,
    displayBanner,
    displayExtractionPlan,
    displaySelectedDivision,
    displayTableHeader,
    promptForAdministrativeLevel,
    promptForAreaName,
    promptForDivisionSelection,
    promptForMainAction,
    promptForSearchHistory,
    promptForSettingsAction,
    selectReleaseVersion,
} from "./ui";
import { bail, bailFromSpinner, successExit } from "./utils";

/**
 * MENUS
 */

/**
 * Runs the interactive mode with main menu loop
 */
export async function handleMainMenu(CONFIG: InitialConfig, cliArgs: CliArgs) {
    displayBanner();

    while (true) {
        const action = await promptForMainAction();

        switch (action) {
            case "download_latest": {
                const initResult = await handleInitialization(CONFIG, cliArgs);
                if (!initResult) {
                    continue;
                }

                await executeDownloadWorkflow(
                    initResult.config,
                    initResult.featureTypes,
                    initResult.themeMapping,
                    initResult.releaseContext,
                    initResult.outputDir,
                    cliArgs.onFilesExistsMode,
                    initResult.featureNameWidth,
                    initResult.indexWidth,
                );
                break;
            }

            case "download_historic": {
                const { s3Releases } = await getS3Releases();
                const historicVersion = await selectReleaseVersion(s3Releases, s3Releases[0]);

                if (!historicVersion) {
                    continue; // User cancelled
                }

                const initResult = await handleInitialization(CONFIG, cliArgs, historicVersion);
                if (!initResult) {
                    continue;
                }

                await executeDownloadWorkflow(
                    initResult.config,
                    initResult.featureTypes,
                    initResult.themeMapping,
                    initResult.releaseContext,
                    initResult.outputDir,
                    cliArgs.onFilesExistsMode,
                    initResult.featureNameWidth,
                    initResult.indexWidth,
                );
                break;
            }

            case "repeat_search": {
                await handleRepeatSearchWorkflow(CONFIG, cliArgs);
                break;
            }

            case "manage_settings": {
                await handleSettingsMenu(CONFIG, cliArgs);
                break;
            }

            case "exit":
                outro(kleur.blue("Goodbye!"));
                process.exit(0);
                break;

            default:
                console.error(kleur.red("Invalid action selected"));
                process.exit(1);
        }
    }
}

/**
 * Handles the settings menu loop
 */
async function handleSettingsMenu(CONFIG?: InitialConfig, cliArgs?: CliArgs) {
    while (true) {
        const action = await promptForSettingsAction();

        switch (action) {
            case "show_preferences": {
                const { showPreferences } = await import("./settings");
                await showPreferences();
                break;
            }

            case "reset_preferences": {
                const { resetPreferences } = await import("./settings");
                await resetPreferences(CONFIG, cliArgs);
                break;
            }

            case "show_cache_stats": {
                const { showCacheStats } = await import("./settings");
                await showCacheStats();
                break;
            }

            case "purge_cache": {
                const { purgeCache } = await import("./settings");
                await purgeCache();
                break;
            }

            case "back":
                return; // Return to main menu

            default:
                console.error(kleur.red("Invalid settings action selected"));
                return;
        }
    }
}

/**
 * DIVISIONS
 */

/**
 * Handles the division selection workflow for users without predefined DIVISION_ID.
 * @param config - Configuration object to update with selected division
 * @param version - Optional version to use for admin levels. Defaults to latest.
 */
export async function handleDivisionSelection(config: Config): Promise<void> {
    // Step 1: Prompt for administrative level
    const adminLevel = await promptForAdministrativeLevel(config);

    // Step 2: Get subtypes for the selected level using the appropriate version
    const adminLevels = getAdminLevels(config.releaseVersion);
    const subtypes = adminLevels[adminLevel as keyof typeof adminLevels].subtypes;

    // Step 3: Prompt for area name
    const queryString = await promptForAreaName(adminLevel, config);

    // Step 4: Search for divisions
    const s = spinner();
    s.start("Filtering for your divisions (takes a couple of minutes)");

    try {
        const searchResult = await searchDivisions(config, queryString, [...subtypes], adminLevel);

        if (searchResult.results.length === 0) {
            s.stop("No divisions found", 1);
            bail(`No ${subtypes.join("/ ")} found matching "${kleur.red(queryString)}"`);
        }

        s.stop(`Found ${searchResult.totalCount} matching division${searchResult.totalCount > 1 ? "s" : ""}`);

        // Step 5: Prompt user to select from results
        const selectedDivision = await promptForDivisionSelection(searchResult);

        // Step 6: Update config with selected division
        config.divisionId = selectedDivision.id;
        config.selectedDivision = selectedDivision;

        // Step 7: Display selection to user
        displaySelectedDivision(selectedDivision, config);
    } catch (error) {
        bailFromSpinner(
            s,
            "Division search failed",
            `Failed to search for divisions: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
    }
}

/**
 * Handles the common initialization and setup workflow for download operations.
 * @param config - Initial configuration object
 * @param cliArgs - Command line arguments
 * @param specifiedVersion - Optional specific version to use
 * @returns Object with initialized data or null if initialization failed
 */
async function handleInitialization(
    config: InitialConfig,
    cliArgs: CliArgs,
    specifiedVersion?: Version,
): Promise<{
    releaseContext: ReleaseContext;
    themeMapping: ThemeMapping;
    featureTypes: string[];
    featureNameWidth: number;
    indexWidth: number;
    outputDir: string;
    config: Config;
} | null> {
    const { themes, types } = cliArgs;

    const { releaseContext, themeMapping, featureTypes, featureNameWidth, indexWidth, outputDir } = await initialize(
        config,
        themes,
        types,
        specifiedVersion,
    );

    if (!releaseContext) {
        console.error(kleur.red("Could not determine release context"));
        return null;
    }

    // Update config with the actual release version
    config.releaseVersion = releaseContext.version;

    return {
        releaseContext,
        themeMapping,
        featureTypes,
        featureNameWidth,
        indexWidth,
        outputDir,
        config: config as Config,
    };
}

/**
 * Handles the common file existence workflow for download operations.
 * @param featureTypes - Array of feature types to check
 * @param outputDir - Output directory path
 * @param onFilesExistsMode - Default action mode for existing files
 * @returns Action to take on existing files or Abort symbol
 */
async function handleExistingFiles(
    featureTypes: string[],
    outputDir: string,
    onFilesExistsMode: OnExistingFilesAction | symbol,
): Promise<OnExistingFilesAction | symbol> {
    const existingFiles = await checkForExistingFiles(featureTypes, outputDir);
    const actionOnExistingFiles = await determineActionOnExistingFiles(existingFiles, onFilesExistsMode);
    return actionOnExistingFiles;
}

/**
 * Executes the complete download workflow.
 * @param config - Configuration object
 * @param featureTypes - Array of feature types to process
 * @param themeMapping - Theme mapping for feature types
 * @param releaseContext - Release context information
 * @param outputDir - Output directory path
 * @param onFilesExistsMode - Default action mode for existing files
 * @param featureNameWidth - Width for formatting feature names in display
 * @param indexWidth - Width for formatting indices in display
 * @returns Promise resolving to true if workflow completed, false if aborted
 */
async function executeDownloadWorkflow(
    config: Config,
    featureTypes: string[],
    themeMapping: ThemeMapping,
    releaseContext: ReleaseContext,
    outputDir: string,
    onFilesExistsMode: OnExistingFilesAction | symbol,
    featureNameWidth: number,
    indexWidth: number,
): Promise<boolean> {
    const actionOnExistingFiles = await handleExistingFiles(featureTypes, outputDir, onFilesExistsMode);

    // Check for abort early
    if (actionOnExistingFiles === "Abort" || typeof actionOnExistingFiles === "symbol") {
        return false;
    }

    await displayExtractionPlan(config, releaseContext, outputDir);
    displayTableHeader(featureNameWidth, indexWidth);

    await processFeatures(
        config,
        featureTypes,
        themeMapping,
        releaseContext,
        outputDir,
        actionOnExistingFiles,
        featureNameWidth,
        indexWidth,
    );

    return true;
}

/**
 * Handles the repeat search workflow by loading cached search results.
 * @param config - Initial configuration object
 * @param cliArgs - Command line arguments
 * @returns Promise resolving when workflow is complete or null if cancelled
 */
async function handleRepeatSearchWorkflow(config: InitialConfig, cliArgs: CliArgs): Promise<void> {
    const searchItem = await promptForSearchHistory();
    if (!searchItem) {
        return; // User cancelled or no history available
    }

    // Load the search results from cache file
    const cachedResults = await getCachedSearchResults(searchItem.version, searchItem.adminLevel, searchItem.term);

    if (!cachedResults) {
        console.error(kleur.red("Could not load cached search results"));
        return;
    }

    // Prompt for division selection
    const division = await promptForDivisionSelection({
        results: cachedResults.results,
        totalCount: cachedResults.totalCount,
    });

    if (!division) {
        return; // User cancelled
    }

    // Set the division ID and selected division in config
    config.divisionId = division.id;
    config.selectedDivision = division;

    // Use the common initialization and download workflow
    const initResult = await handleInitialization(config, cliArgs);
    if (!initResult) {
        return;
    }

    const completed = await executeDownloadWorkflow(
        initResult.config,
        initResult.featureTypes,
        initResult.themeMapping,
        initResult.releaseContext,
        initResult.outputDir,
        cliArgs.onFilesExistsMode,
        initResult.featureNameWidth,
        initResult.indexWidth,
    );

    if (!completed) {
        return;
    }
}

/**
 * Handles the user's chosen action for theme differences.
 * @param action - User's chosen action
 * @param s3FeatureTypes - Feature types available on S3
 * @param version - Release version to cache the theme mapping for
 */
export async function handleThemeAction(
    action: "update" | "ignore" | "cancel",
    s3FeatureTypes: { [theme: string]: string[] },
    version: string,
): Promise<ThemeMapping | null> {
    switch (action) {
        case "cancel":
            successExit("❌ User said no.");
            break;

        case "ignore":
            log.warn(kleur.yellow("Proceeding with existing theme mapping"));
            return null;

        case "update":
            return await updateThemeMappingFromS3(s3FeatureTypes, version);
    }
}
