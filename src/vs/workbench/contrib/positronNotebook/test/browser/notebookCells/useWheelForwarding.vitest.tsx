/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import React from 'react';
import { mainWindow } from '../../../../../../base/browser/window.js';
import { ensureNoLeakedDisposables } from '../../../../../../base/test/common/vitestUtils.js';
import { setupRTLRenderer } from '../../../../../../base/test/browser/reactTestingLibrary.js';
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
	const rtl = setupRTLRenderer();

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
		const { container } = rtl.render(<TestComponent targetRef={scrollTargetRef} />);
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

	it('does not preventDefault at scroll boundary', () => {
		// happy-dom has no layout engine, so we mock scroll metrics to
		// simulate a pinned-to-bottom container where scrollTop is clamped.
		const maxScroll = 250; // scrollHeight(300) - clientHeight(50)
		Object.defineProperty(scrollTarget, 'scrollHeight', { value: 300, configurable: true });
		Object.defineProperty(scrollTarget, 'clientHeight', { value: 50, configurable: true });
		let internalScrollTop = maxScroll;
		Object.defineProperty(scrollTarget, 'scrollTop', {
			get: () => internalScrollTop,
			set: (v: number) => { internalScrollTop = Math.max(0, Math.min(v, maxScroll)); },
			configurable: true,
		});
		const source = renderHook();

		const event = new WheelEvent('wheel', { deltaY: 50, cancelable: true });
		source.dispatchEvent(event);

		expect(scrollTarget.scrollTop).toBe(maxScroll);
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
