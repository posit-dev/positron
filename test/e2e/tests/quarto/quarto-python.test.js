"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = require("path");
const _test_setup_1 = require("../_test.setup");
_test_setup_1.test.use({
    suiteId: __filename
});
// This test group aims to verify basic functionalities of Quarto for Python users
_test_setup_1.test.describe('Quarto - Python', { tag: [_test_setup_1.tags.WEB, _test_setup_1.tags.WIN, _test_setup_1.tags.QUARTO] }, () => {
    (0, _test_setup_1.test)('Verify Quarto app can render correctly with Python script', async function ({ app, openFile, python }, testInfo) {
        // This test verifies basic rendering of report in PDF after user clicks 'Preview'
        await openFile((0, path_1.join)('workspaces', 'quarto_python', 'report.qmd'));
        await app.code.driver.currentPage.locator('.positron-action-bar').getByRole('button', { name: 'Preview' }).click();
        // Viewer tab is targeted by corresponding iframe. It is assumed that the report fully loads once title 'Example Report' appears
        const title = app.workbench.viewer.getViewerFrame().frameLocator('iframe').getByText('Example Report');
        await (0, _test_setup_1.expect)(title).toBeVisible({ timeout: 120000 });
    });
});
//# sourceMappingURL=quarto-python.test.js.map