import { log } from "@clack/prompts";
import { type DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";
import kleur from "kleur";

/**
 * Manages a persistent DuckDB in-memory instance for multi-step processing.
 *
 * This class provides a way to create and reuse a single DuckDB database instance
 * across multiple queries, which is essential for workflows that need to maintain
 * temporary tables between query steps (like bbox then geom filtering).
 */
export class DuckDBManager {
    private instance: DuckDBInstance | null = null;
    private connection: DuckDBConnection | null = null;

    /**
     * Creates or returns an existing DuckDB in-memory instance.
     *
     * @returns Promise<DuckDBConnection> - A connection to the in-memory database
     * @throws Error - If database initialization fails
     *
     * @example
     * const manager = new DuckDBManager();
     * const connection = await manager.getConnection();
     * await connection.run("CREATE TEMP TABLE features AS SELECT * FROM data");
     */
    async getConnection(): Promise<DuckDBConnection> {
        if (!this.instance || !this.connection) {
            this.instance = await DuckDBInstance.create(":memory:");
            this.connection = await this.instance.connect();
        }
        return this.connection;
    }

    /**
     * Closes the database connection and cleans up resources.
     *
     * Should be called when processing is complete to free memory.
     *
     * @example
     * const manager = new DuckDBManager();
     * // ... use the database
     * await manager.close();
     */
    async close(): Promise<void> {
        if (this.connection) {
            // Note: DuckDBConnection doesn't have an explicit close method in the Node.js API
            // The connection will be cleaned up when the instance is closed
            this.connection = null;
        }
        if (this.instance) {
            // Note: DuckDBInstance doesn't have an explicit close method either
            // Resources will be garbage collected
            this.instance = null;
        }
    }
}

/**
 * Executes a DuckDB query and returns the results.
 *
 * This function provides a unified interface for running DuckDB queries with optional
 * progress feedback and error handling. It uses an in-memory database instance for
 * each call to ensure isolation between queries.
 *
 * @param query - The SQL query to execute. Can be any valid DuckDB SQL statement
 *                including SELECT, INSERT, COPY, CREATE TABLE, etc.
 *
 * @param options - Optional configuration object:
 *   @param options.silent - If true, suppresses console error logging. Default: false
 *   @param options.progressCallback - Optional callback function for progress updates.
 *                                    Called with (progress: number, status: string).
 *                                    Progress is 0-100, status is a descriptive message.
 *                                    Note: Progress is reported at start (0%) and completion (100%).
 *
 * @returns Promise<{ stdout: string; stderr: string; exitCode: number }>:
 *   - stdout: JSON string containing query results as an array of objects
 *   - stderr: Error message if the query failed, empty string if successful
 *   - exitCode: 0 for success, 1 for failure
 *
 * @example
 * // Simple query
 * const result = await runDuckDBQuery("SELECT * FROM users LIMIT 10");
 * console.log(JSON.parse(result.stdout));
 *
 * @example
 * // Query with progress feedback
 * await runDuckDBQuery("COPY (SELECT * FROM large_table) TO 'output.parquet'", {
 *   progressCallback: (progress, status) => {
 *     console.log(`${progress}%: ${status}`);
 *   }
 * });
 *
 * @example
 * // Silent query (no console error logging)
 * const result = await runDuckDBQuery("SELECT 1", { silent: true });
 *
 * @example
 * // Query with both options
 * const result = await runDuckDBQuery(
 *   "INSERT INTO target SELECT * FROM source",
 *   {
 *     silent: false,
 *     progressCallback: (p, s) => updateUI(p, s)
 *   }
 * );
 *
 * @throws Error - Errors are caught and returned in the result object rather than thrown
 *
 * @since 0.0.1
 */
export async function runDuckDBQuery(
    query: string,
    options: {
        silent?: boolean;
        progressCallback?: (progress: number, status: string) => void;
    } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const { silent = false, progressCallback } = options;

    try {
        // Create a fresh in-memory database instance for isolation
        const instance = await DuckDBInstance.create(":memory:");
        const connection = await instance.connect();

        // Execute the query and retrieve all results
        // runAndReadAll() blocks until the query completes
        const reader = await connection.runAndReadAll(query);

        // Convert results to JSON array of objects format
        const result = reader.getRowObjectsJson();

        // Notify progress callback of successful completion
        if (progressCallback) {
            progressCallback(100, "Complete");
        }

        // Return successful result
        return {
            stdout: JSON.stringify(result),
            stderr: "",
            exitCode: 0,
        };
    } catch (error) {
        // Extract error information
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;

        // Log error to console unless silent mode is enabled
        if (!silent) {
            log.error(`DuckDB query failed: ${errorMessage}`);
            log.message(kleur.white(errorStack || ""));
        }

        // Notify progress callback of error
        if (progressCallback) {
            progressCallback(0, `Error: ${errorMessage}`);
        }

        // Return error result (errors are caught, not thrown)
        return {
            stdout: "",
            stderr: errorMessage,
            exitCode: 1,
        };
    }
}

/**
 * Executes a DuckDB query using a shared database connection.
 *
 * This function is designed for multi-step workflows where temporary tables
 * need to be preserved between queries. It uses a provided DuckDBManager
 * instance instead of creating a new database for each query.
 *
 * @param manager - The DuckDBManager instance containing the shared database
 * @param query - The SQL query to execute
 * @param options - Optional configuration (same as runDuckDBQuery)
 *
 * @returns Promise<{ stdout: string; stderr: string; exitCode: number }>
 *
 * @example
 * const manager = new DuckDBManager();
 *
 * // Step 1: Create temp table
 * await runDuckDBQueryWithManager(manager,
 *   "CREATE TEMP TABLE bbox_features AS SELECT * FROM s3_data WHERE bbox_filter"
 * );
 *
 * // Step 2: Filter from temp table
 * await runDuckDBQueryWithManager(manager,
 *   "COPY (SELECT * FROM bbox_features WHERE geom_filter) TO 'output.parquet'"
 * );
 *
 * await manager.close();
 */
export async function runDuckDBQueryWithManager(
    manager: DuckDBManager,
    query: string,
    options: {
        silent?: boolean;
        progressCallback?: (progress: number, status: string) => void;
    } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const { silent = false, progressCallback } = options;

    try {
        const connection = await manager.getConnection();

        // Execute the query and get results as JSON
        const reader = await connection.runAndReadAll(query);

        // Get results in the expected format (array of objects)
        const result = reader.getRowObjectsJson();

        // Notify completion if callback provided
        if (progressCallback) {
            progressCallback(100, "Complete");
        }

        return {
            stdout: JSON.stringify(result),
            stderr: "",
            exitCode: 0,
        };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;

        if (!silent) {
            log.error(`DuckDB query failed: ${errorMessage}`);
            log.message(kleur.white(errorStack || ""));
        }

        if (progressCallback) {
            progressCallback(0, `Error: ${errorMessage}`);
        }

        return {
            stdout: "",
            stderr: errorMessage,
            exitCode: 1,
        };
    }
}
