/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, Page } from '@playwright/test';
import type { Protocol } from 'playwright-core/types/protocol';
import { Logger } from '../infra/logger.js';
import { generateTOTP } from './totp.js';
import { isOktaLockedOut, otpRetryDelayMs } from './otpRetry.js';

// The Okta sign-in for a service account, driven on a page the caller has already pointed at a
// provider's login (or at Okta directly).
//
// Several providers federate to the same Okta tenant, and everything between "we are on the login
// page" and "Okta accepted the second factor" is identical for all of them. What differs is only
// what happens *after* that -- Databricks walks through OAuth consent screens before redirecting
// to its loopback server, while Snowflake posts a SAML assertion back and redirects to the SDK's.
// That tail is supplied by the caller as `afterOtp`.
//
// Two accounts, two second factors:
//
//   - The shared IDE service account (IDE_SERVICE_ACCOUNT_*) enrols a TOTP authenticator. Codes
//     roll every 30s and Okta rejects reused ones, so parallel CI jobs signing in as this account
//     collide; the retry loop below papers over that.
//   - The Positron service account (POSITRON_SERVICE_ACCOUNT_*) enrols a WebAuthn passkey. The
//     credential is installed into a virtual authenticator over CDP, so any number of jobs can
//     sign in at once with nothing to collide on. Chromium only, since it relies on CDP.
//
// `afterOtp` runs inside the TOTP retry loop on purpose. A rejected code and a stalled post-OTP
// redirect are indistinguishable from the outside, so a failure there re-enters the loop with a
// fresh code rather than failing the run.

const MAX_OTP_ATTEMPTS = 3;

export interface OktaTotpCredentials {
	email: string;
	password: string;
	/** Base32 TOTP seed. */
	otpSecret: string;
}

export interface OktaPasskeyCredentials {
	email: string;
	password: string;
	/**
	 * JSON list of Chromium `WebAuthn.Credential` records (credentialId, rpId, privateKey,
	 * userHandle, signCount, ...), as exported from a virtual authenticator.
	 */
	passkeyCredential: string;
}

export type OktaCredentials = OktaTotpCredentials | OktaPasskeyCredentials;

export interface OktaSignInOptions {
	/**
	 * Runs once Okta has accepted the second factor, and must reject (or throw) until the flow has
	 * demonstrably completed -- typically by waiting for the provider's callback URL. On the TOTP
	 * path it is called inside the retry loop, so it may run more than once.
	 */
	afterOtp: (page: Page) => Promise<void>;
	/** Where to report progress; callers pass `code.logger`. */
	logger: Logger;
	/** Prefix for log lines, so interleaved shards stay readable (e.g. 'Workbench'). */
	label: string;
	/** Which account to sign in as. Defaults to the shared IDE service account (TOTP). */
	credentials?: OktaCredentials;
}

function readRequiredEnv(purpose: string, names: string[]): string[] {
	const missing = names.filter(name => !process.env[name]);
	if (missing.length > 0) {
		throw new Error(`Okta sign-in requires the ${purpose} credentials. Missing: ${missing.join(', ')}`);
	}
	return names.map(name => process.env[name]!);
}

/**
 * Reads the shared IDE service account credentials, failing with the missing variable names rather
 * than letting an undefined value reach a form field (where it surfaces much later as an opaque
 * Okta error).
 */
export function readServiceAccountCredentials(): OktaTotpCredentials {
	const [email, password, otpSecret] = readRequiredEnv('IDE service account', [
		'IDE_SERVICE_ACCOUNT_EMAIL',
		'IDE_SERVICE_ACCOUNT_PASSWORD',
		'IDE_SERVICE_ACCOUNT_OTP_SECRET',
	]);
	return { email, password, otpSecret };
}

/**
 * Reads the Positron service account credentials (passkey second factor), failing with the missing
 * variable names.
 */
export function readPositronServiceAccountCredentials(): OktaPasskeyCredentials {
	const [email, password, passkeyCredential] = readRequiredEnv('Positron service account', [
		'POSITRON_SERVICE_ACCOUNT_EMAIL',
		'POSITRON_SERVICE_ACCOUNT_PASSWORD',
		'POSITRON_SERVICE_ACCOUNT_PASSKEY_CREDENTIAL',
	]);
	return { email, password, passkeyCredential };
}

function isPasskeyCredentials(credentials: OktaCredentials): credentials is OktaPasskeyCredentials {
	return 'passkeyCredential' in credentials;
}

/**
 * Installs the account's passkey into a virtual authenticator attached to `page`, so Okta's
 * WebAuthn challenge is answered without any user presence or verification prompt.
 */
async function installPasskey(page: Page, passkeyCredential: string): Promise<void> {
	const records = JSON.parse(passkeyCredential) as Protocol.WebAuthn.Credential[];
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('WebAuthn.enable');
	const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
		options: {
			protocol: 'ctap2',
			transport: 'internal',
			hasResidentKey: true,
			hasUserVerification: true,
			isUserVerified: true,
			automaticPresenceSimulation: true,
		},
	});
	for (const credential of records) {
		await cdp.send('WebAuthn.addCredential', { authenticatorId, credential });
	}
}

/**
 * Gets Okta onto the passkey challenge. After the password, Okta shows one of: the challenge
 * itself (passkey is the default factor), the factor picker, or another factor's challenge with a
 * "Verify with something else" link back to the picker. Once the challenge is showing, the virtual
 * authenticator answers it with no further input.
 */
async function selectPasskeyFactor(page: Page, logger: Logger, label: string): Promise<void> {
	const challenge = page.getByRole('heading', { name: /Security Key or Biometric Authenticator/ });
	const passkeyFactor = page.getByRole('link', { name: /Security Key or Biometric Authenticator/ });
	const somethingElse = page.getByRole('link', { name: /Verify with something else/ });

	await expect(challenge.or(passkeyFactor).or(somethingElse).first()).toBeVisible({ timeout: 15000 });

	if (await challenge.isVisible()) {
		logger.log(`[${label}] Passkey challenge shown as the default factor`);
		return;
	}
	if (!await passkeyFactor.isVisible()) {
		logger.log(`[${label}] Another factor is the default; opening the factor picker`);
		await somethingElse.click();
		await expect(passkeyFactor).toBeVisible({ timeout: 15000 });
	}
	await passkeyFactor.click();
	logger.log(`[${label}] Selected the passkey factor`);
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
	const credentials = options.credentials ?? readServiceAccountCredentials();
	const { email, password } = credentials;

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

	if (isPasskeyCredentials(credentials)) {
		await installPasskey(page, credentials.passkeyCredential);
	}

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
	await page.waitForLoadState('networkidle', { timeout: 10000 });

	if (isPasskeyCredentials(credentials)) {
		await selectPasskeyFactor(page, logger, label);
		try {
			await afterOtp(page);
			return true;
		} catch {
			if (page.isClosed()) {
				logger.log(`[${label}] Sign-in page closed before completion; treating as completed and deferring to the caller's state check`);
			} else {
				logger.log(`[${label}] Passkey sign-in did not reach completion; falling through to the caller's state check`);
			}
			return false;
		}
	}

	// Complete 2FA authentication. TOTPs roll every 30s and Okta rejects reused codes, so a parallel
	// shard consuming the same code seconds earlier can knock us out, or rapid duplicate submissions
	// can lock the account ("too many attempts"). Retry up to 3 times, backing off with jitter
	// between attempts so we de-align from the competing shard and land in a different TOTP window
	// (and back off longer on lockout). See otpRetry.ts.
	const otpField = page.locator('input[type="text"], input[type="tel"], input[autocomplete="one-time-code"]').first();
	const verifyOtpButton = page.locator('button:has-text("Verify"), input[value="Verify"]');

	for (let attempt = 1; attempt <= MAX_OTP_ATTEMPTS; attempt++) {
		await expect(otpField).toBeVisible({ timeout: 15000 });
		await otpField.fill('');
		await otpField.fill(generateTOTP(credentials.otpSecret));
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
