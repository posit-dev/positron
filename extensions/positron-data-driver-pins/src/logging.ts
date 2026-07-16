/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The subset of a logger this driver uses. `vscode.LogOutputChannel` satisfies it, so the
 * extension passes its output channel directly, while the non-UI modules (client, connection)
 * depend only on this narrow interface and stay free of a `vscode` import.
 */
export interface Logger {
	trace(message: string): void;
	debug(message: string): void;
	info(message: string): void;
	warn(message: string): void;
	error(message: string): void;
}

/** A logger that discards everything, used as the default when none is provided (e.g. in tests). */
export const NULL_LOGGER: Logger = {
	trace() { },
	debug() { },
	info() { },
	warn() { },
	error() { },
};
