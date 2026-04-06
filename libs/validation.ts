import type { BBox, Division, ThemeDifferences, ThemeMapping } from './types'

/**
 * RELEASES
 */

/**
 * Validates that a release version is available on S3.
 * @param version - The version to validate
 * @param availableVersions - Array of available versions from S3
 * @returns Object indicating if version is valid and available versions
 */
export function validateReleaseVersion(
  version: string,
  availableVersions: string[],
): { isValid: boolean; availableVersions: string[]; message?: string } {
  if (!version) {
    return {
      isValid: false,
      availableVersions,
      message: 'No version specified',
    }
  }

  if (availableVersions.length === 0) {
    return {
      isValid: false,
      availableVersions,
      message: 'No versions available on S3',
    }
  }

  if (!availableVersions.includes(version)) {
    return {
      isValid: false,
      availableVersions,
      message: `Version "${version}" is not available on S3. Available versions: ${availableVersions.join(', ')}`,
    }
  }

  return {
    isValid: true,
    availableVersions,
  }
}

/**
 * THEME MAPPING
 */

/**
 * Compares two theme mappings and identifies differences.
 * @param currentThemeMapping - Current theme mapping to compare
 * @param precedingThemeMapping - Preceding theme mapping to compare against
 * @returns Object containing added, removed, and reassigned feature types
 * @remarks A difference is reported when a feature type is missing in either mapping
 * or when the same feature type points to a different theme between releases.
 */
export function compareThemeMappings(
  currentThemeMapping: ThemeMapping,
  precedingThemeMapping: ThemeMapping,
): ThemeDifferences {
  const currentTypes = Object.keys(currentThemeMapping)
  const precedingTypes = Object.keys(precedingThemeMapping)

  const missingFromCurrent = precedingTypes.filter(type => !currentTypes.includes(type))
  const missingFromPreceding = currentTypes.filter(
    type => !precedingTypes.includes(type),
  )
  // Flag feature types that still exist but were reassigned to a different theme.
  const changedThemes = currentTypes
    .filter(
      type =>
        type in precedingThemeMapping &&
        currentThemeMapping[type] !== precedingThemeMapping[type],
    )
    .map(type => ({
      type,
      currentTheme: currentThemeMapping[type],
      precedingTheme: precedingThemeMapping[type],
    }))

  return {
    missingFromCurrent,
    missingFromPreceding,
    changedThemes,
    hasDifferences:
      missingFromCurrent.length > 0 ||
      missingFromPreceding.length > 0 ||
      changedThemes.length > 0,
  }
}

/**
 * Normalizes raw bbox input to the canonical `xmin/ymin/xmax/ymax` shape.
 * @param value - Raw bbox-like value from DuckDB or cached JSON
 * @returns Canonical bbox when all coordinates are present and finite numbers, otherwise undefined
 * @remarks Legacy `minx/miny/maxx/maxy` aliases and numeric string coercion are rejected.
 */
export function normalizeBBox(value: unknown): BBox | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined
  }

  const record = value as Record<string, unknown>
  const { xmin, ymin, xmax, ymax } = record

  if (![xmin, ymin, xmax, ymax].every(coord => typeof coord === 'number')) {
    return undefined
  }

  if (![xmin, ymin, xmax, ymax].every(coord => Number.isFinite(coord))) {
    return undefined
  }

  return { xmin, ymin, xmax, ymax }
}

/**
 * Normalizes a division record so downstream code can rely on a validated bbox shape.
 * @param division - Division record from DuckDB or cache
 * @returns Division with bbox preserved only when it already matches the canonical shape
 * @remarks Invalid or legacy bbox payloads are left unchanged so callers can decide how to handle them.
 */
export function normalizeDivisionBBox<T extends Division>(division: T): T {
  const bbox = normalizeBBox(division.bbox)

  if (!division.bbox || !bbox) {
    return division
  }

  return {
    ...division,
    bbox,
  }
}
