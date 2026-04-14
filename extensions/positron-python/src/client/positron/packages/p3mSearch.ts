/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * P3M package metadata returned from the API.
 */
export interface P3MPackageMetadata {
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
 * Create an AbortSignal from a CancellationToken for use with fetch.
 */
function createAbortSignal(token?: vscode.CancellationToken): AbortSignal | undefined {
    if (!token) {
        return undefined;
    }
    const controller = new AbortController();
    token.onCancellationRequested(() => controller.abort());
    return controller.signal;
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
 * Fetch package metadata from P3M for multiple packages in a single API call.
 *
 * @param packageNames Array of package names to fetch metadata for
 * @param token Optional cancellation token
 * @returns Map of package name to metadata
 */
export async function fetchP3MMetadata(
    packageNames: string[],
    token?: vscode.CancellationToken,
): Promise<Map<string, P3MPackageMetadata>> {
    const metadataMap = new Map<string, P3MPackageMetadata>();

    if (packageNames.length === 0) {
        return metadataMap;
    }

    const requestBody: P3MFilterRequest = {
        names: packageNames,
        repo: 'pypi',
        omit_downloads: true,
        omit_dependencies: false,
        omit_package_details: false,
    };

    try {
        const response = await fetch('https://p3m.dev/__api__/filter/packages', {
            method: 'POST',
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
            signal: createAbortSignal(token),
        });

        if (!response.ok) {
            throw new Error(`P3M API returned status ${response.status}`);
        }

        const text = await response.text();
        const packages = parseNDJSON<P3MPackageMetadata>(text);

        for (const pkg of packages) {
            if (pkg.name) {
                metadataMap.set(pkg.name.toLowerCase(), pkg);
            }
        }
    } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') {
            throw new vscode.CancellationError();
        }
        // Log but don't throw - metadata is optional
        console.warn('[P3M] Failed to fetch package metadata:', e);
    }

    return metadataMap;
}
