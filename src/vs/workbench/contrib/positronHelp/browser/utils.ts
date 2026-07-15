/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Determines whether a hostname represents localhost.
 * @param hostname The hostname.
 * @returns A value which indicates whether a hostname represents localhost.
 */
export const isLocalhost = (hostname?: string) =>
	!!(hostname && ['localhost', '127.0.0.1', '::1'].indexOf(hostname.toLowerCase()) > -1);

/**
 * Parses a string into a URL, returning undefined instead of throwing when the
 * string is not a valid absolute URL. Useful for source URLs that aren't always
 * absolute (e.g. the help welcome page's 'welcome.html').
 * @param value The string to parse.
 * @returns The parsed URL, or undefined if the string is not a valid absolute URL.
 */
export const tryParseUrl = (value: string): URL | undefined => {
	try {
		return new URL(value);
	} catch {
		return undefined;
	}
};
