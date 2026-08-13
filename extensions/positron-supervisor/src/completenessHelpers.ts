/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/** The status returned by a Jupyter `is_complete_request`. */
export type IsCompleteStatus = 'complete' | 'incomplete' | 'invalid' | 'unknown';

/** The error name thrown when unprocessed code is found to be incomplete. */
export const CODE_INCOMPLETE_ERROR = 'CodeIncompleteError';

/** The error name thrown when an unprocessed submission is cancelled. */
export const EXECUTION_CANCELLED_ERROR = 'ExecutionCancelledError';

/**
 * Decides whether code should execute after an `is_complete_request` check.
 *
 * Only `incomplete` blocks execution; `complete`, `invalid`, and `unknown` all
 * proceed so the interpreter can surface any syntax error itself (matching the
 * front-end's historical behavior for invalid/unknown fragments).
 *
 * @param status The status from the is_complete reply.
 * @returns True if the code should be executed, false if it is incomplete.
 */
export function shouldExecuteAfterCompletenessCheck(status: IsCompleteStatus): boolean {
	return status !== 'incomplete';
}

/**
 * Decides whether a kernel interrupt (the HTTP interrupt call) should be sent.
 *
 * When there are pending unprocessed completeness checks, those are aborted
 * locally; the HTTP interrupt is only needed when the kernel is actually busy
 * executing something. When there are no pending checks, the normal interrupt
 * behavior is preserved.
 *
 * @param kernelBusy Whether the kernel is currently busy executing code.
 * @param pendingUnprocessedCount The number of pending unprocessed checks that
 *   were aborted.
 * @returns True if the HTTP interrupt should be sent.
 */
export function shouldSendKernelInterrupt(kernelBusy: boolean, pendingUnprocessedCount: number): boolean {
	if (pendingUnprocessedCount > 0) {
		return kernelBusy;
	}
	return true;
}
