/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ReactElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, Root } from 'react-dom/client';
import { mainWindow } from '../../browser/window.js';

interface ReactRendererContext {
	root: Root;
	container: HTMLElement;
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
 *     const { render } = setupReactRenderer();
 *     ensureNoDisposablesAreLeakedInTestSuite();
 *
 *     test('renders', () => {
 *         const container = render(<MyWidget />);
 *         assert.ok(container.querySelector('.my-widget'));
 *     });
 * });
 * ```
 */
export function setupReactRenderer() {
	let context: ReactRendererContext | undefined;
	const setupRequiredError = (action: string) => `React root is not initialized. Did you try to ${action} before setup?`;

	setup(() => {
		const container = mainWindow.document.createElement('div');
		mainWindow.document.body.appendChild(container);
		const root = createRoot(container);
		context = { root, container };
	});

	teardown(() => {
		if (context) {
			const { root, container } = context;
			root.unmount();
			container.remove();
			context = undefined;
		}
	});

	return {
		/**
		 * Render a React element synchronously via `flushSync` and return the
		 * DOM container the React root is mounted into.
		 */
		render(element: ReactElement): HTMLElement {
			if (!context) {
				throw new Error(setupRequiredError('render'));
			}
			const { root, container } = context;
			flushSync(() => {
				root.render(element);
			});
			return container;
		},

		/**
		 * Unmount the React root. This is handled automatically during the
		 * `teardown` phase, but can be called manually for testing unmount behavior.
		 */
		unmount(): void {
			if (!context) {
				throw new Error(setupRequiredError('unmount'));
			}
			context.root.unmount();
		}
	};
}
