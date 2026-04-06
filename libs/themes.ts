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
import { bail, failedExit } from './utils'
import { compareThemeMappings } from './validation'

type ThemeMappingLoadResult = {
  themeMapping: ThemeMapping
  isNew: boolean
  precedingThemeMapping?: ThemeMapping | null
}

type FeatureSelectionSource = 'cli' | 'env'

type FeatureSelectionRequest = {
  featureTypes: string[]
  source: FeatureSelectionSource
  shouldConfirm: boolean
}

/**
 * Initializes the theme mapping by loading existing or creating new mapping from S3 data.
 * @param releaseVersion - Release version to initialize theme mapping for
 * @param releaseData - Release data containing version information
 * @param config - Configuration object
 * @param cliArgs - Command line arguments
 * @param interactiveOpts - Interactive options (`false` = non-interactive)
 * @returns Promise resolving to theme mapping and filtered feature types
 * @remarks Interactive confirmation is controlled by `config.confirmFeatureSelection`
 * and is skipped for programmatic `get` commands.
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
 * Loads theme mapping for a given version or creates it if it doesn't exist.
 * @param version - The target release version
 * @param releaseData - Release metadata used to locate the preceding version
 * @param spinner - Active spinner used to report progress to the CLI
 * @returns Promise resolving to the cached or newly created theme mapping state
 */
async function loadOrCreateThemeMapping(
  version: Version,
  releaseData: ReleaseData,
  spinner: Spinner,
): Promise<ThemeMappingLoadResult> {
  // Reuse cached mappings as already-validated release snapshots.
  const cachedMapping = await getCachedThemeMapping(version)
  if (cachedMapping) {
    return {
      themeMapping: cachedMapping,
      isNew: false,
    }
  }

  // Build a fresh mapping for versions that have not yet been validated and cached.
  spinner.message('Creating new theme mapping')

  const precedingVersion = getPrecedingReleaseVersion(version, releaseData)
  if (!precedingVersion) {
    const themeMapping = await getOrCreateThemeMapping(version, false)
    return {
      themeMapping,
      isNew: true,
      precedingThemeMapping: null,
    }
  }

  // Cache the preceding release because it is assumed to be stable on S3.
  const precedingThemeMapping = await getOrCreateThemeMapping(precedingVersion, true)
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
 * @returns Promise resolving to a feature-type-to-theme lookup table
 */
async function createThemeMappingFromVersion(version: Version): Promise<ThemeMapping> {
  const s3FeatureTypes = await getFeatureTypesForVersion(version)
  const themeMapping: ThemeMapping = {}

  // Flatten the S3 theme buckets into the local feature-type lookup shape.
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
 * @param shouldCache - Whether to cache the created theme mapping
 * @returns Promise resolving to a validated theme mapping
 */
async function getOrCreateThemeMapping(
  version: Version,
  shouldCache: boolean = false,
): Promise<ThemeMapping> {
  const cachedMapping = await getCachedThemeMapping(version)
  if (cachedMapping) {
    return cachedMapping
  }

  const themeMapping = await createThemeMappingFromVersion(version)

  if (shouldCache) {
    await cacheThemeMapping(version, themeMapping)
  }

  return themeMapping
}

/**
 * Validates a new theme mapping against the preceding release before caching it.
 * @param releaseVersion - Release version being validated
 * @param themeMapping - Newly generated mapping for the selected release
 * @param precedingThemeMapping - Cached mapping from the preceding release
 * @param spinner - Active spinner used to report progress to the CLI
 * @returns `true` when the spinner was stopped for an interactive decision, otherwise `false`
 */
async function validateThemeMappingAgainstPrevious(
  releaseVersion: Version,
  themeMapping: ThemeMapping,
  precedingThemeMapping: ThemeMapping,
  spinner: Spinner,
): Promise<boolean> {
  const differences = compareThemeMappings(themeMapping, precedingThemeMapping)

  if (!differences.hasDifferences) {
    await cacheThemeMapping(releaseVersion, themeMapping)
    spinner.message('Theme mapping validated and cached')
    return false
  }

  spinner.stop('Theme differences detected.')
  const action = await promptUserForThemeAction(differences)

  await handleThemeAction(action, releaseVersion, themeMapping)
  return true
}

/**
 * Handles the user's chosen action for theme differences.
 * @param action - User's chosen action
 * @param releaseVersion - Release version whose mapping should be updated
 * @param themeMapping - Theme mapping selected for caching
 * @returns The cached theme mapping, or `null` if no mapping was provided
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
      if (themeMapping) {
        await cacheThemeMapping(releaseVersion, themeMapping)
        log.success(
          `Theme mapping updated and cached with ${kleur.green(Object.keys(themeMapping).length)} feature types`,
        )
        return themeMapping
      } else {
        log.error('Schema changes detected but mapping not updated')
      }
  }
  return null
}

/**
 * Resolves feature types from CLI args, environment configuration, or interactive prompts.
 * @param themeMapping - Current theme mapping for the selected release
 * @param config - Configuration object containing environment-derived defaults
 * @param cliArgs - Command line arguments for the current invocation
 * @param interactiveOpts - Interactive options (`false` = non-interactive)
 * @returns Promise resolving to the selected feature types
 * @remarks Resolution order is CLI, then environment config, then interactive selection,
 * with a final fallback to all available feature types.
 */
async function selectFeatureTypes(
  themeMapping: ThemeMapping,
  config: Config,
  cliArgs: CliArgs,
  interactiveOpts?: InteractiveOptions | false,
): Promise<string[]> {
  const selectionRequest =
    resolveFeatureSelectionRequest(cliArgs, themeMapping, config.confirmFeatureSelection) ||
    resolveFeatureSelectionRequest(config, themeMapping, config.confirmFeatureSelection)

  if (selectionRequest) {
    const shouldPromptForConfirmation =
      interactiveOpts !== false && selectionRequest.shouldConfirm

    logResolvedFeatureSelection(selectionRequest, shouldPromptForConfirmation)

    if (shouldPromptForConfirmation) {
      return await selectFeatureTypesInteractively(
        themeMapping,
        selectionRequest.featureTypes,
      )
    }

    return selectionRequest.featureTypes
  }

  if (interactiveOpts !== false) {
    return await selectFeatureTypesInteractively(themeMapping)
  }

  const allFeatureTypes = Object.keys(themeMapping)
  log.info(`Using all ${allFeatureTypes.length} available feature types`)
  return allFeatureTypes
}

/**
 * Resolves feature selections from either CLI args or environment configuration.
 * @param sourceConfig - Selection source containing optional feature types and themes
 * @param themeMapping - Current theme mapping
 * @param confirmSelection - Whether interactive runs should confirm the preselection
 * @returns Normalized feature-selection request, or `null` if the source is unset
 */
function resolveFeatureSelectionRequest(
  sourceConfig: Pick<CliArgs, 'themes' | 'types'> | Pick<Config, 'featureTypes'>,
  themeMapping: ThemeMapping,
  confirmSelection: boolean = true,
): FeatureSelectionRequest | null {
  const requestedTypes = 'types' in sourceConfig ? sourceConfig.types || [] : []
  const requestedThemes = 'themes' in sourceConfig ? sourceConfig.themes || [] : []
  const envFeatureTypes = 'featureTypes' in sourceConfig ? sourceConfig.featureTypes || [] : []
  const source = getFeatureSelectionSource(sourceConfig)
  const explicitFeatureTypes = source === 'env' ? envFeatureTypes : requestedTypes

  if (explicitFeatureTypes.length === 0 && requestedThemes.length === 0) {
    return null
  }

  const validFeatureTypes = validateFeatureTypes(explicitFeatureTypes, themeMapping)
  const resolvedThemeFeatureTypes = resolveThemeFeatureTypes(requestedThemes, themeMapping)
  const combinedFeatureTypes = dedupeFeatureTypes([
    ...validFeatureTypes,
    ...resolvedThemeFeatureTypes,
  ])

  return {
    featureTypes: combinedFeatureTypes,
    source,
    shouldConfirm: confirmSelection,
  }
}

/**
 * Resolves the source label used in feature-selection log messages.
 * @param sourceConfig - Selection source containing CLI or environment values
 * @returns Source label for logging and confirmation decisions
 */
function getFeatureSelectionSource(
  sourceConfig: Pick<CliArgs, 'themes' | 'types'> | Pick<Config, 'featureTypes'>,
): FeatureSelectionSource {
  return 'featureTypes' in sourceConfig ? 'env' : 'cli'
}

/**
 * Logs the resolved feature selection with a consistent source label.
 * @param selectionRequest - Resolved feature selection state
 * @param isPreselected - Whether the selection will be shown for interactive confirmation
 * @returns Nothing
 */
function logResolvedFeatureSelection(
  selectionRequest: FeatureSelectionRequest,
  isPreselected: boolean,
): void {
  const actionLabel = isPreselected ? 'Pre-selected' : 'Selected'
  const sourceLabel = selectionRequest.source.toUpperCase()

  log.message(
    `${actionLabel}: ${kleur.green(selectionRequest.featureTypes.length)} types ${kleur.grey(sourceLabel)}`,
  )
}

/**
 * Validates requested feature types and exits when any are unknown.
 * @param featureTypes - Feature types to validate
 * @param themeMapping - Current theme mapping
 * @returns Validated feature types
 * @remarks This uses the standard CLI `bail` path so user input errors present
 * as operational messages rather than internal exceptions.
 */
function validateFeatureTypes(
  featureTypes: string[],
  themeMapping: ThemeMapping,
): string[] {
  const allFeatureTypes = Object.keys(themeMapping)
  const valid = featureTypes.filter(type => allFeatureTypes.includes(type))
  const invalid = featureTypes.filter(type => !allFeatureTypes.includes(type))

  if (invalid.length > 0) {
    bail(
      [
        `Invalid feature types: ${kleur.red(invalid.join(', '))}`,
        `Valid feature types: ${kleur.grey(allFeatureTypes.join(', '))}`,
      ].join('\n'),
    )
  }

  return valid
}

/**
 * Resolves feature types implied by selected theme names.
 * @param themes - Theme names requested by the user
 * @param themeMapping - Current theme mapping
 * @returns Feature types that belong to the requested themes
 */
function resolveThemeFeatureTypes(
  themes: string[],
  themeMapping: ThemeMapping,
): string[] {
  if (themes.length === 0) {
    return []
  }

  const validThemes = [...new Set(Object.values(themeMapping))].sort()
  const invalidThemes = themes.filter(theme => !validThemes.includes(theme))

  if (invalidThemes.length > 0) {
    bail(
      [
        `Invalid themes: ${kleur.red(invalidThemes.join(', '))}`,
        `Valid themes: ${kleur.grey(validThemes.join(', '))}`,
      ].join('\n'),
    )
  }

  return Object.keys(themeMapping).filter(featureType =>
    themes.includes(themeMapping[featureType]),
  )
}

/**
 * Deduplicates feature types while preserving user-specified order.
 * @param featureTypes - Feature types gathered from multiple input sources
 * @returns Ordered list without duplicates
 */
function dedupeFeatureTypes(featureTypes: string[]): string[] {
  return [...new Set(featureTypes)]
}
