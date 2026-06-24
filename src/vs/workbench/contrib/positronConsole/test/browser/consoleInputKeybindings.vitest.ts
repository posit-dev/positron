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

// The input-history navigation actions that carry default keybindings.
const NAV_COMMAND_IDS = [
	'workbench.action.positronConsole.navigateInputHistoryDown',
	'workbench.action.positronConsole.navigateInputHistoryUp',
	'workbench.action.positronConsole.navigateInputHistoryUpUsingPrefixMatch',
	'workbench.action.positronConsole.engageHistoryInfixSearch',
];

// The editor commands the console rebinds for its input (Home / End / Ctrl+U).
// These reuse existing editor command ids via registerKeybindingRule rather than
// dedicated console actions, so they are checked separately from the nav actions.
const EDITOR_COMMAND_IDS = [
	'cursorLineStart',
	'cursorLineEnd',
	'deleteAllLeft',
];

// '-'-prefixed command ids the console registers to strip leaked upstream
// bindings. interactive.history.focus is the interactive window's Cmd+Up "Focus
// History" binding, which Positron removes because that command is unreachable
// here and the binding otherwise misleads the Keyboard Shortcuts UI (#7380).
const REMOVED_COMMAND_IDS = [
	'-interactive.history.focus',
];

/**
 * Resolve, for a given OS, the set of dispatch chords bound to each of the given
 * commands. `getDefaultKeybindingsForOS` re-applies the mac/linux/win platform
 * overrides from the raw rules, so this works regardless of the host the test
 * runs on. Returns a `{ commandId: sortedDispatchChords }` map.
 */
function bindingsForOS(commandIds: string[], os: OperatingSystem): Record<string, string[]> {
	const result: Record<string, string[]> = {};
	for (const item of KeybindingsRegistry.getDefaultKeybindingsForOS(os)) {
		if (!item.command || !commandIds.includes(item.command) || !item.keybinding) {
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

describe('Console input keybindings', () => {
	// On macOS the arrow keys MUST stay bound alongside the readline Ctrl+N /
	// Ctrl+P bindings. This snapshot is the regression guard for that:
	// Ctrl+N / Ctrl+P appear in addition to, never instead of, Up/Down.
	it('binds Up/Down on macOS alongside the readline Ctrl+N / Ctrl+P bindings', () => {
		expect(bindingsForOS(NAV_COMMAND_IDS, OperatingSystem.Macintosh)).toMatchInlineSnapshot(`
			{
			  "workbench.action.positronConsole.engageHistoryInfixSearch": [
			    "ctrl+R",
			  ],
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

	// On Windows/Linux the readline Ctrl+N / Ctrl+P bindings must NOT apply: raw
	// Ctrl+N opens a new window and Ctrl+P opens the Command Palette. Only the
	// arrows (plus Ctrl+Up for prefix match and Ctrl+R for reverse search, which
	// are platform-independent) are bound here.
	it('binds only the arrows on Linux/Windows, never Ctrl+N / Ctrl+P', () => {
		expect(bindingsForOS(NAV_COMMAND_IDS, OperatingSystem.Linux)).toMatchInlineSnapshot(`
			{
			  "workbench.action.positronConsole.engageHistoryInfixSearch": [
			    "ctrl+R",
			  ],
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
		expect(bindingsForOS(NAV_COMMAND_IDS, OperatingSystem.Windows)).toMatchInlineSnapshot(`
			{
			  "workbench.action.positronConsole.engageHistoryInfixSearch": [
			    "ctrl+R",
			  ],
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

	// Home / End / Ctrl+U rebind existing editor commands for the console input.
	// Home and End are platform-independent; Ctrl+U uses the same WinCtrl-on-mac
	// split as Ctrl+R so it resolves to raw Ctrl+U on every platform (the bug class
	// from PR 2 / PR 3 where a single `primary` resolves to meta+U on Win/Linux).
	it('binds Home / End / Ctrl+U to the console editor commands on every platform', () => {
		expect(bindingsForOS(EDITOR_COMMAND_IDS, OperatingSystem.Macintosh)).toMatchInlineSnapshot(`
			{
			  "cursorLineEnd": [
			    "End",
			  ],
			  "cursorLineStart": [
			    "Home",
			  ],
			  "deleteAllLeft": [
			    "ctrl+U",
			  ],
			}
		`);
		expect(bindingsForOS(EDITOR_COMMAND_IDS, OperatingSystem.Linux)).toMatchInlineSnapshot(`
			{
			  "cursorLineEnd": [
			    "End",
			  ],
			  "cursorLineStart": [
			    "Home",
			  ],
			  "deleteAllLeft": [
			    "ctrl+U",
			  ],
			}
		`);
		expect(bindingsForOS(EDITOR_COMMAND_IDS, OperatingSystem.Windows)).toMatchInlineSnapshot(`
			{
			  "cursorLineEnd": [
			    "End",
			  ],
			  "cursorLineStart": [
			    "Home",
			  ],
			  "deleteAllLeft": [
			    "ctrl+U",
			  ],
			}
		`);
	});

	// The console registers a '-interactive.history.focus' removal rule to strip the
	// interactive window's leaked Cmd+Up "Focus History" binding from the Keyboard
	// Shortcuts UI (#7380). The removal must target the same chord Cmd+Up resolves to
	// on each platform: meta+UpArrow on macOS, ctrl+UpArrow on Linux/Windows. (The
	// snapshot proves the removal rule is registered against the right chord; the
	// resolver's upstream-tested removal semantics do the actual stripping.)
	it('removes the leaked interactive.history.focus Cmd+Up binding on every platform', () => {
		expect(bindingsForOS(REMOVED_COMMAND_IDS, OperatingSystem.Macintosh)).toMatchInlineSnapshot(`
			{
			  "-interactive.history.focus": [
			    "meta+UpArrow",
			  ],
			}
		`);
		expect(bindingsForOS(REMOVED_COMMAND_IDS, OperatingSystem.Linux)).toMatchInlineSnapshot(`
			{
			  "-interactive.history.focus": [
			    "ctrl+UpArrow",
			  ],
			}
		`);
		expect(bindingsForOS(REMOVED_COMMAND_IDS, OperatingSystem.Windows)).toMatchInlineSnapshot(`
			{
			  "-interactive.history.focus": [
			    "ctrl+UpArrow",
			  ],
			}
		`);
	});
});
