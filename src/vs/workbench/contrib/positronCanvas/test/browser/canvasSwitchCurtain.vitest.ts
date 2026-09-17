/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />
/// <reference types="@testing-library/jest-dom/vitest" />

import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { CanvasSwitchCurtain } from '../../browser/canvasSwitchCurtain.js';

/**
 * The card's ARIA state per curtain state is the startup curtain's and is
 * pinned there (canvasStartupPresenter.vitest.ts); the switch tests click the
 * buttons by label. What only this curtain owns is the loading -> failure ->
 * loading cycle on one element: Retry picks the switch back up, so the failure
 * card's buttons and handlers must be gone, not accumulated.
 */
describe('CanvasSwitchCurtain', () => {
	const disposables = ensureNoLeakedDisposables();

	// The curtain is plain DOM built by the Monaco Button widget, not React, and
	// Testing Library queries may only be imported by the vitest infrastructure.
	/** The curtain's buttons in DOM order; the Button widget renders each as `.monaco-button`. */
	function buttonsOf(container: HTMLElement): HTMLElement[] {
		// eslint-disable-next-line no-restricted-syntax -- non-React DOM; no semantic query available here
		return Array.from(container.getElementsByClassName('monaco-button')) as HTMLElement[];
	}

	it('offers Retry Canvas and Open Positron on failure, focused on Retry, and drops them again on the next loading', () => {
		const container = document.createElement('div');
		document.body.appendChild(container);
		disposables.add(toDisposable(() => container.remove()));
		const curtain = disposables.add(new CanvasSwitchCurtain(container));
		const retry = vi.fn();
		const openPositron = vi.fn();

		curtain.showLoading();
		// eslint-disable-next-line no-restricted-syntax -- non-React DOM; no semantic query available here
		const element = container.getElementsByClassName('positron-canvas-startup-curtain').item(0)!;
		expect(buttonsOf(container)).toHaveLength(0);

		curtain.showFailure('The runtime refused to stop.', { retry, openPositron });
		expect(element).toHaveTextContent('The runtime refused to stop.');
		// eslint-disable-next-line no-restricted-syntax -- non-React DOM; no semantic query available here
		expect(container.getElementsByClassName('positron-canvas-startup-brand').item(0)?.id).toBe(element.getAttribute('aria-labelledby'));
		const [retryButton, openButton] = buttonsOf(container);
		expect([retryButton.textContent, openButton.textContent]).toEqual(['Retry Canvas', 'Open Positron']);
		expect(retryButton).toHaveFocus();
		retryButton.click();
		openButton.click();
		expect({ retries: retry.mock.calls.length, opens: openPositron.mock.calls.length }).toEqual({ retries: 1, opens: 1 });

		curtain.showLoading();
		expect(buttonsOf(container)).toHaveLength(0);
		// The disposed failure button is gone from the DOM and from the handler.
		retryButton.click();
		expect(retry).toHaveBeenCalledTimes(1);
	});
});
