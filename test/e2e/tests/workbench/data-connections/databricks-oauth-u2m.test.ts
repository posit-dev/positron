/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, Locator, Page } from '@playwright/test';
import { test, tags } from '../../_test.setup';
import { generateTOTP } from '../../../utils/totp.js';
import { isOktaLockedOut, otpRetryDelayMs } from '../../../utils/otpRetry.js';

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
		const email = process.env.IDE_SERVICE_ACCOUNT_EMAIL;
		const password = process.env.IDE_SERVICE_ACCOUNT_PASSWORD;
		const otpSecret = process.env.IDE_SERVICE_ACCOUNT_OTP_SECRET;
		test.skip(!host || !httpPath || !email || !password || !otpSecret,
			'Needs DATABRICKS_URL, DATABRICKS_HTTP_PATH, and the IDE_SERVICE_ACCOUNT_* credentials');

		const { dataConnections, quickInput } = app.workbench;
		const page = app.code.driver.currentPage;
		const connectionName = `databricks-u2m-${Date.now()}`;
		dataConnections.actionTimeout = 120_000;

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
		// which is reported even though the connection is refused.
		const callbackUrl = new Promise<string>(resolve => popup.on('request', request => {
			if (request.url().startsWith('http://localhost:8030')) {
				resolve(request.url());
			}
		}));

		await signInWithSso(popup, { email: email!, password: password!, otpSecret: otpSecret! }, app.code.logger);
		const callback = await Promise.race([
			callbackUrl,
			popup.waitForTimeout(90_000).then(() => { throw new Error('No redirect to the callback within 90s'); }),
		]);
		app.code.logger.log(`[u2m] callback: ${callback.replace(/code=[^&]+/, 'code=...')}`);
		await popup.close();

		await quickInput.waitForQuickInputOpened({ timeout: 15_000 });
		await quickInput.expectTitleBarToHaveText('Sign in to Databricks');
		await quickInput.type(callback);
		await quickInput.submitInputBox();

		await expect(page.locator('.positron-tree-row').filter({ hasText: 'Catalogs' }).first()).toBeVisible({ timeout: 120_000 });
		await dataConnections.collapseConnection(connectionName);
		dataConnections.actionTimeout = undefined;
	});
});

/**
 * Signs in on the Databricks login page through "Continue with SSO", which federates to
 * posit.okta.com: password, then a TOTP code. Mirrors the Workbench auth page's Azure flow.
 */
async function signInWithSso(popup: Page, account: { email: string; password: string; otpSecret: string }, logger: { log(message: string): void }): Promise<void> {
	const step = (name: string) => logger.log(`[u2m] ${name}: ${popup.url().split('?')[0]}`);
	await popup.getByText('Continue with SSO').click({ timeout: 30_000 });
	await popup.waitForURL(/okta\.com/, { timeout: 60_000 });
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

	// Okta may offer a choice of factors before the code field.
	const codeFactor = popup.getByRole('link', { name: /Google Authenticator|Enter a code|Okta Verify/ }).first();
	if (await codeFactor.isVisible({ timeout: 10_000 }).catch(() => false)) {
		await codeFactor.click();
		step('after-factor');
	}

	const otpField = popup.locator('input[autocomplete="one-time-code"], input[name="credentials.passcode"], input[type="tel"]').first();
	await expect(otpField).toBeVisible({ timeout: 30_000 });
	await popup.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => { });
	for (let attempt = 1; attempt <= 3; attempt++) {
		await typeInto(otpField, generateTOTP(account.otpSecret));
		await popup.getByRole('button', { name: /^Verify$/ }).first().click();
		const left = await popup.waitForURL(url => !url.hostname.endsWith('okta.com'), { timeout: 45_000 }).then(() => true, () => false);
		if (left) {
			break;
		}
		if (attempt === 3) {
			throw new Error('OTP authentication failed after 3 attempts');
		}
		const lockedOut = await isOktaLockedOut(popup);
		const delay = otpRetryDelayMs(lockedOut);
		logger.log(`[u2m] OTP not accepted (attempt ${attempt}/3, lockedOut=${lockedOut}); backing off ${delay}ms`);
		await popup.waitForTimeout(delay);
	}
	step('after-otp');

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
