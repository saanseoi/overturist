import { log } from '@clack/prompts'
import kleur from 'kleur'
import { DEFAULT_LOCALE, DEFAULT_ON_FILE_EXISTS, DEFAULT_TARGET } from './constants'
import { extractBoundsFromDivisionGeometry } from '../workflows/processing'
import type {
  BBox,
  CliArgs,
  Config,
  Division,
  Geometry,
  InteractiveOptions,
  OnExistingFilesAction,
  SpatialFrame,
  SpatialGeometryMode,
  SpatialPredicate,
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
  spatialFrame: 'division',
  spatialPredicate: 'intersects',
  spatialGeometry: 'clip-smart',
  onFileExists: undefined,
}
/**
 * Applies environment variables to a configuration object if they are defined.
 * @param config - The configuration object to update
 * @returns The updated configuration object
 */
function applyEnvVars(config: Config): Config {
  const updatedConfig = { ...config }

  // Apply the configured filter mode if defined. `TARGET` remains a compatibility alias.
  const configuredFilterMode = process.env.FILTER_MODE || process.env.TARGET
  if (configuredFilterMode) {
    updatedConfig.target = validateTarget(configuredFilterMode)
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

  // Apply spatial filtering controls when defined.
  if (process.env.SPATIAL_FRAME) {
    updatedConfig.spatialFrame = validateSpatialFrame(process.env.SPATIAL_FRAME)
  }

  if (process.env.SPATIAL_PREDICATE) {
    updatedConfig.spatialPredicate = validateSpatialPredicate(
      process.env.SPATIAL_PREDICATE,
    )
  }

  if (process.env.SPATIAL_GEOMETRY) {
    updatedConfig.spatialGeometry = validateSpatialGeometry(
      process.env.SPATIAL_GEOMETRY,
    )
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
 * Validates the configured spatial frame.
 * @param frame - Raw frame from environment variables or CLI input
 * @returns Normalized spatial frame
 */
export function validateSpatialFrame(frame: string | undefined): SpatialFrame {
  const validFrames: SpatialFrame[] = ['division', 'bbox']

  if (frame && !validFrames.includes(frame as SpatialFrame)) {
    bail(
      `Invalid SPATIAL_FRAME: ${frame} ${kleur.grey(`- use ${validFrames.join(', ')}`)}`,
    )
  } else if (frame && validFrames.includes(frame as SpatialFrame)) {
    return frame as SpatialFrame
  }

  return 'division'
}

/**
 * Validates the configured spatial predicate.
 * @param predicate - Raw predicate from environment variables or CLI input
 * @returns Normalized spatial predicate
 */
export function validateSpatialPredicate(
  predicate: string | undefined,
): SpatialPredicate {
  const validPredicates: SpatialPredicate[] = ['intersects', 'within']

  if (predicate && !validPredicates.includes(predicate as SpatialPredicate)) {
    bail(
      `Invalid SPATIAL_PREDICATE: ${predicate} ${kleur.grey(`- use ${validPredicates.join(', ')}`)}`,
    )
  } else if (predicate && validPredicates.includes(predicate as SpatialPredicate)) {
    return predicate as SpatialPredicate
  }

  return 'intersects'
}

/**
 * Validates the configured spatial geometry mode.
 * @param geometry - Raw geometry mode from environment variables or CLI input
 * @returns Normalized spatial geometry mode
 */
export function validateSpatialGeometry(
  geometry: string | undefined,
): SpatialGeometryMode {
  const validGeometryModes: SpatialGeometryMode[] = [
    'preserve',
    'clip-smart',
    'clip-all',
  ]

  if (geometry && !validGeometryModes.includes(geometry as SpatialGeometryMode)) {
    bail(
      `Invalid SPATIAL_GEOMETRY: ${geometry} ${kleur.grey(`- use ${validGeometryModes.join(', ')}`)}`,
    )
  } else if (geometry && validGeometryModes.includes(geometry as SpatialGeometryMode)) {
    return geometry as SpatialGeometryMode
  }

  return 'clip-smart'
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
  // Resolve the requested target from interactive input, explicit location flags, then config defaults.
  const target = resolveRequestedTarget(config, cliArgs, interactiveOpts)

  return { target: validateTargetConfig(config, cliArgs, target) }
}

/**
 * Resolves the requested target before precedence rules are normalized.
 * @param config - Configuration object with environment-derived defaults
 * @param cliArgs - Parsed CLI arguments
 * @param interactiveOpts - Interactive overrides
 * @returns Requested target before world/division/bbox conflict handling
 */
function resolveRequestedTarget(
  config: Config,
  cliArgs: CliArgs,
  interactiveOpts?: InteractiveOptions | false,
): Target {
  if (interactiveOpts !== false && interactiveOpts?.target) {
    return interactiveOpts.target
  }

  if (
    cliArgs.divisionRequested ||
    cliArgs.osmIdRequested ||
    cliArgs.divisionId ||
    cliArgs.osmId
  ) {
    return 'division'
  }

  if (cliArgs.bboxRequested || cliArgs.bbox) {
    return 'bbox'
  }

  if (cliArgs.frame === 'bbox' && (cliArgs.bbox || config.bbox)) {
    return 'bbox'
  }

  if (cliArgs.world) {
    return 'world'
  }

  if (
    config.spatialFrame === 'bbox' &&
    config.bbox &&
    !config.divisionId &&
    !cliArgs.divisionId &&
    !cliArgs.osmId
  ) {
    return 'bbox'
  }

  return config.target
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
  const hasDivisionId =
    cliArgs.divisionId || cliArgs.osmId || config.divisionId || false
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
): Promise<{
  bbox: BBox | null
  spatialFrame: SpatialFrame
  spatialPredicate: SpatialPredicate
  spatialGeometry: SpatialGeometryMode
  geometry: Geometry | null
}> {
  // WORLD TARGET
  if (target === 'world') {
    // Download world geometry
    return {
      bbox: null,
      spatialFrame: validateSpatialFrame(cliArgs.frame || config.spatialFrame),
      spatialPredicate: validateSpatialPredicate(
        cliArgs.predicate || config.spatialPredicate,
      ),
      spatialGeometry: validateSpatialGeometry(
        cliArgs.geometry || config.spatialGeometry,
      ),
      geometry: null,
    }
  }
  const spatialFrame = validateSpatialFrame(
    cliArgs.frame || config.spatialFrame || target,
  )
  const spatialPredicate = validateSpatialPredicate(
    cliArgs.predicate || config.spatialPredicate,
  )
  const spatialGeometry = validateSpatialGeometry(
    cliArgs.geometry || config.spatialGeometry,
  )
  const bbox = cliArgs.bbox || config.bbox

  if (spatialFrame === 'bbox' && !bbox) {
    bail('You must provide a bounding box when using frame=bbox')
  }

  if (spatialFrame === 'bbox' && bbox) {
    return {
      bbox,
      geometry: null,
      spatialFrame,
      spatialPredicate,
      spatialGeometry,
    }
  }

  if (target === 'division' && !division) {
    // This should never run
    bail('You must provide a DivisionId if you are using the division target')
  }

  // Extract bounds from division geometry
  const bounds = await extractBoundsFromDivisionGeometry(
    releaseVersion,
    division,
    divisionId,
  )
  if (!bounds?.bbox || !bounds.geometry) {
    bail('Division frame requires valid division geometry and bbox')
  }
  return {
    bbox: bbox || bounds?.bbox || null,
    geometry: bounds.geometry,
    spatialFrame,
    spatialPredicate,
    spatialGeometry,
  }
}
