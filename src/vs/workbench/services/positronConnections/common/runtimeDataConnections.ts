/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The languages whose connection comms Positron keeps open with Data Connections on. Closing one of
 * these comms runs the connection's disconnect() in the kernel, which closes the object the user's
 * code opened.
 */
export const RUNTIME_DATA_CONNECTION_LANGUAGES = ['r', 'python'] as const;

/** A language whose connection comms Positron keeps open; see RUNTIME_DATA_CONNECTION_LANGUAGES. */
export type RuntimeConnectionLanguage = typeof RUNTIME_DATA_CONNECTION_LANGUAGES[number];

/**
 * Whether a connection comm in this language is kept open rather than closed on arrival.
 * @param languageId A comm's metadata `language_id`, or a session's language.
 */
export function isRuntimeConnectionLanguage(languageId: string | undefined): languageId is RuntimeConnectionLanguage {
	return (RUNTIME_DATA_CONNECTION_LANGUAGES as readonly (string | undefined)[]).includes(languageId);
}
