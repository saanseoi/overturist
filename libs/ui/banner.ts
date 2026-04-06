import { log } from '@clack/prompts'
import kleur from 'kleur'

/**
 * Displays the CLI banner.
 * @param showGutter - Whether to render through clack's message gutter
 * @returns Nothing. Writes the banner to stdout.
 */
export function displayBanner(showGutter: boolean = true): void {
  const rainbowArt = [
    kleur.red('山 山 山 山 山 山 山 山  山 山 山 山 山 山 山 山 山'),
    kleur.magenta(' '),
    kleur.red('  ▗▄▖ ▗▖  ▗▖▗▄▄▄▖▗▄▄▖▗▄▄▄▖▗▖ ▗▖▗▄▄▖ ▗▄▄▄▖ ▗▄▄▖▗▄▄▄▖'),
    kleur.yellow(' ▐▌ ▐▌▐▌  ▐▌▐▌   ▐▌ ▐▌ █  ▐▌ ▐▌▐▌ ▐▌  █  ▐▌     █  '),
    kleur.green(' ▐▌ ▐▌▐▌  ▐▌▐▛▀▀▘▐▛▀▚▖ █  ▐▌ ▐▌▐▛▀▚▖  █   ▝▀▚▖  █  '),
    kleur.cyan(' ▝▚▄▞▘ ▝▚▞▘ ▐▙▄▄▖▐▌ ▐▌ █  ▝▚▄▞▘▐▌ ▐▌▗▄█▄▖▗▄▄▞▘  █  '),
    kleur.magenta(' '),
    kleur.blue('水 水 水 水 https://github.com/saanseoi 水 水 水 水'),
  ]

  if (showGutter) {
    log.message(rainbowArt.join('\n'))
    return
  }

  console.log(rainbowArt.join('\n'))
}
