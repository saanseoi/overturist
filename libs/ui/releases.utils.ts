import kleur from 'kleur'
import type { OvertureRelease, ReleaseData } from '../core/types'

/**
 * Extracts release versions that are selectable in the UI.
 * @param releaseData - Release metadata containing availability information
 * @returns Descending list of release versions that are available on S3.
 */
export function getSelectableReleaseVersions(releaseData: ReleaseData): string[] {
  return releaseData.releases
    .filter(release => release.isAvailableOnS3)
    .map(release => release.version)
    .sort()
    .reverse()
}

/**
 * Builds styled prompt options for release-version selection.
 * @param releaseData - Release metadata containing selectable versions
 * @returns Prompt options with the first version marked as latest.
 */
export function buildReleaseVersionOptions(
  releaseData: ReleaseData,
): Array<{ value: string; label: string }> {
  const selectableReleases = getSelectableReleases(releaseData)
  const latestVersion = selectableReleases[0]?.version

  return selectableReleases.map(release => ({
    value: release.version,
    label: kleur.cyan(
      formatReleaseOptionLabel(release, release.version === latestVersion),
    ),
  }))
}

/**
 * Returns releases that can be selected in the UI.
 * @param releaseData - Release metadata containing availability information
 * @returns Descending list of releases that are available on S3.
 */
function getSelectableReleases(releaseData: ReleaseData): OvertureRelease[] {
  return [...releaseData.releases]
    .filter(release => release.isAvailableOnS3)
    .sort((a, b) => b.version.localeCompare(a.version))
}

/**
 * Formats a user-facing release option label.
 * @param release - Release metadata
 * @param isLatest - Whether this is the current latest release on S3
 * @returns Styled label text for the release prompt
 */
function formatReleaseOptionLabel(release: OvertureRelease, isLatest: boolean): string {
  if (isLatest) {
    return `Current (${formatReleaseVersion(release.version)})`
  }

  const releaseDate = new Date(`${release.date}T00:00:00Z`)
  const month = releaseDate.toLocaleString('en-US', {
    month: 'long',
    timeZone: 'UTC',
  })
  const year = releaseDate.toLocaleString('en-US', {
    year: 'numeric',
    timeZone: 'UTC',
  })

  return `${year} ${month} (${formatReleaseVersion(release.version)})`
}

/**
 * Prefixes a release version for prompt display.
 * @param version - Raw release version string
 * @returns Version label formatted as `vYYYY-MM-DD.N`
 */
function formatReleaseVersion(version: string): string {
  return `v${version}`
}
