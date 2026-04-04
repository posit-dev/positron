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
 * Vitest-compatible version of setupReactRenderer.
 *
 * Sets up a React render root for component tests using Vitest's
 * `beforeEach`/`afterEach` hooks instead of Mocha's `setup`/`teardown`.
 *
 * IMPORTANT: Call `ensureNoLeakedDisposables()` BEFORE this function in a
 * `describe` block. Vitest runs `afterEach` hooks in reverse registration
 * order (LIFO), so registering `ensureNoLeakedDisposables` first ensures
 * React's `afterEach` (unmount) runs first, disposing VS Code disposables
 * before the leak checker inspects them.
 *
 * @example
 * ```ts
 * describe('MyWidget', () => {
 *     const disposables = ensureNoLeakedDisposables(); // register afterEach first
 *     const { render } = setupReactRenderer();         // register afterEach second (runs first)
 *
 *     it('renders', () => {
 *         const container = render(<MyWidget />);
 *         expect(container.querySelector('.my-widget')).toBeTruthy();
 *     });
 * });
 * ```
 */
export function setupReactRenderer() {
	let context: ReactRendererContext | undefined;
	const setupRequiredError = (action: string) => `React root is not initialized. Did you try to ${action} before setup?`;

	beforeEach(() => {
		const container = mainWindow.document.createElement('div');
		mainWindow.document.body.appendChild(container);
		const root = createRoot(container);
		context = { root, container };
	});

	afterEach(() => {
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
		 * `afterEach` phase, but can be called manually for testing unmount behavior.
		 */
		unmount(): void {
			if (!context) {
				throw new Error(setupRequiredError('unmount'));
			}
			context.root.unmount();
		}
	};
}
