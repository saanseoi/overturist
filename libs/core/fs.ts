import fs from 'node:fs/promises'
import path from 'node:path'
import kleur from 'kleur'
import type {
  BBox,
  CliArgs,
  ClipMode,
  Config,
  Division,
  InteractiveOptions,
  OnExistingFilesAction,
  Target,
  Version,
} from './types'
import { determineActionOnExistingFiles } from '../ui'
import { bail, failedExit } from './utils'

type DirectoryEntryInfo = {
  name: string
  isDirectory: boolean
}

/**
 * FILESYSTEM :: DATA
 */

/**
 * Checks for existing Parquet files in the given output directory.
 * @param featureTypes - Array of feature type names to check for
 * @param regionOutputDir - Directory path to check for existing files
 * @param clipMode - Active clip mode used to derive the expected filename
 * @returns Promise resolving to array of feature types that have existing files
 */
export async function checkForExistingFiles(
  featureTypes: string[],
  regionOutputDir: string,
  clipMode: ClipMode = 'smart',
): Promise<string[]> {
  const existingFiles: string[] = []
  for (const type of featureTypes) {
    const filePath = path.join(
      regionOutputDir,
      getFeatureOutputFilename(type, clipMode),
    )
    const fileExists = await fs
      .access(filePath)
      .then(() => true)
      .catch(() => false)
    if (fileExists) {
      existingFiles.push(type)
    }
  }
  return existingFiles
}

/**
 * Builds the versioned output filename for a feature type and clip mode.
 * @param featureType - Feature type name used as the file stem
 * @param clipMode - Active clip mode for the run
 * @returns Parquet filename that avoids collisions across clip modes
 * @remarks `smart` stays unsuffixed for backward-friendly default naming.
 */
export function getFeatureOutputFilename(
  featureType: string,
  clipMode: ClipMode = 'smart',
): string {
  if (clipMode === 'preserve') {
    return `${featureType}.preserveCrop.parquet`
  }

  if (clipMode === 'all') {
    return `${featureType}.containCrop.parquet`
  }

  return `${featureType}.parquet`
}

/**
 * Builds a directory path from division hierarchies.
 * @param hierarchies - Division hierarchies array
 * @returns Directory path built from hierarchy names
 * @remarks The first hierarchy is treated as the canonical filesystem path order.
 */
function buildHierarchyPath(
  hierarchies?: Array<Array<{ division_id: string; subtype: string; name: string }>>,
): string {
  if (!hierarchies || hierarchies.length === 0) {
    return 'unknown'
  }

  // Use the first hierarchy as-is (country -> dependency -> region -> etc. order)
  const hierarchy = hierarchies[0]
  return (
    hierarchy
      .map(h => h.name)
      // Normalize hierarchy labels into portable path segments without stripping Unicode.
      // Only replace filesystem-problematic characters, keep Unicode text
      .map(
        name =>
          name
            .replace(/[<>:"/\\|?*]/g, '') // Remove Windows/Unix forbidden characters
            .replace(/\s+/g, ' ') // Replace multiple spaces with single space
            .trim() || 'unnamed', // Use "unnamed" if result is empty
      )
      .join('/')
  )
}

/**
 * Builds a stable directory name from a bounding box.
 * @param bbox - Bounding box coordinates in WGS84
 * @returns Rounded bbox string suitable for use in output paths
 */
export function buildBboxPath(bbox: BBox): string {
  const { xmin, ymin, xmax, ymax } = bbox

  // Round coordinates to 5 decimal places - 1.11m precision
  const roundedMinX = Math.round(xmin * 100000) / 100000
  const roundedMinY = Math.round(ymin * 100000) / 100000
  const roundedMaxX = Math.round(xmax * 100000) / 100000
  const roundedMaxY = Math.round(ymax * 100000) / 100000

  // Concatenate with commas
  return `${roundedMinX},${roundedMinY},${roundedMaxX},${roundedMaxY}`
}

/**
 * Constructs the output directory path for a specific version and division.
 * @param target - Selected extraction target
 * @param config - Configuration object containing output directory and selected division
 * @param releaseVersion - Version string for the release
 * @param division - Selected division when `target` is `division`
 * @param bbox - Selected bbox when `target` is `bbox`
 * @returns Full directory path for the release output
 * @remarks The returned path is deterministic and does not touch the filesystem.
 */
export function getOutputDir(
  target: Target,
  config: Config,
  releaseVersion: Version,
  division: Division | null,
  bbox: BBox | null,
): string {
  let subPath = ''

  if (target === 'world') {
    subPath = 'full'
  } else if (target === 'division') {
    if (division?.hierarchies) {
      // If we have a selected division with hierarchies, use that path
      subPath = path.join('divisions', buildHierarchyPath(division.hierarchies))
    } else {
      // If we don't have a selected division with hierarchies, use the division ID
      bail(
        `Missing hierarchies for division ${kleur.yellow(division?.id || 'unknown')}`,
      )
    }
  } else if (target === 'bbox') {
    if (bbox) {
      subPath = path.join('bbox', buildBboxPath(bbox))
    } else {
      bail(`Missing bbox`)
    }
  } else {
    bail(`Invalid target: ${target}`)
  }

  // Fallback to versioned root if no division is selected
  return path.join(config.outputDir, releaseVersion, subPath)
}

/**
 * Initializes the output directory for the current extraction target.
 * @param target - Selected extraction target
 * @param config - Configuration object containing output directory settings
 * @param releaseVersion - Version string for the release
 * @param division - Selected division when `target` is `division`
 * @param bbox - Selected bbox when `target` is `bbox`
 * @returns Promise resolving to the created output directory path
 */
export async function initializeOutputDir(
  target: Target,
  config: Config,
  releaseVersion: Version,
  division: Division | null,
  bbox: BBox | null,
): Promise<{ outputDir: string }> {
  const outputDir = getOutputDir(target, config, releaseVersion, division, bbox)
  await ensureDirectoryExists(outputDir)
  return { outputDir }
}

/**
 * FILESYSTEM :: CACHE
 */

export const CACHE_DIR = path.join(process.cwd(), '.cache')

/**
 * Ensures cache directory exists for a specific version.
 * @param version - The release version
 * @param subDir - Optional nested cache directory under the version root
 * @returns Promise that resolves when the directory exists
 */
export async function ensureVersionedCacheDir(
  version: string,
  subDir?: string,
): Promise<void> {
  const versionDir = path.join(CACHE_DIR, version, subDir ? subDir : '')
  await ensureDirectoryExists(versionDir)
}

/**
 * FILE HANDLING
 */

/**
 * Determines how to proceed when output files already exist.
 * @param config - Configuration resolved from defaults and environment variables
 * @param cliArgs - Parsed CLI arguments
 * @param interactiveOpts - Interactive options when prompts are enabled
 * @param featureTypes - Feature types scheduled for output
 * @param outputDir - Output directory for the current run
 * @param clipMode - Active clip mode used to resolve output filenames
 * @returns Promise resolving to the selected existing-file strategy
 */
export async function initializeFileHandling(
  config: Config,
  cliArgs: CliArgs,
  interactiveOpts: InteractiveOptions | false | undefined,
  featureTypes: string[],
  outputDir: string,
  clipMode: ClipMode = 'smart',
): Promise<{
  onFileExists: OnExistingFilesAction | null
}> {
  const userDefinedOnFileExists = config.onFileExists || cliArgs.onFileExists
  const existingFiles = await checkForExistingFiles(featureTypes, outputDir, clipMode)
  const onFileExists = await determineActionOnExistingFiles(
    existingFiles,
    userDefinedOnFileExists,
    interactiveOpts,
  )
  // Check for abort early
  if (onFileExists === 'abort') {
    failedExit('Aborting file handling')
  }
  return {
    onFileExists,
  }
}

/**
 * HELPERS
 */

/**
 * Ensures that a directory exists, creating it if necessary.
 * @param dirPath - Directory path to create if it doesn't exist
 * @returns Promise that resolves when the directory exists
 */
export async function ensureDirectoryExists(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true })
}

/**
 * Reads and parses a JSON file.
 * @param filePath - Path to the JSON file
 * @returns Promise resolving to parsed data or null if file doesn't exist/invalid
 * @remarks This helper intentionally treats missing files and invalid JSON as cache misses.
 */
export async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    await fs.access(filePath)
    const data = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(data) as T
  } catch {
    return null
  }
}

/**
 * Writes data to a JSON file.
 * @param filePath - Path to the JSON file
 * @param data - Data to write
 * @returns Promise that resolves when file is written
 */
export async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  await fs.writeFile(filePath, JSON.stringify(data, null, 4))
}

/**
 * Checks if a directory exists and has JSON files.
 * @param dirPath - Path to the directory to check
 * @returns Promise resolving to true if directory exists and contains JSON files
 */
export async function directoryHasJsonFiles(dirPath: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(dirPath)
    return entries.some(file => file.endsWith('.json'))
  } catch {
    return false
  }
}

/**
 * Reads directory entries with file type information.
 * @param dirPath - Path to the directory to read
 * @returns Promise resolving to array of directory entries
 * @remarks This helper returns an empty array when the directory cannot be read.
 */
export async function readDirectoryEntries(
  dirPath: string,
): Promise<DirectoryEntryInfo[]> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true })
    return entries.map(entry => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
    }))
  } catch {
    return []
  }
}

/**
 * Checks if a file exists at the given path.
 * @param filePath - Path to the file to check
 * @returns Promise resolving to true if the file exists
 */
export async function fileExists(filePath: string): Promise<boolean> {
  return await fs
    .access(filePath)
    .then(() => true)
    .catch(() => false)
}

/**
 * Checks if a Parquet file exists for a given version and feature type.
 * @param outputDir - Directory that should contain the Parquet file
 * @param featureType - The feature type to check for
 * @param clipMode - Active clip mode used to derive the expected filename
 * @returns Promise resolving to true if the Parquet file exists
 */
export async function isParquetExists(
  outputDir: string,
  featureType: string,
  clipMode: ClipMode = 'smart',
): Promise<boolean> {
  const parquetFile = path.join(
    outputDir,
    getFeatureOutputFilename(featureType, clipMode),
  )

  return await fileExists(parquetFile)
}
