import { log } from '@clack/prompts'
import { type DuckDBConnection, DuckDBInstance } from '@duckdb/node-api'
import kleur from 'kleur'

type DuckDBQueryResult = {
  stdout: string
  stderr: string
  exitCode: number
}

type DuckDBQueryOptions = {
  silent?: boolean
  progressCallback?: (progress: number, status: string) => void
}

/**
 * Executes a DuckDB query against an existing connection and normalizes the response shape.
 * @param connection - Open DuckDB connection to execute against
 * @param query - SQL query to execute
 * @param options - Optional logging and progress behavior
 * @returns Promise resolving to a CLI-style query result object
 */
async function executeDuckDBQuery(
  connection: DuckDBConnection,
  query: string,
  options: DuckDBQueryOptions = {},
): Promise<DuckDBQueryResult> {
  const { silent = false, progressCallback } = options

  try {
    // Execute the query eagerly so callers get a fully materialized JSON payload.
    const reader = await connection.runAndReadAll(query)
    const result = reader.getRowObjectsJson()

    if (progressCallback) {
      progressCallback(100, 'Complete')
    }

    return {
      stdout: JSON.stringify(result),
      stderr: '',
      exitCode: 0,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const errorStack = error instanceof Error ? error.stack : undefined

    if (!silent) {
      log.error(`DuckDB query failed: ${errorMessage}`)
      log.message(kleur.white(errorStack || ''))
    }

    if (progressCallback) {
      progressCallback(0, `Error: ${errorMessage}`)
    }

    return {
      stdout: '',
      stderr: errorMessage,
      exitCode: 1,
    }
  }
}

/**
 * Manages a persistent DuckDB in-memory instance for multi-step processing.
 *
 * This class provides a way to create and reuse a single DuckDB database instance
 * across multiple queries, which is essential for workflows that need to maintain
 * temporary tables between query steps (like bbox then geom filtering).
 */
export class DuckDBManager {
  private instance: DuckDBInstance | null = null
  private connection: DuckDBConnection | null = null

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
      this.instance = await DuckDBInstance.create(':memory:')
      this.connection = await this.instance.connect()
    }
    return this.connection
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
      this.connection.closeSync()
      this.connection = null
    }
    if (this.instance) {
      this.instance.closeSync()
      this.instance = null
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
  options: DuckDBQueryOptions = {},
): Promise<DuckDBQueryResult> {
  const instance = await DuckDBInstance.create(':memory:')
  const connection = await instance.connect()

  try {
    return await executeDuckDBQuery(connection, query, options)
  } finally {
    connection.closeSync()
    instance.closeSync()
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
  options: DuckDBQueryOptions = {},
): Promise<DuckDBQueryResult> {
  const connection = await manager.getConnection()
  return await executeDuckDBQuery(connection, query, options)
}
