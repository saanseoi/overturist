import type { ThemeMapping } from '../core/types'

/**
 * Groups feature types by theme for interactive multiselect prompts.
 * @param themeMapping - Feature-type to theme lookup
 * @returns Prompt option groups keyed by theme.
 */
export function buildThemeSelectionOptions(
  themeMapping: ThemeMapping,
): Record<string, Array<{ value: string; label: string }>> {
  const themesToFeatureTypes: Record<string, string[]> = {}

  for (const [featureType, theme] of Object.entries(themeMapping)) {
    if (!themesToFeatureTypes[theme]) {
      themesToFeatureTypes[theme] = []
    }
    themesToFeatureTypes[theme].push(featureType)
  }

  const options: Record<string, Array<{ value: string; label: string }>> = {}
  for (const [theme, featureTypes] of Object.entries(themesToFeatureTypes)) {
    options[theme] = featureTypes.map(featureType => ({
      value: featureType,
      label: featureType,
    }))
  }

  return options
}
