/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { CommandsRegistry } from '../../../../../platform/commands/common/commands.js';
import '../../electron-browser/positronCanvas.contribution.js';

/**
 * Pins the `positron.canvas.*` command surface. These ids are string literals
 * on both sides of the Positron / Posit Assistant seam, and nothing else
 * checks the pair: the assistant once shipped a call to a command no Positron
 * registered, and both repos stayed green. Renaming, removing, or adding one
 * must be a visible diff here, made in step with the canonical list in the
 * assistant's `frontend-canvas/README.md`.
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
});
