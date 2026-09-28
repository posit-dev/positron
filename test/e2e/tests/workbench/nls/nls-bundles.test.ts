/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Verifies the web workbench loads a translated NLS bundle from the CDN when the
 * browser locale is not English.
 *
 * Bundles are published per commit by the positron-builds release pipeline, so
 * they exist only for published dailies. Against a branch build the CDN has no
 * bundle and the test skips; it runs for real in the positron-builds nightly.
 */

import { test, expect, tags } from '../../_test.setup';

const LOCALE_COOKIE = 'vscode.nls.locale';
const LOCALE = 'ja';
const EXPLORER_TITLE_JA = 'エクスプローラー';

test.use({
	suiteId: __filename
});

test.describe('Workbench: NLS language bundles', {
	tag: [tags.WORKBENCH],
}, () => {

	test.afterAll(async function ({ app }) {
		await app.code.driver.currentPage.context().clearCookies({ name: LOCALE_COOKIE });
	});

	test('Web workbench renders translated chrome from the published Japanese bundle', async function ({ page }) {
		await test.step(`Reload with the display language set to ${LOCALE}`, async () => {
			await page.context().addCookies([{ name: LOCALE_COOKIE, value: LOCALE, url: page.url() }]);
			await page.reload();
			// A full reload through the Workbench proxy is slower than the 15s default.
			await expect(page.locator('.monaco-workbench')).toBeVisible({ timeout: 60000 });
		});

		const bundleScript = page.locator(`script[type="module"][src$="/${LOCALE}/nls.messages.js"]`);
		test.skip(await bundleScript.count() === 0, 'This build has no nlsCoreBaseUrl, so server-side NLS bundles are disabled.');

		const bundleUrl = (await bundleScript.getAttribute('src'))!;
		const response = await page.request.get(bundleUrl);
		test.skip(!response.ok(), `No published NLS bundle at ${bundleUrl} (HTTP ${response.status()}). Expected for a branch build; only published dailies have bundles.`);

		await expect(page.locator('.activitybar').getByRole('tab', { name: new RegExp(`^${EXPLORER_TITLE_JA}`) })).toBeVisible();
	});
});
