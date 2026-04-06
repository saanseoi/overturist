import { select } from '@clack/prompts'
import kleur from 'kleur'
import { getS3Releases } from '../s3'
import type { ReleaseData } from '../types'
import { successExit } from '../utils'

/**
 * Prompts for a release version when interactive selection is required.
 * @param releaseData - Optional release metadata that has already been fetched
 * @returns Selected release version.
 */
export async function selectReleaseVersion(releaseData?: ReleaseData): Promise<string> {
  let availableReleases: string[]

  if (releaseData) {
    availableReleases = releaseData.releases
      .filter(release => release.isAvailableOnS3)
      .map(release => release.version)
      .sort()
      .reverse()
  } else {
    const { s3Releases } = await getS3Releases()
    availableReleases = s3Releases
  }

  const latest = availableReleases[0]
  const versionOptions = availableReleases.map(version => ({
    value: version,
    label: kleur.cyan(version === latest ? `${version} (latest)` : version),
  }))

  const selectedVersion = await select({
    message: 'Choose a release version:',
    options: versionOptions,
  })

  if (!selectedVersion || typeof selectedVersion === 'symbol') {
    successExit('Version selection cancelled')
  }

  return selectedVersion as string
}
