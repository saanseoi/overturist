import kleur from 'kleur'
import type { ReleaseData } from '../core/types'

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
 * @param versions - Selectable release versions in display order
 * @returns Prompt options with the first version marked as latest.
 */
export function buildReleaseVersionOptions(
  versions: string[],
): Array<{ value: string; label: string }> {
  const latest = versions[0]
  return versions.map(version => ({
    value: version,
    label: kleur.cyan(version === latest ? `${version} (latest)` : version),
  }))
}
