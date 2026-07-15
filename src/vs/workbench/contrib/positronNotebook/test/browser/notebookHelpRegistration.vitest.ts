/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { CommandsRegistry } from '../../../../../platform/commands/common/commands.js';
import { IMenuItem, isIMenuItem, MenuId, MenuRegistry } from '../../../../../platform/actions/common/actions.js';

// Importing the contribution barrel runs its side-effect imports, which is what
// registers the notebook actions. The keyboard-shortcuts help action lives in
// its own file and is only wired up by the barrel's
// `import './contrib/help/NotebookHelpAction.js'`. That import was dropped in a
// merge once (#14365), silently killing the toolbar button, command, and
// keybinding while the action's own tests stayed green. This guards the wiring.
import '../../browser/positronNotebook.contribution.js';

describe('Positron notebook contribution registration', () => {
	it('registers the keyboard shortcuts help action', () => {
		expect(CommandsRegistry.getCommand('positronNotebook.showKeyboardShortcuts')).toBeDefined();
	});

	it('registers the show-commands action', () => {
		// showCommands has no toolbar button (it is reached from the Help modal
		// and the command palette), so a dropped registration leaves no visual
		// affordance to notice. Guard the command wiring.
		expect(CommandsRegistry.getCommand('positronNotebook.showCommands')).toBeDefined();
	});

	it('gates the run/stop all-cells palette entries on the running state', () => {
		// The notebook command picker (and the F1 palette) filter commands by each
		// command's CommandPalette `when`, which registerAction2 derives from the
		// action precondition. runAllCells / stopAllCells share a toolbar slot and
		// must flip with the running state; without a precondition they leaked into
		// the palette/picker regardless of run state, and selecting an out-of-state
		// "Stop Execution" ran all cells. Pin both palette `when`s.
		const paletteWhen = (id: string) => MenuRegistry
			.getMenuItems(MenuId.CommandPalette)
			.find((item): item is IMenuItem => isIMenuItem(item) && item.command.id === id)
			?.when?.serialize();

		expect({
			runAllCells: paletteWhen('positronNotebook.runAllCells'),
			stopAllCells: paletteWhen('positronNotebook.stopAllCells'),
		}).toMatchInlineSnapshot(`
			{
			  "runAllCells": "!notebookHasSomethingRunning && activeEditor == 'workbench.editor.positronNotebook'",
			  "stopAllCells": "notebookHasSomethingRunning && activeEditor == 'workbench.editor.positronNotebook'",
			}
		`);
	});
});
