import { log, select } from '@clack/prompts'
import kleur from 'kleur'
import { DEFAULT_ON_FILE_EXISTS } from '../core/constants'
import type { InteractiveOptions, OnExistingFilesAction } from '../core/types'
import { successExit } from '../core/utils'
import { resolveExistingFilesActionStrategy } from './file-handling.utils'

/**
 * Determines how to handle existing files for the current extraction.
 * @param existingFiles - Existing output files for the target
 * @param onFileExists - Preselected file handling mode, if any
 * @param interactiveOpts - Interactive options or `false` for non-interactive mode
 * @returns Selected file handling mode, or `null` when no existing files were found.
 */
export async function determineActionOnExistingFiles(
  existingFiles: string[],
  onFileExists: OnExistingFilesAction | undefined | null,
  interactiveOpts: InteractiveOptions | false | undefined,
): Promise<OnExistingFilesAction | null> {
  const strategy = resolveExistingFilesActionStrategy(
    existingFiles,
    onFileExists,
    interactiveOpts,
    DEFAULT_ON_FILE_EXISTS,
  )

  if (strategy.kind === 'none') {
    return null
  }

  if (strategy.kind === 'prompt') {
    const selected = await select({
      message: `Found ${kleur.red(existingFiles.length)} existing files for this release. What would you like to do?`,
      options: [
        {
          value: 'skip',
          label: 'Skip',
          hint: 'keep existing files and download missing ones',
        },
        {
          value: 'replace',
          label: 'Replace',
          hint: 'replace existing files with fresh downloads',
        },
        {
          value: 'abort',
          label: 'Abort',
          hint: 'exit this run',
        },
      ],
    })

    if (typeof selected === 'symbol') {
      successExit('File handling cancelled')
    }

    return selected as OnExistingFilesAction
  }

  if (strategy.kind === 'preset') {
    const modeText =
      strategy.action === 'skip'
        ? kleur.green('Skipping existing files')
        : strategy.action === 'replace'
          ? kleur.yellow('Replacing existing files')
          : kleur.red('Aborting due to existing files')

    log.message(
      `📁 Found ${kleur.green(existingFiles.length)} existing files - ${modeText}`,
    )
    return strategy.action
  }

  log.warn(
    `📁 Found ${kleur.red(existingFiles.length)} existing files - skipping by default`,
  )
  return strategy.action
}
