/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Minimal stub for the 'p-queue' module used by vitest tests that transitively
 * depend on extension code importing p-queue. Only implements enough to satisfy
 * module initialization without errors.
 */

class PQueue {
	constructor(_options?: unknown) { }
	add(_fn: () => unknown) { }
	onIdle() { return Promise.resolve(); }
	get size() { return 0; }
	get pending() { return 0; }
}

export default PQueue;
