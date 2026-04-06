import assert from 'node:assert/strict'
import { describe, test } from 'bun:test'
import { ALL_DIVISION_SUBTYPES } from '../libs/core'
import type { ReleaseData } from '../libs/core'
import {
  getAdminLevels,
  getPrecedingReleaseVersion,
  getReleaseContext,
} from '../libs/data'

describe('getAdminLevels', () => {
  test('uses the latest schema mapping not newer than the requested version', () => {
    const levels = getAdminLevels('2026-01-01.0')

    assert.deepEqual(levels[1].subtypes, ['country', 'dependency'])
  })

  test('falls back to the oldest mapping for older versions', () => {
    const levels = getAdminLevels('2025-01-01.0')

    assert.deepEqual(levels[1].subtypes, ['country', 'dependency'])
  })

  test('uses modern division subtype names for current releases', () => {
    const levels = getAdminLevels('2026-03-18.0')

    assert.deepEqual(levels[2].subtypes, ['macroregion', 'region'])
    assert.deepEqual(levels[3].subtypes, [
      'macrocounty',
      'county',
      'localadmin',
      'locality',
      'borough',
    ])
  })

  test('defines the full subtype set for ANY division searches', () => {
    assert.deepEqual(
      [...ALL_DIVISION_SUBTYPES],
      [
        'country',
        'dependency',
        'macroregion',
        'region',
        'macrocounty',
        'county',
        'localadmin',
        'locality',
        'borough',
        'macrohood',
        'neighborhood',
        'microhood',
      ],
    )
  })
})

describe('getPrecedingReleaseVersion', () => {
  test('uses version order instead of insertion order', () => {
    const releaseData: ReleaseData = {
      lastUpdated: '2026-04-06T00:00:00.000Z',
      lastChecked: '2026-04-06T00:00:00.000Z',
      source: 'test',
      latest: '2026-03-18.0',
      totalReleases: 3,
      releases: [
        {
          version: '2025-12-22.0',
          date: '2025-12-22',
          schema: '1',
          isReleased: true,
          isAvailableOnS3: true,
        },
        {
          version: '2026-03-18.0',
          date: '2026-03-18',
          schema: '1',
          isReleased: true,
          isAvailableOnS3: true,
        },
        {
          version: '2025-09-24.0',
          date: '2025-09-24',
          schema: '1',
          isReleased: true,
          isAvailableOnS3: true,
        },
      ],
    }

    assert.equal(
      getPrecedingReleaseVersion('2026-03-18.0', releaseData),
      '2025-12-22.0',
    )
  })

  test('skips unreleased blog-only entries', () => {
    const releaseData: ReleaseData = {
      lastUpdated: '2026-04-06T00:00:00.000Z',
      lastChecked: '2026-04-06T00:00:00.000Z',
      source: 'test',
      latest: '2026-03-18.0',
      totalReleases: 3,
      releases: [
        {
          version: '2026-03-18.0',
          date: '2026-03-18',
          schema: '2',
          isReleased: true,
          isAvailableOnS3: true,
        },
        {
          version: '2026-02-01.0',
          date: '2026-02-01',
          schema: '2',
          isReleased: false,
          isAvailableOnS3: false,
        },
        {
          version: '2025-12-22.0',
          date: '2025-12-22',
          schema: '1',
          isReleased: true,
          isAvailableOnS3: true,
        },
      ],
    }

    assert.equal(
      getPrecedingReleaseVersion('2026-03-18.0', releaseData),
      '2025-12-22.0',
    )
  })
})

describe('getReleaseContext', () => {
  test('detects schema changes using version order, not insertion order', () => {
    const releaseData: ReleaseData = {
      lastUpdated: '2026-04-06T00:00:00.000Z',
      lastChecked: '2026-04-06T00:00:00.000Z',
      source: 'test',
      latest: '2026-03-18.0',
      totalReleases: 3,
      releases: [
        {
          version: '2025-12-22.0',
          date: '2025-12-22',
          schema: '1',
          isReleased: true,
          isAvailableOnS3: true,
        },
        {
          version: '2026-03-18.0',
          date: '2026-03-18',
          schema: '2',
          isReleased: true,
          isAvailableOnS3: true,
        },
        {
          version: '2025-09-24.0',
          date: '2025-09-24',
          schema: '1',
          isReleased: true,
          isAvailableOnS3: true,
        },
      ],
    }

    assert.deepEqual(getReleaseContext(releaseData, '2026-03-18.0'), {
      version: '2026-03-18.0',
      schema: '2',
      date: '2026-03-18',
      isNewSchema: true,
      isLatest: true,
      previousVersion: '2025-12-22.0',
      previousSchema: '1',
    })
  })
})
