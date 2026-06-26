/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { KeybindingsRegistry, KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';

/**
 * Removes upstream keybindings that leak into Positron's Keyboard Shortcuts UI
 * for commands that Positron cannot actually run.
 *
 * The Keyboard Shortcuts editor lists every registered keybinding regardless of
 * its `when` clause or the command's `precondition`. So a command that is dead
 * in Positron (its precondition can never be satisfied) still shows its chord in
 * the UI, where it misleads users about what that key does. See
 * https://github.com/posit-dev/positron/issues/7380.
 *
 * The fix is a `'-'`-prefixed keybinding rule: VS Code's keybinding resolver
 * strips any default binding whose command matches a `-<commandId>` rule
 * (`KeybindingResolver.handleRemovals`), and `getKeybindings()` (which the
 * Shortcuts editor reads) returns the post-removal list. With no `when` clause a
 * removal targets every platform variant of the given chord, and the `'-'` rule
 * itself is dropped from the result, so it leaves no phantom entry.
 *
 * These removals are unconditional and permanent (unlike the opt-in RStudio
 * keymap in the sibling contribution), so they are registered once at module
 * load rather than tracked in a disposable store.
 */
export function registerPositronKeybindingRemovals(): void {
	// The upstream interactive window (editor id `workbench.editor.interactive`)
	// is opened only by the Jupyter extension's `jupyter.createnewinteractive`
	// command, which Positron does not ship. Its actions are gated on
	// `IS_COMPOSITE_NOTEBOOK` / `activeEditor == workbench.editor.interactive`,
	// contexts that are never true in Positron, so all of these bindings are dead
	// and only serve to clutter and mislead the Keyboard Shortcuts UI. Positron's
	// console owns the overlapping chords (arrows, Cmd+Up/Down, Enter) through its
	// own actions. See positronConsoleActions.ts.
	const removals: { id: string; primary: number; secondary?: number[]; mac?: { primary: number } }[] = [
		// Cmd+Up "Focus History" (the chord called out in #7380).
		{ id: '-interactive.history.focus', primary: KeyMod.CtrlCmd | KeyCode.UpArrow },
		// Up / Down history navigation.
		{ id: '-interactive.history.previous', primary: KeyCode.UpArrow },
		{ id: '-interactive.history.next', primary: KeyCode.DownArrow },
		// Scroll to top / bottom (Cmd+Up / Cmd+Down on macOS, Ctrl+Home / Ctrl+End elsewhere).
		{
			id: '-interactive.scrollToTop',
			primary: KeyMod.CtrlCmd | KeyCode.Home,
			mac: { primary: KeyMod.CtrlCmd | KeyCode.UpArrow },
		},
		{
			id: '-interactive.scrollToBottom',
			primary: KeyMod.CtrlCmd | KeyCode.End,
			mac: { primary: KeyMod.CtrlCmd | KeyCode.DownArrow },
		},
		// Execute (Ctrl/Cmd+Enter, Shift+Enter, Enter).
		{
			id: '-interactive.execute',
			primary: KeyMod.CtrlCmd | KeyCode.Enter,
			secondary: [KeyMod.Shift | KeyCode.Enter, KeyCode.Enter],
		},
	];

	for (const removal of removals) {
		KeybindingsRegistry.registerKeybindingRule({
			...removal,
			weight: KeybindingWeight.WorkbenchContrib,
		});
	}
}
