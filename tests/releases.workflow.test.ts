import assert from 'node:assert/strict'
import { describe, test } from 'bun:test'
import { formatAvailableReleaseVersions } from '../libs/workflows/releases'

describe('formatAvailableReleaseVersions', () => {
  test('renders a terminal-friendly newest-first release list', () => {
    assert.equal(
      formatAvailableReleaseVersions(['2026-03-18.0', '2025-12-22.0']),
      'Available Overture releases on S3:\n  2026-03-18.0\n  2025-12-22.0\n',
    )
  })

  test('renders a clear empty-state message', () => {
    assert.equal(
      formatAvailableReleaseVersions([]),
      'No Overture releases are currently available on S3.\n',
    )
  })
})
