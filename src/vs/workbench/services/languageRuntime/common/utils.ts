/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pads a base64 string with the necessary padding characters.
 * @param base64 The base64 string to pad.
 * @returns The padded base64 string.
 */
export function padBase64(base64: string): string {
	const remainder = base64.length % 4;
	if (remainder === 0) {
		return base64; // No padding needed
	} else {
		return `${base64}${'='.repeat(4 - remainder)}`;
	}
}
