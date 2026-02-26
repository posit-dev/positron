/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { PropsWithChildren, ReactElement, useEffect } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, Root } from 'react-dom/client';
import { mainWindow } from '../../browser/window.js';

/**
 * Wrapper component that resolves a promise when its useEffect cleanup runs.
 * React fires cleanup effects bottom-up (children before parent), so by the
 * time this parent's cleanup fires, all child effects -- including those that
 * create VS Code disposables -- have already been disposed.
 */
function EffectGate({ onCleanup, children }: PropsWithChildren<{ onCleanup: () => void }>) {
	useEffect(() => {
		return onCleanup;
	}, [onCleanup]);
	return <>{children}</>;
}

/**
 * Sets up a React render root for component tests. Registers mocha `setup` and
 * `teardown` hooks that create/destroy the DOM container and React root.
 *
 * Must be called before `ensureNoDisposablesAreLeakedInTestSuite()` because
 * mocha runs teardown hooks in FIFO order. The React teardown must run first so
 * that deferred `useEffect` cleanups dispose VS Code disposables before the leak
 * checker inspects them.
 *
 * @example
 * ```ts
 * suite('MyWidget', () => {
 *     const { render, container } = setupReactRenderer();
 *     ensureNoDisposablesAreLeakedInTestSuite();
 *
 *     test('renders', () => {
 *         render(<MyWidget />);
 *         assert.ok(container().querySelector('.my-widget'));
 *     });
 * });
 * ```
 */
export function setupReactRenderer() {
	let root: Root;
	let el: HTMLElement;
	let cleanupPromise: Promise<void>;
	let resolveCleanup: () => void;

	setup(() => {
		el = mainWindow.document.createElement('div');
		mainWindow.document.body.appendChild(el);
		root = createRoot(el);
		cleanupPromise = new Promise<void>(r => { resolveCleanup = r; });
	});

	teardown(async () => {
		root.unmount();
		await cleanupPromise;
		el.remove();
	});

	return {
		/**
		 * Render a React element synchronously via `flushSync`, wrapped in an
		 * `EffectGate` that enables awaiting deferred cleanup effects on unmount.
		 */
		render(element: ReactElement) {
			flushSync(() => {
				root.render(
					<EffectGate onCleanup={resolveCleanup}>
						{element}
					</EffectGate>
				);
			});
		},

		/**
		 * Returns the DOM container the React root is mounted into.
		 * Call inside tests (after `setup` has run), not at suite-definition time.
		 */
		container(): HTMLElement {
			return el;
		},
	};
}
