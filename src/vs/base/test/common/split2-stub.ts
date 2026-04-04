/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Minimal stub for the 'split2' module used by vitest tests that transitively
 * depend on extension code importing split2. Only implements enough to satisfy
 * module initialization without errors.
 */

function split2(_matcher?: unknown) {
	return {
		pipe: () => { },
		on: () => { },
		write: () => { },
		end: () => { },
	};
}

export default split2;
