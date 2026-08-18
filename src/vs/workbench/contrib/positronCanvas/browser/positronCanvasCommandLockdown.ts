/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyChord, KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { KeybindingsRegistry, KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { PositronCanvasModeActiveContext } from '../common/positronCanvasMode.js';

/**
 * Swallowed chords resolve to this no-op so the keys are consumed rather
 * than falling through (a removal rule cannot carry a `when` clause).
 * Internal, so outside the pinned `positron.canvas.*` seam namespace.
 */
const SUPPRESSED_KEY_COMMAND = 'positronCanvasLockdown.suppressedKey';

/**
 * Keeps the IDE's command surface out of reach while Canvas mode is active:
 * a narrow deny list of demonstrated escapes, not a policy layer over all
 * commands. The chords mirror the denied commands' default bindings; a
 * custom user binding is deliberately respected as an explicit instruction.
 * The native menu is trimmed separately (Menubar#install), and OS-level
 * opens are routed in the main process (LaunchMainService).
 */
export function registerCanvasCommandLockdown(): void {
	CommandsRegistry.registerCommand(SUPPRESSED_KEY_COMMAND, () => { });

	// One entry per denied command, carrying that command's default chords.
	const suppressed: { primary: number; secondary?: number[]; mac?: { primary: number; secondary?: number[] } }[] = [
		// workbench.action.showCommands (Positron already unbinds its F1
		// secondary in favor of Show Help at Cursor).
		{ primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyP },
		// workbench.action.quickOpen
		{
			primary: KeyMod.CtrlCmd | KeyCode.KeyP,
			secondary: [KeyMod.CtrlCmd | KeyCode.KeyE],
			mac: { primary: KeyMod.CtrlCmd | KeyCode.KeyP, secondary: undefined }
		},
		// workbench.action.files.newUntitledFile
		{ primary: KeyMod.CtrlCmd | KeyCode.KeyN },
		// workbench.action.newWindow
		{ primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyN },
		// workbench.action.files.openFile / openFolder (Windows, Linux) and
		// openFileFolder (macOS) share Ctrl/Cmd+O; openFolder adds a chord.
		{
			primary: KeyMod.CtrlCmd | KeyCode.KeyO,
			secondary: [KeyChord(KeyMod.CtrlCmd | KeyCode.KeyK, KeyMod.CtrlCmd | KeyCode.KeyO)],
			mac: { primary: KeyMod.CtrlCmd | KeyCode.KeyO, secondary: undefined }
		},
		// workbench.action.openRecent opens another folder in a new window
		// from the quick pick.
		{
			primary: KeyMod.CtrlCmd | KeyCode.KeyR,
			mac: { primary: KeyMod.WinCtrl | KeyCode.KeyR }
		}
	];

	for (const keybinding of suppressed) {
		KeybindingsRegistry.registerKeybindingRule({
			...keybinding,
			id: SUPPRESSED_KEY_COMMAND,
			// Above the denied commands' own WorkbenchContrib-weight rules,
			// independent of registration order.
			weight: KeybindingWeight.WorkbenchContrib + 50,
			when: PositronCanvasModeActiveContext
		});
	}
}
