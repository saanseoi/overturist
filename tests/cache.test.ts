import assert from 'node:assert/strict'
import { describe, test } from 'bun:test'
import type { ReleaseData } from '../libs/core'
import { sortReleaseDataForCache } from '../libs/data'

describe('sortReleaseDataForCache', () => {
  test('sorts releases by version ascending before writing to cache', () => {
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
          schema: '1',
          isReleased: true,
          isAvailableOnS3: true,
        },
        {
          version: '2025-12-18.0',
          date: '2025-12-18',
          schema: '1',
          isReleased: true,
          isAvailableOnS3: true,
        },
        {
          version: '2026-01-21.0',
          date: '2026-01-21',
          schema: '1',
          isReleased: true,
          isAvailableOnS3: true,
        },
      ],
    }

    const cached = sortReleaseDataForCache(releaseData)

    assert.deepEqual(
      cached.releases.map(release => release.version),
      ['2025-12-18.0', '2026-01-21.0', '2026-03-18.0'],
    )
  })
})
