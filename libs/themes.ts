import { log, spinner } from '@clack/prompts'
import kleur from 'kleur'
import { cacheThemeMapping, getCachedThemeMapping } from './cache'
import { getPrecedingReleaseVersion } from './releases'
import { getFeatureTypesForVersion } from './s3'
import type {
  CliArgs,
  Config,
  InteractiveOptions,
  ReleaseData,
  Spinner,
  ThemeMapping,
  Version,
} from './types'
import { promptUserForThemeAction, selectFeatureTypesInteractively } from './ui'
import { failedExit } from './utils'
import { compareThemeMappings } from './validation'

/**
 * THEME MAPPING
 */

/**
 * Initializes the theme mapping by loading existing or creating new mapping from S3 data.
 * @param config - Configuration object
 * @param cliArgs - Command line arguments
 * @param interactiveOpts - Interactive options (undefined = use defaults, false = non-interactive)
 * @param releaseVersion - Release version to initialize theme mapping for
 * @param releaseData - Release data containing version information
 * @returns Promise resolving to theme mapping and filtered feature types
 */
export async function initializeThemeMapping(
  releaseVersion: Version,
  releaseData: ReleaseData,
  config: Config,
  cliArgs: CliArgs,
  interactiveOpts?: InteractiveOptions | false,
): Promise<{
  themeMapping: ThemeMapping
  featureTypes: string[]
}> {
  const s = spinner()
  s.start('Resolving theme mapping')
  let wasSpinnerStopped = false

  // Step 1: Load or create theme mapping for selected version
  const { themeMapping, isNew, precedingThemeMapping } = await loadOrCreateThemeMapping(
    releaseVersion,
    releaseData,
    s,
  )

  // Step 2: Validate theme mapping against previous version if this is a new version
  if (isNew && precedingThemeMapping) {
    wasSpinnerStopped = await validateThemeMappingAgainstPrevious(
      releaseVersion,
      themeMapping,
      precedingThemeMapping,
      s,
    )
  } else if (isNew) {
    log.warn(
      'Cannot validate without prior version. Confirm S3 release is complete and accessible.',
    )
  }

  if (!wasSpinnerStopped) {
    s.stop(
      `Validated theme mapping : ${kleur.green(new Set(Object.values(themeMapping)).size)} themes and ${kleur.green(Object.keys(themeMapping).length)} types`,
    )
  }

  // Step 3: Determine which feature types to include
  const featureTypes = await selectFeatureTypes(
    themeMapping,
    config,
    cliArgs,
    interactiveOpts,
  )

  return { themeMapping, featureTypes }
}

/**
 * THEME MAPPING :: UTILS
 */

/**
 * Loads theme mapping for a given version or creates it if it doesn't exist.
 * @param version - The target release version
 * @param releaseData - Release data for fallback theme mapping creation
 * @returns Promise resolving to loaded or created theme mapping
 */
async function loadOrCreateThemeMapping(
  version: Version,
  releaseData: ReleaseData,
  spinner: Spinner,
): Promise<{
  themeMapping: ThemeMapping
  isNew: boolean
  precedingThemeMapping?: ThemeMapping | null
}> {
  // Strategy 1: Check if theme_mapping.json exists in cache for this version
  try {
    const cachedMapping = await getCachedThemeMapping(version)
    // Step 1. Version is considered validated and can be used as is
    if (cachedMapping) {
      return {
        themeMapping: cachedMapping,
        isNew: false,
      }
    }
  } catch {
    // Cache doesn't exist, proceed to create new mapping
  }

  // Strategy 2. No cached mapping exists, need to create new theme_mapping.json for this version
  spinner.message('Creating new theme mapping')

  // Step 1: Get the preceding version
  const precedingVersion = getPrecedingReleaseVersion(version, releaseData)
  if (!precedingVersion) {
    // No preceding version, create mapping from current version (don't cache yet)
    const themeMapping = await getOrCreateThemeMapping(version, false)
    return {
      themeMapping,
      isNew: true,
      precedingThemeMapping: null,
    }
  }

  // Step 2: Ensure preceding version mapping exists (always cache preceding versions)
  // The preceding version is always stable on S3 - i.e. we don't run the
  // risk that we are building a mapping while the directories are still
  // being uploaded.
  const precedingThemeMapping = await getOrCreateThemeMapping(precedingVersion, true)

  // Step 4: Create mapping for selected version (don't cache yet)
  const selectedThemeMapping = await getOrCreateThemeMapping(version, false)

  return {
    themeMapping: selectedThemeMapping,
    isNew: true,
    precedingThemeMapping,
  }
}

/**
 * Creates a theme mapping from S3 feature types for a given version.
 * @param version - The release version to create theme mapping from
 * @returns Promise resolving to ThemeMapping object
 */
async function createThemeMappingFromVersion(version: Version): Promise<ThemeMapping> {
  const s3FeatureTypes = await getFeatureTypesForVersion(version)
  const themeMapping: ThemeMapping = {}

  // Create mapping from feature types to themes
  for (const [theme, featureTypes] of Object.entries(s3FeatureTypes)) {
    for (const featureType of featureTypes) {
      themeMapping[featureType] = theme
    }
  }

  return themeMapping
}

/**
 * Gets a theme mapping from cache or creates a new one, optionally caching it.
 * @param version - The release version to get or create theme mapping for
 * @param cache - Whether to cache the created theme mapping (default: false)
 * @returns Promise resolving to ThemeMapping object
 */
async function getOrCreateThemeMapping(
  version: Version,
  cache: boolean = false,
): Promise<ThemeMapping> {
  // First check if it already exists in cache
  const cachedMapping = await getCachedThemeMapping(version)
  if (cachedMapping) {
    return cachedMapping
  }

  // Create new theme mapping
  const themeMapping = await createThemeMappingFromVersion(version)

  // Optionally cache it
  if (cache) {
    await cacheThemeMapping(version, themeMapping)
  }

  return themeMapping
}

/**
 * Validates theme mapping against previous version and caches if needed.
 */
async function validateThemeMappingAgainstPrevious(
  releaseVersion: Version,
  themeMapping: ThemeMapping,
  precedingThemeMapping: ThemeMapping,
  spinner: Spinner,
): Promise<boolean> {
  // Compare current mapping with preceding mapping to find differences
  const differences = compareThemeMappings(themeMapping, precedingThemeMapping)

  // If there are no differences, cache the current mapping
  if (!differences.hasDifferences) {
    await cacheThemeMapping(releaseVersion, themeMapping)
    spinner.message('Theme mapping validated and cached')
    return false
  }

  // Stop spinner for user interaction
  spinner.stop('Theme differences detected.')

  // Prompt user for action using UI
  const action = await promptUserForThemeAction(differences)

  await handleThemeAction(action, releaseVersion, themeMapping)
  return true
}

/**
 * Handles the user's chosen action for theme differences.
 * @param action - User's chosen action
 * @param validationResult - Validation result containing differences and theme mapping
 * @param version - Release version to cache the theme mapping for
 */
export async function handleThemeAction(
  action: 'update' | 'cancel',
  releaseVersion: Version,
  themeMapping?: ThemeMapping,
): Promise<ThemeMapping | null> {
  switch (action) {
    case 'cancel':
      failedExit('User said no.')
      break

    case 'update':
      // Return the existing theme mapping to be cached
      if (themeMapping) {
        // Cache the mapping
        await cacheThemeMapping(releaseVersion, themeMapping)
        log.success(
          `Theme mapping updated and cached with ${kleur.green(Object.keys(themeMapping).length)} feature types`,
        )
        return themeMapping
      } else {
        // User cancelled
        log.error('Schema changes detected but mapping not updated')
      }
  }
  return null
}

/**
 * UTILS :: FEATURE TYPES
 */

/**
 * Gets feature types from CLI args and ENV variables, validates them, and returns either valid types or prompts user.
 * Priority: CLI args > ENV variables > Interactive > Default (all)
 */
async function selectFeatureTypes(
  themeMapping: ThemeMapping,
  config: Config,
  cliArgs: CliArgs,
  interactiveOpts?: InteractiveOptions | false,
): Promise<string[]> {
  const state = {
    featureTypes: [] as string[],
    shouldPrompt: false,
  }

  // Handle CLI args first (highest priority)
  handleCliArgsForThemeMapping(cliArgs, themeMapping, state)

  // Throw error in non-interactive mode if invalid CLI args
  if (state.shouldPrompt && interactiveOpts === false) {
    const { invalid } = validateFeatureTypes(cliArgs.types || [], themeMapping)
    throw new Error(`Invalid feature types in CLI arguments: ${invalid.join(', ')}`)
  }

  // Handle environment variables if no valid CLI args
  if (!state.shouldPrompt && state.featureTypes.length === 0) {
    handleEnvVarsForThemeMapping(config, themeMapping, state)
  }

  if (!state.shouldPrompt && state.featureTypes.length > 0) {
    // If we have valid types and no need to prompt, return them
    return state.featureTypes
  } else if (interactiveOpts !== false) {
    // Interactive mode - Prompt user to select feature types
    return await selectFeatureTypesInteractively(themeMapping, state.featureTypes)
  } else {
    // Non-Interactive Mode - Default to all feature types
    log.info(`Using all ${Object.keys(themeMapping).length} available feature types`)
    return Object.keys(themeMapping)
  }
}

/**
 * Handles CLI argument processing for feature types and themes.
 * @param cliArgs - Command line arguments
 * @param themeMapping - Current theme mapping
 * @param allFeatureTypes - All available feature types
 * @param state - Mutable state object to update with results
 */
function handleCliArgsForThemeMapping(
  cliArgs: CliArgs,
  themeMapping: ThemeMapping,
  state: { featureTypes: string[]; shouldPrompt: boolean },
): void {
  if (cliArgs.types && cliArgs.types.length > 0) {
    const { valid, invalid } = validateFeatureTypes(cliArgs.types, themeMapping)

    if (invalid.length > 0) {
      log.warn(
        `Invalid feature types in CLI arguments: ${kleur.red(invalid.join(', '))}`,
      )
      state.shouldPrompt = true
    }

    if (valid.length > 0) {
      state.featureTypes = valid
      log.message(`Selected: ${kleur.green(valid.length)} types ${kleur.grey('CLI')}`)
    }
  }

  // Check if themes are specified in CLI args
  if (!state.shouldPrompt && cliArgs.themes && cliArgs.themes.length > 0) {
    const validTypes = Object.keys(themeMapping).filter(type =>
      cliArgs.themes?.includes(themeMapping[type]),
    )

    if (validTypes.length > 0) {
      // Combine with existing types from --types flag, avoiding duplicates
      const combinedTypes = [...new Set([...state.featureTypes, ...validTypes])]
      state.featureTypes = combinedTypes
      log.message(
        `Selected: ${kleur.green(combinedTypes.length)} types ${kleur.grey('CLI')}`,
      )
    }
  }
}

/**
 * Handles environment variable processing for feature types using config.
 * @param config - Configuration object containing parsed environment variables
 * @param themeMapping - Current theme mapping
 * @param state - Mutable state object to update with results
 */
function handleEnvVarsForThemeMapping(
  config: Config,
  themeMapping: ThemeMapping,
  state: { featureTypes: string[]; shouldPrompt: boolean },
): void {
  if (config.featureTypes && config.featureTypes.length > 0) {
    const { valid, invalid } = validateFeatureTypes(config.featureTypes, themeMapping)

    if (invalid.length > 0) {
      log.warn(
        `Invalid feature types in environment variables: ${kleur.red(invalid.join(', '))}`,
      )
      state.shouldPrompt = true
    }

    if (valid.length > 0) {
      state.featureTypes = valid
      state.shouldPrompt = true
      log.message(
        `Pre-selected: ${kleur.green(valid.length)} types ${kleur.grey('ENV')}`,
      )
    }
  }
}

/**
 * Validates feature types against the current theme mapping.
 * @param featureTypes - Feature types to validate
 * @param themeMapping - Current theme mapping
 * @returns Object with valid and invalid types
 */
function validateFeatureTypes(
  featureTypes: string[],
  themeMapping: ThemeMapping,
): {
  valid: string[]
  invalid: string[]
} {
  const allFeatureTypes = Object.keys(themeMapping)
  const valid = featureTypes.filter(type => allFeatureTypes.includes(type))
  const invalid = featureTypes.filter(type => !allFeatureTypes.includes(type))
  return { valid, invalid }
}
