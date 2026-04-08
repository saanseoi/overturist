import { initializeBounds, initializeLocale, initializeTarget } from '../core/config'
import { initializeDivision } from './divisions'
import { initializeFileHandling, initializeOutputDir } from '../core/fs'
import { processFeatureTypes } from './processing'
import { initializeReleaseVersion } from '../data/releases'
import { initializeThemeMapping } from './themes'
import type { CliArgs, Config, ControlContext, InteractiveOptions } from '../core/types'
import { calculateColumnWidths, displayExtractionPlan, displayTableHeader } from '../ui'
import { setupGracefulExit } from '../core/utils'

/**
 * Resolves the full execution context shared by interactive and non-interactive downloads.
 * @param config - Initial configuration object.
 * @param cliArgs - Parsed command line arguments.
 * @param interactiveOpts - Interactive overrides, or false for non-interactive execution.
 * @returns The resolved control context, or null when initialization is aborted.
 * @remarks This centralizes release, target, clipping, output, and file-handling setup in one path.
 */
export async function resolveOptions(
  config: Config,
  cliArgs: CliArgs,
  interactiveOpts?: InteractiveOptions | false,
): Promise<ControlContext | null> {
  setupGracefulExit()

  // Resolve the release first so later steps can derive versioned metadata.
  const { releaseVersion, releaseData, releaseContext } =
    await initializeReleaseVersion(config, cliArgs, interactiveOpts)

  // Locale selection affects division lookup and target naming.
  const { locale } = initializeLocale(config, cliArgs)

  // Resolve the output target before deriving bounds and directory layout.
  const { target } = initializeTarget(config, cliArgs, interactiveOpts)

  // Division lookup provides the canonical administrative geometry when requested.
  const { divisionId, division } = await initializeDivision(
    releaseVersion,
    locale,
    config,
    cliArgs,
    target,
    interactiveOpts,
  )

  // Expand theme selections into concrete feature types and processing metadata.
  const { featureTypes, themeMapping } = await initializeThemeMapping(
    releaseVersion,
    releaseData,
    config,
    cliArgs,
    interactiveOpts,
  )

  // Resolve clipping once target and division context are known.
  const { bbox, skipBoundaryClip, clipMode, geometry } = await initializeBounds(
    config,
    cliArgs,
    target,
    division,
    divisionId,
    releaseVersion,
  )

  // Build the versioned output path from the resolved target and bounds.
  const { outputDir } = await initializeOutputDir(
    target,
    config,
    releaseVersion,
    division,
    bbox,
  )

  // Precompute table widths so the extraction output stays aligned.
  const { featureNameWidth, indexWidth } = calculateColumnWidths(featureTypes)

  // Resolve existing-file behavior after the output directory and feature list are known.
  const { onFileExists } = await initializeFileHandling(
    config,
    cliArgs,
    interactiveOpts,
    featureTypes,
    outputDir,
    clipMode,
    skipBoundaryClip,
  )

  return {
    releaseVersion,
    releaseContext,
    themeMapping,
    target,
    divisionId,
    division,
    bbox,
    geometry,
    skipBoundaryClip,
    clipMode,
    featureTypes,
    featureNameWidth,
    indexWidth,
    outputDir,
    onFileExists,
    source: {
      env: config,
      cli: cliArgs,
      interactive: interactiveOpts,
    },
  }
}

/**
 * Executes the non-interactive extraction workflow for a resolved control context.
 * @param ctx - Fully resolved control context.
 * @returns Promise resolving to true when the workflow completes.
 */
export async function executeDownloadWorkflow(ctx: ControlContext): Promise<boolean> {
  displayExtractionPlan(ctx)
  displayTableHeader(ctx)
  await processFeatureTypes(ctx)
  return true
}

/**
 * Runs the non-interactive `get` command.
 * @param config - Initial configuration object.
 * @param cliArgs - Parsed command line arguments.
 * @returns Promise resolving when command execution finishes.
 */
export async function getCmd(config: Config, cliArgs: CliArgs): Promise<void> {
  const controlContext = await resolveOptions(config, cliArgs, false)

  if (!controlContext) {
    return
  }

  await executeDownloadWorkflow(controlContext)
}
