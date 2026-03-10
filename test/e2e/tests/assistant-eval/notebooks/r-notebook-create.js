"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.rNotebookCreate = void 0;
const infra_1 = require("../../../infra");
/**
 * Test: createNotebook tool
 *
 * TOOL: createNotebook
 * SCENARIO: When asked to create a new notebook, the assistant should use
 *           createNotebook with the appropriate language (R or Python).
 *
 * This test starts with no notebooks open and asks the assistant to create
 * a new R notebook. The assistant MUST call createNotebook with R as the language.
 */
const prompt = 'Create a new R notebook for me.';
const mode = 'Edit';
exports.rNotebookCreate = {
    id: 'r-notebook-create',
    description: 'Ensure createNotebook tool is used to create new notebooks',
    prompt,
    mode,
    tags: [infra_1.TestTags.POSITRON_NOTEBOOKS],
    run: async ({ app, hotKeys, cleanup, settings }) => {
        const { assistant, notebooksPositron } = app.workbench;
        // Enable Positron notebooks
        await notebooksPositron.enablePositronNotebooks(settings);
        // Close all editors to start fresh
        await hotKeys.closeAllEditors();
        // Ask the question
        await assistant.clickNewChatButton();
        await assistant.selectChatMode(mode);
        const timing = await assistant.sendChatMessageAndWait(prompt);
        const response = await assistant.getChatResponseText(app.workspacePathOrFolder);
        // Cleanup
        await hotKeys.closeAllEditors();
        await cleanup.discardAllChanges();
        return { response, timing };
    },
    evaluationCriteria: {
        required: [
            'The `createNotebook` tool must appear in the "Tools Called:" section',
            'Creates an R notebook (not Python)',
        ],
        optional: [
            'Confirms the notebook was created',
            'Offers to help add content or explains next steps',
            'Does not create a Python notebook when R was requested',
        ],
    },
};
//# sourceMappingURL=r-notebook-create.js.map