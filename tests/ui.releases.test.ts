import assert from 'node:assert/strict'
import { describe, test } from 'bun:test'
import type { ReleaseData } from '../libs/core'
import {
  buildReleaseVersionOptions,
  getSelectableReleaseVersions,
} from '../libs/ui/releases.utils'

describe('release selection helpers', () => {
  test('filters unavailable releases and sorts selectable versions descending', () => {
    const releaseData: ReleaseData = {
      lastUpdated: '2026-04-07T00:00:00.000Z',
      lastChecked: '2026-04-07T00:00:00.000Z',
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
          version: '2026-04-01.0',
          date: '2026-04-01',
          schema: '2',
          isReleased: true,
          isAvailableOnS3: false,
        },
      ],
    }

    assert.deepEqual(getSelectableReleaseVersions(releaseData), [
      '2026-03-18.0',
      '2025-12-22.0',
    ])
  })

  test('marks only the first selectable version as latest in the prompt options', () => {
    const options = buildReleaseVersionOptions({
      lastUpdated: '2026-04-07T00:00:00.000Z',
      lastChecked: '2026-04-07T00:00:00.000Z',
      source: 'test',
      latest: '2026-03-18.0',
      totalReleases: 2,
      releases: [
        {
          version: '2026-03-18.0',
          date: '2026-03-18',
          schema: '2',
          isReleased: true,
          isAvailableOnS3: true,
        },
        {
          version: '2025-12-22.0',
          date: '2025-12-22',
          schema: '1',
          isReleased: true,
          isAvailableOnS3: true,
        },
      ],
    })

    assert.equal(options[0]?.value, '2026-03-18.0')
    assert.match(options[0]?.label ?? '', /Current \(v2026-03-18\.0\)/)
    assert.equal(options[1]?.value, '2025-12-22.0')
    assert.match(options[1]?.label ?? '', /2025 December \(v2025-12-22\.0\)/)
  })
})
