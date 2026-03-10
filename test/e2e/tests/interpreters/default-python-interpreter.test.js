"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const _test_setup_1 = require("../_test.setup");
const default_interpreters_js_1 = require("./helpers/default-interpreters.js");
const include_excludes_js_1 = require("./helpers/include-excludes.js");
const path_1 = __importDefault(require("path"));
_test_setup_1.test.use({
    suiteId: __filename
});
// electron only for now - windows doesn't have hidden interpreters and for web the deletePositronHistoryFiles is not valid
_test_setup_1.test.describe('Default Interpreters - Python', {
    tag: [_test_setup_1.tags.INTERPRETER]
}, () => {
    _test_setup_1.test.beforeAll(async function ({ settings }) {
        await settings.set({ 'interpreters.startupBehavior': 'always' });
        await (0, default_interpreters_js_1.deletePositronHistoryFiles)();
        // Build environment-aware path for default interpreter
        // Note: CI uses hidden Python in /root/scratch, local uses pyenv version
        const pythonVersion = process.env.POSITRON_PY_VER_SEL || '3.10.12';
        const pythonPath = process.env.CI
            ? `${(0, include_excludes_js_1.buildPythonPath)('include')}/bin/python` // Hidden Python (POSITRON_HIDDEN_PY)
            : path_1.default.join(process.env.HOME || '', `.pyenv/versions/${pythonVersion}/bin/python`);
        // First reload: "Apply these settings"
        await settings.set({ 'python.defaultInterpreterPath': pythonPath }, { reload: true, waitForReady: true });
    });
    _test_setup_1.test.afterAll(async function ({ cleanup }) {
        await cleanup.discardAllChanges();
    });
    (0, _test_setup_1.test)('Python - Add a default interpreter (Conda)', async function ({ hotKeys, sessions }) {
        // Get version from appropriate env var (hidden Python in CI, regular in local)
        const pythonVersion = process.env.CI
            ? (process.env.POSITRON_HIDDEN_PY || '3.12.10').split(' ')[0] // Extract "3.12.10" from "3.12.10 (Conda)"
            : process.env.POSITRON_PY_VER_SEL || '3.10.12';
        // Match version with optional text after (e.g., "Python 3.12.10 (Conda)")
        const versionRegex = new RegExp(`Python ${pythonVersion.replace(/\./g, '\\.')}(\\s.*)?`);
        // Build environment-aware path regex
        const pathRegex = process.env.CI
            ? /python-env\/bin\/python/
            : new RegExp(`~?\\.pyenv/versions/${pythonVersion.replace(/\./g, '\\.')}/bin/python`);
        // Second reload: "Now actually start the interpreter with these settings"
        await hotKeys.reloadWindow(true);
        // Verify interpreter metadata
        const { name, path } = await sessions.getMetadata();
        (0, test_1.expect)(name).toMatch(versionRegex);
        (0, test_1.expect)(path).toMatch(pathRegex);
    });
});
//# sourceMappingURL=default-python-interpreter.test.js.map