"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const _test_setup_1 = require("../_test.setup");
_test_setup_1.test.use({
    suiteId: __filename
});
const workspace = process.env.DATABRICKS_WORKSPACE || 'workspace';
const pat = process.env.DATABRICKS_PAT || 'dummypat';
_test_setup_1.test.describe('Catalog Explorer', {
    tag: [_test_setup_1.tags.CATALOG_EXPLORER, _test_setup_1.tags.WEB, _test_setup_1.tags.WIN],
}, () => {
    _test_setup_1.test.beforeAll(async function ({ app, settings }) {
        await settings.set({
            'catalogExplorer.enabled': true
        });
        await app.restart();
    });
    (0, _test_setup_1.test)('Verify Basic Databricks Catalog Explorer functionality', async function ({ app, python }) {
        await app.code.driver.currentPage.getByRole('button', { name: 'Catalog Explorer Section' }).click();
        await app.code.driver.currentPage.getByText('Configure a Catalog Provider').click();
        await app.workbench.quickInput.waitForQuickInputOpened();
        await app.workbench.quickInput.type('Databricks');
        await app.workbench.quickInput.selectQuickInputElement(0, true);
        await app.workbench.quickInput.type(workspace);
        await app.code.driver.currentPage.keyboard.press('Enter');
        await app.workbench.quickInput.type(pat);
        await app.code.driver.currentPage.keyboard.press('Enter');
        await (0, test_1.expect)(app.code.driver.currentPage.locator('.label-name').filter({ hasText: 'main' })).toBeVisible();
        await (0, test_1.expect)(app.code.driver.currentPage.locator('.label-name').filter({ hasText: 'samples' })).toBeVisible();
        await (0, test_1.expect)(app.code.driver.currentPage.locator('.label-name').filter({ hasText: 'system' })).toBeVisible();
        await (0, test_1.expect)(app.code.driver.currentPage.locator('.label-name').filter({ hasText: 'workshops' })).toBeVisible();
        // cannot see dialog that doubles checks if removal is wanted in e2e tests
        // await app.code.driver.currentPage.getByText(workspace.replace('https://','')).hover();
        // await app.code.driver.currentPage.locator('.action-label[aria-label*="Remove Catalog Provider"]').click();
    });
});
//# sourceMappingURL=catalog-explorer.test.js.map