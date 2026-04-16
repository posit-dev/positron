/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import React from 'react';
import { setupRTLRenderer } from '../../../../../../test/vitest/reactTestingLibrary.js';
import { runWithFakedTimers } from '../../../../../../base/test/common/timeTravelScheduler.js';
import { timeout } from '../../../../../../base/common/async.js';
import { SCROLLING_CSS_CLASS, useScrollingIndicator } from '../../../browser/notebookCells/useScrollingIndicator.js';

function TestComponent({ elementRef }: { elementRef: React.RefObject<HTMLDivElement | null> }) {
	useScrollingIndicator(elementRef);
	return <div ref={elementRef} style={{ overflow: 'auto', height: '50px' }} />;
}

describe('useScrollingIndicator', () => {
	const rtl = setupRTLRenderer();

	function fireScroll(el: HTMLElement) {
		el.dispatchEvent(new Event('scroll'));
	}

	it('adds is-scrolling class on scroll', () => runWithFakedTimers({}, async () => {
		const ref = React.createRef<HTMLDivElement>();
		rtl.render(<TestComponent elementRef={ref} />);
		const el = ref.current!;

		fireScroll(el);

		expect(el.classList.contains(SCROLLING_CSS_CLASS)).toBeTruthy();
	}));

	it('removes is-scrolling class after 500ms timeout', () => runWithFakedTimers({}, async () => {
		const ref = React.createRef<HTMLDivElement>();
		rtl.render(<TestComponent elementRef={ref} />);
		const el = ref.current!;

		fireScroll(el);
		expect(el.classList.contains(SCROLLING_CSS_CLASS)).toBeTruthy();

		// Advance past the 500ms hide timeout.
		await timeout(500);
		expect(!el.classList.contains(SCROLLING_CSS_CLASS)).toBeTruthy();
	}));

	it('resets timeout on subsequent scroll events', () => runWithFakedTimers({}, async () => {
		const ref = React.createRef<HTMLDivElement>();
		rtl.render(<TestComponent elementRef={ref} />);
		const el = ref.current!;

		fireScroll(el);

		// Scroll again after 400ms (before the 500ms timeout fires).
		await timeout(400);
		expect(el.classList.contains(SCROLLING_CSS_CLASS)).toBeTruthy();
		fireScroll(el);

		// 400ms after the second scroll: still within the reset 500ms window.
		await timeout(400);
		expect(el.classList.contains(SCROLLING_CSS_CLASS)).toBeTruthy();

		// 100ms more (500ms total after second scroll): class should be removed.
		await timeout(100);
		expect(!el.classList.contains(SCROLLING_CSS_CLASS)).toBeTruthy();
	}));

	it('cleans up on unmount', () => runWithFakedTimers({}, async () => {
		const ref = React.createRef<HTMLDivElement>();
		const { unmount } = rtl.render(<TestComponent elementRef={ref} />);
		const el = ref.current!;

		fireScroll(el);
		expect(el.classList.contains(SCROLLING_CSS_CLASS)).toBeTruthy();

		unmount();

		// Cleanup should remove the class and clear the pending timer.
		expect(!el.classList.contains(SCROLLING_CSS_CLASS)).toBeTruthy();

		// The timer should not fire after unmount.
		await timeout(600);
		expect(!el.classList.contains(SCROLLING_CSS_CLASS)).toBeTruthy();
	}));
});
