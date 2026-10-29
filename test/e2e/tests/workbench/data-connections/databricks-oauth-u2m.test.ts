/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, Locator, Page } from '@playwright/test';
import { test, tags } from '../../_test.setup';
import { Logger } from '../../../infra/logger.js';
import { installPasskey, OktaPasskeyCredentials, readPositronServiceAccountCredentials, selectPasskeyFactor } from '../../../utils/oktaSignIn.js';

test.use({
	suiteId: __filename,
	managedCredentials: 'databricks'
});

// Databricks OAuth U2M on Workbench (posit-dev/positron#16409). The browser runs on the user's
// machine and the extension host on the server, so the OAuth redirect lands on a localhost page
// nothing serves; the user pastes that page's address into Positron's sign-in prompt. Here that
// address is read off the popup's refused request and pasted the same way.
test.describe('Data Connections - Databricks OAuth U2M', {
	tag: [tags.WORKBENCH_DATABRICKS, tags.CONNECTIONS]
}, () => {
	test('signs in through the browser and lists the catalogs', async function ({ app }) {
		test.setTimeout(300_000);
		const host = process.env.DATABRICKS_URL ? new URL(process.env.DATABRICKS_URL).host : '';
		const httpPath = process.env.DATABRICKS_HTTP_PATH || '';
		const passkeyCredential = process.env.POSITRON_SERVICE_ACCOUNT_PASSKEY_CREDENTIAL;
		test.skip(!host || !httpPath || !passkeyCredential,
			'Needs DATABRICKS_URL, DATABRICKS_HTTP_PATH, and the POSITRON_SERVICE_ACCOUNT_* credentials');

		const { dataConnections, quickInput } = app.workbench;
		const page = app.code.driver.currentPage;
		const connectionName = `databricks-u2m-${Date.now()}`;
		dataConnections.actionTimeout = 120_000;
		try {
			await dataConnections.openDataConnectionsView();
			await dataConnections.clickAddConnection();
			await dataConnections.selectProvider('Databricks');
			await dataConnections.selectConnectionMechanism('OAuth User-to-Machine (U2M)');
			await dataConnections.fillConnectionInputs({
				'Connection Name': connectionName,
				'Server Hostname': host,
				'HTTP Path': httpPath,
			});
			await dataConnections.save();
			await dataConnections.expectConnectionInTree(connectionName);

			// Expanding the entry connects, which opens the sign-in popup. The twisty is clicked
			// directly: expandConnection would wait for children that only load after the sign-in.
			const popupPromise = page.context().waitForEvent('page', { timeout: 60_000 });
			const row = page.locator('.positron-tree-row').filter({ has: page.locator('.data-connection-entry-row').filter({ hasText: connectionName }) });
			await row.locator('.positron-tree-twisty-collapsed').first().dispatchEvent('click');
			const popup = await popupPromise;

			// Nothing on this machine serves the redirect; capture its URL from the request itself,
			// which is reported even though the connection is refused. The authorize URL is kept too,
			// so a failed first navigation can be retried against the real address.
			let authorizeUrl = popup.url();
			const callbackUrl = new Promise<string>(resolve => popup.on('request', request => {
				if (request.isNavigationRequest() && request.url().includes('/oidc/v1/authorize')) {
					authorizeUrl = request.url();
				}
				if (request.url().startsWith('http://localhost:8030')) {
					console.log(`[u2m] callback: ${request.url().replace(/code=[^&]+/, 'code=...')}`);
					resolve(request.url());
				}
			}));
			popup.on('requestfailed', request => {
				if (request.isNavigationRequest()) {
					console.log(`[u2m] navigation failed: ${request.failure()?.errorText} at ${request.url().split('?')[0]}`);
				}
			});

			await signInWithSso(popup, () => authorizeUrl, callbackUrl, readPositronServiceAccountCredentials(), app.code.logger);
			const callback = await Promise.race([
				callbackUrl,
				popup.waitForTimeout(90_000).then(() => { throw new Error('No redirect to the callback within 90s'); }),
			]);
			await popup.close();
			const error = new URL(callback).searchParams.get('error');
			if (error) {
				throw new Error(`Databricks answered the authorize request with ${error}: ${new URL(callback).searchParams.get('error_description')}`);
			}

			await quickInput.waitForQuickInputOpened({ timeout: 15_000 });
			await quickInput.expectTitleBarToHaveText('Sign in to Databricks');
			await quickInput.type(callback);
			await quickInput.submitInputBox();

			await expect(page.locator('.positron-tree-row').filter({ hasText: 'Catalogs' }).first()).toBeVisible({ timeout: 120_000 });
			await dataConnections.collapseConnection(connectionName);
		} finally {
			dataConnections.actionTimeout = undefined;
		}
	});
});

/**
 * Signs in on the Databricks login page through "Continue with SSO", which federates to
 * posit.okta.com: password, then the Positron service account's passkey, answered by a virtual
 * authenticator (see oktaSignIn.ts). Mirrors the Workbench auth page's Azure flow.
 */
async function signInWithSso(popup: Page, authorizeUrl: () => string, callbackUrl: Promise<string>, account: OktaPasskeyCredentials, logger: Logger): Promise<void> {
	const step = (name: string) => logger.log(`[u2m] ${name}: ${popup.url().split('?')[0]}`);
	// Databricks may answer the authorize request by redirecting to the callback at once (an
	// OAuth error, or a session it already trusts); the caller reads that callback, so stop here.
	const callbackArrived = callbackUrl.then(() => 'callback' as const);
	const sso = popup.getByText('Continue with SSO');
	for (let attempt = 1; ; attempt++) {
		const outcome = await Promise.race([
			sso.waitFor({ timeout: 30_000 }).then(() => 'sso' as const, () => 'timeout' as const),
			callbackArrived,
		]);
		if (outcome === 'callback') {
			return;
		}
		if (outcome === 'sso') {
			break;
		}
		console.log(`[u2m] login page not shown after 30s (attempt ${attempt}) at ${popup.url().split('?')[0]}; re-navigating`);
		if (attempt === 3) {
			throw new Error('The Databricks login page did not load');
		}
		await popup.goto(authorizeUrl(), { timeout: 60_000 }).catch(err => console.log(`[u2m] re-navigation failed: ${err.message.split('\n')[0]}`));
	}
	await sso.click();
	await popup.waitForURL(/okta\.com/, { timeout: 60_000 });
	await installPasskey(popup, account.passkeyCredential);
	await popup.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => { });
	step('okta');

	const identifier = popup.locator('input[name="identifier"], input[type="email"]').first();
	if (await identifier.isVisible({ timeout: 30_000 }).catch(() => false)) {
		await typeInto(identifier, account.email);
		await popup.getByRole('button', { name: /^(Next|Sign in)$/ }).first().click();
		step('after-identifier');
	}

	const passwordField = popup.locator('input[type="password"]').first();
	await expect(passwordField).toBeVisible({ timeout: 30_000 });
	await typeInto(passwordField, account.password);
	await popup.getByRole('button', { name: /^(Verify|Next|Sign in)$/ }).first().click();
	step('after-password');

	await selectPasskeyFactor(popup, logger, 'u2m');
	await popup.waitForURL(url => !url.hostname.endsWith('okta.com'), { timeout: 45_000 });
	step('after-passkey');

	// Databricks may ask the user to approve the app before redirecting.
	const consent = popup.getByRole('button', { name: /^(Allow|Authorize|Continue|Accept)$/ });
	if (await consent.isVisible({ timeout: 10_000 }).catch(() => false)) {
		await consent.click();
		step('after-consent');
	}
}

/**
 * Text entry for Okta's forms, which re-render their inputs after they appear: wait until the
 * field is editable, type one keystroke at a time so the bindings fire, and check the value stuck.
 */
async function typeInto(field: Locator, value: string): Promise<void> {
	await expect(field).toBeEditable({ timeout: 30_000 });
	await field.click();
	await field.fill('');
	await field.pressSequentially(value, { delay: 30 });
	await expect(field).toHaveValue(value, { timeout: 5_000 });
}
