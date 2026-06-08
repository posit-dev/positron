/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Page } from '@playwright/test';

/**
 * The TOTP rotation period in milliseconds. Codes are only valid for one window and Okta
 * rejects a code once it has been consumed, so a fresh attempt must land in a later window.
 */
const TOTP_PERIOD_MS = 30_000;

/**
 * Okta copy shown when an account has been rate-limited after too many sign-in attempts.
 * The exact wording varies ("too many attempts", "account is locked"), so match loosely.
 */
const OKTA_LOCKOUT_PATTERN = /too many (unsuccessful )?attempts|account is locked|temporarily locked|locked out/i;

/**
 * Detect whether Okta has rate-limited the account ("Too many attempts" / lockout screen).
 *
 * The service account is shared across parallel shards (Azure, Databricks) and workflows
 * (release, stable), so rapid duplicate TOTP submissions can trip Okta's lockout. A lockout
 * is a distinct, longer-lived state than a single rejected code and warrants a longer backoff.
 *
 * @param page The Okta page to inspect.
 * @returns true if a lockout banner is visible.
 */
export async function isOktaLockedOut(page: Page): Promise<boolean> {
	if (page.isClosed()) {
		return false;
	}
	return page.getByText(OKTA_LOCKOUT_PATTERN).first().isVisible().catch(() => false);
}

/**
 * Compute how long to wait before re-submitting a TOTP code after a rejection.
 *
 * The service account's TOTP secret is shared across parallel consumers. A blind fixed wait
 * lets two consumers stay phase-aligned: they wake up together, grab the same code, and one
 * gets rejected again. Randomized jitter de-aligns them so they fall into different windows.
 *
 * - Normal rejection: wait just past a full TOTP window so the retry uses a fresh code, plus
 *   up to one window of jitter to break alignment with a competing shard.
 * - Lockout: Okta has rate-limited the account; back off substantially longer (and jittered)
 *   to let the lock clear before trying again.
 *
 * @param lockedOut Whether the lockout banner was detected (see {@link isOktaLockedOut}).
 * @param random Source of randomness in [0, 1); injectable for deterministic tests.
 * @returns The delay in milliseconds.
 */
export function otpRetryDelayMs(lockedOut: boolean, random: () => number = Math.random): number {
	if (lockedOut) {
		// 40-60s: long enough to outlast a brief lockout window and de-align from the other shard.
		return 40_000 + Math.floor(random() * 20_000);
	}
	// Just past the 30s window (guarantees a fresh code) plus up to one window of jitter: 31-46s.
	return TOTP_PERIOD_MS + 1_000 + Math.floor(random() * TOTP_PERIOD_MS);
}
