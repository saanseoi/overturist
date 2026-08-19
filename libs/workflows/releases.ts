import { getS3Releases } from '../data/s3'
import type { Version } from '../core/types'

/**
 * Lists the Overture release versions that remain directly available on S3.
 * @returns Newest-first S3 release versions, without consulting or modifying the local cache.
 * @remarks This reads directly from S3 and does not consult or modify the local cache.
 */
export async function listAvailableReleaseVersions(): Promise<Version[]> {
  const { s3Releases } = await getS3Releases()
  return s3Releases
}

/**
 * Writes the S3-available release catalogue in a terminal-friendly or JSON format.
 * @param format - Request JSON output for machine consumption
 * @returns Resolves after the complete document has been written to standard output.
 */
export async function releasesCmd(format?: 'json'): Promise<void> {
  const versions = await listAvailableReleaseVersions()

  if (format === 'json') {
    process.stdout.write(`${JSON.stringify({ versions })}\n`)
    return
  }

  process.stdout.write(formatAvailableReleaseVersions(versions))
}

/**
 * Renders available versions for direct terminal use.
 * @param versions - Newest-first release versions from S3
 * @returns A newline-terminated human-readable release list
 */
export function formatAvailableReleaseVersions(versions: Version[]): string {
  if (versions.length === 0) {
    return 'No Overture releases are currently available on S3.\n'
  }

  return `Available Overture releases on S3:\n${versions.map(version => `  ${version}`).join('\n')}\n`
}
