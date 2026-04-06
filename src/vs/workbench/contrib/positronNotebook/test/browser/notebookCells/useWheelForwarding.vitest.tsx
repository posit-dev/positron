/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
/// <reference types="vitest/globals" />

import React from 'react';
import { mainWindow } from '../../../../../../base/browser/window.js';
import { ensureNoLeakedDisposables } from '../../../../../../base/test/common/vitestSetup.js';
import { setupReactRenderer } from '../../../../../../base/test/browser/reactVitest.js';
import { useWheelForwarding } from '../../../browser/notebookCells/useWheelForwarding.js';

/* Minimal wrapper that wires up the hook between a source div and a target ref. */
function TestComponent({ targetRef }: {
	targetRef: React.RefObject<HTMLElement | null>;
}) {
	const sourceRef = React.useRef<HTMLDivElement>(null);
	useWheelForwarding(sourceRef, targetRef);
	return <div ref={sourceRef} />;
}

describe('useWheelForwarding', () => {
	ensureNoLeakedDisposables();
	const { render } = setupReactRenderer();

	let scrollTarget: HTMLDivElement;
	let scrollTargetRef: React.RefObject<HTMLElement | null>;

	/* Create a scrollable container (100x50) with oversized content (300x300). */
	beforeEach(() => {
		scrollTarget = mainWindow.document.createElement('div');
		scrollTarget.style.overflow = 'auto';
		scrollTarget.style.width = '100px';
		scrollTarget.style.height = '50px';
		const inner = mainWindow.document.createElement('div');
		inner.style.width = '300px';
		inner.style.height = '300px';
		scrollTarget.appendChild(inner);
		mainWindow.document.body.appendChild(scrollTarget);

		scrollTargetRef = React.createRef<HTMLElement | null>();
		scrollTargetRef.current = scrollTarget;
	});

	afterEach(() => {
		scrollTarget.remove();
	});

	/* Render the hook and return the source element that receives wheel events. */
	function renderHook() {
		const container = render(<TestComponent targetRef={scrollTargetRef} />);
		const source = container.firstElementChild as HTMLDivElement;
		expect(source).toBeTruthy();
		return source;
	}

	it('forwards wheel deltaY to scroll target scrollTop', () => {
		const source = renderHook();
		expect(scrollTarget.scrollTop).toBe(0);

		source.dispatchEvent(new WheelEvent('wheel', { deltaY: 50, cancelable: true }));

		expect(scrollTarget.scrollTop).toBe(50);
	});

	it('forwards wheel deltaX to scroll target scrollLeft', () => {
		const source = renderHook();
		expect(scrollTarget.scrollLeft).toBe(0);

		source.dispatchEvent(new WheelEvent('wheel', { deltaX: 30, cancelable: true }));

		expect(scrollTarget.scrollLeft).toBe(30);
	});

	// happy-dom does not clamp scrollTop at scrollHeight, so pinning to the
	// bottom and dispatching deltaY still increments scrollTop. This test
	// relies on real browser scroll-clamping behavior; skip in Vitest.
	it.skip('does not preventDefault at scroll boundary', () => {
		/* Pin to the bottom so further deltaY has no effect. */
		scrollTarget.scrollTop = scrollTarget.scrollHeight;
		const prevTop = scrollTarget.scrollTop;
		const source = renderHook();

		const event = new WheelEvent('wheel', { deltaY: 50, cancelable: true });
		source.dispatchEvent(event);

		expect(scrollTarget.scrollTop).toBe(prevTop);
		expect(event.defaultPrevented).toBe(false);
	});

	it('does not throw when scroll target ref is null', () => {
		scrollTargetRef.current = null;
		const source = renderHook();

		const event = new WheelEvent('wheel', { deltaY: 10, cancelable: true });
		source.dispatchEvent(event);

		expect(event.defaultPrevented).toBe(false);
	});
});
