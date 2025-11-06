import * as cheerio from "cheerio";
import fetch from "node-fetch";
import type { Config, OvertureRelease } from "./types";
import { parseNaturalDateToISO } from "./utils";

/**
 * Scrapes the Overture release calendar webpage to extract release information.
 * @param config - Configuration object containing the release calendar URL
 * @returns Promise resolving to array of OvertureRelease objects scraped from the webpage
 * @throws Error if HTTP request fails or webpage structure is unexpected
 */
export async function scrapeReleaseCalendar(config: Config): Promise<OvertureRelease[]> {
    const response = await fetch(config.releaseUrl, {
        headers: {
            "User-Agent": "Overturist-Release-Scraper/1.0 (Glorious Purpose)",
        },
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    const tables = $("table");

    if (tables.length < 2) {
        throw new Error("Could not find the expected release tables on the page.");
    }

    const releases: OvertureRelease[] = [];
    tables.each((tableIndex, table) => {
        const isReleased = tableIndex === 1;
        $(table)
            .find("tbody tr")
            .each((_, row) => {
                const cells = $(row).find("td");
                if (cells.length < 3) return;

                const dateText = $(cells[0]).text().trim();
                const version = $(cells[1]).find("code").text().trim();
                const schema = $(cells[2]).find("code").text().trim().replace(/^v/, "");

                // Skip entries with "TBA" or missing data
                if (!dateText || !version || !schema || dateText.toUpperCase() === "TBA") {
                    return;
                }

                // Parse natural language date to ISO format
                const isoDate = parseNaturalDateToISO(dateText);
                if (!isoDate) {
                    // If date parsing fails, skip this entry
                    return;
                }

                const versionReleaseUrl = $(cells[1]).find("a").attr("href");
                const schemaReleaseUrl = $(cells[2]).find("a").attr("href");

                const releaseData: OvertureRelease = {
                    date: isoDate,
                    version,
                    schema,
                    isReleased: isReleased,
                    isAvailableOnS3: false,
                };

                // Only add optional properties if they exist
                if (versionReleaseUrl) {
                    releaseData.versionReleaseUrl = versionReleaseUrl;
                }
                if (schemaReleaseUrl) {
                    releaseData.schemaReleaseUrl = schemaReleaseUrl;
                }

                releases.push(releaseData);
            });
    });

    if (releases.length === 0) {
        throw new Error("Failed to extract any releases from the tables.");
    }

    return releases;
}
