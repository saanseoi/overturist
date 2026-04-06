import { groupMultiselect, select } from '@clack/prompts'
import kleur from 'kleur'
import { note } from '../core/note'
import type { ThemeDifferences, ThemeMapping } from '../core/types'
import { bail } from '../core/utils'

/**
 * Builds a formatted theme-difference message.
 * @param differences - Theme mapping differences to display
 * @returns Styled difference message for the note output.
 */
export function buildThemeDifferenceMessage(differences: ThemeDifferences): string {
  const sections: string[] = []

  if (differences.missingFromCurrent.length > 0) {
    sections.push(
      `⚠️ Missing on S3 (${kleur.red(differences.missingFromCurrent.length)} types):\n`,
      differences.missingFromCurrent.map(type => `   • ${kleur.red(type)}`).join('\n'),
      '\n\n',
    )
  }

  if (differences.missingFromPreceding.length > 0) {
    sections.push(
      `⚠️ New on S3 (${kleur.red(differences.missingFromPreceding.length)} types):\n`,
      differences.missingFromPreceding
        .map(type => `   • ${kleur.red(type)}`)
        .join('\n'),
      '\n\n',
    )
  }

  if (differences.changedThemes.length > 0) {
    sections.push(
      `⚠️ Reassigned themes (${kleur.red(differences.changedThemes.length)} types):\n`,
      differences.changedThemes
        .map(
          difference =>
            `   • ${kleur.red(difference.type)}: ${kleur.yellow(difference.precedingTheme)} -> ${kleur.green(difference.currentTheme)}`,
        )
        .join('\n'),
      '\n\n',
    )
  }

  sections.push('💡 Overture changed their schema, or their S3 upload is in progress.')
  return sections.join('')
}

/**
 * Prompts for how to handle theme drift against S3.
 * @param differences - Theme mapping differences
 * @returns Selected action.
 */
export async function promptUserForThemeAction(
  differences: ThemeDifferences,
): Promise<'update' | 'cancel'> {
  note(buildThemeDifferenceMessage(differences), 'Overture Maps schema drift')

  const action = await select({
    message: 'Update your theme schema to match S3?',
    options: [
      {
        value: 'update',
        label: 'Accept',
        hint: 'use the S3 schema as the latest theme mapping',
      },
      {
        value: 'cancel',
        label: 'Reject',
        hint: 'manually confirm the schema changes first',
      },
    ],
    initialValue: 'update',
  })

  return typeof action === 'symbol' ? 'cancel' : (action as 'update' | 'cancel')
}

/**
 * Prompts for interactive feature selection.
 * @param themeMapping - Feature-type to theme lookup
 * @param initialValues - Optional preselected feature types
 * @returns Selected feature types.
 */
export async function selectFeatureTypesInteractively(
  themeMapping: ThemeMapping,
  initialValues: string[] = [],
): Promise<string[]> {
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

  const selectedValues =
    initialValues.length > 0 ? initialValues : Object.keys(themeMapping)

  const selectedOptions = await groupMultiselect({
    message: 'Confirm which feature types to download:',
    options,
    selectableGroups: true,
    initialValues: selectedValues,
  })

  if (typeof selectedOptions === 'symbol') {
    bail('Feature selection cancelled')
  }

  return selectedOptions as string[]
}
