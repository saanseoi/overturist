import type { InteractiveOptions, OnExistingFilesAction } from '../core/types'

export type ExistingFilesActionStrategy =
  | { kind: 'none'; action: null }
  | { kind: 'prompt'; action: null }
  | { kind: 'preset' | 'default'; action: OnExistingFilesAction }

/**
 * Resolves the non-UI strategy for handling existing output files.
 * @param existingFiles - Existing output files for the target
 * @param onFileExists - Preselected file handling mode, if any
 * @param interactiveOpts - Interactive options or `false` for non-interactive mode
 * @param defaultAction - Default action used in non-interactive mode
 * @returns Strategy describing whether the caller should prompt or use a fixed action.
 */
export function resolveExistingFilesActionStrategy(
  existingFiles: string[],
  onFileExists: OnExistingFilesAction | undefined | null,
  interactiveOpts: InteractiveOptions | false | undefined,
  defaultAction: OnExistingFilesAction,
): ExistingFilesActionStrategy {
  const isActionUserDefined =
    onFileExists === 'skip' || onFileExists === 'replace' || onFileExists === 'abort'
  const isNonInteractive = interactiveOpts === false
  const hasExistingFiles = existingFiles.length > 0

  if (!hasExistingFiles) {
    return { kind: 'none', action: null }
  }

  if (!isNonInteractive && !isActionUserDefined) {
    return { kind: 'prompt', action: null }
  }

  if (isActionUserDefined) {
    return { kind: 'preset', action: onFileExists }
  }

  return { kind: 'default', action: defaultAction }
}
