/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, Page } from '@playwright/test';
import { Logger } from '../infra/logger.js';
import { generateTOTP } from './totp.js';
import { isOktaLockedOut, otpRetryDelayMs } from './otpRetry.js';

// The Okta sign-in for the shared IDE service account, driven on a page the caller has already
// pointed at a provider's login (or at Okta directly).
//
// Several providers federate to the same Okta tenant, and everything between "we are on the login
// page" and "Okta accepted the one-time code" is identical for all of them. What differs is only
// what happens *after* the code is accepted -- Databricks walks through OAuth consent screens
// before redirecting to its loopback server, while Snowflake posts a SAML assertion back and
// redirects to the SDK's. That tail is supplied by the caller as `afterOtp`.
//
// `afterOtp` runs inside the OTP retry loop on purpose. A rejected code and a stalled post-OTP
// redirect are indistinguishable from the outside, so a failure there re-enters the loop with a
// fresh code rather than failing the run.

const MAX_OTP_ATTEMPTS = 3;

export interface OktaSignInOptions {
	/**
	 * Runs once Okta has accepted the one-time code, and must reject (or throw) until the flow has
	 * demonstrably completed -- typically by waiting for the provider's callback URL. Called inside
	 * the retry loop, so it may run more than once.
	 */
	afterOtp: (page: Page) => Promise<void>;
	/** Where to report progress; callers pass `code.logger`. */
	logger: Logger;
	/** Prefix for log lines, so interleaved shards stay readable (e.g. 'Workbench'). */
	label: string;
}

/**
 * Reads the shared IDE service account credentials, failing with the missing variable names rather
 * than letting an undefined value reach a form field (where it surfaces much later as an opaque
 * Okta error).
 */
export function readServiceAccountCredentials(): { email: string; password: string; otpSecret: string } {
	const email = process.env.IDE_SERVICE_ACCOUNT_EMAIL;
	const password = process.env.IDE_SERVICE_ACCOUNT_PASSWORD;
	const otpSecret = process.env.IDE_SERVICE_ACCOUNT_OTP_SECRET;

	const missing = [
		['IDE_SERVICE_ACCOUNT_EMAIL', email],
		['IDE_SERVICE_ACCOUNT_PASSWORD', password],
		['IDE_SERVICE_ACCOUNT_OTP_SECRET', otpSecret],
	].filter(([, value]) => !value).map(([name]) => name);

	if (missing.length > 0) {
		throw new Error(`Okta sign-in requires the IDE service account credentials. Missing: ${missing.join(', ')}`);
	}

	return { email: email!, password: password!, otpSecret: otpSecret! };
}

/**
 * Completes the Okta sign-in on `page`, then hands off to `afterOtp`.
 *
 * Callers verify success through their own signed-in state rather than this return value: the
 * sign-in tab sometimes closes itself on completion, so "we never saw the callback" is not the same
 * as "sign-in failed".
 *
 * @returns true if `afterOtp` completed without throwing.
 */
export async function completeOktaSignIn(page: Page, options: OktaSignInOptions): Promise<boolean> {
	const { afterOtp, logger, label } = options;
	const { email, password, otpSecret } = readServiceAccountCredentials();

	// Some providers show their own login page first, offering an SSO hop; others (or an authorize
	// endpoint that redirects straight to the IdP) land on Okta directly. A missing button is not a
	// failure -- the waitForURL below is what actually gates progress.
	const ssoButton = page.locator('a:has-text("Continue with SSO")');
	try {
		await expect(ssoButton).toBeVisible({ timeout: 15000 });
		await ssoButton.click();
	} catch {
		logger.log(`[${label}] No "Continue with SSO" button; assuming the login page redirected to the IdP directly`);
	}
	await page.waitForURL(/okta\.com/, { timeout: 15000 });

	// Enter Okta credentials
	const usernameField = page.locator('#input28');
	const passwordField = page.locator('input[type="password"]');
	const nextButton = page.locator('input[value="Next"]');
	const verifyButton = page.locator('input[value="Verify"]');

	await expect(usernameField).toBeVisible({ timeout: 10000 });
	await usernameField.fill(email);
	await expect(nextButton).toBeVisible({ timeout: 10000 });
	await nextButton.click();
	await expect(passwordField).toBeVisible({ timeout: 5000 });
	await passwordField.fill(password);
	await expect(verifyButton).toBeVisible({ timeout: 10000 });
	await verifyButton.click();

	// Complete 2FA authentication. TOTPs roll every 30s and Okta rejects reused codes, so a parallel
	// shard consuming the same code seconds earlier can knock us out, or rapid duplicate submissions
	// can lock the account ("too many attempts"). Retry up to 3 times, backing off with jitter
	// between attempts so we de-align from the competing shard and land in a different TOTP window
	// (and back off longer on lockout). See otpRetry.ts.
	await page.waitForLoadState('networkidle', { timeout: 10000 });
	const otpField = page.locator('input[type="text"], input[type="tel"], input[autocomplete="one-time-code"]').first();
	const verifyOtpButton = page.locator('button:has-text("Verify"), input[value="Verify"]');

	for (let attempt = 1; attempt <= MAX_OTP_ATTEMPTS; attempt++) {
		await expect(otpField).toBeVisible({ timeout: 15000 });
		await otpField.fill('');
		await otpField.fill(generateTOTP(otpSecret));
		logger.log(`[${label}] Submitted TOTP code (attempt ${attempt}/${MAX_OTP_ATTEMPTS})`);
		await expect(verifyOtpButton).toBeVisible({ timeout: 10000 });
		await verifyOtpButton.click();

		try {
			await afterOtp(page);
			return true;
		} catch {
			// The sign-in tab sometimes closes itself on success (or on certain Okta errors). A closed
			// tab here is more likely "flow completed" than "OTP rejected" -- bail out of the retry
			// loop and let the caller's state check decide success.
			if (page.isClosed()) {
				logger.log(`[${label}] Sign-in page closed before completion; treating as completed and deferring to the caller's state check`);
				return false;
			}
			if (attempt === MAX_OTP_ATTEMPTS) {
				logger.log(`[${label}] OTP not accepted after ${MAX_OTP_ATTEMPTS} attempts; falling through to the caller's state check`);
				return false;
			}
			const lockedOut = await isOktaLockedOut(page);
			const delay = otpRetryDelayMs(lockedOut);
			logger.log(`[${label}] OTP not accepted (attempt ${attempt}/${MAX_OTP_ATTEMPTS}, lockedOut=${lockedOut}); backing off ${delay}ms before retry`);
			await page.waitForTimeout(delay);
		}
	}

	return false;
}
