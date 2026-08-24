/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Browser, BrowserContext, chromium, expect, Locator, Page } from '@playwright/test';
import { Logger } from '../infra/logger.js';
import { BrowserLaunchShim } from './browserLaunchShim.js';
import { generateTOTP } from './totp.js';
import { isOktaLockedOut, otpRetryDelayMs } from './otpRetry.js';

// The Okta-fronted Databricks sign-in for the shared IDE service account, driven on a
// page the caller already put in front of the Databricks authorize endpoint. Two callers
// reach this point by different routes and neither one's plumbing belongs here:
//
//   - Posit Workbench's Session Credentials widget opens the authorize URL in a new tab
//     of the workbench's own browser context (see dashboard.page.ts).
//   - Positron Desktop's Databricks LLM provider hands the URL to the system browser via
//     vscode.env.openExternal, so the e2e test intercepts it and replays it in a browser
//     it controls (see modelProviderShared.ts).
//   - The data connections Databricks driver hands off to @databricks/sql, which runs its own
//     OAuth and launches the browser through the `open` npm package -- intercepted with a PATH
//     shim instead (see completeDatabricksSdkOAuth below).
//
// Everything between "we are on the workspace login page" and "the provider redirected
// back to the callback" is identical, and that is what lives here.

const MAX_OTP_ATTEMPTS = 3;

export interface DatabricksOktaSignInOptions {
	/**
	 * Pattern the OAuth page lands on once Databricks redirects back to whoever started
	 * the flow -- the workbench's callback, or the extension's loopback server.
	 */
	completionUrl: RegExp;
	/** Where to report progress; callers pass `code.logger`. */
	logger: Logger;
	/** Prefix for log lines, so interleaved shards stay readable (e.g. 'Workbench'). */
	label: string;
}

/**
 * Reads the shared IDE service account credentials, failing with the missing variable
 * names rather than letting an undefined value reach a form field (where it surfaces
 * much later as an opaque Okta error).
 */
function readServiceAccountCredentials(): { email: string; password: string; otpSecret: string } {
	const email = process.env.IDE_SERVICE_ACCOUNT_EMAIL;
	const password = process.env.IDE_SERVICE_ACCOUNT_PASSWORD;
	const otpSecret = process.env.IDE_SERVICE_ACCOUNT_OTP_SECRET;

	const missing = [
		['IDE_SERVICE_ACCOUNT_EMAIL', email],
		['IDE_SERVICE_ACCOUNT_PASSWORD', password],
		['IDE_SERVICE_ACCOUNT_OTP_SECRET', otpSecret],
	].filter(([, value]) => !value).map(([name]) => name);

	if (missing.length > 0) {
		throw new Error(`Databricks OAuth requires the IDE service account credentials. Missing: ${missing.join(', ')}`);
	}

	return { email: email!, password: password!, otpSecret: otpSecret! };
}

/**
 * Clicks a Databricks OAuth consent control if it appears within a short window.
 * These screens ("Authorize as", "Permission Requested") are optional -- Databricks
 * skips them once the account has granted consent -- so a control that never shows
 * is treated as "already past this step" rather than a failure.
 */
async function clickConsentControl(control: Locator, label: string, logger: Logger): Promise<void> {
	try {
		await expect(control).toBeVisible({ timeout: 8000 });
		await control.click();
		logger.log(`Clicked Databricks consent control: ${label}`);
	} catch {
		logger.log(`Databricks consent control not shown, skipping: ${label}`);
	}
}

/**
 * Completes the Databricks OAuth sign-in on `page`, which must already be showing the
 * workspace login page (or the Okta page it redirects to).
 *
 * Callers verify success through their own signed-in state rather than this return value:
 * the OAuth tab sometimes closes itself on completion, so "we never saw the callback URL"
 * is not the same as "sign-in failed".
 *
 * @returns true if the flow was observed reaching `completionUrl`.
 */
export async function completeDatabricksOktaSignIn(page: Page, options: DatabricksOktaSignInOptions): Promise<boolean> {
	const { completionUrl, logger, label } = options;
	const { email, password, otpSecret } = readServiceAccountCredentials();

	// Navigate to Okta SSO via Databricks. The workspace login page offers the SSO hop;
	// an authorize endpoint that redirects straight to the IdP skips it, so a missing
	// button is not a failure -- the waitForURL below is what actually gates progress.
	const ssoButton = page.locator('a:has-text("Continue with SSO")');
	try {
		await expect(ssoButton).toBeVisible({ timeout: 15000 });
		await ssoButton.click();
	} catch {
		logger.log(`[${label}] No "Continue with SSO" button; assuming the authorize endpoint redirected to the IdP directly`);
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

	// Complete 2FA authentication. TOTPs roll every 30s and Okta rejects reused codes, so a
	// parallel shard (e.g. Azure) consuming the same code seconds earlier can knock us out, or
	// rapid duplicate submissions can lock the account ("too many attempts"). Retry up to 3
	// times, backing off with jitter between attempts so we de-align from the competing shard
	// and land in a different TOTP window (and back off longer on lockout). See otpRetry.ts.
	await page.waitForLoadState('networkidle', { timeout: 10000 });
	const otpField = page.locator('input[type="text"], input[type="tel"], input[autocomplete="one-time-code"]').first();
	const verifyOtpButton = page.locator('button:has-text("Verify"), input[value="Verify"]');

	for (let attempt = 1; attempt <= MAX_OTP_ATTEMPTS; attempt++) {
		await expect(otpField).toBeVisible({ timeout: 15000 });
		await otpField.fill('');
		await otpField.fill(generateTOTP(otpSecret));
		logger.log(`[${label}] Submitted TOTP code for Databricks (attempt ${attempt}/${MAX_OTP_ATTEMPTS})`);
		await expect(verifyOtpButton).toBeVisible({ timeout: 10000 });
		await verifyOtpButton.click();

		try {
			// After Okta accepts the OTP it redirects back to Databricks, which walks
			// through up to two OAuth consent screens before completing the redirect to
			// our callback:
			//   1. "Authorize as" -- account picker with a Continue control
			//      (<a data-component-id="oauth.select-group.continue">).
			//   2. "Permission Requested" -- consent screen with an Authorize control.
			// Both render as du-bois links (role "link"), not buttons, and either may be
			// skipped when the account has already granted consent. Click each if shown.
			await clickConsentControl(
				page.locator('[data-component-id="oauth.select-group.continue"]'),
				'Authorize as / Continue',
				logger,
			);
			await clickConsentControl(
				page.getByText('Authorize', { exact: true }),
				'Permission Requested / Authorize',
				logger,
			);

			await page.waitForURL(completionUrl, { timeout: 20000 });
			return true;
		} catch {
			// The OAuth tab sometimes closes itself on success (or on certain Okta errors).
			// A closed tab here is more likely "OAuth completed" than "OTP rejected" -- bail
			// out of the retry loop and let the caller's signed-in check decide success.
			if (page.isClosed()) {
				logger.log(`[${label}] OAuth page closed before URL match; treating as completed and deferring to the caller's state check`);
				return false;
			}
			if (attempt === MAX_OTP_ATTEMPTS) {
				logger.log(`[${label}] OTP not accepted after ${MAX_OTP_ATTEMPTS} attempts; falling through to the caller's state check`);
				return false;
			}
			const lockedOut = await isOktaLockedOut(page);
			const delay = otpRetryDelayMs(lockedOut);
			logger.log(`[${label}] Databricks OTP not accepted (attempt ${attempt}/${MAX_OTP_ATTEMPTS}, lockedOut=${lockedOut}); backing off ${delay}ms before retry`);
			await page.waitForTimeout(delay);
		}
	}

	return false;
}

/**
 * Completes the Databricks OAuth sign-in for a flow the *SDK* runs, rather than one Positron
 * runs -- currently the data connections driver's OAuth User-to-Machine mechanism.
 *
 * The distinction matters because it decides where the authorize URL is intercepted. The
 * assistant's Databricks provider is Positron's own OAuth, so its URL is captured by patching
 * `shell.openExternal` (see completeDatabricksLoopbackOAuth in modelProviderShared.ts). Here
 * the driver only hands connection options to @databricks/sql, which runs authorization code
 * + PKCE itself against its own loopback server on port 8030 and launches the browser through
 * the `open` npm package -- nothing goes through Positron's opener service. So the capture
 * point is a PATH shim instead; see browserLaunchShim.ts.
 *
 * `trigger` must be the action that establishes the connection, and note that it does *not*
 * resolve until sign-in completes: the driver connects eagerly, and Positron only calls it
 * lazily on the first expand of the connection entry, inside the tree's _fetchChildren. So the
 * trigger is started and deliberately left pending while the browser leg runs, then awaited at
 * the end. Awaiting it up front would deadlock.
 *
 * @param shim The armed PATH shim capturing the SDK's browser launch.
 * @param trigger Starts the connect (expands the connection entry). Started, not awaited.
 * @param options.logger Where to report progress; callers pass `code.logger`.
 * @param options.headless Whether to run the OAuth browser headless. Defaults to false,
 * matching the other IdP flows: these pages are not reliably renderable headless.
 */
export async function completeDatabricksSdkOAuth(
	shim: BrowserLaunchShim,
	trigger: () => Promise<void>,
	options: { logger: Logger; headless?: boolean }
): Promise<void> {
	const { logger, headless = false } = options;

	shim.arm();

	// Start the connect and leave it pending. Attach a no-op catch now so that a failure while
	// we are busy with the browser does not surface as an unhandled rejection; the awaited
	// `pending` below is what actually reports it.
	const pending = trigger();
	pending.catch(() => { /* reported by the await at the end */ });

	// The workspace's OIDC authorize endpoint. The SDK uses /oidc/oauth2/v2.0/authorize, which
	// is a different endpoint from the /oidc/v1/authorize the assistant's provider discovers,
	// so match the shared prefix rather than either exact path.
	const authorizeUrl = await shim.waitForUrl(/\/oidc\/.*authorize/);

	// The SDK's own callback (http://localhost:8030 by default -- DatabricksOAuthManager's
	// defaultCallbackPorts). Landing there is what tells us Databricks completed the handoff.
	const redirectUri = new URL(authorizeUrl).searchParams.get('redirect_uri');
	if (!redirectUri) {
		throw new Error('Databricks authorize URL carried no redirect_uri');
	}
	const loopbackHost = new URL(redirectUri).host;

	let browser: Browser | undefined;
	let context: BrowserContext | undefined;
	try {
		browser = await chromium.launch({ headless });
		context = await browser.newContext();
		const page = await context.newPage();
		await page.goto(authorizeUrl);
		await completeDatabricksOktaSignIn(page, {
			completionUrl: new RegExp(loopbackHost.replace(/\./g, '\\.')),
			logger,
			label: 'DataConnections',
		});
	} finally {
		if (context) { await context.close(); }
		if (browser) { await browser.close(); }
	}

	// The SDK's loopback server has the code by now; awaiting the trigger lets the token
	// exchange, the connect, and the tree's first metadata query finish (or report a failure).
	await pending;
}
