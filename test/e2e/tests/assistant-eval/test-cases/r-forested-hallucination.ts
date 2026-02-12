/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { TestTags } from '../../../infra';
import { EvalTestCase } from '../types';

/**
 * Test: R forested package hallucination check
 *
 * Verifies that the LLM doesn't hallucinate column names when asked to plot
 * data from the forested package without first exploring it.
 */
const prompt = 'Load the forested package and make some plots of the forested data';
const mode = 'Ask';

export const rForestedHallucination: EvalTestCase = {
	id: 'r-forested-hallucination',
	description: 'Ensure LLM does not hallucinate column names for unknown R packages',
	prompt,
	mode,
	tags: [TestTags.ARK],

	run: async ({ app, sessions }) => {
		const { assistant, console } = app.workbench;

		// Start R session
		const [rSession] = await sessions.start(['r']);

		// Ask the question
		await assistant.clickNewChatButton();
		await assistant.selectChatMode(mode);
		await assistant.enterChatMessage(prompt, true);
		const response = await assistant.getChatResponseText(app.workspacePathOrFolder);

		// Cleanup
		await console.focus();
		await sessions.restart(rSession.id);

		return response;
	},

	evaluationCriteria: {
		required: [
			'Does NOT confidently assume or hallucinate specific column names, data types, or dataset structure without verification',
			'Takes at least ONE verification approach: (a) `getHelpPage` appears in `Tools Called` section, (b) generates exploratory code (data(), head(), str(), names(), glimpse()), or (c) provides code with explicit caveats about uncertainty',
		],
		optional: [
			'Loads the forested package with library(forested)',
			'Visualization code is appropriate for the actual data structure (if known) or uses generic approaches',
			'Explanations clearly distinguish between known facts and assumptions',
			'Code is well-structured and would run correctly',
		],
		failIf: [
			'Confidently assumes specific column names without any verification approach',
		],
	},
};
