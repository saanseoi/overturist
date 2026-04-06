import assert from 'node:assert/strict'
import { describe, test } from 'bun:test'
import {
  compareThemeMappings,
  normalizeBBox,
  normalizeDivisionBBox,
  validateReleaseVersion,
} from '../libs/core'
import type { Division, ThemeMapping } from '../libs/core'

describe('validateReleaseVersion', () => {
  test('rejects missing versions', () => {
    assert.deepEqual(validateReleaseVersion('', ['2026-03-18.0']), {
      isValid: false,
      availableVersions: ['2026-03-18.0'],
      message: 'No version specified',
    })
  })

  test('rejects when no versions are available', () => {
    assert.deepEqual(validateReleaseVersion('2026-03-18.0', []), {
      isValid: false,
      availableVersions: [],
      message: 'No versions available on S3',
    })
  })

  test('rejects versions that are not present on s3', () => {
    assert.deepEqual(validateReleaseVersion('2026-03-18.0', ['2025-12-22.0']), {
      isValid: false,
      availableVersions: ['2025-12-22.0'],
      message:
        'Version "2026-03-18.0" is not available on S3. Available versions: 2025-12-22.0',
    })
  })

  test('accepts versions that are present on s3', () => {
    assert.deepEqual(validateReleaseVersion('2026-03-18.0', ['2026-03-18.0']), {
      isValid: true,
      availableVersions: ['2026-03-18.0'],
    })
  })
})

describe('normalizeBBox', () => {
  test('keeps canonical xmin/xmax/ymin/ymax coordinates', () => {
    assert.deepEqual(
      normalizeBBox({
        xmin: 114.1,
        xmax: 114.2,
        ymin: 22.1,
        ymax: 22.2,
      }),
      {
        xmin: 114.1,
        xmax: 114.2,
        ymin: 22.1,
        ymax: 22.2,
      },
    )
  })

  test('rejects legacy minx/maxx/miny/maxy coordinates', () => {
    assert.equal(
      normalizeBBox({
        minx: 114.1,
        maxx: 114.2,
        miny: 22.1,
        maxy: 22.2,
      }),
      undefined,
    )
  })

  test('rejects numeric strings', () => {
    assert.equal(
      normalizeBBox({
        xmin: '114.1',
        xmax: '114.2',
        ymin: '22.1',
        ymax: '22.2',
      }),
      undefined,
    )
  })

  test('rejects non-object, partial, and non-finite bbox payloads', () => {
    assert.equal(normalizeBBox(null), undefined)
    assert.equal(normalizeBBox('114.1,22.1,114.2,22.2'), undefined)
    assert.equal(normalizeBBox({ xmin: 1, ymin: 2, xmax: 3 }), undefined)
    assert.equal(
      normalizeBBox({ xmin: 1, ymin: 2, xmax: Number.NaN, ymax: 4 }),
      undefined,
    )
    assert.equal(
      normalizeBBox({ xmin: 1, ymin: 2, xmax: Number.POSITIVE_INFINITY, ymax: 4 }),
      undefined,
    )
  })
})

describe('normalizeDivisionBBox', () => {
  test('preserves canonical bbox values', () => {
    const division = {
      id: 'division-1',
      country: 'HK',
      subtype: 'locality',
      names: {
        primary: 'Hong Kong',
        common: [],
      },
      hierarchies: [],
      bbox: {
        xmin: 114.1,
        xmax: 114.2,
        ymin: 22.1,
        ymax: 22.2,
      },
    } as Division

    assert.deepEqual(normalizeDivisionBBox(division).bbox, {
      xmin: 114.1,
      xmax: 114.2,
      ymin: 22.1,
      ymax: 22.2,
    })
  })

  test('leaves legacy bbox payloads unchanged', () => {
    const legacyBbox = {
      minx: 114.1,
      maxx: 114.2,
      miny: 22.1,
      maxy: 22.2,
    }
    const division = {
      id: 'division-2',
      country: 'HK',
      subtype: 'locality',
      names: {
        primary: 'Hong Kong',
        common: [],
      },
      hierarchies: [],
      bbox: legacyBbox,
    } as Division

    assert.equal(normalizeDivisionBBox(division).bbox, legacyBbox)
  })

  test('returns the same object when bbox is absent or invalid', () => {
    const withoutBbox = {
      id: 'division-3',
      country: 'HK',
      subtype: 'locality',
      names: {
        primary: 'Hong Kong',
        common: [],
      },
      hierarchies: [],
    } as Division
    const invalidBboxDivision = {
      ...withoutBbox,
      id: 'division-4',
      bbox: { xmin: 1, ymin: 2, xmax: '3', ymax: 4 },
    } as Division

    assert.equal(normalizeDivisionBBox(withoutBbox), withoutBbox)
    assert.equal(normalizeDivisionBBox(invalidBboxDivision), invalidBboxDivision)
  })
})

describe('compareThemeMappings', () => {
  test('flags missing, added, and reassigned feature types', () => {
    const currentThemeMapping: ThemeMapping = {
      building: 'buildings',
      segment: 'transportation',
      locality: 'places',
    }
    const precedingThemeMapping: ThemeMapping = {
      building: 'structures',
      segment: 'transportation',
      address: 'places',
    }

    assert.deepEqual(compareThemeMappings(currentThemeMapping, precedingThemeMapping), {
      missingFromCurrent: ['address'],
      missingFromPreceding: ['locality'],
      changedThemes: [
        {
          type: 'building',
          currentTheme: 'buildings',
          precedingTheme: 'structures',
        },
      ],
      hasDifferences: true,
    })
  })

  test('reports no differences when mappings match exactly', () => {
    const themeMapping: ThemeMapping = {
      building: 'buildings',
      segment: 'transportation',
    }

    assert.deepEqual(compareThemeMappings(themeMapping, themeMapping), {
      missingFromCurrent: [],
      missingFromPreceding: [],
      changedThemes: [],
      hasDifferences: false,
    })
  })
})
