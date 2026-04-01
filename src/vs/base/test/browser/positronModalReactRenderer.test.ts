/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as sinon from 'sinon';
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

			// Stub console.error to prevent actual console output in tests
			const consoleErrorStub = sinon.stub(console, 'error');
			disposables.add({ dispose: () => consoleErrorStub.restore() });

			renderer.render(createMockReactElement());
			const firstChild = container.firstChild;

			// Try to render again
			renderer.render(createMockReactElement());

			// Should still be the same child
			assert.strictEqual(container.firstChild, firstChild);
			assert.strictEqual(container.children.length, 1);

			// Should have logged an error
			assert.strictEqual(consoleErrorStub.callCount, 1);
			assert.ok(consoleErrorStub.calledWith('[PositronModalReactRenderer] Attempted to render a React element when one has already been rendered'));

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

	/**
	 * disposeAll test suite.
	 */
	suite('disposeAll', () => {
		test('disposes all renderers in the stack', () => {
			const container = createMockContainer();

			const renderers: PositronModalReactRenderer[] = [];
			for (let i = 0; i < 5; i++) {
				const renderer = disposables.add(new PositronModalReactRenderer({ container }));
				renderer.render(createMockReactElement());
				renderers.push(renderer);
			}

			assert.strictEqual(container.children.length, 5);

			PositronModalReactRenderer.disposeAll();

			assert.strictEqual(container.children.length, 0);
		});

		test('calls onDisposed for every renderer', () => {
			const container = createMockContainer();
			const callbackFlags: boolean[] = new Array(5).fill(false);

			for (let i = 0; i < 5; i++) {
				const index = i;
				const renderer = disposables.add(new PositronModalReactRenderer({
					container,
					onDisposed: () => { callbackFlags[index] = true; }
				}));
				renderer.render(createMockReactElement());
			}

			PositronModalReactRenderer.disposeAll();

			assert.ok(callbackFlags.every(f => f), 'all onDisposed callbacks should have been called');
		});

		test('is a no-op on an empty stack', () => {
			assert.doesNotThrow(() => PositronModalReactRenderer.disposeAll());
		});
	});

	/**
	 * isInsideAnyPopup / setBoundsProvider test suite.
	 */
	suite('isInsideAnyPopup', () => {
		/**
		 * Creates a mouse event at the given coordinates.
		 */
		function createMouseEvent(clientX: number, clientY: number): MouseEvent {
			return new MouseEvent('mousedown', { clientX, clientY });
		}

		test('returns false when stack is empty', () => {
			const e = createMouseEvent(100, 100);
			assert.strictEqual(PositronModalReactRenderer.isInsideAnyPopup(e), false);
		});

		test('returns true when point is inside the registered bounds', () => {
			const container = createMockContainer();
			const renderer = disposables.add(new PositronModalReactRenderer({ container }));
			renderer.render(createMockReactElement());

			renderer.setBoundsProvider(() => new DOMRect(50, 50, 200, 200));

			assert.strictEqual(PositronModalReactRenderer.isInsideAnyPopup(createMouseEvent(100, 100)), true);

			renderer.dispose();
		});

		test('returns false when point is outside the registered bounds', () => {
			const container = createMockContainer();
			const renderer = disposables.add(new PositronModalReactRenderer({ container }));
			renderer.render(createMockReactElement());

			renderer.setBoundsProvider(() => new DOMRect(50, 50, 200, 200));

			assert.strictEqual(PositronModalReactRenderer.isInsideAnyPopup(createMouseEvent(10, 10)), false);

			renderer.dispose();
		});

		test('returns true when point is inside any one popup in the stack', () => {
			const container = createMockContainer();

			const r1 = disposables.add(new PositronModalReactRenderer({ container }));
			r1.render(createMockReactElement());
			r1.setBoundsProvider(() => new DOMRect(0, 0, 100, 100));

			const r2 = disposables.add(new PositronModalReactRenderer({ container }));
			r2.render(createMockReactElement());
			r2.setBoundsProvider(() => new DOMRect(200, 200, 100, 100));

			// Inside r1 only
			assert.strictEqual(PositronModalReactRenderer.isInsideAnyPopup(createMouseEvent(50, 50)), true);
			// Inside r2 only
			assert.strictEqual(PositronModalReactRenderer.isInsideAnyPopup(createMouseEvent(250, 250)), true);
			// Outside both
			assert.strictEqual(PositronModalReactRenderer.isInsideAnyPopup(createMouseEvent(500, 500)), false);

			PositronModalReactRenderer.disposeAll();
		});

		test('returns false for renderer with no bounds provider registered', () => {
			const container = createMockContainer();
			const renderer = disposables.add(new PositronModalReactRenderer({ container }));
			renderer.render(createMockReactElement());

			// No setBoundsProvider call - should not throw and should return false
			assert.strictEqual(PositronModalReactRenderer.isInsideAnyPopup(createMouseEvent(100, 100)), false);

			renderer.dispose();
		});
	});

	/**
	 * allowPointerPassthrough test suite.
	 */
	suite('allowPointerPassthrough', () => {
		test('sets pointer-events: none on the overlay when enabled', () => {
			const container = createMockContainer();
			const renderer = disposables.add(new PositronModalReactRenderer({
				container,
				allowPointerPassthrough: true
			}));
			renderer.render(createMockReactElement());

			const overlay = container.querySelector('.positron-modal-overlay') as HTMLElement;
			assert.ok(overlay);
			assert.strictEqual(overlay.style.pointerEvents, 'none');

			renderer.dispose();
		});

		test('does not set pointer-events on the overlay when disabled', () => {
			const container = createMockContainer();
			const renderer = disposables.add(new PositronModalReactRenderer({ container }));
			renderer.render(createMockReactElement());

			const overlay = container.querySelector('.positron-modal-overlay') as HTMLElement;
			assert.ok(overlay);
			assert.notStrictEqual(overlay.style.pointerEvents, 'none');

			renderer.dispose();
		});
	});

	/**
	 * Unrendered renderer test suite.
	 */
	suite('unrendered renderer', () => {
		test('dispose before render is a no-op', () => {
			const container = createMockContainer();
			const renderer = disposables.add(new PositronModalReactRenderer({ container }));

			assert.doesNotThrow(() => renderer.dispose());
			assert.strictEqual(container.children.length, 0);
		});

		test('onDisposed is not called when renderer was never rendered', () => {
			const container = createMockContainer();
			let callbackCalled = false;

			const renderer = disposables.add(new PositronModalReactRenderer({
				container,
				onDisposed: () => { callbackCalled = true; }
			}));

			renderer.dispose();

			assert.strictEqual(callbackCalled, false);
		});
	});
});
