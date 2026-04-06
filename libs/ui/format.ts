import kleur from 'kleur'
import { buildBboxPath } from '../fs'
import type { BBox } from '../types'

/**
 * Formats a bounding box for note output.
 * @param bbox - Bounding box coordinates
 * @returns Styled bbox string.
 */
export function formatBboxPath(bbox: BBox): string {
  const coords = buildBboxPath(bbox).split(',')
  const formattedCoords = coords.map(coord => {
    const match = coord.match(/^(-?\d+)(\.\d+)?$/)
    if (!match) {
      return coord
    }

    const wholeNumber = match[1]
    const decimal = match[2] || ''
    return kleur.bold(wholeNumber) + decimal
  })

  return formattedCoords.join(kleur.gray(' , '))
}

/**
 * Formats a filesystem path for note output.
 * @param pathStr - Path string
 * @returns Styled path string.
 */
export function formatPath(pathStr: string): string {
  return pathStr.replace(/\//g, kleur.gray('/'))
}
