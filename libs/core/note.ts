import process from 'node:process'
import type { Writable } from 'node:stream'
import { type Options as WrapAnsiOptions, wrapAnsi } from 'fast-wrap-ansi'
import color from 'picocolors'
import stringWidth from 'string-width'

// Constants for custom note function (from @clack/prompts source)
const isUnicodeSupported = () => {
  if (process.platform !== 'win32') {
    return process.env.TERM !== 'linux'
  }
  return (
    Boolean(process.env.CI) ||
    Boolean(process.env.WT_SESSION) ||
    Boolean(process.env.TERMINUS_SUBLIME) ||
    process.env.ConEmuTask === '{cmd::Cmder}' ||
    process.env.TERM_PROGRAM === 'Terminus-Sublime' ||
    process.env.TERM_PROGRAM === 'vscode' ||
    process.env.TERM === 'xterm-256color' ||
    process.env.TERM === 'alacritty' ||
    process.env.TERM === 'kitty' ||
    process.env.TERMINAL_EMULATOR === 'JetBrains-JediTerm'
  )
}

const unicode = isUnicodeSupported()
const s = (c: string, fallback: string) => (unicode ? c : fallback)
const S_BAR = s('│', '|')
const S_BAR_H = s('─', '-')
const S_CONNECT_LEFT = s('├', '+')
const S_CORNER_TOP_RIGHT = s('╮', '+')
const S_CORNER_BOTTOM_RIGHT = s('╯', '+')
const S_STEP_SUBMIT = s('◇', 'o')

type FormatFn = (line: string) => string

export interface NoteOptions {
  format?: FormatFn
  output?: Writable
}

type ColumnWritable = Writable & { columns?: number }

/**
 * Applies the default visual treatment to wrapped note content.
 * @param line - A single rendered line from the note body
 * @returns Styled line content for display
 */
const defaultNoteFormatter = (line: string): string => color.dim(line)

/**
 * Returns the current terminal width for the provided output stream.
 * @param output - Output stream that may expose a `columns` property
 * @returns Terminal width in columns, defaulting to `80` when unavailable
 */
const getColumns = (output: Writable = process.stdout): number => {
  return (output as ColumnWritable).columns ?? 80
}

/**
 * Wraps note content while preserving alignment after ANSI formatting is applied.
 * @param message - Message body to wrap for display
 * @param width - Maximum available content width before framing
 * @param format - Formatter applied to each wrapped line
 * @returns Wrapped message string with newline separators preserved
 */
const wrapWithFormat = (message: string, width: number, format: FormatFn): string => {
  const opts: WrapAnsiOptions = {
    hard: true,
    trim: false,
  }
  const wrapMsg = wrapAnsi(message, width, opts).split('\n')
  const maxWidthNormal = wrapMsg.reduce((sum, ln) => Math.max(stringWidth(ln), sum), 0)
  const maxWidthFormat = wrapMsg
    .map(format)
    .reduce((sum, ln) => Math.max(stringWidth(ln), sum), 0)
  const wrapWidth = Math.max(width - (maxWidthFormat - maxWidthNormal), 1)
  return wrapAnsi(message, wrapWidth, opts)
}

/**
 * Custom note function that properly handles wide characters (Chinese, etc.)
 * This is a drop-in replacement for @clack/prompts' note function with better
 * support for wide characters like Chinese, Japanese, Korean, etc.
 *
 * @param message - Note body text to render inside the framed box
 * @param title - Short title rendered in the note header
 * @param opts - Optional output stream and line formatter overrides
 * @returns Nothing. Writes the rendered note directly to the output stream.
 * @remarks Width calculations use visual string width so wide characters align correctly.
 */
export const note = (message = '', title = '', opts?: NoteOptions) => {
  const output: Writable = opts?.output ?? process.stdout
  const format = opts?.format ?? defaultNoteFormatter
  const wrapMsg = wrapWithFormat(message, getColumns(output) - 6, format)
  const lines = ['', ...wrapMsg.split('\n').map(format), '']
  const titleLen = stringWidth(title)
  const len =
    Math.max(
      lines.reduce((sum, ln) => {
        const width = stringWidth(ln)
        return width > sum ? width : sum
      }, 0),
      titleLen,
    ) + 2
  const msg = lines
    .map(
      ln =>
        `${color.gray(S_BAR)}  ${ln}${' '.repeat(len - stringWidth(ln))}${color.gray(S_BAR)}`,
    )
    .join('\n')
  output.write(
    `${color.gray(S_BAR)}\n${color.green(S_STEP_SUBMIT)}  ${color.reset(title)} ${color.gray(
      S_BAR_H.repeat(Math.max(len - titleLen - 1, 1)) + S_CORNER_TOP_RIGHT,
    )}\n${msg}\n${color.gray(S_CONNECT_LEFT + S_BAR_H.repeat(len + 2) + S_CORNER_BOTTOM_RIGHT)}\n`,
  )
}
