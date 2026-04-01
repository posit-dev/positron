/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import React from 'react';
import { mainWindow } from '../../../../../../base/browser/window.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { setupReactRenderer } from '../../../../../../base/test/browser/react.js';
import { useWheelForwarding } from '../../../browser/notebookCells/useWheelForwarding.js';

/* Minimal wrapper that wires up the hook between a source div and a target ref. */
function TestComponent({ targetRef }: {
	targetRef: React.RefObject<HTMLElement | null>;
}) {
	const sourceRef = React.useRef<HTMLDivElement>(null);
	useWheelForwarding(sourceRef, targetRef);
	return <div ref={sourceRef} />;
}

suite('useWheelForwarding', () => {
	const { render } = setupReactRenderer();
	ensureNoDisposablesAreLeakedInTestSuite();

	let scrollTarget: HTMLDivElement;
	let scrollTargetRef: React.RefObject<HTMLElement | null>;

	/* Create a scrollable container (100x50) with oversized content (300x300). */
	setup(() => {
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

	teardown(() => {
		scrollTarget.remove();
	});

	/* Render the hook and return the source element that receives wheel events. */
	function renderHook() {
		const container = render(<TestComponent targetRef={scrollTargetRef} />);
		const source = container.firstElementChild as HTMLDivElement;
		assert.ok(source);
		return source;
	}

	test('forwards wheel deltaY to scroll target scrollTop', () => {
		const source = renderHook();
		assert.strictEqual(scrollTarget.scrollTop, 0);

		source.dispatchEvent(new WheelEvent('wheel', { deltaY: 50, cancelable: true }));

		assert.strictEqual(scrollTarget.scrollTop, 50);
	});

	test('forwards wheel deltaX to scroll target scrollLeft', () => {
		const source = renderHook();
		assert.strictEqual(scrollTarget.scrollLeft, 0);

		source.dispatchEvent(new WheelEvent('wheel', { deltaX: 30, cancelable: true }));

		assert.strictEqual(scrollTarget.scrollLeft, 30);
	});

	test('does not preventDefault at scroll boundary', () => {
		/* Pin to the bottom so further deltaY has no effect. */
		scrollTarget.scrollTop = scrollTarget.scrollHeight;
		const prevTop = scrollTarget.scrollTop;
		const source = renderHook();

		const event = new WheelEvent('wheel', { deltaY: 50, cancelable: true });
		source.dispatchEvent(event);

		assert.strictEqual(scrollTarget.scrollTop, prevTop);
		assert.strictEqual(event.defaultPrevented, false);
	});

	test('does not throw when scroll target ref is null', () => {
		scrollTargetRef.current = null;
		const source = renderHook();

		const event = new WheelEvent('wheel', { deltaY: 10, cancelable: true });
		source.dispatchEvent(event);

		assert.strictEqual(event.defaultPrevented, false);
	});
});
