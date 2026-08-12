/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

// @vitest-environment node
// This test only reads files. Under the default happy-dom environment
// `import.meta.url` isn't a file: URL, so the manifest path can't be resolved.

import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { join } from '../../../../../base/common/path.js';

/**
 * The bundled Copilot extension comes straight from upstream, so every bump can
 * add new "Chat" commands. Positron hides them when AI is off by adding a
 * `commandPalette` entry gated on the `chatAiFeaturesEnabled` context key (set by
 * `ChatAgentService` from `chat.disableAIFeatures` and `ai.enabled`). That list is
 * maintained by hand and lives in the same file the merge replaces, so it drifts:
 * #14673 brought in two ungated commands that shipped visible with AI disabled.
 *
 * This is the fast check in front of the e2e coverage in
 * `test/e2e/tests/assistant/chat-command-palette-gating.test.ts`. It names the
 * offending command instead of reporting "a Chat: row was visible", and it doesn't
 * depend on runtime state, so it also catches commands whose other preconditions
 * (experiment flags, say) happen to be off in the e2e environment.
 */
describe('Copilot Chat command palette gating', () => {
	const extensionRoot = join(
		fileURLToPath(new URL('.', import.meta.url)),
		'../../../../../../../extensions/copilot'
	);
	const readJson = (file: string) => JSON.parse(fs.readFileSync(join(extensionRoot, file), 'utf8'));

	const manifest = readJson('package.json');
	const nls = readJson('package.nls.json');
	const chatCommands = manifest.contributes.commands.filter((c: { category?: string }) => c.category === 'Chat');

	// `when: "false"` hides a command from the palette outright, which is also fine.
	// The lookbehind rejects `!chatAiFeaturesEnabled`, which would invert the gate.
	const isGated = (when: string | undefined) => when === 'false' || /(?<!!)\bchatAiFeaturesEnabled\b/.test(when ?? '');

	// A command's title may be an %nls.key% reference; resolve it so a failure reads
	// as the palette row the user actually sees.
	const displayTitle = (title: string) => nls[title.replace(/^%|%$/g, '')] ?? title;

	it('gates every Chat command on chatAiFeaturesEnabled', () => {
		const paletteWhen = new Map<string, string | undefined>(
			manifest.contributes.menus.commandPalette.map((m: { command: string; when?: string }) => [m.command, m.when])
		);

		const ungated = chatCommands
			.filter((c: { command: string }) => !isGated(paletteWhen.get(c.command)))
			.map((c: { command: string; title: string }) => `${c.command} ("Chat: ${displayTitle(c.title)}")`);

		expect(ungated).toEqual([]);
	});

	// Without this, renaming the category upstream would leave the test above
	// passing over an empty list while every Chat command quietly went ungated.
	it('still finds Chat commands to check', () => {
		expect(chatCommands.length).toBeGreaterThan(0);
	});
});
