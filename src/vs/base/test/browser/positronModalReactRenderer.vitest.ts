/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as DOM from '../../browser/dom.js';
import { CodeWindow, ensureCodeWindow, mainWindow } from '../../browser/window.js';
import { PositronReactServices } from '../../browser/positronReactServices.js';
import { PositronModalReactRenderer } from '../../browser/positronModalReactRenderer.js';
import { createTestContainer } from '../../../test/vitest/positronTestContainer.js';

describe('PositronModalReactRenderer', () => {
	const ctx = createTestContainer().withReactServices().build();
	const disposables = ctx.disposables;

	beforeEach(() => {
		// The renderer reads the singleton directly.
		PositronReactServices.services = ctx.reactServices;
	});

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

	describe('auxiliary windows', () => {
		let nextWindowId = 1000;

		/** An iframe provides a separate document and window. */
		function createAuxiliaryWindow(): { auxWindow: CodeWindow; container: HTMLElement } {
			const iframe = document.createElement('iframe');
			iframe.src = 'about:blank';
			document.body.appendChild(iframe);
			disposables.add({ dispose: () => iframe.remove() });

			const auxWindow = iframe.contentWindow!;
			ensureCodeWindow(auxWindow, nextWindowId++);
			disposables.add(DOM.registerWindow(auxWindow));

			const container = auxWindow.document.createElement('div');
			auxWindow.document.body.appendChild(container);
			return { auxWindow, container };
		}

		function dispatchInput(targetWindow: CodeWindow): void {
			targetWindow.dispatchEvent(new targetWindow.KeyboardEvent('keydown', { key: 'Escape' }));
			targetWindow.dispatchEvent(new targetWindow.MouseEvent('mousedown'));
		}

		describe('event listeners', () => {
			it('resolves keybindings against the modal container when another window is active', () => {
				const { auxWindow, container } = createAuxiliaryWindow();
				const softDispatch = vi.spyOn(ctx.reactServices.keybindingService, 'softDispatch');
				expect(ctx.reactServices.workbenchLayoutService.activeContainer.ownerDocument).toBe(document);
				const renderer = disposables.add(new PositronModalReactRenderer({ container }));
				renderer.render(createMockReactElement());

				dispatchInput(auxWindow);

				expect(softDispatch).toHaveBeenCalledExactlyOnceWith(expect.anything(), container);
				renderer.dispose();
			});

			it('binds keydown and mousedown to the container\'s window, not the main window', () => {
				const { auxWindow, container } = createAuxiliaryWindow();
				const renderer = disposables.add(new PositronModalReactRenderer({ container }));
				const onKeyDown = vi.fn();
				const onMouseDown = vi.fn();
				disposables.add(renderer.onKeyDown(onKeyDown));
				disposables.add(renderer.onMouseDown(onMouseDown));
				renderer.render(createMockReactElement());

				dispatchInput(mainWindow);
				expect(onKeyDown).not.toHaveBeenCalled();
				expect(onMouseDown).not.toHaveBeenCalled();

				dispatchInput(auxWindow);
				expect(onKeyDown).toHaveBeenCalledTimes(1);
				expect(onMouseDown).toHaveBeenCalledTimes(1);

				renderer.dispose();
			});

			it('removes the listeners it added from the container\'s window on dispose', () => {
				const { auxWindow, container } = createAuxiliaryWindow();
				const addEventListener = vi.spyOn(auxWindow, 'addEventListener');
				const removeEventListener = vi.spyOn(auxWindow, 'removeEventListener');
				const renderer = disposables.add(new PositronModalReactRenderer({ container }));
				renderer.render(createMockReactElement());

				const added = addEventListener.mock.calls.filter(([type]) => ['keydown', 'mousedown', 'resize'].includes(type));
				expect(added.map(([type]) => type).sort()).toEqual(['keydown', 'mousedown', 'resize']);

				renderer.dispose();

				for (const [type, listener, options] of added) {
					expect(removeEventListener).toHaveBeenCalledWith(type, listener, options);
				}
			});

			it('follows the top renderer across windows', () => {
				const { auxWindow, container: auxContainer } = createAuxiliaryWindow();
				const mainRenderer = disposables.add(new PositronModalReactRenderer({ container: createMockContainer() }));
				const auxRenderer = disposables.add(new PositronModalReactRenderer({ container: auxContainer }));
				const onMainKeyDown = vi.fn();
				const onAuxKeyDown = vi.fn();
				disposables.add(mainRenderer.onKeyDown(onMainKeyDown));
				disposables.add(auxRenderer.onKeyDown(onAuxKeyDown));

				mainRenderer.render(createMockReactElement());
				auxRenderer.render(createMockReactElement());
				dispatchInput(mainWindow);
				dispatchInput(auxWindow);
				expect(onMainKeyDown).not.toHaveBeenCalled();
				expect(onAuxKeyDown).toHaveBeenCalledTimes(1);

				auxRenderer.dispose();
				dispatchInput(auxWindow);
				dispatchInput(mainWindow);
				expect(onAuxKeyDown).toHaveBeenCalledTimes(1);
				expect(onMainKeyDown).toHaveBeenCalledTimes(1);

				mainRenderer.dispose();
			});
		});

		describe('default container', () => {
			function stubContainers(containers: Map<Window, HTMLElement>): void {
				const layoutService = PositronReactServices.services.workbenchLayoutService;

				// The test service's field is writable, despite the readonly interface.
				(layoutService as { activeContainer: HTMLElement }).activeContainer = containers.get(mainWindow)!;
				vi.spyOn(layoutService, 'getContainer').mockImplementation(
					(targetWindow: Window) => containers.get(targetWindow)!
				);
			}

			it('uses the active container while its window is visible', () => {
				const mainContainer = createMockContainer();
				const { auxWindow, container: auxContainer } = createAuxiliaryWindow();
				stubContainers(new Map([[mainWindow, mainContainer], [auxWindow, auxContainer]]));

				const renderer = disposables.add(new PositronModalReactRenderer());
				renderer.render(createMockReactElement());

				expect(mainContainer.children.length).toBe(1);
				expect(auxContainer.children.length).toBe(0);

				renderer.dispose();
			});

			it('opens in a visible window when the active container\'s window is hidden', () => {
				const mainContainer = createMockContainer();
				const { auxWindow, container: auxContainer } = createAuxiliaryWindow();
				stubContainers(new Map([[mainWindow, mainContainer], [auxWindow, auxContainer]]));
				vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
				vi.spyOn(auxWindow.document, 'hasFocus').mockReturnValue(false);

				const renderer = disposables.add(new PositronModalReactRenderer());
				renderer.render(createMockReactElement());

				expect(mainContainer.children.length).toBe(0);
				expect(auxContainer.children.length).toBe(1);

				renderer.dispose();
			});

			it('prefers the visible window that has focus', () => {
				const mainContainer = createMockContainer();
				const first = createAuxiliaryWindow();
				const second = createAuxiliaryWindow();
				stubContainers(new Map([
					[mainWindow, mainContainer],
					[first.auxWindow, first.container],
					[second.auxWindow, second.container]
				]));
				vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
				vi.spyOn(first.auxWindow.document, 'hasFocus').mockReturnValue(false);
				vi.spyOn(second.auxWindow.document, 'hasFocus').mockReturnValue(true);

				const renderer = disposables.add(new PositronModalReactRenderer());
				renderer.render(createMockReactElement());

				expect(first.container.children.length).toBe(0);
				expect(second.container.children.length).toBe(1);

				renderer.dispose();
			});

			it('keeps the active container when no window is visible', () => {
				const mainContainer = createMockContainer();
				const { auxWindow, container: auxContainer } = createAuxiliaryWindow();
				stubContainers(new Map([[mainWindow, mainContainer], [auxWindow, auxContainer]]));
				vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
				vi.spyOn(auxWindow.document, 'visibilityState', 'get').mockReturnValue('hidden');

				const renderer = disposables.add(new PositronModalReactRenderer());
				renderer.render(createMockReactElement());

				expect(mainContainer.children.length).toBe(1);
				expect(auxContainer.children.length).toBe(0);

				renderer.dispose();
			});

			it('honors an explicit container even when its window is hidden', () => {
				const mainContainer = createMockContainer();
				const { auxWindow, container: auxContainer } = createAuxiliaryWindow();
				stubContainers(new Map([[mainWindow, mainContainer], [auxWindow, auxContainer]]));
				vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');

				const renderer = disposables.add(new PositronModalReactRenderer({ container: mainContainer }));

				expect(renderer.container).toBe(mainContainer);
			});
		});

		describe('focus restore', () => {
			it('returns focus to the element focused in the modal\'s window', () => {
				const { auxWindow, container } = createAuxiliaryWindow();
				const button = auxWindow.document.createElement('button');
				auxWindow.document.body.appendChild(button);
				button.focus();
				expect(auxWindow.document.activeElement).toBe(button);

				const renderer = disposables.add(new PositronModalReactRenderer({ container }));
				renderer.render(createMockReactElement());
				expect(auxWindow.document.activeElement).not.toBe(button);

				renderer.dispose();
				expect(auxWindow.document.activeElement).toBe(button);
			});
		});
	});
});
