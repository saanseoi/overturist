import { select } from '@clack/prompts'
import { getS3Releases } from '../data/s3'
import type { ReleaseData } from '../core/types'
import { successExit } from '../core/utils'
import {
  buildReleaseVersionOptions,
  getSelectableReleaseVersions,
} from './releases.utils'

/**
 * Prompts for a release version when interactive selection is required.
 * @param releaseData - Optional release metadata that has already been fetched
 * @returns Selected release version.
 */
export async function selectReleaseVersion(releaseData?: ReleaseData): Promise<string> {
  let availableReleases: string[]

  if (releaseData) {
    availableReleases = getSelectableReleaseVersions(releaseData)
  } else {
    const { s3Releases } = await getS3Releases()
    availableReleases = s3Releases
  }

  const versionOptions = buildReleaseVersionOptions(availableReleases)

  const selectedVersion = await select({
    message: 'Choose a release version:',
    options: versionOptions,
  })

  if (!selectedVersion || typeof selectedVersion === 'symbol') {
    successExit('Version selection cancelled')
  }

  return selectedVersion as string
}
