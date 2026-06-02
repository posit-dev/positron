/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { PositronModalReactRenderer } from '../../browser/positronModalReactRenderer.js';
import { ensureNoLeakedDisposables } from '../../../test/vitest/vitestUtils.js';

describe('PositronModalReactRenderer', () => {
	// Disposables.
	const disposables = ensureNoLeakedDisposables();

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
	describe('dispose', () => {
		/**
		 * Test disposing a single renderer.
		 */
		it('disposes a single renderer', () => {
			const container = createMockContainer();
			const renderer = disposables.add(new PositronModalReactRenderer({ container }));

			renderer.render(createMockReactElement());

			// Verify it's in the DOM
			expect(container.children.length).toBe(1);

			renderer.dispose();

			// Verify it's been removed
			expect(container.children.length).toBe(0);
		});

		it('disposes the top renderer without affecting others', () => {
			const container = createMockContainer();

			// Create 10 renderers
			const renderers: PositronModalReactRenderer[] = [];
			for (let i = 0; i < 10; i++) {
				const renderer = disposables.add(new PositronModalReactRenderer({ container }));
				renderer.render(createMockReactElement());
				renderers.push(renderer);
			}

			// All 10 should be in the DOM
			expect(container.children.length).toBe(10);

			// Dispose the top renderer (last one)
			renderers[9].dispose();

			// Only the top renderer should be removed
			expect(container.children.length).toBe(9);

			// Clean up remaining renderers
			for (let i = 8; i >= 0; i--) {
				renderers[i].dispose();
			}
		});

		it('disposes middle renderer and all renderers above it', () => {
			const container = createMockContainer();

			// Create 10 renderers
			const renderers: PositronModalReactRenderer[] = [];
			for (let i = 0; i < 10; i++) {
				const renderer = disposables.add(new PositronModalReactRenderer({ container }));
				renderer.render(createMockReactElement());
				renderers.push(renderer);
			}

			// All 10 should be in the DOM
			expect(container.children.length).toBe(10);

			// Dispose the middle renderer (index 5) - should dispose renderers 5-9
			renderers[5].dispose();

			// Only renderers 0-4 should remain (5 renderers)
			expect(container.children.length).toBe(5);

			// Clean up remaining renderers
			for (let i = 4; i >= 0; i--) {
				renderers[i].dispose();
			}
		});

		it('disposes bottom renderer and all renderers above it', () => {
			const container = createMockContainer();

			// Create 10 renderers
			const renderers: PositronModalReactRenderer[] = [];
			for (let i = 0; i < 10; i++) {
				const renderer = disposables.add(new PositronModalReactRenderer({ container }));
				renderer.render(createMockReactElement());
				renderers.push(renderer);
			}

			// All 10 should be in the DOM
			expect(container.children.length).toBe(10);

			// Dispose the bottom renderer (first one) - should dispose all renderers
			renderers[0].dispose();

			// All should be removed
			expect(container.children.length).toBe(0);
		});

		it('handles double dispose gracefully', () => {
			const container = createMockContainer();
			const renderer = disposables.add(new PositronModalReactRenderer({ container }));

			renderer.render(createMockReactElement());
			renderer.dispose();

			// Second dispose should not throw
			expect(() => renderer.dispose()).not.toThrow();
		});

		it('calls onDisposed callback', () => {
			const container = createMockContainer();
			let callbackCalled = false;

			const renderer = disposables.add(new PositronModalReactRenderer({
				container,
				onDisposed: () => { callbackCalled = true; }
			}));

			renderer.render(createMockReactElement());
			renderer.dispose();

			expect(callbackCalled).toBe(true);
		});

		it('calls onDisposed for all disposed renderers when disposing middle renderer', () => {
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
				expect(callbackFlags[i], `renderer ${i} should not be disposed`).toBe(false);
			}

			// Renderers 4-9 should be disposed
			for (let i = 4; i < 10; i++) {
				expect(callbackFlags[i], `renderer ${i} should be disposed`).toBe(true);
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
	describe('render', () => {
		it('renders React element into container', () => {
			const container = createMockContainer();
			const renderer = disposables.add(new PositronModalReactRenderer({ container }));

			expect(container.children.length).toBe(0);

			renderer.render(createMockReactElement());

			expect(container.children.length).toBe(1);
			expect(container.firstElementChild).toHaveAttribute('data-testid', 'positron-modal-overlay');

			renderer.dispose();
		});

		it('does not render twice', () => {
			const container = createMockContainer();
			const renderer = disposables.add(new PositronModalReactRenderer({ container }));

			// Spy on console.error to suppress output and verify it was called
			const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

			renderer.render(createMockReactElement());
			const firstChild = container.firstChild;

			// Try to render again
			renderer.render(createMockReactElement());

			// Should still be the same child
			expect(container.firstChild).toBe(firstChild);
			expect(container.children.length).toBe(1);

			// Should have logged an error
			expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
			expect(consoleErrorSpy).toHaveBeenCalledWith('[PositronModalReactRenderer] Attempted to render a React element when one has already been rendered');

			renderer.dispose();
			// consoleErrorSpy is auto-restored by restoreMocks: true in vitest.config.ts
		});
	});

	/**
	 * Parent element test suite.
	 */
	describe('parent element', () => {
		it('sets aria-expanded on parent when rendered', () => {
			const container = createMockContainer();
			const parent = document.createElement('div');
			container.appendChild(parent);

			const renderer = disposables.add(new PositronModalReactRenderer({ container, parent }));

			expect(parent).not.toHaveAttribute('aria-expanded');

			renderer.render(createMockReactElement());

			expect(parent).toHaveAttribute('aria-expanded', 'true');

			renderer.dispose();
		});

		it('removes aria-expanded from parent when disposed', () => {
			const container = createMockContainer();
			const parent = document.createElement('div');
			container.appendChild(parent);

			const renderer = disposables.add(new PositronModalReactRenderer({ container, parent }));

			renderer.render(createMockReactElement());
			expect(parent).toHaveAttribute('aria-expanded', 'true');

			renderer.dispose();

			expect(parent).not.toHaveAttribute('aria-expanded');
		});
	});

	/**
	 * disposeAll test suite.
	 */
	describe('disposeAll', () => {
		it('disposes all renderers in the stack', () => {
			const container = createMockContainer();

			const renderers: PositronModalReactRenderer[] = [];
			for (let i = 0; i < 5; i++) {
				const renderer = disposables.add(new PositronModalReactRenderer({ container }));
				renderer.render(createMockReactElement());
				renderers.push(renderer);
			}

			expect(container.children.length).toBe(5);

			PositronModalReactRenderer.disposeAll();

			expect(container.children.length).toBe(0);
		});

		it('calls onDisposed for every renderer', () => {
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

			expect(callbackFlags.every(f => f), 'all onDisposed callbacks should have been called').toBe(true);
		});

		it('is a no-op on an empty stack', () => {
			expect(() => PositronModalReactRenderer.disposeAll()).not.toThrow();
		});
	});

	/**
	 * disposeTopPopups test suite.
	 */
	describe('disposeTopPopups', () => {
		it('disposes popups above a dialog, leaving the dialog open', () => {
			const container = createMockContainer();

			// A modal dialog (no bounds provider) at the bottom of the stack.
			let dialogDisposed = false;
			const dialog = disposables.add(new PositronModalReactRenderer({
				container,
				onDisposed: () => { dialogDisposed = true; }
			}));
			dialog.render(createMockReactElement());

			// A dropdown popup (registers bounds) on top of the dialog.
			let popupDisposed = false;
			const popup = disposables.add(new PositronModalReactRenderer({
				container,
				onDisposed: () => { popupDisposed = true; }
			}));
			popup.render(createMockReactElement());
			popup.setBoundsProvider(() => new DOMRect(0, 0, 100, 100));

			PositronModalReactRenderer.disposeTopPopups();

			expect({ dialogDisposed, popupDisposed, remaining: container.children.length })
				.toEqual({ dialogDisposed: false, popupDisposed: true, remaining: 1 });

			dialog.dispose();
		});

		it('disposes the whole stack when every renderer is a popup', () => {
			const container = createMockContainer();

			const popup1 = disposables.add(new PositronModalReactRenderer({ container }));
			popup1.render(createMockReactElement());
			popup1.setBoundsProvider(() => new DOMRect(0, 0, 100, 100));

			const popup2 = disposables.add(new PositronModalReactRenderer({ container }));
			popup2.render(createMockReactElement());
			popup2.setBoundsProvider(() => new DOMRect(50, 50, 100, 100));

			PositronModalReactRenderer.disposeTopPopups();

			expect(container.children.length).toBe(0);
		});

		it('is a no-op when the top renderer is not a popup', () => {
			const container = createMockContainer();
			const dialog = disposables.add(new PositronModalReactRenderer({ container }));
			dialog.render(createMockReactElement());

			PositronModalReactRenderer.disposeTopPopups();

			expect(container.children.length).toBe(1);

			dialog.dispose();
		});

		it('is a no-op on an empty stack', () => {
			expect(() => PositronModalReactRenderer.disposeTopPopups()).not.toThrow();
		});
	});

	/**
	 * isInsideAnyPopup / setBoundsProvider test suite.
	 */
	describe('isInsideAnyPopup', () => {
		/**
		 * Creates a mouse event at the given coordinates.
		 */
		function createMouseEvent(clientX: number, clientY: number): MouseEvent {
			return new MouseEvent('mousedown', { clientX, clientY });
		}

		it('returns false when stack is empty', () => {
			const e = createMouseEvent(100, 100);
			expect(PositronModalReactRenderer.isInsideAnyPopup(e)).toBe(false);
		});

		it('returns true when point is inside the registered bounds', () => {
			const container = createMockContainer();
			const renderer = disposables.add(new PositronModalReactRenderer({ container }));
			renderer.render(createMockReactElement());

			renderer.setBoundsProvider(() => new DOMRect(50, 50, 200, 200));

			expect(PositronModalReactRenderer.isInsideAnyPopup(createMouseEvent(100, 100))).toBe(true);

			renderer.dispose();
		});

		it('returns false when point is outside the registered bounds', () => {
			const container = createMockContainer();
			const renderer = disposables.add(new PositronModalReactRenderer({ container }));
			renderer.render(createMockReactElement());

			renderer.setBoundsProvider(() => new DOMRect(50, 50, 200, 200));

			expect(PositronModalReactRenderer.isInsideAnyPopup(createMouseEvent(10, 10))).toBe(false);

			renderer.dispose();
		});

		it('returns true when point is inside any one popup in the stack', () => {
			const container = createMockContainer();

			const r1 = disposables.add(new PositronModalReactRenderer({ container }));
			r1.render(createMockReactElement());
			r1.setBoundsProvider(() => new DOMRect(0, 0, 100, 100));

			const r2 = disposables.add(new PositronModalReactRenderer({ container }));
			r2.render(createMockReactElement());
			r2.setBoundsProvider(() => new DOMRect(200, 200, 100, 100));

			// Inside r1 only
			expect(PositronModalReactRenderer.isInsideAnyPopup(createMouseEvent(50, 50))).toBe(true);
			// Inside r2 only
			expect(PositronModalReactRenderer.isInsideAnyPopup(createMouseEvent(250, 250))).toBe(true);
			// Outside both
			expect(PositronModalReactRenderer.isInsideAnyPopup(createMouseEvent(500, 500))).toBe(false);

			PositronModalReactRenderer.disposeAll();
		});

		it('returns false for renderer with no bounds provider registered', () => {
			const container = createMockContainer();
			const renderer = disposables.add(new PositronModalReactRenderer({ container }));
			renderer.render(createMockReactElement());

			// No setBoundsProvider call - should not throw and should return false
			expect(PositronModalReactRenderer.isInsideAnyPopup(createMouseEvent(100, 100))).toBe(false);

			renderer.dispose();
		});
	});

	/**
	 * allowPointerPassthrough test suite.
	 */
	describe('allowPointerPassthrough', () => {
		it('sets pointer-events: none on the overlay when enabled', () => {
			const container = createMockContainer();
			const renderer = disposables.add(new PositronModalReactRenderer({
				container,
				allowPointerPassthrough: true
			}));
			renderer.render(createMockReactElement());

			const overlay = container.firstElementChild as HTMLElement;
			expect(overlay).toHaveStyle({ pointerEvents: 'none' });

			renderer.dispose();
		});

		it('does not set pointer-events on the overlay when disabled', () => {
			const container = createMockContainer();
			const renderer = disposables.add(new PositronModalReactRenderer({ container }));
			renderer.render(createMockReactElement());

			const overlay = container.firstElementChild as HTMLElement;
			expect(overlay).not.toHaveStyle({ pointerEvents: 'none' });

			renderer.dispose();
		});
	});

	/**
	 * Unrendered renderer test suite.
	 */
	describe('unrendered renderer', () => {
		it('dispose before render is a no-op', () => {
			const container = createMockContainer();
			const renderer = disposables.add(new PositronModalReactRenderer({ container }));

			expect(() => renderer.dispose()).not.toThrow();
			expect(container.children.length).toBe(0);
		});

		it('onDisposed is not called when renderer was never rendered', () => {
			const container = createMockContainer();
			let callbackCalled = false;

			const renderer = disposables.add(new PositronModalReactRenderer({
				container,
				onDisposed: () => { callbackCalled = true; }
			}));

			renderer.dispose();

			expect(callbackCalled).toBe(false);
		});
	});
});
