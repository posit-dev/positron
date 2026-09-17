/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { CodeWindow } from '../../../base/browser/window.js';
import { stubInterface } from '../../../test/vitest/stubInterface.js';
import { BaseWindow } from '../../browser/window.js';
import { canImplicitlyFocusWindow, suppressImplicitWindowFocus } from '../../browser/positronWindowFocus.js';

vi.mock('../../../base/browser/dom.js', async importOriginal => ({
	...await importOriginal<typeof import('../../../base/browser/dom.js')>(),
	hasAppFocus: () => true,
}));

describe('implicit element focus across windows', () => {
	it.each([true, false])('respects explicit focus suppression: %s', suppressed => {
		const focus = vi.fn();
		const nativeFocus = vi.fn();
		const elementFocus = vi.fn();
		class TestElement {
			readonly ownerDocument = { defaultView: { window: target } };
			focus() { elementFocus(); }
		}
		const target = stubInterface<CodeWindow>({
			document: stubInterface<Document>({ visibilityState: 'visible', hasFocus: () => false }),
			focus,
			HTMLElement: TestElement as unknown as CodeWindow['HTMLElement'],
		});
		const suppression = suppressed ? suppressImplicitWindowFocus(target) : undefined;
		const instance = Object.assign(Object.create(BaseWindow.prototype), { hostService: { focus: nativeFocus }, environmentService: {} });
		try {
			instance.enableWindowFocusOnElementFocus(target);
			new TestElement().focus();
			expect(focus).toHaveBeenCalledTimes(suppressed ? 0 : 1);
			expect(nativeFocus).toHaveBeenCalledTimes(suppressed ? 0 : 1);
			expect(elementFocus).toHaveBeenCalledTimes(suppressed ? 0 : 1);
		} finally {
			suppression?.dispose();
		}
	});

	it('keeps suppression until every owner releases it', () => {
		const target = stubInterface<Window>();
		const first = suppressImplicitWindowFocus(target);
		const second = suppressImplicitWindowFocus(target);
		first.dispose();
		expect(canImplicitlyFocusWindow(target)).toBe(false);
		expect(canImplicitlyFocusWindow(stubInterface<Window>())).toBe(true);
		second.dispose();
		expect(canImplicitlyFocusWindow(target)).toBe(true);
	});
});
