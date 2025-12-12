/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Normalizes text for comparison by removing whitespace variations,
 * special characters, and non-printable ASCII characters.
 *
 * This is useful when comparing text that may have been copied from
 * different UI elements where formatting differences can cause exact
 * string matches to fail.
 *
 * @param text The text to normalize
 * @returns The normalized text
 */
export function normalize(text: string): string {
	return text
		.normalize('NFKC') // Normalize Unicode (optional but good when working with special chars)
		.replace(/\s+/g, '') // Remove all whitespace
		.replace(/\u00a0/g, '') // Remove non-breaking spaces
		.replace(/[^\x20-\x7E]/g, '') // Remove not printable ASCII
		.trim();
}
