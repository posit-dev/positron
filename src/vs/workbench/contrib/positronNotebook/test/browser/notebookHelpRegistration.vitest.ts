/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { CommandsRegistry } from '../../../../../platform/commands/common/commands.js';

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
});
