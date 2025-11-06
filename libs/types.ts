/**
 * Valid modes for how existing files should be handled.
 */
export type OnExistingFilesAction = "Skip" | "Replace" | "Abort";

/**
 * Division information from Overture Maps data.
 */
export type Division = {
    id: string;
    names: {
        common: Array<{ key: string; value: string }>;
    };
    subtype: string;
    country: string;
    hierarchies: Array<Array<{ division_id: string; subtype: string; name: string }>>;
    bbox?: {
        minx?: number;
        maxx?: number;
        miny?: number;
        maxy?: number;
        xmin?: number;
        xmax?: number;
        ymin?: number;
        ymax?: number;
    };
    geometry?: string; // GeoJSON geometry
    [key: string]: unknown;
};

/**
 * Selected division information from user search and selection.
 */
export type SelectedDivision = Division;

/**
 * Configuration object containing application settings and environment variables.
 */
export type Config = {
    outputDir: string;
    releaseFn: string;
    releaseUrl: string;
    bbox: {
        xmin: number;
        xmax: number;
        ymin: number;
        ymax: number;
    };
    divisionId: string | undefined;
    releaseVersion: string;
    selectedDivision?: SelectedDivision;
};

/**
 * Mapping of theme feature types to their display names.
 */
export interface ThemeMapping {
    [key: string]: string;
}

/**
 * Represents an Overture release with metadata about availability and URLs.
 */
export interface OvertureRelease {
    date: string;
    version: string;
    schema: string;
    isReleased: boolean;
    isAvailableOnS3: boolean;
    versionReleaseUrl?: string;
    schemaReleaseUrl?: string;
}

/**
 * Context information for a specific release including schema changes and latest status.
 */
export interface ReleaseContext {
    version: string;
    schema: string;
    date: string;
    isNewSchema: boolean;
    isLatest: boolean;
    previousVersion: string | undefined;
    previousSchema: string | undefined;
}

/**
 * Represents the current progress state of download operations.
 */
export interface ProgressState {
    bboxComplete: boolean;
    geomComplete: boolean;
    isProcessing: boolean;
    featureCount: number;
    diffCount: number | null; // Difference from previous version
}

/**
 * Complete release data with metadata and array of all releases.
 */
export type ReleaseData = {
    lastUpdated: string;
    lastChecked: string;
    source: string;
    latest: string;
    totalReleases: number;
    releases: OvertureRelease[];
};

/**
 * Overture data release version.
 */
export type Version = string;

/**
 * Spinner interface for displaying progress indicators in the CLI.
 */
export type Spinner = {
    start: (msg?: string) => void;
    stop: (msg?: string, code?: number) => void;
    message: (msg?: string) => void;
};

/**
 * Interface representing theme differences between local mapping and S3 availability.
 */
export interface ThemeDifferences {
    missingFromLocal: string[];
    missingFromS3: string[];
    hasDifferences: boolean;
}

/**
 * Configuration for command-line arguments handling.
 */
export interface CliArgs {
    onFilesExistsMode: OnExistingFilesAction;
    themes?: string[];
    types?: string[];
    divisionId?: string;
    releaseVersion?: string;
    examples?: boolean;
    bbox?: {
        xmin: number;
        ymin: number;
        xmax: number;
        ymax: number;
    };
    get?: boolean;
}

export type ParsedArgs = {
    // Boolean arguments
    get?: boolean;
    help?: boolean;
    examples?: boolean;
    skip?: boolean;
    replace?: boolean;
    abort?: boolean;

    // String/array arguments (multi can return arrays)
    theme?: string | string[];
    type?: string | string[];
    division?: string;
    release?: string;
    bbox?: string;
};

/**
 * Configuration for command-line options including description, alias, and grouping information.
 */
export interface OptionConfig {
    description: string;
    boolean: boolean;
    alias?: string;
    group?: string;
}
