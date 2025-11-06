import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { OMF_S3_BUCKET, OMF_S3_PREFIX, OMF_S3_REGION } from "./constants";
import type { Version } from "./types";

const s3Client = new S3Client({
    region: OMF_S3_REGION,
    credentials: {
        accessKeyId: "",
        secretAccessKey: "",
    },
    signer: {
        sign: async (request) => request,
    },
});

/**
 * Fetches available release versions from the Overture S3 bucket.
 * @returns Promise resolving to object containing latest version and array of all available versions
 */
export async function getS3Releases(): Promise<{
    latest: string | null;
    s3Releases: string[];
}> {
    const prefixes = await listS3Prefixes(OMF_S3_PREFIX);

    if (prefixes.length === 0) {
        return { latest: null, s3Releases: [] };
    }

    // Extract version names from prefixes like "release/2025-01-15.0/"
    const versions = extractFromPrefixes(prefixes, /\/([^/]+)\/$/);
    versions.sort().reverse();

    const latest = versions[0] || null;
    return { latest, s3Releases: versions };
}

/**
 * Fetches all available themes for a specific version from the Overture S3 bucket.
 * @param version - The release version to get themes for
 * @returns Promise resolving to array of theme names
 */
export async function getThemesForVersion(version: Version): Promise<string[]> {
    const versionPrefix = `${OMF_S3_PREFIX}${version}/`;
    const prefixes = await listS3Prefixes(versionPrefix);

    // Filter only theme prefixes and extract theme names
    const themePrefixes = prefixes.filter((p) => p.includes("theme="));
    return extractFromPrefixes(themePrefixes, /theme=([^/]+)\//);
}

/**
 * Fetches all available feature types for each theme in a specific version from the Overture S3 bucket.
 * @param version - The release version to get feature types for
 * @returns Promise resolving to object with theme keys and arrays of feature types for each theme
 */
export async function getFeatureTypesForVersion(version: Version): Promise<{ [theme: string]: string[] }> {
    const themes = await getThemesForVersion(version);
    const result: { [theme: string]: string[] } = {};

    for (const theme of themes) {
        const themePrefix = `${OMF_S3_PREFIX}${version}/theme=${theme}/`;
        const prefixes = await listS3Prefixes(themePrefix);

        // Extract feature types from prefixes like "release/2025-01-15.0/theme=buildings/type=building/"
        const featureTypes = extractFromPrefixes(prefixes, /type=([^/]+)\//);
        result[theme] = featureTypes;
    }

    return result;
}

/**
 * HELPERS
 */

/**
 * Helper function to execute S3 ListObjectsV2 command with given prefix and delimiter.
 * @param prefix - S3 prefix to list objects for
 * @param delimiter - Delimiter for grouping objects (default: "/")
 * @returns Promise resolving to array of common prefixes
 */
async function listS3Prefixes(prefix: string, delimiter: string = "/"): Promise<string[]> {
    const command = new ListObjectsV2Command({
        Bucket: OMF_S3_BUCKET,
        Prefix: prefix,
        Delimiter: delimiter,
    });

    const output = await s3Client.send(command);
    return output.CommonPrefixes?.map((p) => p.Prefix).filter((p): p is string => !!p) || [];
}

/**
 * Helper function to extract values from S3 prefixes using regex pattern.
 * @param prefixes - Array of S3 prefix strings
 * @param pattern - Regex pattern to match (should include capture group)
 * @returns Array of extracted values sorted alphabetically
 */
function extractFromPrefixes(prefixes: string[], pattern: RegExp): string[] {
    return prefixes
        .map((prefix) => {
            const match = prefix.match(pattern);
            return match ? match[1] : null;
        })
        .filter((value): value is string => !!value)
        .sort();
}
