/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * Represents a failure that occured during kernel startup; thrown as an error
 * from all code paths that can fail during startup.
 */
export class StartupFailure {
	constructor(
		public readonly message: string,
		public readonly details: string,
	) { }
}
