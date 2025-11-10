import fs from "node:fs/promises";
import path from "node:path";
import type { Config, Version } from "./types";

/**
 * FILESYSTEM :: DATA
 */

/**
 * Checks for existing Parquet files in the given output directory.
 * @param featureTypes - Array of feature type names to check for
 * @param regionOutputDir - Directory path to check for existing files
 * @returns Promise resolving to array of feature types that have existing files
 */
export async function checkForExistingFiles(featureTypes: string[], regionOutputDir: string): Promise<string[]> {
    const existingFiles: string[] = [];
    for (const type of featureTypes) {
        const filePath = path.join(regionOutputDir, `${type}.parquet`);
        const fileExists = await fs
            .access(filePath)
            .then(() => true)
            .catch(() => false);
        if (fileExists) {
            existingFiles.push(type);
        }
    }
    return existingFiles;
}

/**
 * Builds a directory path from division hierarchies.
 * @param hierarchies - Division hierarchies array
 * @returns Directory path built from hierarchy names
 */
export function buildHierarchyPath(
    hierarchies?: Array<Array<{ division_id: string; subtype: string; name: string }>>,
): string {
    if (!hierarchies || hierarchies.length === 0) {
        return "unknown";
    }

    // Use the first hierarchy as-is (country -> dependency -> region -> etc. order)
    const hierarchy = hierarchies[0];
    return (
        hierarchy
            .map((h) => h.name)
            // Only replace filesystem-problematic characters, keep Unicode text
            .map(
                (name) =>
                    name
                        .replace(/[<>:"/\\|?*]/g, "") // Remove Windows/Unix forbidden characters
                        .replace(/\s+/g, " ") // Replace multiple spaces with single space
                        .trim() || "unnamed", // Use "unnamed" if result is empty
            )
            .join("/")
    );
}

/**
 * Constructs the output directory path for a specific version and division.
 * @param config - Configuration object containing output directory and selected division
 * @param version - Version string for the release
 * @returns Full directory path for the release output
 */
export function getOutputDir(config: Config, version: Version): string {
    // If we have a selected division with hierarchies, use that path
    if (config.selectedDivision?.hierarchies) {
        const hierarchyPath = buildHierarchyPath(config.selectedDivision.hierarchies);
        return path.join(config.outputDir, config.releaseVersion, hierarchyPath);
    }

    // Fallback to versioned root if no division is selected
    return path.join(config.outputDir, version ? version : config.releaseVersion);
}

/**
 * FILESYSTEM :: CACHE
 */

const CACHE_DIR = path.join(process.cwd(), ".cache");

/**
 * Ensures cache directory exists for a specific version.
 * @param version - The release version
 */
export async function ensureVersionedCacheDir(version: string, subDir?: string): Promise<void> {
    const versionDir = path.join(CACHE_DIR, version, subDir ? subDir : "");
    await ensureDirectoryExists(versionDir);
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
    await fs.mkdir(dirPath, { recursive: true });
}

/**
 * Reads and parses a JSON file.
 * @param filePath - Path to the JSON file
 * @returns Promise resolving to parsed data or null if file doesn't exist/invalid
 */
export async function readJsonFile<T>(filePath: string): Promise<T | null> {
    try {
        await fs.access(filePath);
        const data = await fs.readFile(filePath, "utf-8");
        return JSON.parse(data) as T;
    } catch {
        return null;
    }
}

/**
 * Writes data to a JSON file.
 * @param filePath - Path to the JSON file
 * @param data - Data to write
 * @returns Promise that resolves when file is written
 */
export async function writeJsonFile(filePath: string, data: any): Promise<void> {
    await fs.writeFile(filePath, JSON.stringify(data, null, 4));
}

/**
 * Checks if a directory exists and has JSON files.
 * @param dirPath - Path to the directory to check
 * @returns Promise resolving to true if directory exists and contains JSON files
 */
export async function directoryHasJsonFiles(dirPath: string): Promise<boolean> {
    try {
        const entries = await fs.readdir(dirPath);
        return entries.some((file) => file.endsWith(".json"));
    } catch {
        return false;
    }
}

/**
 * Reads directory entries with file type information.
 * @param dirPath - Path to the directory to read
 * @returns Promise resolving to array of directory entries
 */
export async function readDirectoryEntries(dirPath: string): Promise<Array<{ name: string; isDirectory: boolean }>> {
    try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        return entries.map((entry) => ({
            name: entry.name,
            isDirectory: entry.isDirectory(),
        }));
    } catch {
        return [];
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
        .catch(() => false);
}

/**
 * Checks if a Parquet file exists for a given version and feature type.
 * @param version - The release version
 * @param featureType - The feature type to check for
 * @param config - Configuration object containing output directory
 * @returns Promise resolving to true if the Parquet file exists
 */
export async function isParquetExists(version: Version, featureType: string, config: Config): Promise<boolean> {
    const versionOutputDir = getOutputDir(config, version);
    const parquetFile = path.join(versionOutputDir, `${featureType}.parquet`);

    return await fileExists(parquetFile);
}
