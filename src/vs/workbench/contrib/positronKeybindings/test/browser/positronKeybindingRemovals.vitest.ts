/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { OperatingSystem } from '../../../../../base/common/platform.js';
import { KeybindingsRegistry } from '../../../../../platform/keybinding/common/keybindingsRegistry.js';
import { USLayoutResolvedKeybinding } from '../../../../../platform/keybinding/common/usLayoutResolvedKeybinding.js';
import { registerPositronKeybindingRemovals } from '../../browser/positronKeybindingRemovals.js';

// Register the removal rules once so they land in the KeybindingsRegistry.
// registerKeybindingRule only records metadata, so this needs no workbench
// services. Mirrors the console's consoleInputKeybindings keybinding test.
registerPositronKeybindingRemovals();

// The '-'-prefixed command ids whose leaked upstream bindings Positron strips
// from the Keyboard Shortcuts UI (#7380). All belong to the interactive window,
// which Positron does not surface.
const REMOVED_COMMAND_IDS = [
	'-interactive.history.focus',
	'-interactive.history.previous',
	'-interactive.history.next',
	'-interactive.scrollToTop',
	'-interactive.scrollToBottom',
	'-interactive.execute',
];

/**
 * Resolve, for a given OS, the set of dispatch chords each removal rule targets.
 * `getDefaultKeybindingsForOS` re-applies the mac/linux/win platform overrides
 * from the raw rules, so this works regardless of the host the test runs on.
 * Returns a `{ commandId: sortedDispatchChords }` map.
 */
function removalsForOS(os: OperatingSystem): Record<string, string[]> {
	const result: Record<string, string[]> = {};
	for (const item of KeybindingsRegistry.getDefaultKeybindingsForOS(os)) {
		if (!item.command || !REMOVED_COMMAND_IDS.includes(item.command) || !item.keybinding) {
			continue;
		}
		const resolved = USLayoutResolvedKeybinding.resolveKeybinding(item.keybinding, os)[0];
		(result[item.command] ??= []).push(resolved.getDispatchChords().join(' '));
	}
	for (const command of Object.keys(result)) {
		result[command].sort();
	}
	return result;
}

describe('Positron keybinding removals', () => {
	// Each removal must target the same chord(s) the upstream interactive-window
	// binding resolves to per platform, or the resolver will not strip it. The
	// snapshot doubles as documentation of what is being removed where. (It proves
	// the removal rules are registered against the right chords; the resolver's
	// upstream-tested removal semantics do the actual stripping.)
	it('targets the leaked interactive-window chords on macOS', () => {
		expect(removalsForOS(OperatingSystem.Macintosh)).toMatchInlineSnapshot(`
			{
			  "-interactive.execute": [
			    "Enter",
			    "meta+Enter",
			    "shift+Enter",
			  ],
			  "-interactive.history.focus": [
			    "meta+UpArrow",
			  ],
			  "-interactive.history.next": [
			    "DownArrow",
			  ],
			  "-interactive.history.previous": [
			    "UpArrow",
			  ],
			  "-interactive.scrollToBottom": [
			    "meta+DownArrow",
			  ],
			  "-interactive.scrollToTop": [
			    "meta+UpArrow",
			  ],
			}
		`);
	});

	it('targets the leaked interactive-window chords on Linux', () => {
		expect(removalsForOS(OperatingSystem.Linux)).toMatchInlineSnapshot(`
			{
			  "-interactive.execute": [
			    "Enter",
			    "ctrl+Enter",
			    "shift+Enter",
			  ],
			  "-interactive.history.focus": [
			    "ctrl+UpArrow",
			  ],
			  "-interactive.history.next": [
			    "DownArrow",
			  ],
			  "-interactive.history.previous": [
			    "UpArrow",
			  ],
			  "-interactive.scrollToBottom": [
			    "ctrl+End",
			  ],
			  "-interactive.scrollToTop": [
			    "ctrl+Home",
			  ],
			}
		`);
	});

	it('targets the leaked interactive-window chords on Windows', () => {
		expect(removalsForOS(OperatingSystem.Windows)).toMatchInlineSnapshot(`
			{
			  "-interactive.execute": [
			    "Enter",
			    "ctrl+Enter",
			    "shift+Enter",
			  ],
			  "-interactive.history.focus": [
			    "ctrl+UpArrow",
			  ],
			  "-interactive.history.next": [
			    "DownArrow",
			  ],
			  "-interactive.history.previous": [
			    "UpArrow",
			  ],
			  "-interactive.scrollToBottom": [
			    "ctrl+End",
			  ],
			  "-interactive.scrollToTop": [
			    "ctrl+Home",
			  ],
			}
		`);
	});
});
