import assert from 'node:assert/strict'
import { describe, test } from 'bun:test'
import type { CliArgs, Config, Division } from '../libs/core'
import { getPreselectedDivision, initializeDivision } from '../libs/workflows'

function createConfig(overrides: Partial<Config> = {}): Config {
  return {
    locale: 'en',
    outputDir: './data',
    releaseFn: 'releases.json',
    releaseUrl: 'https://docs.overturemaps.org/release-calendar/',
    target: 'division',
    confirmFeatureSelection: true,
    ...overrides,
  }
}

function createCliArgs(overrides: Partial<CliArgs> = {}): CliArgs {
  return {
    onFileExists: 'skip',
    ...overrides,
  }
}

function createDivision(id: string): Division {
  return {
    id,
    names: {
      primary: 'Hong Kong SAR',
      common: [],
    },
    subtype: 'dependency',
    country: 'HK',
    hierarchies: [],
  }
}

describe('initializeDivision', () => {
  test('does not reuse config.selectedDivision during interactive new-search flows', () => {
    const config = createConfig({
      selectedDivision: createDivision('persisted-division'),
    })
    const cliArgs = createCliArgs()

    const result = getPreselectedDivision({ target: 'division' }, config, cliArgs)

    assert.equal(result, undefined)
  })

  test('reuses config.selectedDivision for non-interactive runs when compatible', async () => {
    const division = createDivision('persisted-division')

    const result = await initializeDivision(
      '2026-03-18.0',
      'en',
      createConfig({ selectedDivision: division }),
      createCliArgs(),
      'division',
      false,
    )

    assert.equal(result.divisionId, division.id)
    assert.equal(result.division?.id, division.id)
  })
})
