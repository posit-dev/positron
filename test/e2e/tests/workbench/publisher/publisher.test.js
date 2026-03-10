"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractGuid = extractGuid;
const _test_setup_1 = require("../../_test.setup");
_test_setup_1.test.use({
    suiteId: __filename
});
let userId;
let pythonVersion;
const connectServer = 'http://connect:3939';
_test_setup_1.test.describe('Publisher - Positron', { tag: [_test_setup_1.tags.WORKBENCH, _test_setup_1.tags.PUBLISHER] }, () => {
    _test_setup_1.test.beforeAll('Get connect API key', async function ({ app, runDockerCommand, hotKeys }) {
        // Read previously bootstrapped token from the shared volume
        const { stdout } = await runDockerCommand(`docker exec test bash -lc 'set -euo pipefail; [ -s /tokens/connect_bootstrap_token ] && cat /tokens/connect_bootstrap_token'`, 'Read Connect API key');
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
        }
        else {
            userId = user1Present;
        }
        const versions = await app.workbench.positConnect.getPythonVersions();
        pythonVersion = versions[0];
        await hotKeys.stackedLayout();
    });
    (0, _test_setup_1.test)('Verify Publisher functionality in Positron with Shiny app deployment as example', async function ({ app, page, openFile, hotKeys }) {
        await _test_setup_1.test.step('Open file', async () => {
            await openFile('workspaces/shiny-py-example/app.py');
        });
        await _test_setup_1.test.step('Click on Publish button', async () => {
            await app.workbench.editorActionBar.clickButton('Deploy with Posit Publisher');
        });
        await _test_setup_1.test.step('Enter title for application through quick-input', async () => {
            await app.workbench.quickInput.waitForQuickInputOpened();
            await app.workbench.quickInput.type('shiny-py-example');
            await page.keyboard.press('Enter');
        });
        const existing = app.workbench.quickInput.quickInputList.getByText('shiny-py-example');
        let existingPresent = false;
        try {
            await existing.textContent({ timeout: 3000 });
            existingPresent = true;
        }
        catch {
        }
        if (existingPresent) {
            await _test_setup_1.test.step('Use saved credential', async () => {
                await app.workbench.quickInput.selectQuickInputElement(0, false);
            });
        }
        else {
            await _test_setup_1.test.step('Select Posit Connect as deployment target', async () => {
                await app.workbench.quickInput.selectQuickInputElement(1, true);
                await (0, _test_setup_1.expect)(app.code.driver.currentPage.getByText('Please provide the Posit Connect server\'s URL')).toBeVisible({ timeout: 10000 });
                await app.workbench.quickInput.type(connectServer);
                await page.keyboard.press('Enter');
            });
            // Make sure to delete stored credentials by accessing Keychain Access --> Login --> Search for `posit` --> Remove `Posit Publisher Safe Storage`
            await _test_setup_1.test.step('Enter Connect server and API key', async () => {
                await app.workbench.quickInput.selectQuickInputElement(1, true);
                const apiKeyInputLocator = page.locator('div.monaco-inputbox input[type="password"]');
                await (0, _test_setup_1.expect)(apiKeyInputLocator).toBeVisible({ timeout: 30000 });
                await app.workbench.quickInput.type(app.workbench.positConnect.getConnectApiKey());
                await page.keyboard.press('Enter');
            });
            await _test_setup_1.test.step('Unique name for credential (Connect Server and API key)', async () => {
                await (0, _test_setup_1.expect)(app.code.driver.currentPage.getByText(`Successfully connected to ${connectServer}`)).toBeVisible({ timeout: 10000 });
                await app.workbench.quickInput.type('shiny-py-example');
                await page.keyboard.press('Enter');
            });
        }
        const outerFrame = page.frameLocator('iframe.webview.ready');
        const innerFrame = outerFrame.frameLocator('iframe#active-frame');
        await _test_setup_1.test.step('Add files to deployment file (after app.py) and save', async () => {
            await innerFrame.locator('.tree-item-container').filter({ hasText: 'shared.py' }).locator('.tree-item-checkbox .checkbox-control').click();
            await innerFrame.locator('.tree-item-container').filter({ hasText: 'styles.css' }).locator('.tree-item-checkbox .checkbox-control').click();
            await innerFrame.locator('.tree-item-container').filter({ hasText: 'tips.csv' }).locator('.tree-item-checkbox .checkbox-control').click();
        });
        const deployButton = innerFrame.locator('vscode-button[data-automation="deploy-button"] >>> button');
        await _test_setup_1.test.step('Expect Deploy Your Project button to appear', async () => {
            await (0, _test_setup_1.expect)(deployButton).toBeVisible();
        });
        await hotKeys.minimizeBottomPanel();
        await _test_setup_1.test.step('Ensure toml file is ready for update - flake workaround', async () => {
            await (0, _test_setup_1.expect)(async () => {
                try {
                    // is tips.csv in the toml file?
                    const editorContainer = app.code.driver.currentPage.locator('[id="workbench.parts.editor"]');
                    const dynamicTomlLineRegex = 'tips.csv';
                    const targetLine = editorContainer.locator('.view-line').filter({ hasText: dynamicTomlLineRegex });
                    await (0, _test_setup_1.expect)(targetLine).toBeVisible({ timeout: 10000 });
                }
                catch (e) {
                    // reload the toml file
                    const filenames = await app.workbench.editor.getMonacoFilenames();
                    await hotKeys.closeAllEditors();
                    const file = `workspaces/shiny-py-example/.posit/publish/${filenames.find(f => f.startsWith('shiny-py-example'))}`;
                    console.log(`Retrying to open file ${file} in editor`);
                    await openFile(file);
                    await hotKeys.stackedLayout();
                    await hotKeys.minimizeBottomPanel();
                    await hotKeys.publishDocument();
                    throw e;
                }
            }).toPass({ timeout: 60000 });
        });
        await _test_setup_1.test.step('Update toml file', async () => {
            await app.workbench.positConnect.setPythonVersion(pythonVersion);
            await hotKeys.save();
            await (0, _test_setup_1.expect)(app.workbench.topActionBar.saveAllButton).not.toBeEnabled({ timeout: 10000 });
        });
        let appGuid;
        await _test_setup_1.test.step('Deploy, await completion and get appGuid', async () => {
            await deployButton.click({ timeout: 5000 });
            await (0, _test_setup_1.expect)(app.code.driver.currentPage.locator('text=Deployment was successful').first()).toBeVisible({ timeout: 200000 });
            await hotKeys.closeSecondarySidebar();
            await hotKeys.restoreBottomPanel();
            await app.code.driver.currentPage.locator('.monaco-action-bar .action-label', { hasText: 'Publisher' }).click({ timeout: 60000 });
            const deployedLocator = app.code.driver.currentPage.locator('.monaco-tl-row .monaco-highlighted-label', { hasText: 'Successfully deployed at' });
            const deploymentText = await deployedLocator.textContent();
            appGuid = extractGuid(deploymentText || '');
        });
        await _test_setup_1.test.step('Grant permission to connect user', async () => {
            const payload = {
                principal_guid: userId,
                principal_type: 'user',
                role: 'viewer',
            };
            await app.workbench.positConnect.setContentPermission(appGuid, payload);
        });
        await _test_setup_1.test.step('Ensure connect user can access content', async () => {
            await app.code.driver.currentPage.goto('http://localhost:3939');
            await app.code.driver.currentPage.locator('[data-automation="signin"]').click();
            await app.code.driver.currentPage.fill('input[name="username"]', 'user1');
            await app.code.driver.currentPage.fill('input[name="password"]', process.env.POSIT_WORKBENCH_PASSWORD);
            await app.code.driver.currentPage.locator('[data-automation="login-panel-submit"]').click();
            await app.code.driver.currentPage.locator('[data-automation="content-table__row__display-name"]').first().click();
            const headerLocator = app.code.driver.currentPage.frameLocator('#contentIFrame').locator('h1');
            await (0, _test_setup_1.expect)(headerLocator).toHaveText('Restaurant tipping', { timeout: 20000 });
        });
    });
});
function extractGuid(line) {
    const m = line.match(/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?!.*[0-9a-f-])/i);
    return m ? m[1] : null;
}
//# sourceMappingURL=publisher.test.js.map