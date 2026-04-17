/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { PermissionPayload } from '../../../pages/connect.js';
import { test, tags, expect } from '../../_test.setup.js';

test.use({
	suiteId: __filename
});

let userId: string;
const connectServer = 'http://connect:3939';

test.describe('Publisher - Quarto R', { tag: [tags.WORKBENCH, tags.PUBLISHER] }, () => {

	test.beforeAll('Get connect API key', async function ({ app, runDockerCommand, hotKeys }) {

		// Read previously bootstrapped token from the shared volume
		const { stdout } = await runDockerCommand(
			`docker exec test bash -lc 'set -euo pipefail; [ -s /tokens/connect_bootstrap_token ] && cat /tokens/connect_bootstrap_token'`,
			'Read Connect API key'
		);

		const connectApiKey = stdout.trim();
		if (!connectApiKey) {
			throw new Error('Connect API key file was empty or missing at /tokens/connect_bootstrap_token');
		}

		app.workbench.positConnect.setConnectApiKey(connectApiKey);

		const user1Present = await app.workbench.positConnect.getUserId('user1');
		if (!user1Present) {

			await runDockerCommand('docker exec connect sudo groupadd -g 1100 user1g', 'Create group user1g');
			await runDockerCommand('docker exec connect sudo useradd --create-home --shell /bin/bash --home-dir /home/user1 -u 1100 -g 1100 user1', 'Create user user1');
			await runDockerCommand(`docker exec connect bash -c \'echo "user1":"${process.env.POSIT_WORKBENCH_PASSWORD}" | sudo chpasswd\'`, 'Set password for user1');

			userId = await app.workbench.positConnect.createUser();
		} else {
			userId = user1Present;
		}

		await hotKeys.stackedLayout();

	});

	test('Verify Publisher functionality with Quarto Python document deployment', async function ({ app, page, openFile, hotKeys }) {

		test.slow();

		await test.step('Open file', async () => {
			await openFile(join('workspaces', 'quarto_basic', 'quarto_basic.qmd'));
		});

		await test.step('Click on Publish button', async () => {
			await app.workbench.editorActionBar.clickButton('Deploy with Posit Publisher');
		});

		// Check if the publisher setup wizard appears (first run) or if we go straight to publisher UI (re-run)
		// Look for the specific quick input list items that appear during the publisher wizard
		let publishWizardPresent = false;
		try {
			await page.locator('.quick-input-list').getByText('source', { exact: false }).waitFor({ state: 'visible', timeout: 5000 });
			publishWizardPresent = true;
		} catch {
			publishWizardPresent = false;
		}

		if (publishWizardPresent) {
			// First run: need to complete setup wizard
			await test.step('Publish with source code', async () => {
				await app.workbench.quickInput.waitForQuickInputOpened();
				await app.workbench.quickInput.type('source');
				await page.keyboard.press('Enter');
			});

			await test.step('Enter title for application through quick-input', async () => {
				await app.workbench.quickInput.waitForQuickInputOpened();
				await app.workbench.quickInput.type('quarto-r-example');
				await page.keyboard.press('Enter');
			});

			const existingPresent = await app.workbench.publisher.hasSavedCredential(page, 'connect-container');

			if (existingPresent) {
				await test.step('Use saved credential', async () => {
					await app.workbench.publisher.useSavedCredential();
				});
			} else {

				// Make sure to delete stored credentials by accessing Keychain Access --> Login --> Search for `posit` --> Remove `Posit Publisher Safe Storage`
				await test.step('Enter Connect server and API key', async () => {
					await app.workbench.publisher.enterConnectCredentials(page, connectServer, app.workbench.positConnect.getConnectApiKey());
				});

				await test.step('Unique name for credential (Connect Server and API key)', async () => {
					await app.workbench.publisher.saveCredentialName(page, 'connect-container', connectServer);
				});
			}
		}

		// At this point, whether first run or re-run, we should have the publisher UI with deploy button
		const { innerFrame } = app.workbench.publisher.getPublisherFrames(page);
		const deployButton = app.workbench.publisher.getDeployButton(innerFrame);

		await test.step('Expect Deploy Your Project button to appear', async () => {
			await expect(deployButton).toBeVisible();
		});

		await hotKeys.minimizeBottomPanel();

		let appGuid;
		await test.step('Deploy, await completion and get appGuid', async () => {
			await deployButton.click({ timeout: 5000 });

			await expect(app.code.driver.page.locator('text=Deployment was successful').first()).toBeVisible({ timeout: 400000 });

			await hotKeys.closeSecondarySidebar();

			await hotKeys.restoreBottomPanel();

			await app.code.driver.page.locator('.monaco-action-bar .action-label', { hasText: 'Publisher' }).click({ timeout: 60000 });

			const deployedLocator = app.code.driver.page.locator('.monaco-tl-row .monaco-highlighted-label', { hasText: 'Successfully deployed at' });

			const deploymentText = await deployedLocator.textContent();

			appGuid = app.workbench.publisher.extractGuid(deploymentText || '');
		});

		await test.step('Grant permission to connect user', async () => {
			const payload: PermissionPayload = {
				principal_guid: userId,
				principal_type: 'user',
				role: 'viewer',
			};

			await app.workbench.positConnect.setContentPermission(
				appGuid!,
				payload,
			);
		});

		await test.step('Ensure connect user can access content', async () => {
			await app.code.driver.page.goto('http://localhost:3939');

			await app.code.driver.page.locator('[data-automation="signin"]').click();

			await app.code.driver.page.fill('input[name="username"]', 'user1');
			await app.code.driver.page.fill('input[name="password"]', process.env.POSIT_WORKBENCH_PASSWORD!);
			await app.code.driver.page.locator('[data-automation="login-panel-submit"]').click();

			await app.code.driver.page.locator('[data-automation="content-table__row__display-name"]').first().click();

			const headerLocator = app.code.driver.page.frameLocator('#contentIFrame').locator('h1');
			await expect(headerLocator).toHaveText('Diamond sizes', { timeout: 20000 });
		});

	});
});
