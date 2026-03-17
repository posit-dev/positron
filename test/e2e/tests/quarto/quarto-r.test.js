"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const _test_setup_1 = require("../_test.setup");
const path_1 = require("path");
const path = require('path');
const fs = require('fs-extra');
_test_setup_1.test.use({
    suiteId: __filename
});
_test_setup_1.test.describe('Quarto - R', { tag: [_test_setup_1.tags.WEB, _test_setup_1.tags.WIN, _test_setup_1.tags.QUARTO, _test_setup_1.tags.ARK] }, () => {
    _test_setup_1.test.beforeAll(async function ({ openFile }) {
        await openFile(path.join('workspaces', 'quarto_basic', 'quarto_basic.qmd'));
    });
    _test_setup_1.test.afterEach(async function ({ hotKeys, cleanup }) {
        await hotKeys.killAllTerminals();
        await cleanup.removeTestFiles(['quarto_basic.pdf', 'quarto_basic.html', 'quarto_basic.docx']);
    });
    (0, _test_setup_1.test)('Verify Quarto can render html', { tag: [_test_setup_1.tags.WORKBENCH] }, async function ({ app, runDockerCommand }, testInfo) {
        await renderQuartoDocument(app, 'html');
        await expectFileToExist(app, testInfo, runDockerCommand, 'html');
    });
    (0, _test_setup_1.test)('Verify Quarto can render docx ', { tag: [_test_setup_1.tags.WORKBENCH] }, async function ({ app, runDockerCommand }, testInfo) {
        await renderQuartoDocument(app, 'docx');
        await expectFileToExist(app, testInfo, runDockerCommand, 'docx');
    });
    (0, _test_setup_1.test)('Verify Quarto can render pdf (LaTeX)', async function ({ app, runDockerCommand }, testInfo) {
        await (0, _test_setup_1.expect)(async () => {
            await renderQuartoDocument(app, 'pdf');
            await expectFileToExist(app, testInfo, runDockerCommand, 'pdf');
        }).toPass({ timeout: 60000 });
    });
    (0, _test_setup_1.test)('Verify Quarto can render pdf (typst)', { tag: [_test_setup_1.tags.WORKBENCH] }, async function ({ app, runDockerCommand }, testInfo) {
        await renderQuartoDocument(app, 'typst');
        await expectFileToExist(app, testInfo, runDockerCommand, 'pdf');
    });
    (0, _test_setup_1.test)('Verify Quarto can generate preview', async function ({ app }) {
        await app.code.driver.currentPage.getByRole('button', { name: 'Preview' }).click();
        const viewerFrame = app.workbench.viewer.getViewerFrame().frameLocator('iframe');
        // verify preview displays
        await (0, _test_setup_1.expect)(viewerFrame.locator('h1')).toHaveText('Diamond sizes', { timeout: 30000 });
    });
    (0, _test_setup_1.test)('Quarto Shiny App renders correctly', async ({ app, openFile }) => {
        await openFile((0, path_1.join)('workspaces', 'quarto_shiny', 'mini-app.qmd'));
        await app.code.driver.currentPage.getByRole('button', { name: 'Preview' }).click();
        await app.code.driver.currentPage
            .frameLocator('iframe[name]')
            .frameLocator('#active-frame')
            .frameLocator('iframe')
            .getByRole('heading', { name: 'Old Faithful' })
            .waitFor({ state: 'visible', timeout: 30000 });
    });
});
const renderQuartoDocument = async (app, fileExtension) => {
    await _test_setup_1.test.step(`render quarto document`, async () => {
        await app.workbench.quickaccess.runCommand('quarto.render.document', { keepOpen: true });
        await app.workbench.quickInput.selectQuickInputElementContaining(fileExtension);
    });
};
const expectFileToExist = async (app, testInfo, runDockerCommand, fileExtension) => {
    const dockerCommand = testInfo.project.name === 'e2e-workbench' ? runDockerCommand : undefined;
    await (0, _test_setup_1.expect)(async () => {
        (0, _test_setup_1.expect)(await fileExists(app, `quarto_basic.${fileExtension}`, dockerCommand)).toBe(true);
    }).toPass({ timeout: 20000 });
};
const fileExists = async (app, file, runDockerCommand) => {
    if (runDockerCommand) {
        // Check inside the container at the known workbench workspace path
        const containerPath = `/home/user1/qa-example-content/workspaces/quarto_basic/${file}`;
        try {
            const { stdout } = await runDockerCommand(`docker exec test bash -lc 'if test -f "${containerPath}"; then echo FOUND; else echo MISSING; fi'`, `Check existence of ${containerPath}`);
            return stdout.trim() === 'FOUND';
        }
        catch {
            return false;
        }
    }
    // Default: check local filesystem for non-workbench projects
    const filePath = path.join(app.workspacePathOrFolder, 'workspaces', 'quarto_basic', file);
    return fs.pathExists(filePath);
};
//# sourceMappingURL=quarto-r.test.js.map