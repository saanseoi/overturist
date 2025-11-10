import type { Option } from "@clack/prompts";
import { log, outro, select, text } from "@clack/prompts";
import kleur from "kleur";
import { getSearchHistory } from "./cache";
import { DEFAULT_LOCALE } from "./constants";
import { note } from "./note";
import { getCount, getLastReleaseCount } from "./queries";
import { getAdminLevels } from "./releases";
import type {
    CliArgs,
    Config,
    Division,
    InitialConfig,
    OnExistingFilesAction,
    ProgressState,
    ReleaseContext,
    SearchHistoryItem,
    ThemeDifferences,
    Version,
} from "./types";
import { getDiffCount, successExit } from "./utils";

// Local type definition to avoid import issues
type DivisionOption = { value: Division | string; label: string; hint: string };

/**
 * COMMON
 */

/**
 * Displays a colorful rainbow banner.
 */
export function displayBanner(showGutter: boolean = true) {
    const rainbowArt = [
        kleur.red("山 山 山 山 山 山 山 山  山 山 山 山 山 山 山 山 山"),
        kleur.magenta(" "),
        kleur.red("  ▗▄▖ ▗▖  ▗▖▗▄▄▄▖▗▄▄▖▗▄▄▄▖▗▖ ▗▖▗▄▄▖ ▗▄▄▄▖ ▗▄▄▖▗▄▄▄▖"),
        kleur.yellow(" ▐▌ ▐▌▐▌  ▐▌▐▌   ▐▌ ▐▌ █  ▐▌ ▐▌▐▌ ▐▌  █  ▐▌     █  "),
        kleur.green(" ▐▌ ▐▌▐▌  ▐▌▐▛▀▀▘▐▛▀▚▖ █  ▐▌ ▐▌▐▛▀▚▖  █   ▝▀▚▖  █  "),
        kleur.cyan(" ▝▚▄▞▘ ▝▚▞▘ ▐▙▄▄▖▐▌ ▐▌ █  ▝▚▄▞▘▐▌ ▐▌▗▄█▄▖▗▄▄▞▘  █  "),
        kleur.magenta(" "),
        kleur.blue("水 水 水 水 https://github.com/saanseoi 水 水 水 水"),
    ];

    if (showGutter) {
        log.message(rainbowArt.join("\n"));
    } else {
        console.log(rainbowArt.join("\n"));
    }
}

/**
 * MENU :: MAIN
 */

/**
 * Prompts user for the main action selection.
 * @returns Promise resolving to selected action
 */
export async function promptForMainAction(): Promise<string> {
    // Check if there are any cached searches before showing the repeat search option
    const cacheModule = await import("./cache");
    const hasSearches = await cacheModule.hasCachedSearches();

    const options = [
        {
            value: "download_latest",
            label: "Download latest",
            hint: "version from S3",
        },
        ...(hasSearches
            ? [
                  {
                      value: "repeat_search",
                      label: "Repeat a search",
                      hint: "from your local search history",
                  },
              ]
            : []),
        {
            value: "download_historic",
            label: "Download specific version",
            hint: "from S3 from the last 60 days",
        },
        {
            value: "manage_settings",
            label: "Settings",
            hint: "Manage preferences and cache",
        },
        {
            value: "exit",
            label: "Exit",
            hint: "Quit the application",
        },
    ];

    const selected = await select({
        message: "What would you like to do?",
        options,
    });

    if (typeof selected === "symbol") {
        throw new Error("Operation cancelled");
    }

    return selected;
}

/**
 * MENU :: SEARCH HISTORY
 */

/**
 * Prompts user to select from search history.
 * @returns Promise resolving to search history entry or null if cancelled
 */
export async function promptForSearchHistory(): Promise<SearchHistoryItem | null> {
    const history = await getSearchHistory();

    if (history.length === 0) {
        log.warning("No search history found.");
        return null;
    }

    // Build options for search history selection
    const options: Array<{
        value: SearchHistoryItem | string;
        label: string;
        hint: string;
    }> = history.slice(0, 50).map((entry) => {
        const createdDate = new Date(entry.createdAt);
        const date = createdDate.toISOString().split("T")[0]; // YYYY-MM-DD format
        const time = createdDate.toTimeString().split(" ")[0].substring(0, 5); // HH:MM format
        const adminLevels = getAdminLevels(entry.version);
        const levelName =
            adminLevels[entry.adminLevel as keyof typeof adminLevels]?.name || `Level ${entry.adminLevel}`;

        return {
            value: entry,
            label: `${entry.term}`,
            hint: `${levelName} • ${date} ${time} • ${entry.totalCount} ${entry.totalCount > 1 ? "results" : "result"}`,
        };
    });

    // Add pagination options if there are more than 50 entries
    if (history.length > 50) {
        options.push({
            value: "show_more",
            label: kleur.blue("Show older searches..."),
            hint: `Showing 50 of ${history.length} total searches`,
        });
    }

    const message = "Which search would you like to repeat?";
    const selected = await select({
        message,
        options: options as Option<string | SearchHistoryItem>[], // Type assertion for clack compatibility
    });

    if (typeof selected === "symbol" || selected === "show_more") {
        return null;
    }

    if (typeof selected === "string") {
        return null;
    }

    return selected;
}

/**
 * MENU :: SETTINGS
 */

/**
 * Prompts user for settings and cache management options.
 * @returns Promise resolving to selected action
 */
export async function promptForSettingsAction(): Promise<string> {
    const options = [
        {
            value: "show_preferences",
            label: "Show preferences",
            hint: "Display current .env configuration",
        },
        {
            value: "reset_preferences",
            label: "Reset preferences",
            hint: "Delete the .env file",
        },
        {
            value: "show_cache_stats",
            label: "Show cache stats",
            hint: "Display cache directory sizes",
        },
        {
            value: "purge_cache",
            label: "Purge cache",
            hint: "Delete entire .cache directory",
        },
        {
            value: "back",
            label: "Back to main menu",
            hint: "Return to previous menu",
        },
    ];

    const selected = await select({
        message: "Manage Settings and Cache:",
        options,
    });

    if (typeof selected === "symbol") {
        throw new Error("Operation cancelled");
    }

    return selected;
}

/**
 * GET
 */

/**
 * Displays the extraction plan summary as a note with key information.
 * Shows release version, schema, bounding box, and output directory in a formatted note.
 *
 * @param config - Configuration object containing bounding box coordinates
 * @param release - Release context with version and schema information
 * @param outputDir - Directory where files will be extracted
 */
export async function displayExtractionPlan(config: Config, release: ReleaseContext, outputDir: string) {
    const planLines = [
        `Release:      ${kleur.cyan(release.version)}${release.isLatest ? ` ${kleur.red("(latest)")}` : ""}`,
        `Schema:       ${kleur.cyan(release.schema)}${release.isNewSchema ? ` ${kleur.red("(new)")}` : ""}`,
        `BBox:         ${kleur.cyan(`${config.bbox.xmin},${config.bbox.ymin} to ${config.bbox.xmax},${config.bbox.ymax}`)}`,
        `Output:       ${kleur.cyan(outputDir)}`,
    ];

    note(planLines.join("\n"), "Extraction Plan");
}

/**
 * GET :: DOWNLOAD PROGRESS
 */

/**
 * Displays the table header for feature processing progress.
 * Creates a formatted header with column titles and separator line.
 *
 * @param featureNameWidth - Width of the feature name column for proper alignment
 * @param indexWidth - Width of the index column for proper alignment
 */
export function displayTableHeader(featureNameWidth: number, indexWidth: number) {
    const headerLine = `${kleur.white("".padEnd(indexWidth + 1))} ${kleur.cyan("FEATURE".padEnd(featureNameWidth + 1))} ${kleur.white("BBOX".padEnd(6))} ${kleur.white("GEOM".padEnd(6))} ${kleur.white("COUNT".padEnd(9))} ${kleur.white("DIFF".padEnd(8))}`;
    const separatorLine = ` ${kleur.gray("─".repeat(indexWidth + 2))}${kleur.gray("─".repeat(featureNameWidth))} ${kleur.gray("─".repeat(6))} ${kleur.gray("─".repeat(6))} ${kleur.gray("─".repeat(9))} ${kleur.gray("─".repeat(9))}`;
    console.log(headerLine);
    console.log(separatorLine);
}

/**
 * Updates the progress display for a specific feature being processed.
 * Shows completion status with emojis, progress percentages, or spinners.
 * Handles alignment for single and double-digit indices.
 *
 * @param featureType - Name of the feature type being processed
 * @param index - Current index (0-based) in the processing queue
 * @param total - Total number of features to process
 * @param progress - Progress state object with completion flags and counts
 * @param featureNameWidth - Width for feature name column alignment
 * @param indexWidth - Width for index column alignment
 */
export function updateProgressDisplay(
    featureType: string,
    index: number,
    total: number,
    progress: ProgressState,
    featureNameWidth: number,
    indexWidth: number,
): void {
    const indexNum = index + 1;
    // Special handling for index alignment when total > 9
    let progressPrefix: string;
    if (total > 9 && indexNum < 10) {
        // For indices 1-9 when there are 10+ total, add extra space to align with double-digit indices
        progressPrefix = `[${indexNum}/${total}]`.padStart(indexWidth + 1);
    } else {
        progressPrefix = `[${indexNum}/${total}]`.padStart(indexWidth);
    }

    // Show EITHER emoji OR percentage, not both
    let bboxDisplay: string, geomDisplay: string;

    if (progress.bboxComplete) {
        bboxDisplay = kleur.green("✅    "); // Two spaces for proper 6-char width
    } else if (progress.isProcessing) {
        // Show spinner instead of percentage for bbox operations
        const spinnerFrames = ["◒", "◐", "◓", "◑"];
        const spinnerIndex = Math.floor(Date.now() / 100) % spinnerFrames.length;
        bboxDisplay = kleur.yellow(`${spinnerFrames[spinnerIndex]}   `.padEnd(6));
    } else {
        bboxDisplay = kleur.white("⬜   "); // Two spaces for proper 6-char width
    }

    if (progress.geomComplete) {
        geomDisplay = kleur.green("✅    "); // Add space for proper 6-char width
    } else if (progress.isProcessing && progress.bboxComplete) {
        // Show spinner instead of percentage for geom operations
        const spinnerFrames = ["◒", "◐", "◓", "◑"];
        const spinnerIndex = Math.floor(Date.now() / 100) % spinnerFrames.length;
        geomDisplay = kleur.yellow(`${spinnerFrames[spinnerIndex]}   `.padEnd(6));
    } else {
        geomDisplay = kleur.white("⬜    "); // Add space for proper 6-char width
    }

    // Clear the current line and show the compact progress
    process.stdout.write(`\r${" ".repeat(process.stdout.columns || 80)}\r`);

    // Use consistent column widths with proper padding for emojis
    const bboxCol = bboxDisplay.padEnd(6);
    const geomCol = geomDisplay.padEnd(6);

    // Format count as full number, right-aligned in 7-character width
    const count = progress.featureCount || 0;
    const countText = count.toString().padStart(7);

    // Format diff with proper coloring and alignment (9-character width)
    let diffText: string;
    if (progress.diffCount === null) {
        diffText = kleur.yellow("NEW".padStart(9));
    } else if (progress.diffCount === 0) {
        diffText = kleur.white("-".padStart(9));
    } else if (progress.diffCount > 0) {
        diffText = kleur.green(`+${progress.diffCount}`.padStart(9));
    } else {
        diffText = kleur.red(progress.diffCount.toString().padStart(9));
    }

    const line =
        `${kleur.white(progressPrefix)} ${kleur.cyan(featureType.padEnd(featureNameWidth))} │ ` +
        `${bboxCol} ${geomCol} ${kleur.white(countText)} ${diffText}`;

    process.stdout.write(line);
}

/**
 * Handles the skipped feature logic when files already exist.
 * @param config - Configuration object
 * @param featureType - Feature type being processed
 * @param outputFile - Path to the output file
 * @param index - Index of the feature type
 * @param featureTypes - Array of all feature types
 * @param releaseContext - Release context information
 * @param featureNameWidth - Width for feature name display
 * @param indexWidth - Width for index display
 */
export async function handleSkippedFeature(
    config: Config,
    featureType: string,
    outputFile: string,
    index: number,
    featureTypes: string[],
    releaseContext: ReleaseContext,
    featureNameWidth: number,
    indexWidth: number,
): Promise<void> {
    let existingCount = 0;
    try {
        existingCount = await getCount(outputFile);
    } catch (_error) {
        existingCount = 0;
    }

    // Get previous count for diff display
    const lastReleaseCount = await getLastReleaseCount(config, featureType, releaseContext);
    const diffCount = getDiffCount(existingCount, lastReleaseCount);
    const diffText = toDiffText(diffCount);

    let skippedPrefix: string;
    const indexNum = index + 1;
    if (featureTypes.length > 9 && indexNum < 10) {
        skippedPrefix = kleur.gray(`${indexNum}/${featureTypes.length}`.padStart(indexWidth));
    } else {
        skippedPrefix = kleur.gray(`${indexNum}/${featureTypes.length}`.padStart(indexWidth));
    }

    const skippedProgress = `${kleur.gray("│")}${kleur.white(skippedPrefix)} ${kleur.cyan(featureType.padEnd(featureNameWidth))} ${kleur.gray("│")}  ${kleur.yellow("⏭️".padEnd(6))} ${kleur.yellow("⏭️".padEnd(6))} ${kleur.white(existingCount.toString().padStart(7))} ${diffText}`;
    console.log(skippedProgress);
}

/**
 * Formats diff count with appropriate coloring.
 * @param diffCount - The difference count to format
 * @returns Formatted diff text with colors
 */
export function toDiffText(diffCount: number | null): string {
    if (diffCount === null) {
        return kleur.yellow("NEW".padStart(9));
    } else if (diffCount === 0) {
        return kleur.white("-".padStart(9));
    } else if (diffCount > 0) {
        return kleur.green(`+${diffCount}`.padStart(9));
    } else {
        return kleur.red(diffCount.toString().padStart(9));
    }
}

/**
 * Calculates optimal column widths for displaying feature progress table.
 * Ensures proper alignment based on the longest feature name and total count.
 *
 * @param featureTypes - Array of feature type strings to calculate widths for
 * @returns Object containing calculated widths for feature name and index columns
 */
export function calculateColumnWidths(featureTypes: string[]): {
    featureNameWidth: number;
    indexWidth: number;
} {
    const maxFeatureLength = Math.max(...featureTypes.map((f) => f.length));
    const featureNameWidth = Math.max(maxFeatureLength, 15) + 1;
    const indexWidth = featureTypes.length >= 10 ? 6 : 5;
    return { featureNameWidth, indexWidth };
}

/**
 * GET :: ON EXISTING FILES
 */

/**
 * Determines how to handle existing files when extracting data.
 * Either prompts the user interactively or uses the provided mode.
 *
 * @param existingFiles - Array of existing file paths found
 * @param existingFilesActionFromArgs - Pre-determined mode or undefined for interactive prompt
 * @returns Promise resolving to the selected onExistingFilesAction mode
 */
export async function determineActionOnExistingFiles(
    existingFiles: string[],
    existingFilesActionFromArgs: OnExistingFilesAction | symbol,
): Promise<OnExistingFilesAction | symbol> {
    const hasBehaviorArgs = process.argv.length > 2;

    let onExistingFilesActionMode = existingFilesActionFromArgs;

    if (!hasBehaviorArgs && existingFiles.length > 0) {
        onExistingFilesActionMode = (await select({
            message: `Found ${kleur.red(existingFiles.length)} existing files for this release. What would you like to do?`,
            options: [
                {
                    value: "Skip",
                    label: "Skip",
                    hint: "Keep existing files and download missing ones",
                },
                {
                    value: "Replace",
                    label: "Replace",
                    hint: "Replace existing files with fresh downloads",
                },
                { value: "Abort", label: "Abort", hint: "Exit the script" },
            ],
        })) as "Skip" | "Replace" | "Abort" | symbol;
    } else if (hasBehaviorArgs && existingFiles.length > 0) {
        const modeText =
            onExistingFilesActionMode === "Skip"
                ? kleur.green("Skipping existing files")
                : onExistingFilesActionMode === "Replace"
                  ? kleur.yellow("Overriding existing files")
                  : onExistingFilesActionMode === "Abort"
                    ? kleur.red("Aborting due to existing files")
                    : "";

        outro(kleur.white(`📁 Found ${kleur.red(existingFiles.length)} existing files - ${modeText}`));
    }
    return onExistingFilesActionMode;
}

/**
 * GET :: VERSION
 */

/**
 * Allows user to select a specific version from available releases.
 * Displays an interactive selection menu with all available versions.
 *
 * @param s3Releases - Array of available version strings from S3
 * @param latest - The latest version string
 * @returns Promise resolving to selected version string or null if cancelled
 */
export async function selectReleaseVersion(s3Releases: Version[], latest: Version): Promise<string | null> {
    // Create options for the select prompt
    const versionOptions = s3Releases.map((version) => {
        const isLatest = version === latest;
        const label = isLatest ? `${version} (latest)` : version;
        return {
            value: version,
            label: kleur.cyan(label),
        };
    });

    const selectedVersion = (await select({
        message: "Choose a release version:",
        options: versionOptions,
    })) as string;

    // Check if selection was cancelled (result is undefined or a symbol)
    if (!selectedVersion || typeof selectedVersion === "symbol") {
        successExit("Version selection cancelled");
    }

    return selectedVersion;
}

/**
 * GET :: THEMES
 */

/**
 * Builds a formatted message showing theme differences.
 * @param differences - Theme differences to display
 * @returns Formatted message string
 */
export function buildThemeDifferenceMessage(differences: ThemeDifferences): string {
    const sections: string[] = [];
    if (differences.missingFromLocal.length > 0) {
        sections.push(
            `⚠️ Missing from theme_mapping.json (${differences.missingFromLocal.length}):\n`,
            differences.missingFromLocal.map((type) => `   • ${kleur.red(type)}`).join("\n"),
            "\n\n",
        );
    }

    if (differences.missingFromS3.length > 0) {
        sections.push(
            `⚠️ No longer available on S3 (${differences.missingFromS3.length}):\n`,
            differences.missingFromS3.map((type) => `   • ${kleur.red(type)}`).join("\n"),
            "\n\n",
        );
    }

    sections.push("💡 This may happen when Overture Maps changes their schema.");

    return sections.join("");
}

/**
 * Displays the UI for theme differences and prompts user for action.
 * @param differences - Theme differences to display
 * @returns Promise resolving to user's chosen action ('update', 'ignore', or 'cancel')
 */
export async function promptUserForThemeAction(differences: ThemeDifferences): Promise<"update" | "ignore" | "cancel"> {
    // Build and display the difference message
    const noteMessage = buildThemeDifferenceMessage(differences);
    note(noteMessage, "Overture Maps schema drift detected");

    // Ask user what to do with three clear options
    const action = await select({
        message: "How would you like to proceed?",
        options: [
            {
                value: "update",
                label: "Update",
                hint: "Reflect S3 schema in theme_mapping.json",
            },
            {
                value: "ignore",
                label: "Ignore",
                hint: "Continue downloading with existing mapping",
            },
            {
                value: "cancel",
                label: "Cancel",
                hint: "Exit",
            },
        ],
        initialValue: "update",
    });

    if (typeof action === "symbol") {
        return "cancel";
    }

    return action as "update" | "ignore" | "cancel";
}

/**
 * GET :: DIVISIONS
 */

/**
 * Prompts user to select an administrative level.
 * @param config - Config with releaseVersion to use for admin level mapping.
 * @returns Promise resolving to selected administrative level (1-4)
 */
export async function promptForAdministrativeLevel(config: Config): Promise<number> {
    const adminLevels = getAdminLevels(config.releaseVersion);

    const level = await select({
        message: "Select administrative level:",
        options: Object.entries(adminLevels).map(([num, config]) => ({
            value: parseInt(num, 10),
            label: `${num}. ${config.name}`,
            hint: config.subtypes.join(", "),
        })),
    });

    if (typeof level === "symbol") {
        successExit("Administrative level selection cancelled");
    }

    return level as number;
}

/**
 * Prompts user to enter area name or country code for search.
 * @param level - Selected administrative level
 * @param config - Config with releaseVersion to use for admin level mapping.
 * @returns Promise resolving to search query string
 */
export async function promptForAreaName(level: number, config: Config): Promise<string> {
    const adminLevels = getAdminLevels(config.releaseVersion);
    const levelConfig = adminLevels[level as keyof typeof adminLevels];
    const isCountryLevel = level === 1;

    const message = isCountryLevel
        ? `Enter ${levelConfig.name.toLowerCase()} name (or country code):`
        : `Enter ${levelConfig.name.toLowerCase()} name:`;

    // Contextual placeholders based on administrative level
    const getPlaceholder = (level: number): string => {
        switch (level) {
            case 1:
                return "e.g. 'Hong Kong' or 'HK'";
            case 2:
                return "e.g. 'California'";
            case 3:
                return "e.g. 'Kowloon'";
            case 4:
                return "e.g. 'Manhattan' or 'Central, Hong Kong'";
            default:
                return "e.g., Hong Kong";
        }
    };

    const result = await text({
        message,
        placeholder: getPlaceholder(level),
        validate: (value: string) => {
            if (!value || value.trim().length === 0) {
                return "Please enter a name to search for";
            }
            return undefined;
        },
    });

    if (typeof result === "symbol" || !result) {
        successExit("Area name entry cancelled");
    }

    return result.trim();
}

/**
 * Displays division search results and prompts user to select one.
 * @param results - Array of division search results
 * @returns Promise resolving to selected division object
 */
export async function promptForDivisionSelection(searchResults: {
    results: Division[];
    totalCount: number;
}): Promise<Division> {
    const { results, totalCount } = searchResults;

    // Handle case with no results
    if (totalCount === 0 || results.length === 0) {
        successExit(`No divisions found. Please try a different search term.`);
        return null as never; // This line will never be reached
    }

    const PAGE_SIZE = 15;
    let currentPage = 0;
    // Pagination loop
    while (true) {
        const startIndex = currentPage * PAGE_SIZE;
        const endIndex = Math.min(startIndex + PAGE_SIZE, totalCount);
        const currentPageResults = results.slice(startIndex, endIndex);

        // Build options for current page
        const options: DivisionOption[] = currentPageResults.map((result) => {
            const hierarchy = result.hierarchies?.[0];

            // Get unique hierarchy path and find the most specific entry
            const uniquePath = getUniqueHierarchyPath(result, results);
            const mostSpecificEntry = hierarchy?.[hierarchy.length - 1];

            // Build label: subtype first, then unique hierarchy path
            let label = "";
            if (mostSpecificEntry) {
                // Show subtype first in magenta
                label = kleur.magenta(mostSpecificEntry.subtype);

                // Add separator and then the unique hierarchy path
                if (uniquePath) {
                    label += `: ${uniquePath}`;
                }
            } else {
                // Fallback to just the unique path if no most specific entry
                label = uniquePath;
            }

            // Build hint: remaining hierarchy that wasn't used in the unique path
            // We need to find which hierarchy entries were used in the unique path
            let remainingHierarchy = "";
            if (hierarchy && uniquePath) {
                // Split the unique path into individual names
                const usedNames = uniquePath.split(" / ").map((name) => name.trim());

                // Find hierarchy entries that were NOT used in the unique path
                const unusedEntries = hierarchy.filter(
                    (hierarchyEntry) =>
                        !usedNames.some((usedName) => hierarchyEntry.name.toLowerCase() === usedName.toLowerCase()),
                );

                // Build hint from unused entries (reverse order)
                remainingHierarchy = unusedEntries
                    .reverse()
                    .map((h) => h.name)
                    .join(" / ");
            }
            const hint = remainingHierarchy || "";

            return {
                value: result,
                label,
                hint: hint || "",
            };
        });

        // Add pagination option if there are more results
        if (endIndex < totalCount) {
            options.push({
                value: "next_page",
                label: kleur.blue("→ Show more results"),
                hint: `Results ${endIndex + 1}-${Math.min(endIndex + PAGE_SIZE, totalCount)} of ${totalCount}`,
            });
        }

        // Add previous page option if not on first page
        if (currentPage > 0) {
            options.unshift({
                value: "prev_page",
                label: kleur.blue("← Previous page"),
                hint: `Results ${startIndex - PAGE_SIZE + 1}-${startIndex} of ${totalCount}`,
            });
        }

        const message =
            totalCount > PAGE_SIZE
                ? `Select the area you're looking for: (${kleur.cyan(`${startIndex + 1}-${endIndex} of ${totalCount} results`)})`
                : "Select the area you're looking for:";

        const selected = await select({
            message,
            options: options as Option<string | Division>[], // Type assertion for clack compatibility
        });

        if (typeof selected === "symbol") {
            successExit("Division selection cancelled");
        }

        // Handle pagination navigation
        if (selected === "next_page") {
            currentPage++;
            continue;
        } else if (selected === "prev_page") {
            currentPage--;
            continue;
        }

        // User selected a division
        return selected as Division;
    }
}

/**
 * Finds the shortest unique hierarchy path for a result by comparing with other results
 */
function getUniqueHierarchyPath(result: Division, allResults: Division[]): string {
    if (!result.hierarchies?.[0]) return result.id;

    const hierarchy = result.hierarchies[0];

    // Start with the most specific (last) entry and add parents until unique
    // Build path in REVERSE order (most specific first)
    for (let i = hierarchy.length - 1; i >= 0; i--) {
        const candidatePath = hierarchy
            .slice(i)
            .reverse()
            .map((h) => h.name)
            .join(" / ");

        // Check if this path is unique among all results
        const isUnique =
            allResults.filter((other) => {
                if (other.id === result.id) return true; // always match self
                if (!other.hierarchies?.[0]) return false;

                const otherHierarchy = other.hierarchies[0];
                const otherPath = otherHierarchy
                    .slice(i)
                    .reverse()
                    .map((h) => h.name)
                    .join(" / ");

                return otherPath === candidatePath;
            }).length === 1;

        if (isUnique) {
            return candidatePath;
        }
    }

    // Fallback to full hierarchy in REVERSE order (most specific first)
    return hierarchy
        .slice()
        .reverse()
        .map((h) => h.name)
        .join(" / ");
}

/**
 * Displays selected division information to the user.
 * @param division - Selected division object
 * @param config - Config object containing locale preference
 */
export function displaySelectedDivision(division: Division, config?: Config): void {
    const subtype = division.subtype || "Unknown";
    const locale = config?.locale || DEFAULT_LOCALE;

    // Helper function to get name by locale with fallbacks
    const getNameByLocale = (targetLocale: string): string | undefined => {
        return division.names?.common?.find((name: { key: string; value: string }) => name.key === targetLocale)?.value;
    };

    // Get primary name (local language) - fallback to first common name if primary doesn't exist
    const primaryName = division.names?.primary || "-";

    // Get localized name based on config.locale
    const localizedName = getNameByLocale(locale);

    // Build reverse hierarchy, skipping the last entry
    const hierarchy =
        division.hierarchies?.[0]
            ?.slice(0, -1) // Skip the last entry
            .reverse()
            .map((h: { division_id: string; subtype: string; name: string }) => h.name)
            .join(" / ") || "";

    // Build note content
    const noteLines = [];

    // Primary Name (local language)
    noteLines.push(`${kleur.bold("Name:")} ${kleur.cyan(primaryName)}`);

    // Localized name (if different from primary)
    if (localizedName && localizedName !== primaryName) {
        const localeLabel = locale.toUpperCase();
        noteLines.push(`${kleur.bold(`Name (${localeLabel}):`)} ${kleur.cyan(localizedName)}`);
    }

    // Level : subtype (in magenta)
    noteLines.push(`${kleur.bold("Level:")} ${kleur.magenta(subtype)}`);

    // Hierarchy : Reverse hierarchy (skip the last entry)
    if (hierarchy) {
        noteLines.push(`${kleur.bold("Hierarchy:")} ${kleur.gray(hierarchy)}`);
    }

    // Id : division id
    noteLines.push(`${kleur.bold("ID:")} ${kleur.yellow(division.id)}`);

    note(noteLines.join("\n"), "Selected Division");
}
