/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { PermissionPayload } from '../../../pages/connect.js';
import { test, tags, expect } from '../../_test.setup';

test.use({
	suiteId: __filename
});

let userId: string;
let pythonVersion: string;
const connectServer = 'http://connect:3939';

test.describe('Publisher - Positron', { tag: [tags.WORKBENCH, tags.PUBLISHER] }, () => {

	test.beforeAll('Get connect API key', async function ({ app, runDockerCommand, hotKeys }) {

		// await app.code.driver.page.setViewportSize({ width: 2560, height: 1440 });

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

		const versions = await app.workbench.positConnect.getPythonVersions();
		pythonVersion = versions[0];

		await hotKeys.stackedLayout();

	});

	test('Verify Publisher functionality in Positron with Shiny app deployment as example', async function ({ app, page, openFile, hotKeys }) {

		await test.step('Open file', async () => {
			await openFile('workspaces/shiny-py-example/app.py');
		});

		await test.step('Click on Publish button', async () => {
			await app.workbench.editorActionBar.clickButton('Deploy with Posit Publisher');
		});

		await test.step('Enter title for application through quick-input', async () => {
			await app.workbench.quickInput.waitForQuickInputOpened();
			await app.workbench.quickInput.type('shiny-py-example');
			await page.keyboard.press('Enter');
		});

		const existing = app.workbench.quickInput.quickInputList.getByText('shiny-py-example');

		let existingPresent = false;
		try {
			await existing.textContent({ timeout: 3000 });
			existingPresent = true;
		} catch {
		}

		if (existingPresent) {
			await test.step('Use saved credential', async () => {
				await app.workbench.quickInput.selectQuickInputElement(0, false);
			});
		} else {

			await test.step('Select Posit Connect as deployment target', async () => {
				await app.workbench.quickInput.selectQuickInputElement(1, true);
				await expect(app.code.driver.page.getByText('Please provide the Posit Connect server\'s URL')).toBeVisible({ timeout: 10000 });
				await app.workbench.quickInput.type(connectServer);
				await page.keyboard.press('Enter');
			});

			// Make sure to delete stored credentials by accessing Keychain Access --> Login --> Search for `posit` --> Remove `Posit Publisher Safe Storage`
			await test.step('Enter Connect server and API key', async () => {
				await app.workbench.quickInput.selectQuickInputElement(1, true);
				const apiKeyInputLocator = page.locator('div.monaco-inputbox input[type="password"]');
				await expect(apiKeyInputLocator).toBeVisible({ timeout: 30000 });
				await app.workbench.quickInput.type(app.workbench.positConnect.getConnectApiKey());
				await page.keyboard.press('Enter');
			});

			await test.step('Unique name for credential (Connect Server and API key)', async () => {
				await expect(app.code.driver.page.getByText(`Successfully connected to ${connectServer}`)).toBeVisible({ timeout: 10000 });

				await app.workbench.quickInput.type('shiny-py-example');
				await page.keyboard.press('Enter');
			});
		}

		const outerFrame = page.frameLocator('iframe.webview.ready');
		const innerFrame = outerFrame.frameLocator('iframe#active-frame');

		await test.step('Add files to deployment file (after app.py) and save', async () => {
			await innerFrame.locator('.tree-item-title', { hasText: 'shared.py' }).click();
			await innerFrame.locator('.tree-item-title', { hasText: 'styles.css' }).click();
			await innerFrame.locator('.tree-item-title', { hasText: 'tips.csv' }).click();
		});

		const deployButton = innerFrame.locator('vscode-button[data-automation="deploy-button"] >>> button');

		await test.step('Expect Deploy Your Project button to appear', async () => {
			await expect(deployButton).toBeVisible();
		});

		await hotKeys.toggleBottomPanel();

		await app.code.wait(2000);

		await app.workbench.positConnect.setPythonVersion(pythonVersion);

		await hotKeys.save();

		await expect(app.workbench.topActionBar.saveAllButton).not.toBeEnabled({ timeout: 10000 });

		await hotKeys.toggleBottomPanel();

		await test.step('Click on Deploy Your Project button', async () => {
			await deployButton.click();
		});

		await app.workbench.toasts.awaitToastDisappearance(120000);

		await hotKeys.closeSecondarySidebar();

		await app.code.driver.page.locator('.monaco-action-bar .action-label', { hasText: 'Publisher' }).click({ timeout: 60000 });

		const deployedLocator = app.code.driver.page.locator('.monaco-tl-row .monaco-highlighted-label', { hasText: 'Successfully deployed at' });

		const deploymentText = await deployedLocator.textContent();

		const appGuid = extractGuid(deploymentText || '');

		console.log(appGuid);

		const payload: PermissionPayload = {
			principal_guid: userId,
			principal_type: 'user',
			role: 'viewer',
		};

		await app.workbench.positConnect.setContentPermission(
			appGuid!,
			payload,
		);

		await app.code.driver.page.goto('http://localhost:3939');

		await app.code.wait(60000);

	});
});

export function extractGuid(line: string): string | null {
	const m = line.match(
		/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?!.*[0-9a-f-])/i
	);
	return m ? m[1] : null;
}
