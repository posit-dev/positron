/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />
/// <reference types="@testing-library/jest-dom/vitest" />

import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { CanvasSwitchCurtain } from '../../browser/canvasSwitchCurtain.js';

/** The ARIA attributes the curtain moves between states; absent ones read as `null`. */
const ARIA_ATTRIBUTES = ['role', 'aria-live', 'aria-busy', 'aria-modal', 'aria-labelledby'] as const;

/** Collects the curtain's ARIA state into one comparable object. */
function attributes(element: Element): Record<string, string | null> {
	return Object.fromEntries(ARIA_ATTRIBUTES.map(name => [name, element.getAttribute(name)]));
}

const LOADING_ATTRIBUTES = {
	'role': 'status',
	'aria-live': 'polite',
	'aria-busy': 'true',
	'aria-modal': null,
	'aria-labelledby': null,
};

const FAILURE_ATTRIBUTES = {
	'role': 'dialog',
	'aria-live': null,
	'aria-busy': 'false',
	'aria-modal': 'true',
	'aria-labelledby': 'positron-canvas-switch-failure-brand',
};

describe('CanvasSwitchCurtain', () => {
	const disposables = ensureNoLeakedDisposables();

	function createContainer(): HTMLElement {
		const container = document.createElement('div');
		document.body.appendChild(container);
		disposables.add(toDisposable(() => container.remove()));
		return container;
	}

	// The curtain is plain DOM built by the Monaco Button widget, not React, and
	// Testing Library queries may only be imported by the vitest infrastructure.
	/** The curtain element while it is up, `null` once it came down. */
	function curtainOf(container: HTMLElement): Element | null {
		// eslint-disable-next-line no-restricted-syntax -- non-React DOM; no semantic query available here
		return container.getElementsByClassName('positron-canvas-startup-curtain').item(0);
	}

	/** The curtain's buttons in DOM order; the Button widget renders each as `.monaco-button`. */
	function buttonsOf(container: HTMLElement): HTMLElement[] {
		// eslint-disable-next-line no-restricted-syntax -- non-React DOM; no semantic query available here
		return Array.from(container.getElementsByClassName('monaco-button')) as HTMLElement[];
	}

	/** The brand element carrying the failure card's accessible name. */
	function brandOf(container: HTMLElement): Element | null {
		// eslint-disable-next-line no-restricted-syntax -- non-React DOM; no semantic query available here
		return container.getElementsByClassName('positron-canvas-startup-brand').item(0);
	}

	function createCurtain(container: HTMLElement): CanvasSwitchCurtain {
		return disposables.add(new CanvasSwitchCurtain(container));
	}

	it('shows loading as a busy status region with a spinner and no buttons', () => {
		const container = createContainer();
		const curtain = createCurtain(container);

		curtain.showLoading();

		const element = curtainOf(container)!;
		expect(attributes(element)).toEqual(LOADING_ATTRIBUTES);
		// eslint-disable-next-line no-restricted-syntax -- non-React DOM; no semantic query available here
		expect(element.getElementsByClassName('positron-canvas-startup-spinner')).toHaveLength(1);
		expect(element).toHaveTextContent('Canvas is starting in new workspace');
		expect(buttonsOf(container)).toHaveLength(0);
	});

	it('shows failure as a modal dialog labelled by its brand, focused on Retry Canvas', () => {
		const container = createContainer();
		const curtain = createCurtain(container);
		const retry = vi.fn();
		const openPositron = vi.fn();

		curtain.showFailure('The runtime refused to stop.', { retry, openPositron });

		const element = curtainOf(container)!;
		expect(attributes(element)).toEqual(FAILURE_ATTRIBUTES);
		expect(brandOf(container)?.id).toBe(element.getAttribute('aria-labelledby'));
		expect(element).toHaveTextContent('The runtime refused to stop.');

		const buttons = buttonsOf(container);
		expect(buttons.map(button => button.textContent)).toEqual(['Retry Canvas', 'Open Positron']);
		expect(buttons[0]).toHaveFocus();

		buttons[0].click();
		buttons[1].click();
		expect(retry).toHaveBeenCalledTimes(1);
		expect(openPositron).toHaveBeenCalledTimes(1);
	});

	// A curtain moves loading -> failure -> loading on one element (Retry
	// picks the switch back up), so each state must clear the other's
	// attributes and drop the other's buttons rather than accumulate them.
	it('replaces the previous state on the same element', () => {
		const container = createContainer();
		const curtain = createCurtain(container);
		const retry = vi.fn();

		curtain.showLoading();
		const element = curtainOf(container)!;

		curtain.showFailure('detail', { retry, openPositron: vi.fn() });
		expect(curtainOf(container)).toBe(element);
		expect(attributes(element)).toEqual(FAILURE_ATTRIBUTES);
		const [retryButton] = buttonsOf(container);

		curtain.showLoading();
		expect(curtainOf(container)).toBe(element);
		expect(attributes(element)).toEqual(LOADING_ATTRIBUTES);
		expect(brandOf(container)?.id).toBe('');
		expect(buttonsOf(container)).toHaveLength(0);
		// The disposed failure button is gone from the DOM and from the handler.
		retryButton.click();
		expect(retry).not.toHaveBeenCalled();
	});

	it('removes its element on dispose', () => {
		const container = createContainer();
		const curtain = createCurtain(container);

		curtain.showLoading();
		expect(curtainOf(container)).not.toBeNull();

		curtain.dispose();
		expect(curtainOf(container)).toBeNull();
	});
});
