/**
 * CUSTOM
 */

/**
 * OVERTURE SCHEMA
 */

/**
 * Division information from Overture Maps data.
 */
export type Division = {
  id: string
  names: {
    primary?: string // Primary name in local language
    common: Array<{ key: string; value: string }>
  }
  subtype: string
  country: string
  hierarchies: Array<Array<{ division_id: string; subtype: string; name: string }>>
  bbox?: BBox
  geometry?: string // GeoJSON geometry
  [key: string]: unknown
}

export type ExtendedDivision = Division & {
  bboxExtraction?: {
    xmin: number
    xmax: number
    ymin: number
    ymax: number
  }
  geometryExtraction?: string
  boundsExtractionDivisionId?: string
}

export type DivisionArea = {
  id: string
  name: string
  type: string
  geometry?: string // DuckDB geometry
  [key: string]: unknown
}

export type DivisionBoundary = {
  id: string
  name: string
  type: string
  geometry?: string // DuckDB geometry
  [key: string]: unknown
}

/**
 * CONFIG
 */

/**
 * Configuration object containing application settings and environment variables.
 */

export type Target = 'division' | 'bbox' | 'world'
export type ClipMode = 'preserve' | 'smart' | 'all'

export type Config = {
  locale: string
  outputDir: string
  releaseFn: string
  releaseUrl: string
  target: Target
  bbox?: BBox
  divisionId?: GERS
  releaseVersion?: Version
  selectedDivision?: Division
  skipBoundaryClip?: boolean
  clipMode?: ClipMode
  featureTypes?: string[]
  confirmFeatureSelection: boolean
  onFileExists?: OnExistingFilesAction
}

/**
 * RELEASES
 */

/**
 * Represents an Overture release with metadata about availability and URLs.
 */
export interface OvertureRelease {
  date: string
  version: string
  schema: string
  isReleased: boolean
  isAvailableOnS3: boolean
  versionReleaseUrl?: string
  schemaReleaseUrl?: string
}

/**
 * Context information for a specific release including schema changes and latest status.
 */
export interface ReleaseContext {
  version: string
  schema: string
  date: string
  isNewSchema: boolean
  isLatest: boolean
  previousVersion: string | undefined
  previousSchema: string | undefined
}

/**
 * Complete release data with metadata and array of all releases.
 */
export type ReleaseData = {
  lastUpdated: string
  lastChecked: string
  source: string
  latest: string
  totalReleases: number
  releases: OvertureRelease[]
}

/**
 * Overture data release version.
 */
export type Version = string
export type GERS = string

/**
 * THEMES
 */

/**
 * Mapping of theme feature types to their display names.
 */
export interface ThemeMapping {
  [key: string]: string
}
/**
 * Interface representing theme differences between local mapping and S3 availability.
 */
export interface ThemeDifferences {
  missingFromCurrent: string[]
  missingFromPreceding: string[]
  changedThemes: Array<{
    type: string
    currentTheme: string
    precedingTheme: string
  }>
  hasDifferences: boolean
}

/**
 * UI
 */

/**
 * Spinner interface for displaying progress indicators in the CLI.
 */
export type Spinner = {
  start: (msg?: string) => void
  stop: (msg?: string, code?: number) => void
  message: (msg?: string) => void
}

export type DivisionOption = { value: Division | string; label: string; hint: string }

/**
 * Represents the current progress state of download operations.
 */
export interface ProgressState {
  bboxComplete: boolean
  geomComplete: boolean
  hasGeometryPass: boolean
  isProcessing: boolean
  activeStage: 'bbox' | 'geometry' | null
  featureCount: number
  diffCount: number | null // Difference from previous version
  currentMessage: string | null
}

/**
 * Incremental progress update emitted by extraction queries.
 */
export interface ProgressUpdate {
  stage: 'setup' | 'bbox' | 'geometry'
  message?: string
  count?: number
}

/**
 * CLI
 */

/**
 * Valid modes for how existing files should be handled.
 */
export type OnExistingFilesAction = 'skip' | 'replace' | 'abort'

/**
 * Configuration for command-line arguments handling.
 */
export interface BBox {
  xmin: number
  ymin: number
  xmax: number
  ymax: number
}

export type Geometry = string

export interface CliArgs {
  onFileExists: OnExistingFilesAction
  themes?: string[]
  types?: string[]
  divisionId?: GERS
  osmId?: string
  releaseVersion?: Version
  examples?: boolean
  bbox?: BBox
  skipBoundaryClip?: boolean
  clipMode?: ClipMode
  target?: Target
  locale?: string
  get?: boolean
  info?: boolean
}

export type ParsedArgs = {
  // Boolean arguments
  get?: boolean
  info?: boolean
  help?: boolean
  examples?: boolean
  'skip-bc'?: boolean
  skip?: boolean
  replace?: boolean
  abort?: boolean

  // String/Array arguments
  theme?: string | string[]
  type?: string | string[]

  // String arguments
  target?: Target
  division?: string
  osmId?: string
  release?: string
  bbox?: string
  locale?: string
  'clip-mode'?: ClipMode
}

/**
 * Configuration for command-line options including description, alias, and grouping information.
 */
export interface OptionConfig {
  description: string
  boolean: boolean
  alias?: string
  group?: string
}

export interface InteractiveOptions {
  releaseVersion?: string | null
  skipBoundaryClip?: boolean
  clipMode?: ClipMode
  target?: Target
  divisionLookupMode?: 'name' | 'osm'
  selectedDivision?: Division
}

/**
 * Resolved Config + CLI options + Interactive Prompts
 */
export interface ControlContext {
  releaseVersion: Version
  releaseContext: ReleaseContext
  themeMapping: ThemeMapping
  target: Target
  divisionId: string | null
  division: Division | null
  bbox: BBox | null
  geometry: Geometry | null // Hex-encoded WKB binary
  skipBoundaryClip: boolean
  clipMode: ClipMode
  featureTypes: string[]
  featureNameWidth: number
  indexWidth: number
  outputDir: string
  onFileExists: OnExistingFilesAction | null
  source: {
    env: Config // Original Config (based on defaults and env variables),
    cli: CliArgs // CLI arguments parsed from command-line input
    interactive?: InteractiveOptions | false // Interactive options resolved from prompts
  }
}

/**
 * SEARCH RESULTS
 */

export type CachedSearchResults = {
  createdAt: string
  version: Version
  adminLevel: number
  term: string
  totalCount: number
  results: Division[]
}

export type SearchHistoryItem = CachedSearchResults & {
  cachePath?: string
}

export type SearchHistory = SearchHistoryItem[]
