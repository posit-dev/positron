"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const assert_1 = require("assert");
const _test_setup_1 = require("../_test.setup");
const include_excludes_js_1 = require("./helpers/include-excludes.js");
_test_setup_1.test.use({
    suiteId: __filename
});
_test_setup_1.test.describe('Interpreter: Includes', {
    tag: [_test_setup_1.tags.INTERPRETER, _test_setup_1.tags.WEB]
}, () => {
    _test_setup_1.test.beforeAll(async function ({ settings }) {
        await settings.set({
            'python.interpreters.include': [(0, include_excludes_js_1.buildPythonPath)('include')],
            'positron.r.customRootFolders': [(0, include_excludes_js_1.buildRPath)('customRoot')]
        }, { reload: true, waitForReady: true });
    });
    (0, _test_setup_1.test)('Python - Can Include an Interpreter', async function ({ sessions }) {
        const hiddenPython = process.env.POSITRON_HIDDEN_PY;
        hiddenPython
            ? await sessions.start('pythonHidden')
            : (0, assert_1.fail)('Hidden Python version not set');
    });
    (0, _test_setup_1.test)('R - Can Include an Interpreter', { tag: [_test_setup_1.tags.ARK] }, async function ({ sessions }) {
        const hiddenR = process.env.POSITRON_HIDDEN_R;
        hiddenR
            ? await sessions.start('rHidden')
            : (0, assert_1.fail)('Hidden R version not set');
    });
});
_test_setup_1.test.describe('Interpreter: Excludes', {
    tag: [_test_setup_1.tags.INTERPRETER, _test_setup_1.tags.WEB]
}, () => {
    let excludedRPath;
    let excludedPythonPath;
    _test_setup_1.test.beforeAll(async function ({ settings }) {
        excludedRPath = (0, include_excludes_js_1.buildRPath)('exclude');
        excludedPythonPath = (0, include_excludes_js_1.buildPythonPath)('exclude');
        await settings.set({
            'python.interpreters.exclude': [excludedPythonPath],
            'positron.r.interpreters.exclude': [excludedRPath]
        }, { reload: true, waitForReady: true });
    });
    (0, _test_setup_1.test)('R - Can Exclude an Interpreter', { tag: [_test_setup_1.tags.ARK] }, async function ({ sessions }) {
        await (0, include_excludes_js_1.expectSessionStartToFail)(sessions, 'rAlt', excludedRPath);
    });
    (0, _test_setup_1.test)('Python - Can Exclude an Interpreter', async function ({ sessions }) {
        await (0, include_excludes_js_1.expectSessionStartToFail)(sessions, 'pythonAlt', excludedPythonPath);
    });
});
_test_setup_1.test.describe('Interpreter: Override', {
    tag: [_test_setup_1.tags.INTERPRETER, _test_setup_1.tags.WEB]
}, () => {
    let overrideRPath;
    let overridePythonPath;
    _test_setup_1.test.beforeAll(async function ({ settings }) {
        overridePythonPath = (0, include_excludes_js_1.buildPythonPath)('override');
        overrideRPath = (0, include_excludes_js_1.buildRPath)('override');
        await settings.set({
            'python.interpreters.override': [overridePythonPath],
            'positron.r.interpreters.override': [overrideRPath]
        }, { reload: true, waitForReady: true });
    });
    (0, _test_setup_1.test)('R - Can Override Interpreter Discovery', { tag: [_test_setup_1.tags.ARK] }, async function ({ sessions }) {
        await (0, include_excludes_js_1.expectSessionStartToFail)(sessions, 'r', overrideRPath);
    });
    (0, _test_setup_1.test)('Python - Can Override Interpreter Discovery', async function ({ sessions }) {
        await (0, include_excludes_js_1.expectSessionStartToFail)(sessions, 'python', overridePythonPath);
    });
});
//# sourceMappingURL=includes-excludes.test.js.map