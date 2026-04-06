// CLI
import { outro } from '@clack/prompts'
import kleur from 'kleur'
import type { Spinner } from './types'

/**
 * TYPES
 */

/**
 * Computes the feature count difference between the current and previous release.
 * @param currentCount - Feature count for the current release
 * @param previousCount - Feature count for the previous release, if available
 * @returns Signed difference or `null` when no previous count exists
 */
export function getDiffCount(
  currentCount: number,
  previousCount: number | null,
): number | null {
  if (previousCount === null) {
    return null // No previous count available
  }
  return currentCount - previousCount
}

/**
 * DATETIME
 */

/**
 * Parses natural language date (e.g., "22 October 2025") to ISO format (YYYY-MM-DD)
 * @param dateText - Natural language date string
 * @returns ISO formatted date string or null if parsing fails
 */
export function parseNaturalDateToISO(dateText: string): string | null {
  try {
    // Handle various date formats that might appear in the release calendar
    const cleanDate = dateText.trim()

    // Parse the date using Date constructor - this handles "22 October 2025" format
    const date = new Date(cleanDate)

    // Check if the date is valid
    if (Number.isNaN(date.getTime())) {
      return null
    }

    // Convert to YYYY-MM-DD format
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')

    return `${year}-${month}-${day}`
  } catch (_error) {
    return null
  }
}

/**
 * TERMINATION
 */

/**
 * Sets up graceful exit handling for SIGINT (Ctrl+C) to allow clean shutdown.
 * @returns Nothing. Registers the SIGINT handler once per process.
 */
let isGracefulExitHandlerRegistered = false

export function setupGracefulExit() {
  if (isGracefulExitHandlerRegistered) {
    return
  }

  isGracefulExitHandlerRegistered = true
  process.on('SIGINT', () => {
    outro(kleur.yellow('\n🛑 Script interrupted by user. Exiting gracefully...'))
    process.exit(0)
  })
}

/**
 * Displays a success message and exits the process with status code 0.
 * Use this for early successful termination when no error occurred.
 *
 * @param msg - Success message to display before exiting
 * @returns Never returns. Terminates the process with exit code `0`.
 */
export function successExit(msg?: string): never {
  if (msg) {
    outro(kleur.green(`✨ ${msg}`))
  }
  process.exit(0)
}

/**
 * Displays a failure message and exits the process with status code 1.
 * Use this for early unsuccessful termination when an error occurred.
 *
 * @param msg - Failure message to display before exiting
 * @returns Never returns. Terminates the process with exit code `1`.
 */
export function failedExit(msg?: string): never {
  if (msg) {
    outro(kleur.red(`❌ ${msg}`))
  }
  process.exit(1)
}

/**
 * Displays an error message and exits the process with status code 1.
 * This is the standard way to handle fatal errors in the application.
 *
 * @param msg - Error message to display before exiting
 * @returns Never returns. Terminates the process with exit code `1`.
 */
export function bail(msg: string = 'Exiting.'): never {
  outro(kleur.red(`💥 ${msg}`))
  process.exit(1)
}

/**
 * Stops a spinner, displays an error message, and exits the process with status code 1.
 * Use this when terminating from within a spinner operation.
 *
 * @param spinner - Active spinner instance to stop
 * @param spinnerMsg - Message that was being displayed in the spinner
 * @param msg - Error message to display before exiting
 * @returns Never returns. Terminates the process with exit code `1`.
 */
export function bailFromSpinner(
  spinner: Spinner,
  spinnerMsg: string,
  msg?: string,
): never {
  spinner.stop(spinnerMsg)
  bail(msg)
}
