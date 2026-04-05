import { parse } from '@bomb.sh/args'
import kleur from 'kleur'
import { validateTarget } from './config'
import type {
  BBox,
  CliArgs,
  OnExistingFilesAction,
  OptionConfig,
  ParsedArgs,
} from './types'
import { displayBanner } from './ui'
import { successExit } from './utils'

const options: Record<string, OptionConfig> = {
  release: {
    description: `Download this version ${kleur.grey('e.g. 2025-10-22.0')}`,
    boolean: false,
    alias: 'r',
    group: 'Download',
  },
  theme: {
    description: `Only download these themes ${kleur.grey('- repeatable')}`,
    boolean: false,
    alias: 'T',
    group: 'Download',
  },
  type: {
    description: `Only download these feature types ${kleur.grey('- repeatable')}`,
    boolean: false,
    alias: 't',
    group: 'Download',
  },
  target: {
    description: `Download extract by ${kleur.grey('division, bbox, or world')}`,
    boolean: false,
    group: 'Geospatial',
  },
  division: {
    description: "Filter results by this division's boundaries",
    boolean: false,
    alias: 'd',
    group: 'Geospatial',
  },
  bbox: {
    description: `Filter results by BBox ${kleur.grey('e.g. 71.1,42.3,72,43')}`,
    boolean: false,
    group: 'Geospatial',
  },
  'no-clip': {
    description: 'Do not clip results to division boundary geometry',
    boolean: true,
    group: 'Geospatial',
  },
  skip: {
    description: `Skip downloads if files exist ${kleur.grey('(default)')}`,
    boolean: true,
    group: 'File Handling',
  },
  replace: {
    description: 'Replace existing files with fresh downloads',
    boolean: true,
    group: 'File Handling',
  },
  abort: {
    description: 'Exit if existing files are found',
    boolean: true,
    group: 'File Handling',
  },
  examples: {
    description: 'Show usage examples',
    boolean: true,
    group: 'default',
  },
  help: {
    description: 'Show this help message',
    boolean: true,
    alias: 'h',
    group: 'default',
  },
  locale: {
    description: `ISO code for localised names ${kleur.grey('e.g. zh-hk')}`,
    boolean: false,
    alias: 'l',
    group: 'default',
  },
}

const argConfig = {
  boolean: Object.keys(options).filter(key => options[key]?.boolean),
  string: ['theme', 'type', 'division', 'release', 'bbox', 'target'], // Add support for multiple values
  alias: Object.fromEntries(
    Object.entries(options)
      .filter(([, value]) => value.alias)
      .map(([key, value]) => [value.alias, key]),
  ),
  multi: ['theme', 'type'], // Allow repeated values for theme and type
}

/**
 * Parses command-line arguments and returns configuration values.
 * @param argv - Raw process arguments, including runtime and script paths
 * @returns Object containing all parsed CLI arguments
 * @remarks Parsing happens inside this function so tests can supply their own argv.
 */
export function handleArguments(argv: string[] = process.argv): CliArgs {
  const parsedArgs = parseArgs(argv)

  // Handle display flags first (help, examples)
  handleModeFlags(parsedArgs)

  // Parse file handling action (skip/replace/abort)
  const onFilesExists = parseFileHandlingAction(parsedArgs)

  // Parse repeatable values directly from argv so repeated flags remain intact.
  const themes = parseRepeatableArgument(argv, 'theme', 'T')
  const types = parseRepeatableArgument(argv, 'type', 't')

  // Parse bbox if provided (format: xmin,ymin,xmax,ymax)
  const bbox = parseBboxArgument(parsedArgs.bbox)

  // Parse simple string options
  const divisionId = parseStringArgument(parsedArgs.division)
  const releaseVersion = parseStringArgument(parsedArgs.release)
  const locale = parseStringArgument(parsedArgs.locale)

  // Parse Limited Sets
  const target = validateTarget(parsedArgs.target)

  return {
    onFilesExists,
    themes,
    types,
    divisionId,
    releaseVersion,
    bbox,
    noClip: parsedArgs['no-clip'],
    target,
    locale,
    get: isGetCommand(argv),
  }
}

/**
 * NON INTERACTIVE MODES
 */

/**
 * Displays the help message with usage instructions and available options.
 */
function displayHelp() {
  console.log()
  displayBanner(false)
  console.log(
    '\n' +
      kleur.white(
        'CLI for downloading Overture Maps data from S3. \n\n            Friendly to 🧑 and 🤖.',
      ) +
      '\n\n' +
      kleur.white('INTERACTIVE:') +
      '\n' +
      '  > ' +
      kleur.cyan('bun overturist.ts ') +
      kleur.gray('[OPTIONS]') +
      '\n\n' +
      kleur.white('SCRIPTING:') +
      '\n' +
      '  > ' +
      kleur.cyan('bun overturist.ts ') +
      kleur.red('get') +
      ' ' +
      kleur.gray('[OPTIONS]') +
      '\n',
  )
  console.log(kleur.white('ARGUMENTS:'))
  console.log(
    kleur.red('  get'.padEnd(20)) + kleur.white('Download without user input'),
  )
  console.log()
  console.log(kleur.white('OPTIONS:'))

  // Group options by their group, showing default options first
  const groupedOptions = new Map<string, Array<[string, OptionConfig]>>()

  for (const [name, config] of Object.entries(options)) {
    const group = config.group || 'default'
    if (!groupedOptions.has(group)) {
      groupedOptions.set(group, [])
    }
    groupedOptions.get(group)?.push([name, config])
  }

  // Display default group first, then other groups in order of appearance
  const displayOrder = ['default']
  for (const [groupName] of groupedOptions) {
    if (groupName !== 'default' && !displayOrder.includes(groupName)) {
      displayOrder.push(groupName)
    }
  }

  for (const groupName of displayOrder) {
    const groupOptions = groupedOptions.get(groupName)
    if (!groupOptions || groupOptions.length === 0) continue

    if (groupName !== 'default') {
      console.log()
      console.log(kleur.blue(`${groupName}:`))
    }

    for (const [name, config] of groupOptions) {
      let optionStr = `  --${name}`
      if (config.alias) {
        optionStr += `, -${config.alias}`
      }
      console.log(kleur.green(optionStr.padEnd(20)) + kleur.white(config.description))
    }
  }

  console.log(
    kleur.white('\nEXAMPLES:\n'),
    kleur.gray('Use --examples for detailed usage examples\n'),
  )
  successExit()
}

/**
 * Displays usage examples grouped by functionality.
 */
export function displayExamples() {
  console.log()
  displayBanner(false)
  console.log(kleur.white('\nUSAGE EXAMPLES:'))

  // Define examples with groups
  const examples = [
    {
      group: 'Interactive Mode',
      items: [
        {
          command: 'bun overturist.ts',
          description: 'Show main menu',
        },
      ],
    },
    {
      group: 'Scripting Mode',
      items: [
        {
          command: 'bun overturist.ts get',
          description: `Run in scripting mode (set either ${kleur.gray('bbox')} or ${kleur.gray('division')} in .env variables or CLI arguments)`,
        },
      ],
    },
    {
      group: 'Download Options',
      items: [
        {
          command: '--release 2026-03-18.0',
          description: 'Download specific release version',
        },
        {
          command: '--theme buildings,addresses,base',
          description:
            'Download all types from the addresses, base and buildings themes',
        },
        {
          command: '--type building,address',
          description: 'Download only building and address types',
        },
        {
          command: '--theme buildings --type segment',
          description: "Download all buildings' types and the segment type",
        },
      ],
    },
    {
      group: 'Geographic Selection',
      items: [
        {
          command: '-d b4f09a9f-4cba-4a7c-bf58-2e63bc2e913d',
          description: "All features will fall within this division's boundaries",
        },
        {
          command: '--bbox -71.0,42.3,-71.1,42.4',
          description:
            'All features will fall within this bounding box (west, south, east, north)',
        },
        {
          command: '--no-clip',
          description:
            'Skip boundary geometry, rely solely on bbox for results filtering',
        },
      ],
    },
    {
      group: 'File Handling',
      items: [
        {
          command: '--skip',
          description: 'Skip existing files automatically',
        },
        {
          command: '--replace',
          description: 'Replace existing files automatically',
        },
        {
          command: '--abort',
          description: 'Exit if existing files are found',
        },
      ],
    },
  ]

  // Display examples by group
  for (const exampleGroup of examples) {
    console.log()
    console.log(kleur.blue(`${exampleGroup.group}:`))

    for (const example of exampleGroup.items) {
      const coloredCommand = colorizeExampleCommand(example.command)

      // Calculate padding without ANSI color codes
      const visibleLength = example.command.length
      const padding = ' '.repeat(Math.max(0, 48 - visibleLength))

      console.log(coloredCommand + padding + kleur.white(example.description))
    }
  }

  console.log()
  console.log(kleur.blue('COMPLETE EXAMPLES:'))

  // Complete examples showing realistic usage
  const completeExamples = [
    {
      command: 'bun overturist.ts --type division,division_area',
      description: 'Interactive mode, pre-filter to 2 division types',
    },
    {
      command: 'bun overturist.ts get --division b4f09a9f-4cba-4a7c-bf58-2e63bc2e913d',
      description:
        'Download all features for the latest version for Hong Kong SAR, skip existing files.',
    },
    {
      command:
        'bun overturist.ts get --replace --division b4f09a9f-4cba-4a7c-bf58-2e63bc2e913d --type building --release 2026-03-18.0',
      description:
        'Download buildings only for Hong Kong SAR from release version 2026-03-18.0, replacing existing files.',
    },
  ]

  for (const example of completeExamples) {
    // Print description on line before in gray
    console.log(kleur.gray(example.description))

    const coloredCommand = colorizeExampleCommand(example.command)

    console.log(coloredCommand)
    console.log()
  }

  console.log()
  console.log(kleur.magenta('Tips:'))
  console.log(
    kleur.white(
      "  • Use 'get' command for scripting/automation, no prompts for user input",
    ),
  )
  console.log(
    kleur.white('  • Use interactive mode for exploratory use and division search'),
  )
  console.log(kleur.white('  • Combine multiple options for fine-grained control'))
  console.log(
    kleur.white(
      '  • Both --theme and --type can be repeated to specify multiple values',
    ),
  )

  console.log()
  successExit()
}

/**
 * HELPERS
 */

/**
 * Parses raw argv into the internal argument shape.
 * @param argv - Raw process arguments, including runtime and script paths
 * @returns Parsed command-line arguments
 */
function parseArgs(argv: string[]): ParsedArgs {
  return parse(argv, argConfig) as ParsedArgs
}

/**
 * Handles display flags (help, examples) and exits if they are set.
 * @param args - Parsed command line arguments
 * @returns Nothing. Exits the process when a display mode is selected.
 */
function handleModeFlags(args: ParsedArgs): void {
  if (args.help) {
    displayHelp()
  }

  if (args.examples) {
    displayExamples()
  }
}

/**
 * Detects whether the CLI was invoked with the positional `get` command.
 * @param argv - Raw process arguments, including runtime and script paths
 * @returns True when the first positional argument is `get`
 */
function isGetCommand(argv: string[]): boolean {
  return argv[2] === 'get'
}

/**
 * Applies CLI example color conventions to a command string.
 * @param command - Example command string to colorize
 * @returns Colorized command string for terminal display
 */
function colorizeExampleCommand(command: string): string {
  let coloredCommand = command

  // Highlight the CLI entry command consistently across examples.
  coloredCommand = coloredCommand.replace(
    /bun overturist\.ts/g,
    kleur.cyan('bun overturist.ts'),
  )

  // Highlight the scripting subcommand when present.
  if (coloredCommand.includes(' get')) {
    coloredCommand = coloredCommand.replace(' get', ` ${kleur.red('get')}`)
  }

  // Highlight options whether they appear first or later in the command.
  coloredCommand = coloredCommand.replace(/^(--[\w-]+)/g, match => kleur.green(match))
  coloredCommand = coloredCommand.replace(/^(-d)/g, match => kleur.green(match))
  coloredCommand = coloredCommand.replace(
    /(\s)(--[\w-]+)/g,
    (_, space, option) => space + kleur.green(option),
  )
  coloredCommand = coloredCommand.replace(
    /(\s)(-d)/g,
    (_, space, option) => space + kleur.green(option),
  )

  return coloredCommand
}

/**
 * Collects values for a repeatable option from raw argv.
 * @param argv - Raw process arguments, including runtime and script paths
 * @param optionName - Long option name without the leading dashes
 * @param alias - Short option alias without the leading dash
 * @returns Array of parsed values or undefined when the option is absent
 * @remarks Supports repeated flags, `--option=value`, and comma-separated values.
 */
function parseRepeatableArgument(
  argv: string[],
  optionName: string,
  alias: string,
): string[] | undefined {
  const values: string[] = []
  const longOption = `--${optionName}`
  const shortOption = `-${alias}`

  // Walk argv once so repeatable flags preserve user order.
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index]

    if (token === longOption || token === shortOption) {
      const nextToken = argv[index + 1]
      if (nextToken && !nextToken.startsWith('-')) {
        values.push(nextToken)
        index += 1
      }
      continue
    }

    if (token.startsWith(`${longOption}=`)) {
      values.push(token.slice(longOption.length + 1))
      continue
    }

    if (token.startsWith(`${shortOption}=`)) {
      values.push(token.slice(shortOption.length + 1))
    }
  }

  return parseArrayArgument(values.length > 0 ? values : undefined)
}

/**
 * Safely converts an argument to a string or returns undefined.
 * @param arg - The argument to convert (can be any type)
 * @returns String value or undefined if no argument provided
 */
function parseStringArgument(arg: string | undefined): string | undefined {
  return arg ? String(arg) : undefined
}

/**
 * Parses an argument that can be an array, comma-separated string, or single value.
 * @param arg - The argument to parse (can be array, string, or undefined)
 * @returns Array of strings or undefined if no argument provided
 * @remarks Repeated flags and comma-separated values are both normalized to string arrays.
 */
function parseArrayArgument(arg: string | string[] | undefined): string[] | undefined {
  if (!arg) {
    return undefined
  }

  if (Array.isArray(arg)) {
    // If it's already an array, flatten any comma-separated values within
    return arg.flatMap(item =>
      typeof item === 'string' && item.includes(',')
        ? item
            .split(',')
            .map(s => s.trim())
            .filter(Boolean)
        : [item],
    )
  }

  // If it's a string with commas, split by comma
  if (typeof arg === 'string' && arg.includes(',')) {
    return arg
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
  }

  // Single value
  return [arg]
}

/**
 * Parses and validates a bounding box argument.
 * @param arg - The bbox argument to parse (string or undefined)
 * @returns Bounding box object or undefined if no argument provided
 * @remarks Throws when the bbox string is present but invalid so callers can decide how to exit.
 */
function parseBboxArgument(arg: string | undefined): BBox | undefined {
  if (!arg) {
    return undefined
  }

  const bbox = parseBboxString(String(arg))
  if (!bbox) {
    throw new Error(
      `Invalid bbox format. Use xmin,ymin,xmax,ymax ${kleur.grey(
        '(example: --bbox -71.068,42.353,-71.098,42.363)',
      )}`,
    )
  }

  return bbox
}

/**
 * Parses a bbox string into numeric coordinates.
 * @param bboxStr - Bounding box string in `xmin,ymin,xmax,ymax` order
 * @returns Parsed bbox when valid, otherwise null
 */
function parseBboxString(bboxStr: string): BBox | null {
  const coords = bboxStr.split(',').map(coord => parseFloat(coord.trim()))

  if (coords.length !== 4 || coords.some(Number.isNaN)) {
    return null
  }

  return {
    xmin: coords[0],
    ymin: coords[1],
    xmax: coords[2],
    ymax: coords[3],
  }
}

/**
 * Parses file handling action arguments and returns the appropriate action mode.
 * @param args - Parsed command line arguments
 * @returns File handling action mode (skip, replace, or abort)
 * @remarks `replace` takes precedence over `abort`, and `skip` remains the default.
 */
function parseFileHandlingAction(args: ParsedArgs): OnExistingFilesAction {
  if (args.replace) {
    return 'replace'
  } else if (args.abort) {
    return 'abort'
  } else {
    return 'skip' // Default action
  }
}
