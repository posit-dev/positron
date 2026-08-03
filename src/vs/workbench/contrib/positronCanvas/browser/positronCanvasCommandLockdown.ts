/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyChord, KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { KeybindingsRegistry, KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { PositronCanvasModeActiveContext } from '../common/positronCanvasMode.js';

/**
 * The chords swallowed while Canvas mode is active resolve to this instead of
 * their commands. It exists so the keys are consumed rather than falling
 * through: an unbound key would reach whatever sits under the webview, and a
 * removal rule cannot carry a `when` clause, which would take these chords
 * away from the IDE too.
 */
// Deliberately outside the `positron.canvas.*` seam namespace: that prefix is
// pinned as the assistant-facing command surface, and this command is internal
// to the lockdown.
const SUPPRESSED_KEY_COMMAND = 'positronCanvasLockdown.suppressedKey';

/**
 * Keeps the IDE's command surface out of reach while Canvas mode is active.
 *
 * Canvas mode presents the assistant's Canvas as the whole product; the smoke
 * evidence in the pair workspace's canvas-smoke-findings.md shows each of
 * these chords escaping that surface (palette and quick open opening over
 * Canvas, new and opened editors revealing the hidden IDE window, new windows
 * duplicating Canvas). This is a deliberately narrow deny list of those
 * demonstrated escapes, gated on `PositronCanvasModeActiveContext`, rather
 * than a policy layer over all commands: outside Canvas mode every one of
 * these chords behaves exactly as before, and commands that cannot escape the
 * Canvas webview are not touched at all.
 *
 * The chords mirror the deny-listed commands' own default bindings, per
 * platform. A custom user binding for one of those commands is deliberately
 * respected: rebinding is an explicit instruction, and the native menu, the
 * other route to these commands, is trimmed separately while Canvas is
 * active (Menubar#install).
 *
 * The application-level escape this cannot cover -- files opened from a
 * second instance or the OS while Canvas is engaged -- is routed in the main
 * process instead (LaunchMainService).
 */
export function registerCanvasCommandLockdown(): void {
	CommandsRegistry.registerCommand(SUPPRESSED_KEY_COMMAND, () => { });

	// One entry per denied command, carrying that command's default chords.
	const suppressed: { denies: string; primary: number; secondary?: number[]; mac?: { primary: number; secondary?: number[] } }[] = [
		// workbench.action.showCommands (Positron already unbinds its F1
		// secondary in favor of Show Help at Cursor).
		{ denies: 'workbench.action.showCommands', primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyP },
		// workbench.action.quickOpen
		{
			denies: 'workbench.action.quickOpen',
			primary: KeyMod.CtrlCmd | KeyCode.KeyP,
			secondary: [KeyMod.CtrlCmd | KeyCode.KeyE],
			mac: { primary: KeyMod.CtrlCmd | KeyCode.KeyP, secondary: undefined }
		},
		// workbench.action.files.newUntitledFile
		{ denies: 'workbench.action.files.newUntitledFile', primary: KeyMod.CtrlCmd | KeyCode.KeyN },
		// workbench.action.newWindow
		{ denies: 'workbench.action.newWindow', primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyN },
		// workbench.action.files.openFile / openFolder (Windows, Linux) and
		// openFileFolder (macOS) share Ctrl/Cmd+O; openFolder adds a chord.
		{
			denies: 'workbench.action.files.openFile, openFolder, openFileFolder',
			primary: KeyMod.CtrlCmd | KeyCode.KeyO,
			secondary: [KeyChord(KeyMod.CtrlCmd | KeyCode.KeyK, KeyMod.CtrlCmd | KeyCode.KeyO)],
			mac: { primary: KeyMod.CtrlCmd | KeyCode.KeyO, secondary: undefined }
		}
	];

	for (const { denies: _denies, ...keybinding } of suppressed) {
		KeybindingsRegistry.registerKeybindingRule({
			...keybinding,
			id: SUPPRESSED_KEY_COMMAND,
			// Above the denied commands' own WorkbenchContrib-weight rules, so
			// this rule wins while its `when` holds without depending on
			// registration order.
			weight: KeybindingWeight.WorkbenchContrib + 50,
			when: PositronCanvasModeActiveContext
		});
	}
}
