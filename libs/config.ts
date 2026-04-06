import { log } from '@clack/prompts'
import kleur from 'kleur'
import { DEFAULT_LOCALE, DEFAULT_ON_FILE_EXISTS, DEFAULT_TARGET } from './constants'
import { extractBoundsFromDivisionGeometry } from './processing'
import type {
  BBox,
  CliArgs,
  Config,
  Division,
  Geometry,
  InteractiveOptions,
  OnExistingFilesAction,
  Target,
  Version,
} from './types'
import { bail } from './utils'

const CONFIG: Config = {
  locale: DEFAULT_LOCALE,
  outputDir: './data',
  releaseFn: 'releases.json',
  releaseUrl: 'https://docs.overturemaps.org/release-calendar/',
  target: DEFAULT_TARGET,
  confirmFeatureSelection: true,
  bbox: undefined,
  divisionId: undefined,
  noClip: undefined,
  onFileExists: undefined,
}
/**
 * Applies environment variables to a configuration object if they are defined.
 * @param config - The configuration object to update
 * @returns The updated configuration object
 */
function applyEnvVars(config: Config): Config {
  const updatedConfig = { ...config }

  // Apply download target if defined
  if (process.env.TARGET) {
    updatedConfig.target = validateTarget(process.env.TARGET)
  }

  // Apply locale if defined
  if (process.env.LOCALE) {
    updatedConfig.locale = process.env.LOCALE
  }

  // Apply bbox coordinates only if ALL are defined
  if (
    process.env.BBOX_XMIN !== undefined &&
    process.env.BBOX_YMIN !== undefined &&
    process.env.BBOX_XMAX !== undefined &&
    process.env.BBOX_YMAX !== undefined
  ) {
    updatedConfig.bbox = {
      xmin: parseFloat(process.env.BBOX_XMIN),
      ymin: parseFloat(process.env.BBOX_YMIN),
      xmax: parseFloat(process.env.BBOX_XMAX),
      ymax: parseFloat(process.env.BBOX_YMAX),
    }
  }

  // Apply division ID if defined
  if (process.env.DIVISION_ID) {
    updatedConfig.divisionId = process.env.DIVISION_ID
  }

  // Apply boundary-filter environment variable.
  if (process.env.SKIP_BOUNDARY_FILTER === '1') {
    updatedConfig.noClip = true
  } else if (process.env.SKIP_BOUNDARY_FILTER === '0') {
    updatedConfig.noClip = false
  }

  // Apply featureTypes
  if (process.env.FEATURE_TYPES) {
    updatedConfig.featureTypes = process.env.FEATURE_TYPES.split(',')
  }

  // Apply interactive feature confirmation preference.
  if (process.env.CONFIRM_FEATURE_SELECTION) {
    updatedConfig.confirmFeatureSelection = validateBooleanConfig(
      process.env.CONFIRM_FEATURE_SELECTION,
      'CONFIRM_FEATURE_SELECTION',
    )
  }

  // Apply onFileExists
  if (process.env.ON_FILE_EXISTS) {
    updatedConfig.onFileExists = validateOnFileExists(process.env.ON_FILE_EXISTS)
  }

  return updatedConfig
}

/**
 * Returns the application configuration object with defaults, environment variables, and CLI arguments applied.
 * @param ignoreEnv - If true, skip applying environment variables and return defaults only
 * @returns Config object containing all application settings
 * @remarks CLI overrides are applied later by the runtime initializers, not in this function.
 */
export function getConfig(ignoreEnv: boolean = false): Config {
  let config = { ...CONFIG }

  // Apply environment variables if not ignored
  if (!ignoreEnv) {
    config = applyEnvVars(config)
  }

  return config
}

export function validateTarget(target: string | undefined): Target {
  const validTargets = ['division', 'bbox', 'world']
  if (target && !validTargets.includes(target)) {
    bail(`Invalid target: ${target} ${kleur.grey(`- use ${validTargets.join(', ')}`)}`)
  } else if (target && validTargets.includes(target)) {
    return target as Target
  }
  return DEFAULT_TARGET
}

export function validateOnFileExists(
  action: string | undefined,
): OnExistingFilesAction {
  const validOnFileExists = ['skip', 'replace', 'abort']
  if (action && !validOnFileExists.includes(action)) {
    bail(
      `Invalid OnFileExists: ${action} ${kleur.grey(`- use ${validOnFileExists.join(', ')}`)}`,
    )
  } else if (action && validOnFileExists.includes(action)) {
    return action as OnExistingFilesAction
  }
  return DEFAULT_ON_FILE_EXISTS
}

/**
 * Validates a boolean-like environment variable value.
 * @param value - Raw environment variable value
 * @param envVarName - Environment variable name for error messaging
 * @returns Parsed boolean value
 * @remarks Accepts `true`/`false` and `1`/`0` for parity with existing config flags.
 */
export function validateBooleanConfig(value: string, envVarName: string): boolean {
  const normalizedValue = value.trim().toLowerCase()

  if (normalizedValue === 'true' || normalizedValue === '1') {
    return true
  }

  if (normalizedValue === 'false' || normalizedValue === '0') {
    return false
  }

  bail(`Invalid ${envVarName}: ${value} ${kleur.grey('- use true, false, 1, or 0')}`)
}

/**
 * Reloads configuration defaults while ignoring environment variables.
 * @param config - The live configuration object to refresh in place
 * @returns Nothing. Mutates the provided config object.
 * @remarks This is used after resetting preferences to restore default values only.
 */
export function reloadConfig(config: Config): void {
  const freshConfig = getConfig(true)
  Object.assign(config, freshConfig)
}

// LOCALE
/**
 * Initializes the locale based on configuration and CLI arguments.
 * @param config - The configuration object.
 * @param cliArgs - The CLI arguments.
 * @returns The initialized locale.
 */
export function initializeLocale(config: Config, cliArgs: CliArgs): { locale: string } {
  let locale = DEFAULT_LOCALE
  if (cliArgs.locale) {
    locale = cliArgs.locale
  } else if (config.locale) {
    locale = config.locale
  }
  return { locale }
}

export function initializeTarget(
  config: Config,
  cliArgs: CliArgs,
  interactiveOpts?: InteractiveOptions | false,
): { target: Target } {
  // Resolve the requested target from interactive input, CLI overrides, then config defaults.
  const target =
    (interactiveOpts as InteractiveOptions | undefined)?.target ||
    cliArgs.target ||
    config.target

  return { target: validateTargetConfig(config, cliArgs, target) }
}

/**
 * Normalizes target selection when mutually exclusive location inputs are present.
 * @param config - Configuration object with environment-derived defaults
 * @param cliArgs - Parsed CLI arguments for the current invocation
 * @param target - Initially selected target before precedence rules are applied
 * @returns Final target after resolving division and bbox precedence
 * @remarks Division and bbox inputs override `world` so location-specific filtering is preserved.
 */
export function validateTargetConfig(
  config: Config,
  cliArgs: CliArgs,
  target: Target,
): Target {
  // CASE 1 : target=world AND dividionId - dividionId takes precedence over target=world
  const hasDivisionId = cliArgs.divisionId || config.divisionId || false
  const isTargetWorld = target === 'world'
  if (isTargetWorld && hasDivisionId) {
    log.warn(kleur.yellow('⚠️  Target=world is ignored when DivisionId is set'))
    log.info(kleur.gray('   Search will look for the specified Division'))
    return 'division'
  }
  // CASE 2 : target=world AND BBox - BBox takes precedence over target=world
  const hasBBoxDefined = cliArgs.bbox || config.bbox || false
  if (isTargetWorld && hasBBoxDefined) {
    log.warn(kleur.yellow('⚠️  Target=world is ignored when BBox is set'))
    log.info(kleur.gray('   Search will look for the specified bounding box'))
    return 'bbox'
  }
  // DEFAULT CASE
  return target
}

/**
 * Initializes the bounding box based on configuration and CLI arguments.
 * @param config - The configuration object.
 * @param cliArgs - The CLI arguments.
 * @param interactiveOpts - The interactive options.
 * @returns The initialized bounding box.
 */
export async function initializeBounds(
  config: Config,
  cliArgs: CliArgs,
  target: Target,
  division: Division | null,
  divisionId: string | null,
  releaseVersion: Version,
): Promise<{ bbox: BBox | null; noClip: boolean; geometry: Geometry | null }> {
  // WORLD TARGET
  if (target === 'world') {
    // Download world geometry
    return { bbox: null, noClip: true, geometry: null }
  }
  // Determine clipping behavior based on config
  const noClip = cliArgs.noClip || config.noClip || false
  const bbox = cliArgs.bbox || config.bbox
  // BBOX MODE
  if (target === 'bbox' && !bbox) {
    bail('You must provide a bounding box if you are using the bbox target')
  } else if (target === 'bbox' && bbox) {
    // Download bbox geometry
    return { bbox: bbox, noClip: true, geometry: null }
    // DIVISION TARGET
  } else if (target === 'division' && !division) {
    // This should never run
    bail('You must provide a DivisionId if you are using the division target')
  } else {
    // Extract bounds from division geometry
    const bounds = await extractBoundsFromDivisionGeometry(
      releaseVersion,
      division,
      divisionId,
    )
    return {
      bbox: bbox || bounds?.bbox || null,
      geometry: noClip ? null : bounds?.geometry || null,
      noClip: validateNoClip(noClip),
    }
  }
}

function validateNoClip(noClip: boolean): boolean {
  // DEFAULT CASE
  return noClip
}
