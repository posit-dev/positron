/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { isIMenuItem, MenuId, MenuRegistry } from '../../../../../platform/actions/common/actions.js';
import { CommandsRegistry } from '../../../../../platform/commands/common/commands.js';
import '../../electron-browser/positronCanvas.contribution.js';

/**
 * Pins Positron's public `positron.canvas.*` command surface. The cross-repo
 * subset is also documented in the assistant's `frontend-canvas/README.md`;
 * changing that subset requires changing both documents together.
 */
describe('positron.canvas command surface', () => {

	it('registers exactly the commands the seam is documented to have', () => {
		const canvasCommands = [...CommandsRegistry.getCommands().keys()]
			.filter(id => id.startsWith('positron.canvas.'))
			.sort();

		expect(canvasCommands).toEqual([
			'positron.canvas.enter',
			'positron.canvas.exit',
			'positron.canvas.isActive',
			'positron.canvas.open',
		]);
	});

	it('leaves user-facing discovery to the Canvas-capable assistant', () => {
		const canvasPaletteCommands = MenuRegistry.getMenuItems(MenuId.CommandPalette)
			.filter(isIMenuItem)
			.map(item => item.command.id)
			.filter(id => id.startsWith('positron.canvas.'));

		expect(canvasPaletteCommands).toEqual(['positron.canvas.exit']);
	});
});
