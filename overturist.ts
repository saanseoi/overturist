#!/usr/bin/env bun
import kleur from "kleur";
import { handleArguments } from "./libs/args";
import { getCmd } from "./libs/commands";
import { applyArgs, getConfig } from "./libs/config";
import { handleMainMenu } from "./libs/interactive";

const CONFIG = getConfig();

/**
 * CLI entry point for Overturist.
 *
 * This CLI tool is designed to extract geospatial data from the Overture Maps Foundation's (OMF) S3 bucket.
 * OMF segments their releases by themes and featureTypes. This script tool downloads all available feature types
 * for a defined geographic region and stores them as parquet files.
 *
 * Current functionality:
 * - Extract data from Overture Maps S3 releases using DuckDB spatial queries
 * - Supports bounding box and administrative division-based filtering
 * - Displays download progress with diffs against the previous release
 * - Handles existing file management (skip/replace/abort)
 * - Supports both latest and historical release processing (where available).
 *
 * @throws Will exit with code 1 if release context cannot be determined or if unexpected errors occur
 */
async function main() {
    // Parse arguments and show examples or help if required
    const cliArgs = handleArguments();

    // Apply CLI arguments to configuration (overrides environment variables and defaults)
    applyArgs(CONFIG, cliArgs);

    // If get command is used, run in non-interactive mode
    if (cliArgs.get) {
        await getCmd(CONFIG, cliArgs);
        return;
    }

    // Interactive mode
    await handleMainMenu(CONFIG, cliArgs);
}

main().catch((e) => {
    if (e instanceof Error) {
        console.error(kleur.red(`✖ ${e.message}`));
    } else {
        console.error(kleur.red("An unexpected error occurred:"));
        console.error(e);
    }
    process.exit(1);
});
