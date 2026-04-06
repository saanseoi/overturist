import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, mock, test } from 'bun:test'
import type { Config } from '../libs/core'

const fetchMock = mock(async () => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  text: async () => '',
}))

function createConfig(overrides: Partial<Config> = {}): Config {
  return {
    locale: 'en',
    outputDir: './data',
    releaseFn: 'releases.json',
    releaseUrl: 'https://docs.overturemaps.org/release-calendar/',
    target: 'division',
    confirmFeatureSelection: true,
    clipMode: 'preserve',
    ...overrides,
  }
}

async function loadWebModule() {
  mock.module('node-fetch', () => ({
    default: fetchMock,
  }))

  return await import(`../libs/data/web.ts?test=${Date.now()}-${Math.random()}`)
}

beforeEach(() => {
  fetchMock.mockClear()
})

afterEach(() => {
  mock.restore()
})

describe('scrapeReleaseCalendar', () => {
  test('parses upcoming and released tables and preserves optional URLs', async () => {
    const { scrapeReleaseCalendar } = await loadWebModule()
    fetchMock.mockImplementation(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => `
        <html>
          <body>
            <table>
              <tbody>
                <tr>
                  <td>18 April 2026</td>
                  <td><a href="/release/2026-04-18"><code>2026-04-18.0</code></a></td>
                  <td><a href="/schema/v1.17.0"><code>v1.17.0</code></a></td>
                </tr>
              </tbody>
            </table>
            <table>
              <tbody>
                <tr>
                  <td>18 March 2026</td>
                  <td><a href="/release/2026-03-18"><code>2026-03-18.0</code></a></td>
                  <td><code>v1.16.0</code></td>
                </tr>
              </tbody>
            </table>
          </body>
        </html>
      `,
    }))

    const releases = await scrapeReleaseCalendar(createConfig())

    assert.deepEqual(releases, [
      {
        date: '2026-04-18',
        version: '2026-04-18.0',
        schema: '1.17.0',
        isReleased: false,
        isAvailableOnS3: false,
        versionReleaseUrl: '/release/2026-04-18',
        schemaReleaseUrl: '/schema/v1.17.0',
      },
      {
        date: '2026-03-18',
        version: '2026-03-18.0',
        schema: '1.16.0',
        isReleased: true,
        isAvailableOnS3: false,
        versionReleaseUrl: '/release/2026-03-18',
      },
    ])
  })

  test('skips rows with TBA, missing data, or unparsable dates', async () => {
    const { scrapeReleaseCalendar } = await loadWebModule()
    fetchMock.mockImplementation(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => `
        <html>
          <body>
            <table><tbody><tr><td>ignore</td></tr></tbody></table>
            <table>
              <tbody>
                <tr><td>TBA</td><td><code>2026-04-18.0</code></td><td><code>v1.17.0</code></td></tr>
                <tr><td>not-a-date</td><td><code>2026-05-18.0</code></td><td><code>v1.17.0</code></td></tr>
                <tr><td>18 April 2026</td><td></td><td><code>v1.17.0</code></td></tr>
              </tbody>
            </table>
            <table>
              <tbody>
                <tr>
                  <td>18 March 2026</td>
                  <td><code>2026-03-18.0</code></td>
                  <td><code>v1.16.0</code></td>
                </tr>
              </tbody>
            </table>
          </body>
        </html>
      `,
    }))

    const releases = await scrapeReleaseCalendar(createConfig())

    assert.equal(releases.length, 1)
    assert.equal(releases[0]?.version, '2026-03-18.0')
  })

  test('throws on HTTP failures', async () => {
    const { scrapeReleaseCalendar } = await loadWebModule()
    fetchMock.mockImplementation(async () => ({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      text: async () => '',
    }))

    await assert.rejects(
      scrapeReleaseCalendar(createConfig()),
      /HTTP 503: Service Unavailable/,
    )
  })

  test('throws when expected tables are missing', async () => {
    const { scrapeReleaseCalendar } = await loadWebModule()
    fetchMock.mockImplementation(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => '<html><body><table></table></body></html>',
    }))

    await assert.rejects(
      scrapeReleaseCalendar(createConfig()),
      /expected release tables/,
    )
  })

  test('throws when no valid releases can be extracted', async () => {
    const { scrapeReleaseCalendar } = await loadWebModule()
    fetchMock.mockImplementation(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => `
        <html>
          <body>
            <table><tbody><tr><td>ignore</td></tr></tbody></table>
            <table><tbody><tr><td>TBA</td><td><code>2026-04-18.0</code></td><td><code>v1.17.0</code></td></tr></tbody></table>
            <table><tbody><tr><td>invalid</td><td><code>2026-03-18.0</code></td><td><code>v1.16.0</code></td></tr></tbody></table>
          </body>
        </html>
      `,
    }))

    await assert.rejects(
      scrapeReleaseCalendar(createConfig()),
      /Failed to extract any releases/,
    )
  })
})
