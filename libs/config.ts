import { DEFAULT_XMAX, DEFAULT_XMIN, DEFAULT_YMAX, DEFAULT_YMIN } from "./constants";
import type { CliArgs, InitialConfig } from "./types";

const CONFIG: InitialConfig = {
    outputDir: "./data",
    releaseFn: "releases.json",
    releaseUrl: "https://docs.overturemaps.org/release-calendar/",
    bbox: {
        xmin: process.env.BBOX_XMIN ? parseFloat(process.env.BBOX_XMIN) : DEFAULT_XMIN,
        ymin: process.env.BBOX_YMIN ? parseFloat(process.env.BBOX_YMIN) : DEFAULT_YMIN,
        xmax: process.env.BBOX_XMAX ? parseFloat(process.env.BBOX_XMAX) : DEFAULT_XMAX,
        ymax: process.env.BBOX_YMAX ? parseFloat(process.env.BBOX_YMAX) : DEFAULT_YMAX,
    },
    divisionId: process.env.DIVISION_ID || undefined,
};

/**
 * Returns the application configuration object with environment variables and defaults.
 * @returns Config object containing all application settings
 */
export function getConfig(): InitialConfig {
    return CONFIG;
}

/**
 * Applies CLI arguments to the configuration object, overriding environment variables and defaults.
 * @param config - The configuration object to update
 * @param args - The CLI arguments to apply
 */
export function applyArgs(config: InitialConfig, args: CliArgs): void {
    // Override division ID if provided via CLI
    if (args.divisionId) {
        config.divisionId = args.divisionId;
    }

    // Override bbox if provided via CLI
    if (args.bbox) {
        config.bbox = args.bbox;
    }
}

/**
 * Reloads configuration from environment variables and applies CLI args.
 * This is called after resetting preferences to ensure proper fallback to reloaded env vars.
 * @param config - The configuration object to update
 * @param cliArgs - The CLI arguments to reapply
 */
export function reloadConfig(config: InitialConfig, cliArgs: CliArgs): void {
    // Reload environment variables into config
    config.bbox = {
        xmin: DEFAULT_XMIN,
        ymin: DEFAULT_YMIN,
        xmax: DEFAULT_XMAX,
        ymax: DEFAULT_YMAX,
    };
    config.divisionId = undefined;

    // Reapply CLI args (they will override environment variables if present)
    applyArgs(config, cliArgs);
}
