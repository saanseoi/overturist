import assert from 'node:assert/strict'
import { Writable } from 'node:stream'
import { describe, test } from 'bun:test'
import stringWidth from 'string-width'
import { note } from '../libs/core'

function stripAnsi(value: string): string {
  let result = ''

  for (let index = 0; index < value.length; index++) {
    const char = value[index]
    const nextChar = value[index + 1]

    if (char === '\u001B' && nextChar === '[') {
      index += 2
      while (index < value.length && value[index] !== 'm') {
        index++
      }
      continue
    }

    result += char
  }

  return result
}

class CaptureWritable extends Writable {
  chunks: string[] = []
  columns?: number

  constructor(columns?: number) {
    super()
    this.columns = columns
  }

  override _write(
    chunk: string | Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ) {
    this.chunks.push(String(chunk))
    callback()
  }

  toString() {
    return this.chunks.join('')
  }
}

describe('note', () => {
  test('renders a framed note with a header, body, and footer', () => {
    const output = new CaptureWritable(60)
    note('Hello world', 'Summary', { output })

    const rendered = stripAnsi(output.toString())
    const lines = rendered.trimEnd().split('\n')

    assert.equal(lines.length >= 5, true)
    assert.match(lines[0] ?? '', /^[│|]$/)
    assert.match(lines[1] ?? '', /Summary/)
    assert.match(lines.at(-1) ?? '', /^[├+]/)
    assert.equal(
      lines.some(line => line.includes('Hello world')),
      true,
    )
  })

  test('wraps long content based on the output width and preserves framed alignment', () => {
    const output = new CaptureWritable(22)
    note('This message should wrap across multiple lines cleanly.', 'Wrap', { output })

    const rendered = stripAnsi(output.toString())
    const lines = rendered.trimEnd().split('\n')
    const bodyLines = lines.slice(2, -1)

    assert.equal(bodyLines.length > 3, true)

    const widths = bodyLines.map(line => stringWidth(line))
    assert.equal(new Set(widths).size, 1)
  })

  test('handles wide characters without breaking visual alignment', () => {
    const output = new CaptureWritable(20)
    note('中文字符需要正确换行和对齐。', '标题', { output })

    const rendered = stripAnsi(output.toString())
    const lines = rendered.trimEnd().split('\n')
    const bodyLines = lines.slice(2, -1)

    assert.equal(bodyLines.length > 2, true)
    assert.equal(new Set(bodyLines.map(line => stringWidth(line))).size, 1)
  })

  test('uses a custom formatter while preserving width compensation', () => {
    const output = new CaptureWritable(24)
    note('alpha beta gamma delta epsilon', 'Format', {
      output,
      format: line => `>> ${line} <<`,
    })

    const rendered = stripAnsi(output.toString())
    const bodyLines = rendered.trimEnd().split('\n').slice(2, -1)

    assert.equal(
      bodyLines.some(line => line.includes('>> ')),
      true,
    )
    assert.equal(new Set(bodyLines.map(line => stringWidth(line))).size, 1)
  })

  test('falls back to an 80-column width when columns are unavailable', () => {
    const output = new CaptureWritable()
    note('fallback width rendering', 'Default Width', { output })

    const rendered = stripAnsi(output.toString())
    assert.match(rendered, /Default Width/)
    assert.match(rendered, /fallback width rendering/)
  })
})
