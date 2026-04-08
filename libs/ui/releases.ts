import { select } from '@clack/prompts'
import { getS3Releases } from '../data/s3'
import type { ReleaseData } from '../core/types'
import { successExit } from '../core/utils'
import { buildReleaseVersionOptions } from './releases.utils'

/**
 * Prompts for a release version when interactive selection is required.
 * @param releaseData - Optional release metadata that has already been fetched
 * @returns Selected release version.
 */
export async function selectReleaseVersion(releaseData?: ReleaseData): Promise<string> {
  let resolvedReleaseData = releaseData

  if (!resolvedReleaseData) {
    const { s3Releases } = await getS3Releases()
    const releases = s3Releases.map(version => ({
      version,
      date: version.slice(0, 10),
      schema: 'Unknown',
      isReleased: true,
      isAvailableOnS3: true,
    }))
    resolvedReleaseData = {
      lastUpdated: new Date().toISOString(),
      lastChecked: new Date().toISOString(),
      source: 'S3',
      latest: s3Releases[0] ?? 'Unknown',
      totalReleases: releases.length,
      releases,
    }
  }

  const versionOptions = buildReleaseVersionOptions(resolvedReleaseData)

  const selectedVersion = await select({
    message: 'Which version should be downloaded?',
    options: versionOptions,
  })

  if (!selectedVersion || typeof selectedVersion === 'symbol') {
    successExit('Version selection cancelled')
  }

  return selectedVersion as string
}
