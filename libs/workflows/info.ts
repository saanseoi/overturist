import path from 'node:path'
import { spinner } from '@clack/prompts'
import kleur from 'kleur'
import { initializeLocale } from '../core/config'
import { initializeDivision } from './divisions'
import { ensureDirectoryExists, getOutputDir, writeJsonFile } from '../core/fs'
import { initializeReleaseVersion } from '../data/releases'
import type {
  CliArgs,
  Config,
  ControlContext,
  Division,
  ExtendedDivision,
  InteractiveOptions,
  Version,
} from '../core/types'
import { displayDivisionInfo } from '../ui'
import { bailFromSpinner } from '../core/utils'

type DivisionInfoContext = Pick<
  ControlContext,
  'releaseVersion' | 'releaseContext' | 'outputDir'
> & {
  divisionId: string
  division: Division
}

/**
 * Resolves the context required to inspect and persist a single division record.
 * @param config - Environment-backed configuration object
 * @param cliArgs - Parsed command-line arguments
 * @param interactiveOpts - Interactive overrides for division lookup when prompting is allowed
 * @returns Promise resolving to the division info context
 */
export async function resolveDivisionInfoContext(
  config: Config,
  cliArgs: CliArgs,
  interactiveOpts?: InteractiveOptions | false,
): Promise<DivisionInfoContext> {
  const { releaseVersion, releaseContext } = await initializeReleaseVersion(
    config,
    cliArgs,
    interactiveOpts,
  )
  const { locale } = initializeLocale(config, cliArgs)
  const { divisionId, division } = await initializeDivision(
    releaseVersion,
    locale,
    config,
    cliArgs,
    'division',
    interactiveOpts,
  )

  if (!divisionId || !division) {
    throw new Error('No division selected')
  }

  const outputDir = getOutputDir('division', config, releaseVersion, division, null)
  await ensureDirectoryExists(outputDir)

  return {
    releaseVersion,
    releaseContext,
    divisionId,
    division,
    outputDir,
  }
}

/**
 * Downloads a single division record into the release hierarchy and displays it in the terminal.
 * @param config - Environment-backed configuration object
 * @param cliArgs - Parsed command-line arguments
 * @param interactiveOpts - Interactive overrides for division lookup when prompting is allowed
 * @returns Promise resolving when the division has been saved and displayed
 */
export async function infoCmd(
  config: Config,
  cliArgs: CliArgs,
  interactiveOpts?: InteractiveOptions | false,
): Promise<void> {
  const ctx = await resolveDivisionInfoContext(config, cliArgs, interactiveOpts)
  await persistAndDisplayDivisionInfo(ctx)
}

/**
 * Persists a resolved division record and renders the formatted inspector output.
 * @param ctx - Resolved division info context
 * @returns Promise resolving when the record has been saved and displayed
 */
export async function persistAndDisplayDivisionInfo(
  ctx: DivisionInfoContext,
): Promise<void> {
  const outputFile = path.join(ctx.outputDir, 'division.json')
  const s = spinner()
  const divisionName = ctx.division.names?.primary || ctx.division.id

  s.start(`Saving division details for ${kleur.cyan(divisionName)}`)

  try {
    const payload = buildDivisionInfoPayload(ctx.releaseVersion, ctx.division)
    await writeJsonFile(outputFile, payload)
    s.stop(`Saved division details to ${kleur.cyan(outputFile)}`)
    displayDivisionInfo(ctx, payload)
  } catch (error) {
    bailFromSpinner(
      s,
      'Division info failed',
      `Failed to save division details: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Builds the persisted division payload for inspection output.
 * @param releaseVersion - Release version used to resolve the division
 * @param division - Division record to persist
 * @returns Division payload annotated with the release version used to fetch it
 */
function buildDivisionInfoPayload(
  releaseVersion: Version,
  division: Division,
): ExtendedDivision & { releaseVersion: Version } {
  return {
    ...division,
    releaseVersion,
  }
}
