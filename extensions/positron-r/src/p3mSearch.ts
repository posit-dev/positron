/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';

interface P3MPackageMetadata {
	readonly name: string;
	readonly version: string;
	readonly summary: string | null;
	readonly license: string | null;
	readonly licenses?: readonly string[];
	readonly license_types?: readonly string[];
	readonly package_date: string | null;
	readonly package_size: number | null;
	readonly downloads: number | null;
	readonly available_versions?: readonly string[];
	readonly dependencies?: {
		readonly imports?: ReadonlyArray<{
			readonly name: string;
			readonly version?: string;
			readonly operator?: string;
		}>;
		readonly suggests?: ReadonlyArray<{
			readonly name: string;
			readonly version?: string;
			readonly operator?: string;
		}>;
	};
}

interface P3MFilterRequest {
	readonly names: readonly string[];
	readonly repo: string;
	readonly omit_downloads?: boolean;
	readonly omit_dependencies?: boolean;
	readonly omit_package_details?: boolean;
}

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
 * Fetch package metadata from P3M for multiple R packages in a single API call
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
		repo: 'cran',
		omit_downloads: true,
		omit_dependencies: false,
		omit_package_details: false,
	};

	const controller = new AbortController();
	const cancelSubscription = token?.onCancellationRequested(() => controller.abort());

	try {
		const response = await fetch('https://p3m.dev/__api__/filter/packages', {
			method: 'POST',
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(requestBody),
			signal: controller.signal,
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
		console.warn('[P3M] Failed to fetch R package metadata:', e);
	} finally {
		cancelSubscription?.dispose();
	}

	return result;
}
