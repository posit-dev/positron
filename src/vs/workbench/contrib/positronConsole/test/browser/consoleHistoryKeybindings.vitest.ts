/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { OperatingSystem } from '../../../../../base/common/platform.js';
import { KeybindingsRegistry } from '../../../../../platform/keybinding/common/keybindingsRegistry.js';
import { USLayoutResolvedKeybinding } from '../../../../../platform/keybinding/common/usLayoutResolvedKeybinding.js';
import { registerPositronConsoleActions } from '../../browser/positronConsoleActions.js';

// Register the console actions once so their default keybindings land in the
// KeybindingsRegistry. registerAction2 only records metadata, so this needs no
// workbench services. Mirrors the upstream chatQueueActions keybinding test.
registerPositronConsoleActions();

// The three input-history navigation actions that carry default keybindings.
const NAV_COMMAND_IDS = [
	'workbench.action.positronConsole.navigateInputHistoryDown',
	'workbench.action.positronConsole.navigateInputHistoryUp',
	'workbench.action.positronConsole.navigateInputHistoryUpUsingPrefixMatch',
];

/**
 * Resolve, for a given OS, the set of dispatch chords bound to each history-nav
 * command. `getDefaultKeybindingsForOS` re-applies the mac/linux/win platform
 * overrides from the raw rules, so this works regardless of the host the test
 * runs on. Returns a `{ commandId: sortedDispatchChords }` map.
 */
function navBindingsForOS(os: OperatingSystem): Record<string, string[]> {
	const result: Record<string, string[]> = {};
	for (const item of KeybindingsRegistry.getDefaultKeybindingsForOS(os)) {
		if (!item.command || !NAV_COMMAND_IDS.includes(item.command) || !item.keybinding) {
			continue;
		}
		const resolved = USLayoutResolvedKeybinding.resolveKeybinding(item.keybinding, os)[0];
		const dispatch = resolved.getDispatchChords().join(' ');
		(result[item.command] ??= []).push(dispatch);
	}
	for (const command of Object.keys(result)) {
		result[command].sort();
	}
	return result;
}

describe('Console input-history navigation keybindings', () => {
	// On macOS the arrow keys MUST stay bound alongside the readline Ctrl+N /
	// Ctrl+P bindings. This snapshot is the regression guard for that:
	// Ctrl+N / Ctrl+P appear in addition to, never instead of, Up/Down.
	it('binds Up/Down on macOS alongside the readline Ctrl+N / Ctrl+P bindings', () => {
		expect(navBindingsForOS(OperatingSystem.Macintosh)).toMatchInlineSnapshot(`
			{
			  "workbench.action.positronConsole.navigateInputHistoryDown": [
			    "DownArrow",
			    "ctrl+N",
			  ],
			  "workbench.action.positronConsole.navigateInputHistoryUp": [
			    "UpArrow",
			    "ctrl+P",
			  ],
			  "workbench.action.positronConsole.navigateInputHistoryUpUsingPrefixMatch": [
			    "meta+UpArrow",
			  ],
			}
		`);
	});

	// On Windows/Linux the readline bindings must NOT apply: raw Ctrl+N opens a
	// new window and Ctrl+P opens the Command Palette. Only the arrows (and
	// Ctrl+Up for prefix match) are bound here.
	it('binds only the arrows on Linux/Windows, never Ctrl+N / Ctrl+P', () => {
		expect(navBindingsForOS(OperatingSystem.Linux)).toMatchInlineSnapshot(`
			{
			  "workbench.action.positronConsole.navigateInputHistoryDown": [
			    "DownArrow",
			  ],
			  "workbench.action.positronConsole.navigateInputHistoryUp": [
			    "UpArrow",
			  ],
			  "workbench.action.positronConsole.navigateInputHistoryUpUsingPrefixMatch": [
			    "ctrl+UpArrow",
			  ],
			}
		`);
		expect(navBindingsForOS(OperatingSystem.Windows)).toMatchInlineSnapshot(`
			{
			  "workbench.action.positronConsole.navigateInputHistoryDown": [
			    "DownArrow",
			  ],
			  "workbench.action.positronConsole.navigateInputHistoryUp": [
			    "UpArrow",
			  ],
			  "workbench.action.positronConsole.navigateInputHistoryUpUsingPrefixMatch": [
			    "ctrl+UpArrow",
			  ],
			}
		`);
	});
});
