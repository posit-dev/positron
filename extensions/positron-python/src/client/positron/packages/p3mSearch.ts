/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';

/**
 * P3M package metadata returned from the API.
 */
interface P3MPackageMetadata {
    name: string;
    version: string;
    summary: string | null;
    license: string | null;
    licenses?: string[];
    license_types?: string[];
    package_date: string | null;
    package_size: number | null;
    downloads: number | null;
    available_versions?: string[];
    dependencies?: {
        imports?: Array<{ name: string; version?: string; operator?: string }>;
        suggests?: Array<{ name: string; version?: string; operator?: string }>;
    };
}

/**
 * Request body for the P3M filter packages API.
 */
interface P3MFilterRequest {
    names: string[];
    repo: string;
    omit_downloads?: boolean;
    omit_dependencies?: boolean;
    omit_package_details?: boolean;
}

/**
 * Parse NDJSON (newline-delimited JSON) response into an array of objects.
 * Each line in the response is a separate JSON object.
 */
function parseNDJSON<T>(text: string): T[] {
    const results: T[] = [];
    const lines = text.trim().split('\n');
    for (const line of lines) {
        if (line.trim()) {
            try {
                results.push(JSON.parse(line) as T);
            } catch {
                // Skip malformed lines
            }
        }
    }
    return results;
}

/**
 * Fetch package metadata from P3M for multiple packages in a single API call
 * and map it onto the LanguageRuntimePackage shape consumed by the UI.
 *
 * @param packageNames Array of package names to fetch metadata for
 * @param token Optional cancellation token
 * @returns Map of lowercase package name to partial package metadata
 */
export async function fetchP3MPackageMetadata(
    packageNames: string[],
    token?: vscode.CancellationToken,
): Promise<Map<string, Partial<positron.LanguageRuntimePackage>>> {
    const result = new Map<string, Partial<positron.LanguageRuntimePackage>>();

    if (packageNames.length === 0) {
        return result;
    }

    const requestBody: P3MFilterRequest = {
        names: packageNames,
        repo: 'pypi',
        omit_downloads: true,
        omit_dependencies: false,
        omit_package_details: false,
    };

    const controller = token ? new AbortController() : undefined;
    const cancelSubscription =
        controller && token ? token.onCancellationRequested(() => controller.abort()) : undefined;

    try {
        const response = await fetch('https://p3m.dev/__api__/filter/packages', {
            method: 'POST',
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
            signal: controller?.signal,
        });

        if (!response.ok) {
            throw new Error(`P3M API returned status ${response.status}`);
        }

        const text = await response.text();
        const packages = parseNDJSON<P3MPackageMetadata>(text);

        for (const pkg of packages) {
            if (pkg.name) {
                result.set(pkg.name.toLowerCase(), {
                    license: pkg.license ?? pkg.licenses?.join(', ') ?? undefined,
                    latestVersion: pkg.version ?? undefined,
                    publishedDate: pkg.package_date ?? undefined,
                });
            }
        }
    } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') {
            throw new vscode.CancellationError();
        }
        // Log but don't throw - metadata is optional
        console.warn('[P3M] Failed to fetch package metadata:', e);
    } finally {
        cancelSubscription?.dispose();
    }

    return result;
}
