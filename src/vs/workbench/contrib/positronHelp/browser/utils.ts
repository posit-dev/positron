/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * Determines whether a hostname represents localhost.
 * @param hostname The hostname.
 * @returns A value which indicates whether a hostname represents localhost.
 */
export const isLocalhost = (hostname?: string) =>
	!!(hostname && ['localhost', '127.0.0.1', '::1'].indexOf(hostname.toLowerCase()) > -1);
