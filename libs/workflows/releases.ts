import { getS3Releases } from '../data/s3'
import type { Version } from '../core/types'

/**
 * Lists the Overture release versions that remain directly available on S3.
 * @returns Newest-first S3 release versions, without consulting or modifying the local cache.
 * @remarks This is deliberately machine-oriented so downstream update tools can discover a bounded archive.
 */
export async function listAvailableReleaseVersions(): Promise<Version[]> {
  const { s3Releases } = await getS3Releases()
  return s3Releases
}

/**
 * Writes the S3-available release catalogue as one JSON document.
 * @returns Resolves after the complete document has been written to standard output.
 */
export async function releasesCmd(): Promise<void> {
  const versions = await listAvailableReleaseVersions()
  process.stdout.write(`${JSON.stringify({ versions })}\n`)
}
