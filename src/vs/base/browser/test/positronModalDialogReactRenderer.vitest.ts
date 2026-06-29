/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { KeyCode } from '../../common/keyCodes.js';
import { applyModalKeydownSuppression } from '../positronModalDialogReactRenderer.js';

/** A keyboard event with only the members applyModalKeydownSuppression touches. */
function fakeEvent(keyCode: KeyCode) {
	return { keyCode, preventDefault: vi.fn(), stopPropagation: vi.fn() };
}

describe('applyModalKeydownSuppression', () => {
	it('leaves unbound keys alone (no matching command)', () => {
		const event = fakeEvent(KeyCode.KeyA);
		applyModalKeydownSuppression(null, event);
		expect(event.preventDefault).not.toHaveBeenCalled();
		expect(event.stopPropagation).not.toHaveBeenCalled();
	});

	it('leaves allowable commands alone so modal inputs keep working', () => {
		const event = fakeEvent(KeyCode.KeyC);
		applyModalKeydownSuppression('copy', event);
		expect(event.preventDefault).not.toHaveBeenCalled();
		expect(event.stopPropagation).not.toHaveBeenCalled();
	});

	it('Escape bound to a non-allowable command stops propagation but NOT default, so the dialog still closes', () => {
		const event = fakeEvent(KeyCode.Escape);
		applyModalKeydownSuppression('notebook.cell.quitEdit', event);
		expect(event.stopPropagation).toHaveBeenCalledTimes(1);
		expect(event.preventDefault).not.toHaveBeenCalled();
	});

	it('a non-Escape bound key gets the full stop (preventDefault + stopPropagation)', () => {
		const event = fakeEvent(KeyCode.KeyP);
		applyModalKeydownSuppression('workbench.action.showCommands', event);
		expect(event.preventDefault).toHaveBeenCalledTimes(1);
		expect(event.stopPropagation).toHaveBeenCalledTimes(1);
	});
});
