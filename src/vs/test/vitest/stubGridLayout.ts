/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { stubInterface } from './stubInterface.js';

/**
 * The Positron data grid (and everything built on it: PositronList, PositronTree,
 * the packages pane) sizes itself from the DOM via requestAnimationFrame +
 * ResizeObserver. Neither produces a real layout in happy-dom, so neutralize
 * them and drive the size explicitly with `instance.setSize`. Stubbing rAF to a
 * no-op also stops a late frame from resetting that size to 0.
 *
 * Callers must pair this with `vi.unstubAllGlobals()` in `afterEach`.
 */
export function stubGridLayout(): void {
	vi.stubGlobal('requestAnimationFrame', () => 0);
	vi.stubGlobal('ResizeObserver', class {
		observe() { }
		unobserve() { }
		disconnect() { }
	});
}

/**
 * Like {@link stubGridLayout}, but for tests that assert on rendered rows rather
 * than instance state: the data grid only paints the rows that fit its *local*
 * height, which it learns from the DOM. happy-dom reports 0 for every
 * measurement, so this gives elements a real offset size and hands that size to
 * the grid synchronously via a ResizeObserver that fires on observe(), so the
 * rows paint during render.
 *
 * @returns A restore function for the offset overrides; callers must invoke it
 * (typically in `afterEach`) and also call `vi.unstubAllGlobals()`.
 */
export function stubGridLayoutWithSize(width: number, height: number): () => void {
	const offsetWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
	const offsetHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
	Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => width });
	Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => height });

	// rAF stays a no-op; the size instead arrives from the ResizeObserver below.
	vi.stubGlobal('requestAnimationFrame', () => 0);
	vi.stubGlobal('ResizeObserver', class {
		private readonly _callback: ResizeObserverCallback;
		constructor(callback: ResizeObserverCallback) { this._callback = callback; }
		observe() {
			// Report the stubbed size immediately so the grid sizes itself during render. The grid
			// only reads contentRect, so the rest of the entry throws if it is ever read.
			const entry = stubInterface<ResizeObserverEntry>({
				contentRect: stubInterface<DOMRectReadOnly>({ width, height }),
			});
			this._callback([entry], this);
		}
		unobserve() { }
		disconnect() { }
	});

	return () => {
		Object.defineProperty(HTMLElement.prototype, 'offsetWidth', offsetWidthDescriptor!);
		Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeightDescriptor!);
	};
}
