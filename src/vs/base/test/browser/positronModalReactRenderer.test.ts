/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { PositronModalReactRenderer } from '../../browser/positronModalReactRenderer.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../common/utils.js';

suite('PositronModalReactRenderer', () => {
	// Disposables.
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	/**
	 * Creates a mock container element for testing.
	 */
	function createMockContainer(): HTMLElement {
		const container = document.createElement('div');
		document.body.appendChild(container);
		disposables.add({ dispose: () => container.remove() });
		return container;
	}

	/**
	 * Creates a mock React element for testing.
	 */
	function createMockReactElement(): any {
		return { type: 'div', props: {} };
	}

	/**
	 * Dispose test suite.
	 */
	suite('dispose', () => {
		/**
		 * Test disposing a single renderer.
		 */
		test('disposes a single renderer', () => {
			const container = createMockContainer();
			const renderer = disposables.add(new PositronModalReactRenderer({ container }));

			renderer.render(createMockReactElement());

			// Verify it's in the DOM
			assert.strictEqual(container.children.length, 1);

			renderer.dispose();

			// Verify it's been removed
			assert.strictEqual(container.children.length, 0);
		});

		test('disposes the top renderer without affecting others', () => {
			const container = createMockContainer();

			// Create 10 renderers
			const renderers: PositronModalReactRenderer[] = [];
			for (let i = 0; i < 10; i++) {
				const renderer = disposables.add(new PositronModalReactRenderer({ container }));
				renderer.render(createMockReactElement());
				renderers.push(renderer);
			}

			// All 10 should be in the DOM
			assert.strictEqual(container.children.length, 10);

			// Dispose the top renderer (last one)
			renderers[9].dispose();

			// Only the top renderer should be removed
			assert.strictEqual(container.children.length, 9);

			// Clean up remaining renderers
			for (let i = 8; i >= 0; i--) {
				renderers[i].dispose();
			}
		});

		test('disposes middle renderer and all renderers above it', () => {
			const container = createMockContainer();

			// Create 10 renderers
			const renderers: PositronModalReactRenderer[] = [];
			for (let i = 0; i < 10; i++) {
				const renderer = disposables.add(new PositronModalReactRenderer({ container }));
				renderer.render(createMockReactElement());
				renderers.push(renderer);
			}

			// All 10 should be in the DOM
			assert.strictEqual(container.children.length, 10);

			// Dispose the middle renderer (index 5) - should dispose renderers 5-9
			renderers[5].dispose();

			// Only renderers 0-4 should remain (5 renderers)
			assert.strictEqual(container.children.length, 5);

			// Clean up remaining renderers
			for (let i = 4; i >= 0; i--) {
				renderers[i].dispose();
			}
		});

		test('disposes bottom renderer and all renderers above it', () => {
			const container = createMockContainer();

			// Create 10 renderers
			const renderers: PositronModalReactRenderer[] = [];
			for (let i = 0; i < 10; i++) {
				const renderer = disposables.add(new PositronModalReactRenderer({ container }));
				renderer.render(createMockReactElement());
				renderers.push(renderer);
			}

			// All 10 should be in the DOM
			assert.strictEqual(container.children.length, 10);

			// Dispose the bottom renderer (first one) - should dispose all renderers
			renderers[0].dispose();

			// All should be removed
			assert.strictEqual(container.children.length, 0);
		});

		test('handles double dispose gracefully', () => {
			const container = createMockContainer();
			const renderer = disposables.add(new PositronModalReactRenderer({ container }));

			renderer.render(createMockReactElement());
			renderer.dispose();

			// Second dispose should not throw
			assert.doesNotThrow(() => renderer.dispose());
		});

		test('calls onDisposed callback', () => {
			const container = createMockContainer();
			let callbackCalled = false;

			const renderer = disposables.add(new PositronModalReactRenderer({
				container,
				onDisposed: () => { callbackCalled = true; }
			}));

			renderer.render(createMockReactElement());
			renderer.dispose();

			assert.strictEqual(callbackCalled, true);
		});

		test('calls onDisposed for all disposed renderers when disposing middle renderer', () => {
			const container = createMockContainer();

			// Create 10 renderers with callback flags
			const callbackFlags: boolean[] = new Array(10).fill(false);
			const renderers: PositronModalReactRenderer[] = [];

			for (let i = 0; i < 10; i++) {
				const index = i; // Capture for closure
				const renderer = disposables.add(new PositronModalReactRenderer({
					container,
					onDisposed: () => { callbackFlags[index] = true; }
				}));
				renderer.render(createMockReactElement());
				renderers.push(renderer);
			}

			// Dispose renderer at index 4 - should dispose renderers 4-9
			renderers[4].dispose();

			// Renderers 0-3 should not be disposed
			for (let i = 0; i < 4; i++) {
				assert.strictEqual(callbackFlags[i], false, `renderer ${i} should not be disposed`);
			}

			// Renderers 4-9 should be disposed
			for (let i = 4; i < 10; i++) {
				assert.strictEqual(callbackFlags[i], true, `renderer ${i} should be disposed`);
			}

			// Clean up remaining renderers
			for (let i = 3; i >= 0; i--) {
				renderers[i].dispose();
			}
		});
	});

	/**
	 * Dispose test suite.
	 */
	suite('render', () => {
		test('renders React element into container', () => {
			const container = createMockContainer();
			const renderer = disposables.add(new PositronModalReactRenderer({ container }));

			assert.strictEqual(container.children.length, 0);

			renderer.render(createMockReactElement());

			assert.strictEqual(container.children.length, 1);
			assert.ok(container.querySelector('.positron-modal-overlay'));

			renderer.dispose();
		});

		test('does not render twice', () => {
			const container = createMockContainer();
			const renderer = disposables.add(new PositronModalReactRenderer({ container }));

			renderer.render(createMockReactElement());
			const firstChild = container.firstChild;

			// Try to render again
			renderer.render(createMockReactElement());

			// Should still be the same child
			assert.strictEqual(container.firstChild, firstChild);
			assert.strictEqual(container.children.length, 1);

			renderer.dispose();
		});
	});

	/**
	 * Parent element test suite.
	 */
	suite('parent element', () => {
		test('sets aria-expanded on parent when rendered', () => {
			const container = createMockContainer();
			const parent = document.createElement('div');
			container.appendChild(parent);

			const renderer = disposables.add(new PositronModalReactRenderer({ container, parent }));

			assert.strictEqual(parent.getAttribute('aria-expanded'), null);

			renderer.render(createMockReactElement());

			assert.strictEqual(parent.getAttribute('aria-expanded'), 'true');

			renderer.dispose();
		});

		test('removes aria-expanded from parent when disposed', () => {
			const container = createMockContainer();
			const parent = document.createElement('div');
			container.appendChild(parent);

			const renderer = disposables.add(new PositronModalReactRenderer({ container, parent }));

			renderer.render(createMockReactElement());
			assert.strictEqual(parent.getAttribute('aria-expanded'), 'true');

			renderer.dispose();

			assert.strictEqual(parent.hasAttribute('aria-expanded'), false);
		});
	});
});
