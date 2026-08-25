/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Browser, BrowserContext, chromium } from '@playwright/test';
import { Logger } from '../infra/logger.js';
import { BrowserLaunchShim } from './browserLaunchShim.js';
import { completeOktaSignIn } from './oktaSignIn.js';

// The data connections Snowflake driver's External Browser sign-in.
//
// Despite the name, this is not Snowflake's own login form. The account federates to Okta, so the
// SSO URL the SDK requests redirects to an Okta SAML endpoint and the credentials entered are the
// shared IDE service account's -- the same identity, and the same TOTP secret, the Databricks flows
// use. The Okta steps themselves live in oktaSignIn.ts; what is Snowflake-specific is only which
// URL is captured and what "done" looks like.
//
// (Posit Workbench's Session Credentials widget reaches Snowflake by a different route -- an OAuth
// client against Snowflake, which does show Snowflake's native username/password form. That flow
// lives in dashboard.page.ts and shares nothing with this one.)

/**
 * Completes the sign-in for the data connections driver's External Browser mechanism, which
 * snowflake-sdk runs itself rather than Positron running it.
 *
 * The driver only hands connection options to snowflake-sdk; `auth_web.js` then stands up a
 * loopback server on an ephemeral port, asks Snowflake for an SSO URL bound to that port, and
 * launches the browser through the `open` npm package. Nothing reaches Positron's opener service,
 * so the URL is captured with a PATH shim (browserLaunchShim.ts) and replayed in a browser
 * Playwright controls. The SDK's own server receives the token and finishes the handshake.
 *
 * Note which URL that is: `auth_web.js` has two branches, and `disableConsoleLogin` defaults to
 * true, so the live one is `ssoUrlProvider.getSSOURL(...)` -- an opaque, account-specific SSO URL.
 * The `/console/login` URL built by `getLoginUrl` is the *other* branch and is not what ships. So
 * match any launched URL rather than a shape, and let the awaited connect below be the verdict on
 * whether sign-in actually worked.
 *
 * (snowflake-sdk does expose an `openExternalBrowserCallback` connection option, but it is not
 * surfaced by the driver, and adding a test-only hook to production code would be the wrong trade.)
 *
 * `trigger` must be the action that establishes the connection, and note that it does *not*
 * resolve until sign-in completes: the driver connects eagerly, and Positron only calls it lazily
 * on the first expand of the connection entry. So the trigger is started and deliberately left
 * pending while the browser leg runs, then awaited at the end. Awaiting it up front would deadlock.
 *
 * @param shim The PATH shim capturing the SDK's browser launch.
 * @param trigger Starts the connect (expands the connection entry). Started, not awaited.
 * @param options.logger Where to report progress; callers pass `code.logger`.
 * @param options.headless Whether to run the sign-in browser headless. Defaults to false, matching
 * the other IdP flows: these pages are not reliably renderable headless.
 */
export async function completeSnowflakeSdkOAuth(
	shim: BrowserLaunchShim,
	trigger: () => Promise<void>,
	options: { logger: Logger; headless?: boolean }
): Promise<void> {
	const { logger, headless = false } = options;

	shim.arm();

	// Start the connect and leave it pending. Attach a no-op catch now so that a failure while we
	// are busy with the browser does not surface as an unhandled rejection; the awaited `pending`
	// below is what actually reports it.
	const pending = trigger();
	pending.catch(() => { /* reported by the race and the await below */ });

	// Race the capture against the connect *failing*. Without this, a connect that fails before ever
	// reaching the browser (a bad account, an unreachable host) is reported as "no browser launch was
	// captured" -- a timeout that describes the symptom and hides the cause.
	//
	// Only a rejection is meaningful here. `expandConnection` resolves as soon as the row's twisty
	// flips from `collapsed` to `loading` (see positronTreeInstance.tsx), which happens the instant
	// expansion begins and long before the connect finishes -- so treating a fulfilment as "already
	// connected" bails out before the browser is ever launched. Map it to a promise that never
	// settles and let the capture decide.
	const loginUrl = await Promise.race([
		shim.waitForUrl(/^https?:\/\//),
		pending.then(() => new Promise<string>(() => { /* never settles; see above */ })),
	]);

	let browser: Browser | undefined;
	let context: BrowserContext | undefined;
	try {
		browser = await chromium.launch({ headless });
		context = await browser.newContext();
		const page = await context.newPage();
		await page.goto(loginUrl);
		await completeOktaSignIn(page, {
			logger,
			label: 'DataConnections/Snowflake',
			// Okta posts the SAML assertion back to Snowflake, which redirects to the SDK's loopback
			// server on an ephemeral port. Landing on localhost is what tells us the handoff completed;
			// the port is not in the SSO URL, so match the host and let the port be whatever it is.
			afterOtp: signInPage => signInPage.waitForURL(/localhost:\d+/, { timeout: 30000 }),
		});
	} finally {
		if (context) { await context.close(); }
		if (browser) { await browser.close(); }
	}

	// Surface a trigger failure if there was one. Note this does not wait for the connection: the
	// trigger resolved back when the twisty began loading. What actually proves the connect
	// succeeded is the caller's next expand, which cannot render until the metadata query returns.
	await pending;
}
