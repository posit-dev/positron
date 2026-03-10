"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = require("path");
const fs = __importStar(require("fs"));
const _test_setup_1 = require("../_test.setup");
_test_setup_1.test.use({
    suiteId: __filename
});
_test_setup_1.test.describe('Quarto - Inline Output: Popout', {
    tag: [_test_setup_1.tags.WEB, _test_setup_1.tags.WIN, _test_setup_1.tags.QUARTO]
}, () => {
    _test_setup_1.test.beforeAll(async function ({ python, settings }) {
        await settings.set({
            'positron.quarto.inlineOutput.enabled': true
        }, { reload: 'web' });
    });
    _test_setup_1.test.afterEach(async function ({ hotKeys }) {
        await hotKeys.closeAllEditors();
    });
    _test_setup_1.test.afterAll(async function ({ cleanup }) {
        await cleanup.discardAllChanges();
    });
    (0, _test_setup_1.test)('Python - Verify save button saves plot to file', async function ({ app, openFile, page }) {
        const { editors, inlineQuarto, quickInput, toasts } = app.workbench;
        // Set up a unique file name for the saved plot to avoid conflicts
        const savedPlotName = `test-plot-${Date.now()}.png`;
        const savedPlotPath = (0, path_1.join)(app.workspacePathOrFolder, savedPlotName);
        // Open a Quarto file and wait for the kernel to be ready
        await openFile((0, path_1.join)('workspaces', 'quarto_inline_output', 'simple_plot.qmd'));
        await editors.waitForActiveTab('simple_plot.qmd');
        await inlineQuarto.expectKernelStatusVisible();
        // Run the cell and wait for output
        await editors.clickTab('simple_plot.qmd');
        await inlineQuarto.runCellAndWaitForOutput({ cellLine: 12, outputLine: 25 });
        // Save the plot
        await inlineQuarto.gotoLine(19);
        await inlineQuarto.saveButton.click();
        await quickInput.waitForQuickInputOpened();
        await quickInput.type(savedPlotPath);
        await quickInput.clickOkButton();
        await toasts.expectToastWithTitle('.png saved');
        // Verify file was created
        (0, _test_setup_1.expect)(fs.existsSync(savedPlotPath)).toBe(true);
        const stats = fs.statSync(savedPlotPath);
        (0, _test_setup_1.expect)(stats.size).toBeGreaterThan(100);
        // Verify PNG magic bytes
        const fileBuffer = fs.readFileSync(savedPlotPath);
        (0, _test_setup_1.expect)(fileBuffer[0]).toBe(137);
        (0, _test_setup_1.expect)(fileBuffer[1]).toBe(80);
    });
    (0, _test_setup_1.test)('Python - Verify popout button appears for plot output and opens image in new tab', async function ({ app, openFile }) {
        const { editors, inlineQuarto } = app.workbench;
        // Open a Quarto file and wait for the kernel to be ready
        await openFile((0, path_1.join)('workspaces', 'quarto_inline_output', 'simple_plot.qmd'));
        await editors.waitForActiveTab('simple_plot.qmd');
        await inlineQuarto.expectKernelStatusVisible();
        // Run the cell and wait for output
        await editors.clickTab('simple_plot.qmd');
        await inlineQuarto.runCellAndWaitForOutput({ cellLine: 12, outputLine: 25 });
        await inlineQuarto.expectOutputVisible();
        // Verify new tab opens with image when popout button is clicked
        await inlineQuarto.gotoLine(19);
        await inlineQuarto.popoutOutput();
        await editors.verifyTab('simple_plot.qmd', { isVisible: true, isSelected: false });
        await editors.verifyTab('.positron-temp-simple_plot_cell0.png', { isVisible: true, isSelected: true });
    });
    (0, _test_setup_1.test)('Python - Verify popout command opens text output in new editor', async function ({ app, openFile }) {
        const { editors, inlineQuarto } = app.workbench;
        const tab1 = 'text_output.qmd';
        const tab2 = 'Hello World from Quarto inline output te';
        // Open a Quarto file and wait for the kernel to be ready
        await openFile((0, path_1.join)('workspaces', 'quarto_inline_output', 'text_output.qmd'));
        await editors.waitForActiveTab(tab1);
        await inlineQuarto.expectKernelStatusVisible();
        // Run the cell and wait for output
        await editors.clickTab(tab1);
        await inlineQuarto.runCellAndWaitForOutput({ cellLine: 13, outputLine: 20 });
        // Verify new tab opens with text output when popout command is run
        await inlineQuarto.gotoLine(13);
        await inlineQuarto.runPopoutCommand();
        await editors.verifyTab(tab1, { isVisible: true, isSelected: false });
        await editors.verifyTab(tab2, { isVisible: true, isSelected: true });
    });
    (0, _test_setup_1.test)('Python - Verify popout button is hidden for error-only output', async function ({ app, openFile }) {
        const { editors, inlineQuarto } = app.workbench;
        // Open a Quarto file and wait for the kernel to be ready
        await openFile((0, path_1.join)('workspaces', 'quarto_inline_output', 'r_errors.qmd'));
        await editors.waitForActiveTab('r_errors.qmd');
        await inlineQuarto.expectKernelStatusVisible();
        // Run the cell and wait for output
        await editors.clickTab('r_errors.qmd');
        await inlineQuarto.runCellAndWaitForOutput({ cellLine: 8, outputLine: 15 });
        // Verify error is visible and popout button is hidden
        await inlineQuarto.expectErrorCount(1);
        await (0, _test_setup_1.expect)(inlineQuarto.popoutButton).not.toBeVisible({ timeout: 5000 });
    });
    _test_setup_1.test.skip('Python - Verify popout button opens interactive HTML in viewer panel', {
        annotation: [{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/12373' }]
    }, async function ({ app, openFile }) {
        const { editors, inlineQuarto, viewer, toasts } = app.workbench;
        // Open a Quarto file and wait for the kernel to be ready
        await openFile((0, path_1.join)('workspaces', 'quarto_inline_output', 'interactive_plot.qmd'));
        await editors.waitForActiveTab('interactive_plot.qmd');
        await inlineQuarto.expectKernelStatusVisible();
        // Run the cell and wait for output
        await editors.clickTab('interactive_plot.qmd');
        await inlineQuarto.runCellAndWaitForOutput({ cellLine: 8, outputLine: 15 });
        await inlineQuarto.expectOutputVisible();
        // Run the popout command and verify viewer panel opens with interactive HTML
        await inlineQuarto.gotoLine(8);
        await inlineQuarto.runPopoutCommand();
        await viewer.expectViewerPanelVisible();
        await toasts.expectToastWithTitleNotToAppear('Failed to open');
    });
    (0, _test_setup_1.test)('Python - Verify Open Output in New Tab command works', async function ({ app, openFile }) {
        const { editors, inlineQuarto } = app.workbench;
        // Open a Quarto file and wait for the kernel to be ready
        await openFile((0, path_1.join)('workspaces', 'quarto_inline_output', 'simple_plot.qmd'));
        await editors.waitForActiveTab('simple_plot.qmd');
        await inlineQuarto.expectKernelStatusVisible();
        // Run the cell and wait for output
        await editors.clickTab('simple_plot.qmd');
        await inlineQuarto.runCellAndWaitForOutput({ cellLine: 12, outputLine: 25 });
        await inlineQuarto.expectOutputVisible();
        // Run the popout command and verify new tab opens with image
        await inlineQuarto.gotoLine(19);
        await inlineQuarto.runPopoutCommand();
        await editors.verifyTab('simple_plot.qmd', { isVisible: true, isSelected: false });
        await editors.verifyTab('.positron-temp-simple_plot_cell0.png', { isVisible: true, isSelected: true });
    });
    (0, _test_setup_1.test)('Python - Verify HTML popout displays DataFrame in viewer without errors', async function ({ app, openFile }) {
        const { editors, inlineQuarto, viewer, toasts } = app.workbench;
        // Open a Quarto file and wait for the kernel to be ready
        await openFile((0, path_1.join)('workspaces', 'quarto_inline_output', 'py_data_frame.qmd'));
        await editors.waitForActiveTab('py_data_frame.qmd');
        await inlineQuarto.expectKernelStatusVisible();
        // Run the cell and wait for output
        await editors.clickTab('py_data_frame.qmd');
        await inlineQuarto.runCellAndWaitForOutput({ cellLine: 8, outputLine: 15 });
        await inlineQuarto.expectOutputVisible();
        // Run the popout command and verify viewer panel opens with DataFrame HTML
        await inlineQuarto.popoutOutput();
        await viewer.expectViewerPanelVisible();
        // Verify DataFrame content in viewer
        const previewIframe = viewer.getViewerFrame().frameLocator('#preview-iframe');
        await (0, _test_setup_1.expect)(async () => {
            const body = previewIframe.locator('body');
            await (0, _test_setup_1.expect)(body).toBeAttached({ timeout: 2000 });
            const text = await body.textContent({ timeout: 2000 });
            (0, _test_setup_1.expect)(text).toContain('Alice');
        }).toPass({ timeout: 30000 });
        const body = previewIframe.locator('body');
        const bodyText = await body.textContent();
        (0, _test_setup_1.expect)(bodyText).not.toContain('Cannot GET');
        await toasts.expectToastWithTitleNotToAppear('Failed to open');
    });
});
//# sourceMappingURL=quarto-inline-output-popout.test.js.map