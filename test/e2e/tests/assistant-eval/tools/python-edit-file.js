"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.pythonEditFile = void 0;
const test_1 = require("@playwright/test");
const path_1 = require("path");
/**
 * Test: positron_editFile_internal tool usage
 *
 * Verifies that the positron_editFile_internal tool is called when
 * editing a file in Edit mode.
 */
const prompt = 'Add a method to return today\'s date.';
const mode = 'Edit';
exports.pythonEditFile = {
    id: 'python-edit-file',
    description: 'Ensure editFile tool is called when editing files',
    prompt,
    mode,
    run: async ({ app, sessions, hotKeys, cleanup }) => {
        const { assistant, console, quickaccess } = app.workbench;
        // Start Python session
        const [pySession] = await sessions.start(['python']);
        // Setup: Open file
        await (0, test_1.expect)(async () => {
            await quickaccess.openFile((0, path_1.join)(app.workspacePathOrFolder, 'workspaces', 'chinook-db-py', 'chinook-sqlite.py'));
        }).toPass({ timeout: 5000 });
        // Ask the question
        await assistant.clickNewChatButton();
        await assistant.selectChatMode(mode);
        const timing = await assistant.sendChatMessageAndWait(prompt);
        // Get the response
        const response = await assistant.getChatResponseText(app.workspacePathOrFolder);
        // Cleanup
        await hotKeys.closeAllEditors();
        await console.focus();
        await sessions.restart(pySession.id);
        await cleanup.discardAllChanges();
        return { response, timing };
    },
    evaluationCriteria: {
        required: [
            'The `positron_editFile_internal` tool must appear in the "Tools Called:" section',
            'Code uses a valid Python date approach (datetime module or similar)',
        ],
        optional: [
            'Code is structured as a reusable method/function',
            'Method returns the date (not just prints it)',
            'Code includes appropriate imports (e.g., from datetime import date)',
        ],
    },
};
//# sourceMappingURL=python-edit-file.js.map