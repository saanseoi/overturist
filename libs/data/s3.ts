import fs from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3'
import { OMF_S3_BUCKET, OMF_S3_PREFIX, OMF_S3_REGION } from '../core/constants'
import { runDuckDBQuery } from './db'
import type { Version } from '../core/types'

const s3Client = new S3Client({
  region: OMF_S3_REGION,
  credentials: {
    accessKeyId: '',
    secretAccessKey: '',
  },
  signer: {
    sign: async request => request,
  },
})

/**
 * Fetches available release versions from the Overture S3 bucket.
 * @returns Promise resolving to object containing latest version and array of all available versions
 * @remarks Results are gathered across all S3 pages and returned newest-first.
 */
export async function getS3Releases(): Promise<{
  latest: Version | null
  s3Releases: Version[]
}> {
  const prefixes = await listS3Prefixes(OMF_S3_PREFIX)

  if (prefixes.length === 0) {
    return { latest: null, s3Releases: [] }
  }

  // Extract version names from prefixes like "release/2025-01-15.0/"
  const versions = extractFromPrefixes(prefixes, /\/([^/]+)\/$/)
    .sort()
    .reverse()

  const latest = versions[0] || null
  return { latest, s3Releases: versions }
}

/**
 * Fetches all available themes for a specific version from the Overture S3 bucket.
 * @param version - The release version to get themes for
 * @returns Promise resolving to array of theme names
 */
export async function getThemesForVersion(version: Version): Promise<string[]> {
  const versionPrefix = `${OMF_S3_PREFIX}${version}/`
  const prefixes = await listS3Prefixes(versionPrefix)

  // Filter only theme prefixes and extract theme names
  const themePrefixes = prefixes.filter(p => p.includes('theme='))
  return extractFromPrefixes(themePrefixes, /theme=([^/]+)\//)
}

/**
 * Fetches all available feature types for each theme in a specific version from the Overture S3 bucket.
 * @param version - The release version to get feature types for
 * @returns Promise resolving to object with theme keys and arrays of feature types for each theme
 */
export async function getFeatureTypesForVersion(
  version: Version,
): Promise<{ [theme: string]: string[] }> {
  const themes = await getThemesForVersion(version)
  const result: { [theme: string]: string[] } = {}

  for (const theme of themes) {
    const themePrefix = `${OMF_S3_PREFIX}${version}/theme=${theme}/`
    const prefixes = await listS3Prefixes(themePrefix)

    // Extract feature types from prefixes like "release/2025-01-15.0/theme=buildings/type=building/"
    const featureTypes = extractFromPrefixes(prefixes, /type=([^/]+)\//)
    result[theme] = featureTypes
  }

  return result
}

/**
 * HELPERS
 */

/**
 * Executes paginated S3 prefix listing for a prefix and delimiter.
 * @param prefix - S3 prefix to list objects for
 * @param delimiter - Delimiter for grouping objects (default: "/")
 * @returns Promise resolving to array of common prefixes
 * @remarks S3 returns at most 1000 grouped prefixes per response, so continuation tokens
 * must be followed to avoid silently truncating releases, themes, or feature types.
 */
async function listS3Prefixes(
  prefix: string,
  delimiter: string = '/',
): Promise<string[]> {
  const prefixes: string[] = []
  let continuationToken: string | undefined

  do {
    const command = new ListObjectsV2Command({
      Bucket: OMF_S3_BUCKET,
      Prefix: prefix,
      Delimiter: delimiter,
      ContinuationToken: continuationToken,
    })
    const output = await s3Client.send(command)

    prefixes.push(...getDefinedPrefixes(output.CommonPrefixes))
    continuationToken = output.IsTruncated ? output.NextContinuationToken : undefined
  } while (continuationToken)

  return prefixes
}

/**
 * Extracts matched values from S3 prefixes using a capture-group regex.
 * @param prefixes - Array of S3 prefix strings
 * @param pattern - Regex pattern to match (should include capture group)
 * @returns Array of extracted values sorted alphabetically
 */
function extractFromPrefixes(prefixes: string[], pattern: RegExp): string[] {
  return [
    ...new Set(prefixes.map(prefix => prefix.match(pattern)?.[1]).filter(isDefined)),
  ].sort()
}

/**
 * Escapes a string for use inside a single-quoted DuckDB SQL literal.
 * @param value - Untrusted string value to embed in SQL
 * @returns Escaped SQL string literal
 */
function escapeSqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

/**
 * Downloads all parquet files for a specific theme and type to a local file.
 * Combines all parquet files from S3 into a single compressed parquet file.
 * @param version - Release version
 * @param theme - Theme name
 * @param featureType - Feature type name
 * @param outputPath - Local file path to save the combined parquet
 * @returns Promise resolving when download is complete
 */
export async function downloadParquetFiles(
  version: Version,
  theme: string,
  featureType: string,
  outputPath: string,
): Promise<void> {
  // Ensure output directory exists
  await fs.mkdir(path.dirname(outputPath), { recursive: true })

  const s3Path = getS3ParquetPath(version, theme, featureType)
  // Materialize the remote parquet shard set into one local compressed parquet file.
  const query = `
    INSTALL httpfs; LOAD httpfs;
    SET s3_region='${OMF_S3_REGION}';

    COPY (
      SELECT *
      FROM read_parquet(${escapeSqlLiteral(s3Path)})
    ) TO ${escapeSqlLiteral(outputPath)} (FORMAT PARQUET, COMPRESSION 'ZSTD');
  `

  const result = await runDuckDBQuery(query)

  if (result.exitCode !== 0) {
    throw new Error(
      `Failed to materialize ${theme}/${featureType}: ${result.stderr || 'Unknown DuckDB error'}`,
    )
  }
}

/**
 * Downloads a single S3 file directly to the specified output path.
 * @param s3Path - S3 path to the file (e.g., "s3://bucket/path/file.parquet")
 * @param outputFile - Local output file path
 * @returns Promise resolving when download is complete
 */
export async function downloadFile(s3Path: string, outputFile: string): Promise<void> {
  const { bucket, key } = parseS3Path(s3Path)

  const getObjectCommand = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  })

  const response = await s3Client.send(getObjectCommand)

  if (!response.Body) {
    throw new Error(`No data in response body for ${s3Path}`)
  }

  // Ensure output directory exists
  const outputDir = path.dirname(outputFile)
  await fs.mkdir(outputDir, { recursive: true })

  // Create a writable stream for the output file
  const fileStream = createWriteStream(outputFile)

  // Pipeline the S3 stream to the file
  await pipeline(response.Body as NodeJS.ReadableStream, fileStream)
}

/**
 * Gets the S3 path for a specific theme and type.
 * @param version - Release version
 * @param theme - Theme name
 * @param featureType - Feature type name
 * @returns S3 path pattern for the parquet files
 */
export function getS3ParquetPath(
  version: Version,
  theme: string,
  featureType: string,
): string {
  return `s3://${OMF_S3_BUCKET}/${OMF_S3_PREFIX}${version}/theme=${theme}/type=${featureType}/*.parquet`
}

/**
 * Filters common-prefix records down to defined prefix strings.
 * @param prefixes - Raw S3 common-prefix entries
 * @returns Prefix strings that can be processed safely
 */
function getDefinedPrefixes(
  prefixes: Array<{ Prefix?: string }> | undefined,
): string[] {
  return prefixes?.map(prefix => prefix.Prefix).filter(isDefined) ?? []
}

/**
 * Checks whether a value is neither `null` nor `undefined`.
 * @param value - Value to validate
 * @returns True when the value is defined
 */
function isDefined<T>(value: T | null | undefined): value is T {
  return value != null
}

/**
 * Parses an S3 URI into bucket and key components.
 * @param s3Path - Fully qualified `s3://` URI
 * @returns Parsed bucket and key pair
 * @remarks The key must be non-empty.
 */
function parseS3Path(s3Path: string): { bucket: string; key: string } {
  const s3Match = s3Path.match(/^s3:\/\/([^/]+)\/(.+)$/)

  if (!s3Match) {
    throw new Error(`Invalid S3 path: ${s3Path}`)
  }

  const [, bucket, key] = s3Match
  return { bucket, key }
}
