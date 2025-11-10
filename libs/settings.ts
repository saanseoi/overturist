import fs from "node:fs/promises";
import path from "node:path";
import { confirm, log, note } from "@clack/prompts";
import kleur from "kleur";
import type { InitialConfig } from "./types";

/**
 * Shows current preferences from .env file.
 */
export async function showPreferences(): Promise<void> {
    const envPath = path.join(process.cwd(), ".env");

    try {
        await fs.access(envPath);
        const envContent = await fs.readFile(envPath, "utf-8");

        log.info("Current preferences from .env file:");

        // Parse and display .env content
        const lines = envContent.split("\n").filter((line) => line.trim() && !line.startsWith("#"));

        for (const line of lines) {
            const [key, ...valueParts] = line.split("=");
            const value = valueParts.join("=");

            if (key && value) {
                const displayValue = kleur.yellow(value);
                const colorKey = kleur.cyan(key);
                log.message(`${colorKey}: ${displayValue}`);
            }
        }
    } catch {
        log.warning("No .env file found. Using default values.");
    }
}

/**
 * Resets preferences by copying .env.example to .env, or deleting .env if .env.example doesn't exist.
 */
export async function resetPreferences(config?: InitialConfig, cliArgs?: any): Promise<void> {
    const envPath = path.join(process.cwd(), ".env");
    const envExamplePath = path.join(process.cwd(), ".env.example");

    try {
        // Check if .env.example exists and if .env exists
        const envExampleExists = await fs
            .access(envExamplePath)
            .then(() => true)
            .catch(() => false);
        const envExists = await fs
            .access(envPath)
            .then(() => true)
            .catch(() => false);

        if (!envExists && !envExampleExists) {
            log.warning("No .env or .env.example file found. Nothing to reset.");
            return;
        }

        let message: string;
        let resetAction: string;

        if (envExampleExists) {
            // We have .env.example, so we can copy from it
            message = envExists
                ? "Are you sure you want to reset your .env file to defaults?"
                : "Create a new .env file with default preferences?";
            resetAction = "copy";
        } else {
            // No .env.example, so we'll delete .env instead
            message = "Are you sure you want to delete your .env file?";
            resetAction = "delete";
        }

        const confirmed = await confirm({
            message,
        });

        if (confirmed) {
            if (resetAction === "copy") {
                await fs.copyFile(envExamplePath, envPath);
                log.success("Preferences reset successfully. Created .env file with default values.");
            } else {
                if (envExists) {
                    await fs.unlink(envPath);
                }
                log.success("Preferences reset successfully. The application will use default values.");
            }

            // Reload config to pick up new environment variable state
            if (config && cliArgs) {
                const { reloadConfig } = await import("./config");
                reloadConfig(config, cliArgs);
                log.info("Configuration reloaded with current CLI arguments preserved.");
            }
        } else {
            log.info("Preferences reset cancelled.");
        }
    } catch (error) {
        log.error(`Failed to reset preferences: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * Shows cache statistics.
 */
export async function showCacheStats(): Promise<void> {
    const cacheDir = path.join(process.cwd(), ".cache");

    try {
        await fs.access(cacheDir);

        log.info("Cache statistics:\n");

        await showDirectoryStats(cacheDir, "Cache");
    } catch {
        log.warning("No cache directory found.");
    }
}

/**
 * Recursively shows directory statistics.
 */
async function showDirectoryStats(dirPath: string, label: string, indent = 0, maxDisplayDepth = 2): Promise<void> {
    const prefix = "  ".repeat(indent);

    try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        let totalSize = 0;
        const subdirectories: Array<{ name: string; path: string; size: number; fileCount: number }> = [];

        // First, process all entries to calculate cumulative sizes and file counts (include ALL children)
        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);

            if (entry.isDirectory()) {
                // Calculate full cumulative size and file count for subdirectory (no depth limit for calculation)
                const { size: subdirSize, fileCount: subdirFileCount } = await calculateDirectoryStats(fullPath);
                subdirectories.push({ name: entry.name, path: fullPath, size: subdirSize, fileCount: subdirFileCount });
                totalSize += subdirSize;
            } else if (entry.isFile()) {
                const stats = await fs.stat(fullPath);
                totalSize += stats.size;
            }
        }

        // Show current directory stats with cumulative size
        if (totalSize > 0 || subdirectories.length > 0) {
            const sizeStr = formatBytes(totalSize);
            let output = `${kleur.gray("│  ")}${prefix}${kleur.blue(label)}: ${sizeStr}`;

            // Add file count for third-tier directories (indent = 2)
            if (indent === 2) {
                const totalFiles = subdirectories.reduce((sum, subdir) => sum + subdir.fileCount, 0);
                const filesInCurrentDir = entries.filter((entry) => entry.isFile()).length;
                const allFiles = totalFiles + filesInCurrentDir;
                output += ` ${kleur.gray(`(${allFiles} items)`)}`;
            }

            console.log(output);
        }

        // Then process subdirectories if we haven't reached max display depth
        if (indent < maxDisplayDepth) {
            for (const subdir of subdirectories) {
                await showDirectoryStats(subdir.path, subdir.name, indent + 1, maxDisplayDepth);
            }
        }
    } catch (error) {
        log.error(`${prefix}${kleur.red(label)}: Error reading directory`);
    }
}

/**
 * Calculates the total size and file count of a directory and all its subdirectories (unlimited depth).
 */
async function calculateDirectoryStats(dirPath: string): Promise<{ size: number; fileCount: number }> {
    try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        let totalSize = 0;
        let fileCount = 0;

        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);

            if (entry.isDirectory()) {
                // Recursively calculate subdirectory stats (unlimited depth)
                const subdirStats = await calculateDirectoryStats(fullPath);
                totalSize += subdirStats.size;
                fileCount += subdirStats.fileCount;
            } else if (entry.isFile()) {
                // Add file size and count
                const stats = await fs.stat(fullPath);
                totalSize += stats.size;
                fileCount += 1;
            }
        }

        return { size: totalSize, fileCount };
    } catch (error) {
        return { size: 0, fileCount: 0 };
    }
}

/**
 * Formats bytes into human-readable format.
 */
function formatBytes(bytes: number): string {
    if (bytes === 0) return "0 B";

    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / k ** i).toFixed(1)) + " " + sizes[i];
}

/**
 * Purges the entire cache directory.
 */
export async function purgeCache(): Promise<void> {
    const cacheDir = path.join(process.cwd(), ".cache");

    try {
        await fs.access(cacheDir);

        const confirmed = await confirm({
            message: "Are you sure you want to delete the entire cache? This action cannot be undone.",
        });

        if (confirmed) {
            await fs.rm(cacheDir, { recursive: true, force: true });
            log.success("Cache purged successfully.");
        } else {
            log.info("Cache purge cancelled.");
        }
    } catch {
        log.warning("No cache directory found to purge.");
    }
}
