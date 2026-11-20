/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/** Why a read method of the engine failed, as far as the view tells the cases apart. */
export type ReadFailureKind = 'timed-out' | 'git-missing' | 'other';

/**
 * The kind of a failed read. The engine's read methods reject with an `Error` whose message
 * starts with `checkpoints:timed-out` when git did not answer in time, and with
 * `checkpoints:git-missing` when the git program could not start. Any other failure is `other`.
 */
export function readFailureKind(error: unknown): ReadFailureKind {
	const message = error instanceof Error ? error.message : String(error);
	if (message.startsWith('checkpoints:timed-out')) {
		return 'timed-out';
	}
	if (message.startsWith('checkpoints:git-missing')) {
		return 'git-missing';
	}
	return 'other';
}
