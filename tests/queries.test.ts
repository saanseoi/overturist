import assert from 'node:assert/strict'
import { describe, test } from 'bun:test'
import type { Division } from '../libs/core'
import { getDivisionNameForLocale, localizeDivisionHierarchies } from '../libs/data'

describe('getDivisionNameForLocale', () => {
  test('prefers the requested locale, then en, then primary, then id', () => {
    assert.equal(
      getDivisionNameForLocale(
        {
          id: 'division-1',
          names: {
            primary: 'Munchen',
            common: [
              { key: 'en', value: 'Munich' },
              { key: 'de', value: 'Muenchen' },
            ],
          },
        },
        'de',
      ),
      'Muenchen',
    )

    assert.equal(
      getDivisionNameForLocale(
        {
          id: 'division-1',
          names: {
            primary: 'Munchen',
            common: [{ key: 'en', value: 'Munich' }],
          },
        },
        'fr',
      ),
      'Munich',
    )

    assert.equal(
      getDivisionNameForLocale(
        {
          id: 'division-1',
          names: {
            primary: 'Munchen',
            common: [],
          },
        },
        'fr',
      ),
      'Munchen',
    )

    assert.equal(
      getDivisionNameForLocale(
        {
          id: 'division-1',
          names: {
            common: [],
          },
        },
        'fr',
      ),
      'division-1',
    )
  })
})

describe('localizeDivisionHierarchies', () => {
  test('rewrites hierarchy names from division ids using locale fallbacks', () => {
    const division: Division = {
      id: 'locality-1',
      country: 'HK',
      subtype: 'locality',
      names: {
        primary: 'Central and Western',
        common: [{ key: 'en', value: 'Central & Western' }],
      },
      hierarchies: [
        [
          { division_id: 'country-1', subtype: 'country', name: '香港特別行政區' },
          { division_id: 'locality-1', subtype: 'locality', name: '中西區' },
        ],
      ],
    }

    const hierarchyLookup = new Map<string, Division>([
      [
        'country-1',
        {
          id: 'country-1',
          country: 'HK',
          subtype: 'country',
          names: {
            primary: '香港特別行政區',
            common: [{ key: 'en', value: 'Hong Kong SAR' }],
          },
          hierarchies: [],
        },
      ],
    ])

    const [localizedDivision] = localizeDivisionHierarchies(
      [division],
      hierarchyLookup,
      'fr',
    )

    assert.deepEqual(localizedDivision.hierarchies, [
      [
        { division_id: 'country-1', subtype: 'country', name: 'Hong Kong SAR' },
        { division_id: 'locality-1', subtype: 'locality', name: 'Central & Western' },
      ],
    ])
  })
})
