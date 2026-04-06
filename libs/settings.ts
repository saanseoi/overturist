import fs from 'node:fs/promises'
import path from 'node:path'
import { confirm, log } from '@clack/prompts'
import kleur from 'kleur'
import { reloadConfig } from './config'
import type { CliArgs, Config } from './types'

/**
 * Checks whether a file-system path exists.
 * @param targetPath - Absolute or relative path to test
 * @returns `true` when the path is accessible, otherwise `false`
 */
async function pathExists(targetPath: string): Promise<boolean> {
  return fs
    .access(targetPath)
    .then(() => true)
    .catch(() => false)
}

/**
 * Shows current preferences from .env file.
 * @returns Nothing. Logs the current `.env` values when the file exists.
 */
export async function showPreferences(): Promise<void> {
  const envPath = getEnvPath()

  if (!(await pathExists(envPath))) {
    log.warning('No .env file found. Using default values.')
    return
  }

  try {
    const envContent = await fs.readFile(envPath, 'utf-8')
    log.info('Current preferences from .env file:')

    // Parse active assignments while preserving empty values such as `KEY=`.
    const entries = envContent.split('\n').map(parseEnvLine).filter(isDefined)

    if (entries.length === 0) {
      log.info('No active preferences found in .env.')
      return
    }

    for (const { key, value } of entries) {
      const displayValue = kleur.yellow(value)
      const colorKey = kleur.cyan(key)
      log.message(`${colorKey}: ${displayValue}`)
    }
  } catch (error) {
    log.error(
      `Failed to read preferences: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * Resets preferences by copying .env.example to .env, or deleting .env if .env.example doesn't exist.
 * @param config - Live configuration object to refresh after the reset completes
 * @param cliArgs - Parsed CLI arguments used to determine whether live config should be reloaded
 * @returns Nothing. Prompts the user and applies the requested reset action.
 */
export async function resetPreferences(
  config?: Config,
  cliArgs?: CliArgs,
): Promise<void> {
  const envPath = getEnvPath()
  const envExamplePath = getEnvExamplePath()

  try {
    // Check if .env.example exists and if .env exists
    const envExampleExists = await pathExists(envExamplePath)
    const envExists = await pathExists(envPath)

    if (!envExists && !envExampleExists) {
      log.warning('No .env or .env.example file found. Nothing to reset.')
      return
    }

    const { message, resetAction } = getPreferenceResetPlan(envExists, envExampleExists)

    const confirmed = await confirm({
      message,
    })

    if (typeof confirmed === 'symbol' || !confirmed) {
      log.info('Preferences reset cancelled.')
      return
    }

    if (resetAction === 'copy') {
      await fs.copyFile(envExamplePath, envPath)
      log.success(
        'Preferences reset successfully. Created .env file with default values.',
      )
    } else {
      if (envExists) {
        await fs.unlink(envPath)
      }
      log.success(
        'Preferences reset successfully. The application will use default values.',
      )
    }

    // Reload config to pick up new environment variable state
    if (config && cliArgs) {
      reloadConfig(config)
      log.info('Configuration reloaded with current CLI arguments preserved.')
    }
  } catch (error) {
    log.error(
      `Failed to reset preferences: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * Shows cache statistics.
 * @returns Nothing. Logs a directory summary when the cache exists.
 */
export async function showCacheStats(): Promise<void> {
  const cacheDir = getCacheDir()

  if (!(await pathExists(cacheDir))) {
    log.warning('No cache directory found.')
    return
  }

  try {
    log.info('Cache statistics:\n')

    await showDirectoryStats(cacheDir, 'Cache')
  } catch (error) {
    log.error(
      `Failed to show cache statistics: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * Recursively shows directory statistics.
 * @param dirPath - Directory to inspect
 * @param label - Label to display for the current directory
 * @param indent - Current display indentation depth
 * @param maxDisplayDepth - Maximum depth to print while still calculating full sizes
 * @returns Nothing. Prints one summary line per displayed directory.
 */
async function showDirectoryStats(
  dirPath: string,
  label: string,
  indent = 0,
  maxDisplayDepth = 2,
): Promise<void> {
  const prefix = '  '.repeat(indent)

  try {
    const entries = (await fs.readdir(dirPath, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )
    let totalSize = 0
    const subdirectories: Array<{
      name: string
      path: string
      size: number
      fileCount: number
    }> = []

    // First, calculate cumulative size and file counts so parent rows show full totals.
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name)

      if (entry.isDirectory()) {
        // Calculate full cumulative size and file count for each child directory.
        const { size: subdirSize, fileCount: subdirFileCount } =
          await calculateDirectoryStats(fullPath)
        subdirectories.push({
          name: entry.name,
          path: fullPath,
          size: subdirSize,
          fileCount: subdirFileCount,
        })
        totalSize += subdirSize
      } else if (entry.isFile()) {
        const stats = await fs.stat(fullPath)
        totalSize += stats.size
      }
    }

    // Show the current directory after cumulative totals have been resolved.
    if (totalSize > 0 || subdirectories.length > 0) {
      const sizeStr = formatBytes(totalSize)
      let output = `${kleur.gray('│  ')}${prefix}${kleur.blue(label)}: ${sizeStr}`

      // Add file count for third-tier directories (indent = 2)
      if (indent === 2) {
        const totalFiles = subdirectories.reduce(
          (sum, subdir) => sum + subdir.fileCount,
          0,
        )
        const filesInCurrentDir = entries.filter(entry => entry.isFile()).length
        const allFiles = totalFiles + filesInCurrentDir
        output += ` ${kleur.gray(`(${allFiles} items)`)}`
      }

      console.log(output)
    }

    // Then recurse into subdirectories if they are still within the display depth budget.
    if (indent < maxDisplayDepth) {
      for (const subdir of subdirectories) {
        await showDirectoryStats(subdir.path, subdir.name, indent + 1, maxDisplayDepth)
      }
    }
  } catch (_error) {
    log.error(`${prefix}${kleur.red(label)}: Error reading directory`)
  }
}

/**
 * Calculates the total size and file count of a directory and all its subdirectories (unlimited depth).
 * @param dirPath - Directory to inspect recursively
 * @returns Aggregate byte size and file count for the full subtree
 */
async function calculateDirectoryStats(
  dirPath: string,
): Promise<{ size: number; fileCount: number }> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true })
    let totalSize = 0
    let fileCount = 0

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name)

      if (entry.isDirectory()) {
        // Recursively calculate subdirectory stats (unlimited depth)
        const subdirStats = await calculateDirectoryStats(fullPath)
        totalSize += subdirStats.size
        fileCount += subdirStats.fileCount
      } else if (entry.isFile()) {
        // Add file size and count
        const stats = await fs.stat(fullPath)
        totalSize += stats.size
        fileCount += 1
      }
    }

    return { size: totalSize, fileCount }
  } catch (_error) {
    return { size: 0, fileCount: 0 }
  }
}

/**
 * Formats bytes into human-readable format.
 * @param bytes - Byte count to format for display
 * @returns Human-readable size string using binary units
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'

  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1)

  return `${parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`
}

/**
 * Purges the entire cache directory.
 * @returns Nothing. Deletes the cache directory after confirmation when it exists.
 */
export async function purgeCache(): Promise<void> {
  const cacheDir = getCacheDir()

  if (!(await pathExists(cacheDir))) {
    log.warning('No cache directory found to purge.')
    return
  }

  try {
    const confirmed = await confirm({
      message:
        'Are you sure you want to delete the entire cache? This action cannot be undone.',
    })

    if (typeof confirmed === 'symbol' || !confirmed) {
      log.info('Cache purge cancelled.')
      return
    }

    await fs.rm(cacheDir, { recursive: true, force: true })
    log.success('Cache purged successfully.')
  } catch (error) {
    log.error(
      `Failed to purge cache: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * Returns the absolute path to the active `.env` file.
 * @returns Absolute `.env` path for the current workspace
 */
function getEnvPath(): string {
  return path.join(process.cwd(), '.env')
}

/**
 * Returns the absolute path to the default `.env.example` template.
 * @returns Absolute `.env.example` path for the current workspace
 */
function getEnvExamplePath(): string {
  return path.join(process.cwd(), '.env.example')
}

/**
 * Returns the absolute path to the cache directory.
 * @returns Absolute cache directory path for the current workspace
 */
function getCacheDir(): string {
  return path.join(process.cwd(), '.cache')
}

/**
 * Parses one `.env` line into a displayable key-value pair.
 * @param line - Raw `.env` line
 * @returns Parsed assignment or `undefined` for comments and blank lines
 * @remarks Empty values such as `KEY=` are preserved.
 */
function parseEnvLine(line: string): { key: string; value: string } | undefined {
  const trimmedLine = line.trim()

  if (!trimmedLine || trimmedLine.startsWith('#')) {
    return undefined
  }

  const separatorIndex = trimmedLine.indexOf('=')
  if (separatorIndex === -1) {
    return undefined
  }

  const key = trimmedLine.slice(0, separatorIndex).trim()
  const value = trimmedLine.slice(separatorIndex + 1)

  if (!key) {
    return undefined
  }

  return { key, value }
}

/**
 * Resolves the reset prompt and action based on available preference files.
 * @param envExists - Whether `.env` exists
 * @param envExampleExists - Whether `.env.example` exists
 * @returns Reset prompt and action
 */
function getPreferenceResetPlan(
  envExists: boolean,
  envExampleExists: boolean,
): {
  message: string
  resetAction: 'copy' | 'delete'
} {
  if (envExampleExists) {
    return {
      message: envExists
        ? 'Are you sure you want to reset your .env file to defaults?'
        : 'Create a new .env file with default preferences?',
      resetAction: 'copy',
    }
  }

  return {
    message: 'Are you sure you want to delete your .env file?',
    resetAction: 'delete',
  }
}

/**
 * Checks whether a value is neither `null` nor `undefined`.
 * @param value - Value to validate
 * @returns True when the value is defined
 */
function isDefined<T>(value: T | null | undefined): value is T {
  return value != null
}
