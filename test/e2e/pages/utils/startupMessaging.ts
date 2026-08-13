/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Selector matching any status message that means Positron is still coming up.
 *
 * Shared by every readiness gate rather than copied into each. The pattern lived
 * in two places, and a message missing from one of them is invisible: the gate
 * still passes, just earlier than it should, and the test that follows races
 * whatever was still starting.
 *
 * `Activating Extensions...` comes from upstream's own progress item
 * (`extensionsActivationProgress.ts`), not from Positron. Each activation there
 * is raced against a 5s timeout, so this can never hold a gate open for long.
 */
export const STARTUP_MESSAGING_SELECTOR =
	'text=/^Setting up|^Waiting for extensions|^Activating Extensions|^Starting|^Preparing|Reconnecting|^Reactivating|^Discovering( \\w+)? interpreters|starting\\.$/i';

/** How long a readiness gate waits for startup messaging to clear. */
export const STARTUP_MESSAGING_TIMEOUT = 90000;
