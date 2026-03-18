/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Builds the update check URL with optional query parameters for language and telemetry reporting.
 * @param baseUrl The base URL for the update check
 * @param languages Array of active languages (e.g., ['python', 'r'])
 * @param includeLanguages Whether to include language parameters
 * @param anonymousId The anonymous telemetry ID, or undefined to omit
 * @returns The complete URL with query parameters
 */
export function buildUpdateUrl(
	baseUrl: string,
	languages: string[],
	includeLanguages: boolean,
	anonymousId: string | undefined
): string {
	const urlParams: string[] = [];
	if (includeLanguages && languages.length > 0) {
		urlParams.push(...languages.map(lang => `${lang}=1`));
	}
	if (anonymousId) {
		urlParams.push(`uuid=${anonymousId}`);
	}
	return urlParams.length > 0 ? `${baseUrl}?${urlParams.join('&')}` : baseUrl;
}
