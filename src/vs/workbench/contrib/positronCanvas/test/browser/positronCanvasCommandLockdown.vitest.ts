/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { OperatingSystem } from '../../../../../base/common/platform.js';
import { KeybindingsRegistry, KeybindingWeight } from '../../../../../platform/keybinding/common/keybindingsRegistry.js';
import { USLayoutResolvedKeybinding } from '../../../../../platform/keybinding/common/usLayoutResolvedKeybinding.js';
import { registerCanvasCommandLockdown } from '../../browser/positronCanvasCommandLockdown.js';

const SUPPRESSED_KEY_COMMAND = 'positronCanvasLockdown.suppressedKey';

registerCanvasCommandLockdown();

function suppressedBindings(os: OperatingSystem) {
	return KeybindingsRegistry.getDefaultKeybindingsForOS(os)
		.filter(item => item.command === SUPPRESSED_KEY_COMMAND && item.keybinding)
		.map(item => ({
			chord: USLayoutResolvedKeybinding.resolveKeybinding(item.keybinding!, os)[0].getDispatchChords().join(' '),
			when: item.when?.serialize(),
			weight: item.weight1,
		}))
		.sort((left, right) => left.chord.localeCompare(right.chord));
}

describe('Canvas command lockdown', () => {
	it.each([
		['macOS', OperatingSystem.Macintosh, ['meta+N', 'meta+O', 'meta+P', 'shift+meta+N', 'shift+meta+P']],
		['Linux', OperatingSystem.Linux, ['ctrl+E', 'ctrl+K ctrl+O', 'ctrl+N', 'ctrl+O', 'ctrl+P', 'ctrl+shift+N', 'ctrl+shift+P']],
		['Windows', OperatingSystem.Windows, ['ctrl+E', 'ctrl+K ctrl+O', 'ctrl+N', 'ctrl+O', 'ctrl+P', 'ctrl+shift+N', 'ctrl+shift+P']],
	] as const)('pins the default escape chords, context, and precedence on %s', (_name, os, expectedChords) => {
		const bindings = suppressedBindings(os);

		expect(bindings.map(binding => binding.chord)).toEqual(expectedChords);
		expect(bindings.every(binding => binding.when === 'positronCanvasModeActive')).toBe(true);
		expect(bindings.every(binding => binding.weight === KeybindingWeight.WorkbenchContrib + 50)).toBe(true);
	});
});
