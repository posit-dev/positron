/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Browser, BrowserContext, chromium, expect, Locator, Page } from '@playwright/test';
import { Logger } from '../infra/logger.js';
import { BrowserLaunchShim } from './browserLaunchShim.js';
import { completeOktaSignIn } from './oktaSignIn.js';

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

	return completeOktaSignIn(page, {
		logger,
		label,
		// After Okta accepts the OTP, Databricks walks through up to two OAuth consent screens before
		// completing the redirect to our callback:
		//   1. "Authorize as" -- account picker with a Continue control
		//      (<a data-component-id="oauth.select-group.continue">).
		//   2. "Permission Requested" -- consent screen with an Authorize control.
		// Both render as du-bois links (role "link"), not buttons, and either may be skipped when the
		// account has already granted consent. Click each if shown, then wait for the callback -- that
		// wait is what tells completeOktaSignIn the code was actually accepted.
		afterOtp: async (signInPage: Page) => {
			await clickConsentControl(
				signInPage.locator('[data-component-id="oauth.select-group.continue"]'),
				'Authorize as / Continue',
				logger,
			);
			await clickConsentControl(
				signInPage.getByText('Authorize', { exact: true }),
				'Permission Requested / Authorize',
				logger,
			);
			await signInPage.waitForURL(completionUrl, { timeout: 20000 });
		},
	});
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

	// Surface a trigger failure if there was one. Note this does not wait for the connection:
	// `expandConnection` resolved back when the row's twisty flipped from `collapsed` to `loading`
	// (see positronTreeInstance.tsx), which happens the instant expansion begins. What actually
	// proves the connect succeeded is the caller's next expand, which cannot render until the
	// metadata query returns.
	await pending;
}
