"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const _test_setup_1 = require("../_test.setup");
_test_setup_1.test.use({
    suiteId: __filename
});
_test_setup_1.test.describe('Notebook Working Directory Configuration', {
    tag: [_test_setup_1.tags.WIN, _test_setup_1.tags.NOTEBOOKS]
    // Web tag removed: path resolution is browser-agnostic; Electron provides full coverage
}, () => {
    _test_setup_1.test.beforeAll(async function ({ hotKeys, python }) {
        await hotKeys.notebookLayout();
    });
    _test_setup_1.test.afterEach(async function ({ app }) {
        await app.workbench.notebooks.closeNotebookWithoutSaving();
    });
    const testCases = [
        {
            title: 'Default working directory is the notebook parent',
            workingDirectory: null, // null = use default (clear settings)
            expectedEnd: 'working-directory-notebook',
        },
        {
            title: 'fileDirname works',
            workingDirectory: '${fileDirname}',
            expectedEnd: 'working-directory-notebook',
        },
        {
            title: 'Paths that do not exist result in the default notebook parent',
            workingDirectory: '/does/not/exist',
            expectedEnd: 'working-directory-notebook',
        },
        {
            title: 'Bad variables result in the default notebook parent',
            workingDirectory: '${asdasd}',
            expectedEnd: 'working-directory-notebook',
        },
        {
            title: 'workspaceFolder works',
            workingDirectory: '${workspaceFolder}',
            expectedEnd: 'qa-example-content',
        },
    ];
    testCases.forEach(({ title, workingDirectory, expectedEnd }) => {
        (0, _test_setup_1.test)(title, async function ({ app, settings }) {
            workingDirectory === null
                ? await settings.clear()
                : await settings.set({ 'notebook.workingDirectory': workingDirectory }, { reload: 'web', waitMs: 1000 });
            await verifyWorkingDirectoryEndsWith(app.workbench.notebooks, expectedEnd);
        });
    });
    (0, _test_setup_1.test)('A hardcoded path works', async function ({ app, settings, python }) {
        // Make a temp dir
        const tempDir = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'notebook-test'));
        await settings.set({
            'notebook.workingDirectory': tempDir
        }, { reload: 'web' });
        await verifyWorkingDirectoryEndsWith(app.workbench.notebooks, path_1.default.basename(tempDir));
    });
});
async function verifyWorkingDirectoryEndsWith(notebooks, expectedEnd) {
    await notebooks.openNotebook('working-directory.ipynb');
    await notebooks.runAllCells({ timeout: 5000 });
    await notebooks.assertCellOutput(new RegExp(`^'.*${expectedEnd}'$`), 0, { timeout: 30000 });
}
//# sourceMappingURL=notebook-working-directory.test.js.map