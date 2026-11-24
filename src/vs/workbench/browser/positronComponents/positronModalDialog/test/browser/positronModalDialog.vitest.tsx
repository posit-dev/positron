/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { cleanup, render, screen } from '@testing-library/react';
import { Emitter } from '../../../../../../base/common/event.js';
import { PositronModalReactRenderer } from '../../../../../../base/browser/positronModalReactRenderer.js';
import { ensureNoLeakedDisposables } from '../../../../../../test/vitest/vitestUtils.js';
import { stubInterface } from '../../../../../../test/vitest/stubInterface.js';
import { PositronModalDialog } from '../../positronModalDialog.js';

describe('PositronModalDialog centering', () => {
	const disposables = ensureNoLeakedDisposables();

	let renderer: PositronModalReactRenderer;
	let originalClientWidth: PropertyDescriptor | undefined;
	let originalClientHeight: PropertyDescriptor | undefined;

	afterEach(() => {
		cleanup();
		for (const [name, descriptor] of [['clientWidth', originalClientWidth], ['clientHeight', originalClientHeight]] as const) {
			if (descriptor) {
				Object.defineProperty(HTMLElement.prototype, name, descriptor);
			} else {
				delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
			}
		}
	});

	beforeEach(() => {
		originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
		originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
		Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1000 });
		Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 800 });
		const onResize = disposables.add(new Emitter<UIEvent>());
		renderer = stubInterface<PositronModalReactRenderer>({
			onResize: onResize.event,
			onKeyDown: disposables.add(new Emitter<KeyboardEvent>()).event
		});
	});

	const dialog = (width: number, centerKey?: number) => (
		<PositronModalDialog centerKey={centerKey} height={200} renderer={renderer} title='Test' width={width} />
	);

	// The dialog box is the only child of the role=dialog backdrop.
	const boxLeft = () => (screen.getByRole('dialog').firstElementChild as HTMLElement).style.left;

	it('recenters on a width change without centerKey', () => {
		const { rerender } = render(dialog(400));
		expect(boxLeft()).toBe('300px');
		rerender(dialog(600));
		expect(boxLeft()).toBe('200px');
	});

	it('keeps its position on a width change with centerKey', () => {
		const { rerender } = render(dialog(400, 0));
		expect(boxLeft()).toBe('300px');
		rerender(dialog(600, 0));
		expect(boxLeft()).toBe('300px');
	});

	it('recenters when centerKey changes', () => {
		const { rerender } = render(dialog(400, 0));
		rerender(dialog(600, 0));
		rerender(dialog(600, 1));
		expect(boxLeft()).toBe('200px');
	});
});
