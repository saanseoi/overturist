import { DEFAULT_LOCALE, DEFAULT_XMAX, DEFAULT_XMIN, DEFAULT_YMAX, DEFAULT_YMIN } from "./constants";
import type { CliArgs, InitialConfig } from "./types";

const CONFIG: InitialConfig = {
    locale: DEFAULT_LOCALE,
    outputDir: "./data",
    releaseFn: "releases.json",
    releaseUrl: "https://docs.overturemaps.org/release-calendar/",
    bbox: {
        xmin: DEFAULT_XMIN,
        ymin: DEFAULT_YMIN,
        xmax: DEFAULT_XMAX,
        ymax: DEFAULT_YMAX,
    },
    divisionId: undefined,
    noClip: undefined,
};

/**
 * Applies environment variables to a configuration object if they are defined.
 * @param config - The configuration object to update
 * @returns The updated configuration object
 */
function applyEnvVars(config: InitialConfig): InitialConfig {
    const updatedConfig = { ...config };

    // Apply locale if defined
    if (process.env.LOCALE) {
        updatedConfig.locale = process.env.LOCALE;
    }

    // Apply bbox coordinates if defined
    if (process.env.BBOX_XMIN !== undefined) {
        updatedConfig.bbox.xmin = parseFloat(process.env.BBOX_XMIN);
    }
    if (process.env.BBOX_YMIN !== undefined) {
        updatedConfig.bbox.ymin = parseFloat(process.env.BBOX_YMIN);
    }
    if (process.env.BBOX_XMAX !== undefined) {
        updatedConfig.bbox.xmax = parseFloat(process.env.BBOX_XMAX);
    }
    if (process.env.BBOX_YMAX !== undefined) {
        updatedConfig.bbox.ymax = parseFloat(process.env.BBOX_YMAX);
    }

    // Apply division ID if defined
    if (process.env.DIVISION_ID) {
        updatedConfig.divisionId = process.env.DIVISION_ID;
    }

    // Apply noClip environment variables
    // NO_CLIP_BBOX takes precedence over NO_CLIP_GEOM
    if (process.env.NO_CLIP_BBOX === "1") {
        updatedConfig.noClip = "bbox";
    } else if (process.env.NO_CLIP_GEOM === "1") {
        updatedConfig.noClip = "geom";
    }

    return updatedConfig;
}

/**
 * Applies CLI arguments to a configuration object if they are defined.
 * CLI arguments take precedence over environment variables and defaults.
 * @param config - The configuration object to update
 * @param cliArgs - The CLI arguments to apply
 * @returns The updated configuration object
 */
function applyCliArgs(config: InitialConfig, cliArgs: Partial<CliArgs>): InitialConfig {
    const updatedConfig = { ...config };

    // Apply division ID if provided via CLI
    if (cliArgs.divisionId) {
        updatedConfig.divisionId = cliArgs.divisionId;
    }

    // Apply bbox if provided via CLI
    if (cliArgs.bbox) {
        updatedConfig.bbox = cliArgs.bbox;
    }

    // Apply noClip CLI arguments
    // NO_CLIP_BBOX takes precedence over NO_CLIP_GEOM
    if (cliArgs.noClipBbox) {
        updatedConfig.noClip = "bbox";
    } else if (cliArgs.noClipGeom) {
        updatedConfig.noClip = "geom";
    }

    return updatedConfig;
}

/**
 * Returns the application configuration object with defaults, environment variables, and CLI arguments applied.
 * @param cliArgs - Optional CLI arguments to merge with environment config
 * @param ignoreEnv - If true, skip applying environment variables (defaults only)
 * @returns Config object containing all application settings
 */
export function getConfig(cliArgs?: Partial<CliArgs>, ignoreEnv: boolean = false): InitialConfig {
    let config = { ...CONFIG };

    // Apply environment variables if not ignored
    if (!ignoreEnv) {
        config = applyEnvVars(config);
    }

    // Apply CLI arguments if provided (takes precedence over environment variables and defaults)
    if (cliArgs) {
        config = applyCliArgs(config, cliArgs);
    }

    // Validate and adjust configuration based on compatibility rules
    config = validateConfig(config, cliArgs);

    return config;
}

/**
 * Validates and adjusts configuration based on compatibility rules.
 * @param config - The configuration object to validate
 * @param cliArgs - The CLI arguments that were applied
 * @returns The potentially modified configuration object
 */
export function validateConfig(config: InitialConfig, cliArgs?: Partial<CliArgs>): InitialConfig {
    const validatedConfig = { ...config };
    const { log } = require("@clack/prompts");
    const kleur = require("kleur");

    // Handle noClip="bbox" conflicts with divisionId
    if (validatedConfig.noClip === "bbox" && validatedConfig.divisionId) {
        const wasCliNoClipGeom = cliArgs?.noClipGeom;
        const wasEnvNoClipGeom = process.env.NO_CLIP_GEOM === "1";

        if (wasCliNoClipGeom || wasEnvNoClipGeom) {
            // Adapt to "boundary" mode if boundary clipping was requested
            validatedConfig.noClip = "geom";
            log.warn(kleur.yellow("⚠️  Adjusted NO_CLIP_BBOX to NO_CLIP_GEOM due to DIVISION_ID conflict"));
            log.info(
                kleur.gray("   Results will be filtered by the Division BBox and boundary geometry will be ignored"),
            );
        } else {
            // Fall back to undefined (enable both bbox and boundary clipping)
            validatedConfig.noClip = undefined;
            log.warn(kleur.yellow("⚠️  NO_CLIP_BBOX is ignored when DIVISION_ID is set"));
            log.info(kleur.gray("   Both bbox and boundary filtering will be applied"));
        }
    }

    // Handle noClip="bbox" conflicts with BBOX_* environment variables
    const hasBboxEnvVars =
        process.env.BBOX_XMIN || process.env.BBOX_YMIN || process.env.BBOX_XMAX || process.env.BBOX_YMAX;
    if (validatedConfig.noClip === "bbox" && hasBboxEnvVars) {
        validatedConfig.noClip = undefined;
        log.warn(kleur.yellow("⚠️  NO_CLIP_BBOX will be ignored when BBOX_* variables are set"));
        log.info(kleur.gray("   Bbox filtering will still be applied"));
    }

    // Warn if both NO_CLIP_BBOX and NO_CLIP_BOUNDARY are set
    const noClipBboxEnv = process.env.NO_CLIP_BBOX === "1";
    const noClipBoundaryEnv = process.env.NO_CLIP_BOUNDARY === "1";
    if (noClipBboxEnv && noClipBoundaryEnv) {
        log.info(kleur.blue("ℹ️  Both NO_CLIP_BBOX and NO_CLIP_BOUNDARY detected"));
        log.info(kleur.gray("   NO_CLIP_BBOX takes precedence"));
    }

    return validatedConfig;
}

/**
 * Reloads configuration respecting CLI args, but ignoring environment variables
 * This is called after resetting preferences to ensure proper fallback to defaulted env vars.
 * @param config - The configuration object to update
 * @param cliArgs - The CLI arguments to reapply
 */
export function reloadConfig(config: InitialConfig, cliArgs: CliArgs): void {
    const freshConfig = getConfig(cliArgs, true);
    Object.assign(config, freshConfig);
}
