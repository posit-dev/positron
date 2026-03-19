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
_test_setup_1.test.describe('Autocomplete', {
    tag: [_test_setup_1.tags.WEB, _test_setup_1.tags.WIN, _test_setup_1.tags.CONSOLE, _test_setup_1.tags.SESSIONS, _test_setup_1.tags.EDITOR]
}, () => {
    _test_setup_1.test.afterEach(async function ({ hotKeys }) {
        await hotKeys.closeAllEditors();
    });
    (0, _test_setup_1.test)('Python - Verify autocomplete suggestions in Console and Editor', async function ({ app, runCommand, sessions, hotKeys }) {
        const { editors, console } = app.workbench;
        const [pySession1, pySession2, pyAltSession] = await sessions.start(['python', 'python', 'pythonAlt']);
        await hotKeys.closeSecondarySidebar();
        // Session 1 - trigger and verify console autocomplete
        await sessions.select(pySession1.id);
        await triggerAutocompleteInConsole(app, pySession1);
        await console.expectSuggestionListCount(1);
        // Session 2 - trigger and verify console autocomplete
        await sessions.select(pySession2.id);
        await triggerAutocompleteInConsole(app, pySession2);
        await console.expectSuggestionListCount(1);
        // Alt Session 1 - trigger and verify no console autocomplete
        await sessions.select(pyAltSession.id);
        await console.typeToConsole('pd.DataF', false, 250);
        await console.expectSuggestionListCount(0);
        // Open a new Python file
        await runCommand('Python: New Python File');
        // Session 1 - trigger and verify editor autocomplete
        await triggerFirstAutocompleteInEditor({ app, session: pySession1, expectedCount: 1 });
        // Session 2 - retrigger and verify editor autocomplete
        await triggerAutocompleteInEditor({ app, session: pySession2, retrigger: true });
        await editors.expectSuggestionListCount(1);
        // Alt Session 1 - retrigger and verify no editor autocomplete
        await triggerAutocompleteInEditor({ app, session: pyAltSession, retrigger: true });
        await editors.expectSuggestionListCount(0);
    });
    (0, _test_setup_1.test)('Python - Verify autocomplete suggestions (LSP is alive) after restart', async function ({ app, hotKeys, sessions }) {
        const { console } = app.workbench;
        const [pySession, pyAltSession] = await sessions.start(['python', 'pythonAlt']);
        await hotKeys.closeSecondarySidebar();
        // Session 1 - verify console autocomplete
        await sessions.select(pySession.id);
        await console.clearInput();
        await console.typeToConsole('import os', true, 0);
        await console.typeToConsole('os.path.', false, 250);
        await console.expectSuggestionListToContain('abspath, def abspath(path)');
        // Session 2 - verify console autocomplete
        await sessions.select(pyAltSession.id);
        await console.clearInput();
        await console.typeToConsole('import os', true, 0);
        await console.typeToConsole('os.path.', false, 250);
        await console.expectSuggestionListToContain('abspath, def abspath(path)');
        await console.clearInput();
        // Session 1 - restart and verify console autocomplete
        await sessions.restart(pySession.id);
        await console.clearInput();
        await console.typeToConsole('import os', true, 0);
        await console.expectSuggestionListToContain('abspath, def abspath(path)');
        // Session 2 - verify console autocomplete
        await sessions.select(pyAltSession.id);
        await console.clearInput();
        await console.expectSuggestionListToContain('abspath, def abspath(path)');
    });
    (0, _test_setup_1.test)('R - Verify autocomplete suggestions in Console and Editor', {
        tag: [_test_setup_1.tags.ARK]
    }, async function ({ app, runCommand, sessions, hotKeys }) {
        const { editors, console } = app.workbench;
        const [rSession1, rSession2, rSessionAlt] = await sessions.start(['r', 'r', 'rAlt']);
        await hotKeys.closeSecondarySidebar();
        // Session 1 - verify console autocomplete
        await sessions.select(rSession1.id);
        await triggerAutocompleteInConsole(app, rSession1);
        await console.expectSuggestionListCount(4);
        // Session 2 - verify console autocomplete
        await sessions.select(rSession2.id);
        await triggerAutocompleteInConsole(app, rSession2);
        await console.expectSuggestionListCount(4);
        // Alt Session 1 - verify no console autocomplete
        await sessions.select(rSessionAlt.id);
        await console.typeToConsole('read_p', false, 250);
        await console.expectSuggestionListCount(0);
        // Open a new R file
        await runCommand('R: New R File');
        // Session 1 - trigger and verify editor autocomplete
        await triggerFirstAutocompleteInEditor({ app, session: rSession1, expectedCount: 4 });
        // Session 2 - retrigger and verify editor autocomplete
        await triggerAutocompleteInEditor({ app, session: rSession2, retrigger: true });
        await editors.expectSuggestionListCount(4);
        // Alt Session 1 - retrigger verify no editor autocomplete
        await triggerAutocompleteInEditor({ app, session: rSessionAlt, retrigger: true });
        await editors.expectSuggestionListCount(0);
    });
    (0, _test_setup_1.test)('R - Verify autocomplete suggestions (LSP is alive) after restart', {
        tag: [_test_setup_1.tags.ARK, _test_setup_1.tags.SOFT_FAIL]
    }, async function ({ app, sessions, hotKeys }) {
        const { console } = app.workbench;
        const [rSession, rSessionAlt] = await sessions.start(['r', 'rAlt']);
        await hotKeys.closeSecondarySidebar();
        // Session 1 - verify console autocomplete
        await sessions.select(rSession.id);
        await console.typeToConsole('base::abb');
        await console.expectSuggestionListToContain('abbreviate, {base}');
        // Session 2 - verify console autocomplete
        await sessions.select(rSessionAlt.id);
        await console.typeToConsole('base::abb');
        await console.expectSuggestionListToContain('abbreviate, {base}');
        // Session 1 - restart and verify console autocomplete
        await sessions.restart(rSession.id);
        await console.clearInput();
        await console.typeToConsole('base::abb');
        await console.expectSuggestionListToContain('abbreviate, {base}');
        // Session 2 - verify console autocomplete
        await sessions.select(rSessionAlt.id);
        await console.clearInput();
        await console.typeToConsole('base::abb');
        await console.expectSuggestionListToContain('abbreviate, {base}');
    });
});
// Helper functions
async function triggerAutocompleteInConsole(app, session) {
    const { console, sessions } = app.workbench;
    if (session.name.includes('Python')) {
        await console.typeToConsole('import pandas as pd', true, 0);
        await sessions.expectAllSessionsToBeReady();
        await console.typeToConsole('pd.DataF', false, 250);
    }
    else {
        await console.typeToConsole('library(arrow)', true, 0);
        await sessions.expectAllSessionsToBeReady();
        await console.typeToConsole('read_p', false, 250);
    }
}
async function triggerAutocompleteInEditor({ app, session, retrigger = false }) {
    const { sessions, hotKeys } = app.workbench;
    const keyboard = app.code.driver.currentPage.keyboard;
    await sessions.select(session.id);
    await hotKeys.firstTab();
    // Wait for the editor to actually have focus before typing
    const editorInput = app.code.driver.currentPage.locator('.editor-instance .monaco-editor .native-edit-context');
    await (0, test_1.expect)(editorInput).toBeFocused();
    if (retrigger) {
        const triggerText = session.name.includes('Python') ? 'pd.DataF' : 'read_p';
        for (let i = 0; i < triggerText.length; i++) {
            await keyboard.press('Backspace', { delay: 250 });
        }
        await keyboard.type(triggerText);
    }
    else {
        await keyboard.type(session.name.includes('Python') ? 'pd.DataF' : 'read_p', { delay: 250 });
    }
}
/**
 * Triggers autocomplete in a newly opened editor file, retrying if the
 * didOpen/didChange race causes the language server to miss the typed text.
 * Each attempt clears the editor and retypes the trigger text.
 */
async function triggerFirstAutocompleteInEditor({ app, session, expectedCount }) {
    const { sessions, hotKeys, editors } = app.workbench;
    const keyboard = app.code.driver.currentPage.keyboard;
    const triggerText = session.name.includes('Python') ? 'pd.DataF' : 'read_p';
    // Select session and wait for editor focus once, before the retry loop
    await sessions.select(session.id);
    await hotKeys.firstTab();
    const editorInput = app.code.driver.currentPage.locator('.editor-instance .monaco-editor .native-edit-context');
    await (0, test_1.expect)(editorInput).toBeFocused();
    await (0, test_1.expect)(async () => {
        // Clear any previous attempt (Select All + Delete), no-op on empty file
        await hotKeys.selectAll();
        await keyboard.press('Delete');
        // Dismiss any stale suggestion widget
        await keyboard.press('Escape');
        // Type the trigger text
        await keyboard.type(triggerText, { delay: 250 });
        // Check for suggestions with a reduced timeout so failed attempts
        // don't burn the full 15s default
        await (0, test_1.expect)(editors.suggestionList).toHaveCount(expectedCount, { timeout: 5_000 });
    }).toPass({ timeout: 30_000 });
}
//# sourceMappingURL=autocomplete.test.js.map