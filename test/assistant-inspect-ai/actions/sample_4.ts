/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { SampleActions } from './types';

/**
 * Sample 4: Hallucination test for statistical results
 *
 * Tests that the LLM doesn't hallucinate statistical results of code
 * it didn't actually execute. Uses an animal dataset with physical characteristics.
 */
export const actions: SampleActions = {
	setup: async (ctx) => {
		await expect(async () => {
			await ctx.sessions.select(ctx.sessions.python.id);
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
			await ctx.app.workbench.console.executeCode('Python', polarsCode);
			await ctx.app.workbench.console.clearButton.click();
		}).toPass({ timeout: 5000 });
	},

	cleanup: async (ctx) => {
		// Explicitly focus console before restart to ensure UI is ready
		await ctx.app.workbench.console.focus();
		await ctx.sessions.restart(ctx.sessions.python.id, { clearConsole: false });
	},
};
