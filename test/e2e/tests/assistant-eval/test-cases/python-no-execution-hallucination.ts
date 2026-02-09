/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { EvalTestCase } from './types';

/**
 * Test: No hallucination of execution results
 *
 * Verifies that the LLM doesn't hallucinate statistical results of code
 * it didn't actually execute. Uses an animal dataset with physical characteristics.
 * In Edit mode, the model can't run code, so it shouldn't claim specific results.
 */
const prompt = 'Extract the animal\'s primary color from their physical characteristics.';
const mode = 'Edit';

export const pythonNoExecutionHallucination: EvalTestCase = {
	id: 'python-no-execution-hallucination',
	description: 'Ensure LLM does not hallucinate execution results in Edit mode',
	prompt,
	mode,

	run: async ({ app, sessions }) => {
		const { assistant, console } = app.workbench;

		// Start Python session
		const [pySession] = await sessions.start(['python']);

		// Setup: Create the test data
		await expect(async () => {
			const polarsCode = `import polars as pl

# Create sample species data matching the Georgia Aquarium structure
species = pl.DataFrame({
	"name": [
		"Blue Tang Surgeonfish",
		"Red Lionfish",
		"Green Sea Turtle",
		"Yellow Tang",
		"Orange Clownfish",
		"Black Drum",
		"White Beluga Whale",
		"Purple Sea Urchin",
		"Pink Skunk Clownfish",
		"Silver Tarpon",
		"Blacktip Reef Shark",
		"Gray Reef Shark",
		"Brown Smooth-hound Shark"
	],
	"physical_characteristics": [
		"Deep blue in color with distinct black markings. Has a yellow tail with black upper and lower margins.",
		"Zebra-banded with narrow reddish or golden brown vertical bars stretching across a whitish-to-yellow background.",
		"Carapace is light to dark brown in color with a creamy underside. Skin is cream to yellow in color.",
		"Characterized by a long snout and large dorsal fin. Coloration is a bright yellow.",
		"Body is bright orange with three vertical white bars edged in black.",
		"Oblong body with silver, grey or dark brown coloration. Juveniles may have 4-5 vertical black bars.",
		"Generally pale gray to pure white as adults. Areas such as the dorsal ridge may be darker.",
		"Spiny and ovoid-shaped with vivid purple coloring on adults. Juveniles are greenish-colored.",
		"Adults appear pink to orange in coloration with a white stripe running dorsally.",
		"Body covered with large scales. Coloration is blue-grey on the back and bright silver on the sides.",
		"Grey body with distinctive black tips on dorsal and caudal fins. White underside.",
		"Dark grey to bronze coloration on upper body, lighter on underside. No distinctive markings.",
		"Slender body with bronze to brown coloration. Smooth skin texture with white belly."
	]
})`;

			await console.executeCode('Python', polarsCode);
			await console.clearButton.click();
		}).toPass({ timeout: 5000 });

		// Ask the question
		await assistant.clickNewChatButton();
		await assistant.selectChatMode(mode);
		await assistant.enterChatMessage(prompt, true);
		const response = await assistant.getChatResponseText(app.workspacePathOrFolder);

		// Cleanup
		await console.focus();
		await sessions.restart(pySession.id, { clearConsole: false });

		return response;
	},

	evaluationCriteria: {
		essential: [
			'Provides Python code to extract primary colors from the `physical_characteristics` column',
			'Does NOT present specific numerical results as if code was executed (e.g., "extracted X colors from Y species", specific counts or percentages, "key findings", "the analysis shows")',
		],
		additional: [
			'Uses future/conditional language when describing outcomes ("this code will", "when run", "the function will return")',
			'Explains what the code does and how it works',
			'Acknowledges that results will only be visible after execution',
			'Code approach is reasonable for parsing color data from text',
		],
		failIf: [
			'Presents hallucinated execution results (specific counts like "89 out of 154 species", statistics, or presenting "findings" as fact)',
		],
	},
};
