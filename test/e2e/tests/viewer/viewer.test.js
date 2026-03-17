"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const _test_setup_1 = require("../_test.setup");
_test_setup_1.test.use({
    suiteId: __filename
});
_test_setup_1.test.describe('Viewer', { tag: [_test_setup_1.tags.VIEWER] }, () => {
    _test_setup_1.test.afterEach(async function ({ app }) {
        await app.workbench.viewer.clearViewer();
    });
    (0, _test_setup_1.test)('Python - Verify Viewer opens for WebBrowser calls', async function ({ app, python }) {
        const { console, viewer } = app.workbench;
        await console.executeCode('Python', pythonScript);
        await viewer.expectViewerPanelVisible();
        await viewer.expectUrlToHaveValue('http://127.0.0.1:8000/');
    });
    // note: this test is skipped on firefox - it fails
    (0, _test_setup_1.test)('Python - Verify Viewer displays great-tables', { tag: [_test_setup_1.tags.WEB, _test_setup_1.tags.CROSS_BROWSER] }, async function ({ app, python }) {
        const { console, viewer } = app.workbench;
        await console.executeCode('Python', pythonGreatTablesScript);
        await viewer.expectContentVisible(frame => frame.getByRole('cell', { name: 'apricot' }), { useIframe: false });
    });
    (0, _test_setup_1.test)('R - Verify Viewer displays modelsummary output', {
        tag: [_test_setup_1.tags.WEB, _test_setup_1.tags.ARK, _test_setup_1.tags.CROSS_BROWSER]
    }, async function ({ app, r }) {
        const { console, viewer } = app.workbench;
        await console.executeCode('R', rModelSummaryScript);
        // await viewer.expectContentVisible(frame => frame.getByRole('cell', { name: 'bill_depth_mm' }));
        await viewer.expectContentVisible(frame => frame.locator('tr').filter({ hasText: 'bill_depth_mm' }));
    });
    (0, _test_setup_1.test)('R - Verify Viewer displays reactable table output', {
        tag: [_test_setup_1.tags.WEB, _test_setup_1.tags.ARK, _test_setup_1.tags.CROSS_BROWSER]
    }, async function ({ app, r }) {
        const { console, viewer } = app.workbench;
        await console.executeCode('R', rReactableScript);
        await viewer.expectContentVisible(frame => frame.getByText('Datsun 710'));
    });
    (0, _test_setup_1.test)('R - Verify Viewer displays reprex code output', {
        tag: [_test_setup_1.tags.WEB, _test_setup_1.tags.ARK, _test_setup_1.tags.CROSS_BROWSER]
    }, async function ({ app, r }) {
        const { console, viewer } = app.workbench;
        await console.executeCode('R', rReprexScript);
        await viewer.expectContentVisible(frame => frame.getByText('rbinom'));
    });
});
const pythonScript = `import webbrowser
# will not have any content, but we just want to make sure
# the viewer will open when webbrowser calls are made
webbrowser.open('http://127.0.0.1:8000')`;
const pythonGreatTablesScript = `from great_tables import GT, exibble
GT(exibble)`;
const rModelSummaryScript = `library(palmerpenguins)
library(fixest)
library(modelsummary)
m1 = feols(body_mass_g ~ bill_depth_mm + bill_length_mm | species, data = penguins)
modelsummary(m1)`;
const rReactableScript = `library(reactable)
mtcars |> reactable::reactable()`;
const rReprexScript = `reprex::reprex(rbinom(3, size = 10, prob = 0.5), comment = "#;-)")`;
//# sourceMappingURL=viewer.test.js.map