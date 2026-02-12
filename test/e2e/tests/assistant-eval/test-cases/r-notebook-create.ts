/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { TestTags } from '../../../infra';
import { EvalTestCase } from '../types';

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

export const rNotebookCreate: EvalTestCase = {
	id: 'r-notebook-create',
	description: 'Ensure createNotebook tool is used to create new notebooks',
	prompt,
	mode,
	tags: [TestTags.POSITRON_NOTEBOOKS, TestTags.ARK],

	run: async ({ app, sessions, hotKeys, cleanup, settings }) => {
		const { assistant, notebooksPositron, console } = app.workbench;

		// Enable Positron notebooks
		await notebooksPositron.enablePositronNotebooks(settings);

		// Start R session (needed for the R kernel to be available)
		const [rSession] = await sessions.start(['r']);

		// Close all editors to start fresh
		await hotKeys.closeAllEditors();

		// Ask the question
		await assistant.clickNewChatButton();
		await assistant.selectChatMode(mode);
		await assistant.enterChatMessage(prompt, false);

		// Handle allow button
		await assistant.clickAllowButton();
		await assistant.waitForResponseComplete();

		const response = await assistant.getChatResponseText(app.workspacePathOrFolder);

		// Cleanup
		await hotKeys.closeAllEditors();
		await console.focus();
		await sessions.restart(rSession.id);
		await cleanup.discardAllChanges();

		return response;
	},

	evaluationCriteria: {
		essential: [
			'The `createNotebook` tool must appear in the "Tools Called:" section',
			'Creates an R notebook (not Python)',
		],
		additional: [
			'Confirms the notebook was created',
			'Offers to help add content or explains next steps',
			'Does not create a Python notebook when R was requested',
		],
	},
};
