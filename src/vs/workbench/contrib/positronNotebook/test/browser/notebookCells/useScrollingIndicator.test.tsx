/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import React from 'react';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { setupReactRenderer } from '../../../../../../base/test/browser/react.js';
import { runWithFakedTimers } from '../../../../../../base/test/common/timeTravelScheduler.js';
import { timeout } from '../../../../../../base/common/async.js';
import { SCROLLING_CSS_CLASS, useScrollingIndicator } from '../../../browser/notebookCells/useScrollingIndicator.js';

function TestComponent({ elementRef }: { elementRef: React.RefObject<HTMLDivElement | null> }) {
	useScrollingIndicator(elementRef);
	return <div ref={elementRef} style={{ overflow: 'auto', height: '50px' }} />;
}

suite('useScrollingIndicator', () => {
	const { render, unmount } = setupReactRenderer();
	ensureNoDisposablesAreLeakedInTestSuite();

	function fireScroll(el: HTMLElement) {
		el.dispatchEvent(new Event('scroll'));
	}

	test('adds is-scrolling class on scroll', () => runWithFakedTimers({}, async () => {
		const ref = React.createRef<HTMLDivElement>();
		render(<TestComponent elementRef={ref} />);
		const el = ref.current!;

		fireScroll(el);

		assert.ok(el.classList.contains(SCROLLING_CSS_CLASS));
	}));

	test('removes is-scrolling class after 500ms timeout', () => runWithFakedTimers({}, async () => {
		const ref = React.createRef<HTMLDivElement>();
		render(<TestComponent elementRef={ref} />);
		const el = ref.current!;

		fireScroll(el);
		assert.ok(el.classList.contains(SCROLLING_CSS_CLASS));

		// Advance past the 500ms hide timeout.
		await timeout(500);
		assert.ok(!el.classList.contains(SCROLLING_CSS_CLASS));
	}));

	test('resets timeout on subsequent scroll events', () => runWithFakedTimers({}, async () => {
		const ref = React.createRef<HTMLDivElement>();
		render(<TestComponent elementRef={ref} />);
		const el = ref.current!;

		fireScroll(el);

		// Scroll again after 400ms (before the 500ms timeout fires).
		await timeout(400);
		assert.ok(el.classList.contains(SCROLLING_CSS_CLASS));
		fireScroll(el);

		// 400ms after the second scroll: still within the reset 500ms window.
		await timeout(400);
		assert.ok(el.classList.contains(SCROLLING_CSS_CLASS));

		// 100ms more (500ms total after second scroll): class should be removed.
		await timeout(100);
		assert.ok(!el.classList.contains(SCROLLING_CSS_CLASS));
	}));

	test('cleans up on unmount', () => runWithFakedTimers({}, async () => {
		const ref = React.createRef<HTMLDivElement>();
		render(<TestComponent elementRef={ref} />);
		const el = ref.current!;

		fireScroll(el);
		assert.ok(el.classList.contains(SCROLLING_CSS_CLASS));

		unmount();

		// Cleanup should remove the class and clear the pending timer.
		assert.ok(!el.classList.contains(SCROLLING_CSS_CLASS));

		// The timer should not fire after unmount.
		await timeout(600);
		assert.ok(!el.classList.contains(SCROLLING_CSS_CLASS));
	}));
});
