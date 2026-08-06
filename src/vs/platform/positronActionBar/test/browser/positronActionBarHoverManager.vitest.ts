/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Event } from '../../../../base/common/event.js';
import { IConfigurationService } from '../../../configuration/common/configuration.js';
import { IHoverService } from '../../../hover/browser/hover.js';
import { IHoverWidget } from '../../../../base/browser/ui/hover/hover.js';
import { PositronActionBarHoverManager } from '../../browser/positronActionBarHoverManager.js';
import { stubInterface } from '../../../../test/vitest/stubInterface.js';

const HOVER_DELAY = 500;

describe('PositronActionBarHoverManager', () => {
	/**
	 * Builds a manager over stubbed services, and reports how many hovers actually reached the
	 * hover service.
	 */
	function createManager() {
		const shown: string[] = [];
		const hoverService = stubInterface<IHoverService>({
			showInstantHover: (options: { content: unknown }) => {
				shown.push(String(options.content));
				return stubInterface<IHoverWidget>({ dispose: () => { } });
			},
			hideHover: () => { },
		});
		const configurationService = stubInterface<IConfigurationService>({
			getValue: () => HOVER_DELAY,
			onDidChangeConfiguration: Event.None,
		});
		const manager = new PositronActionBarHoverManager(false, configurationService, hoverService);
		return { manager, shown };
	}

	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('ignores a repeat request for the hover it has already scheduled', () => {
		const { manager, shown } = createManager();
		const target = document.createElement('button');

		// Re-issuing the same hover while its delay is still running must not restart the delay,
		// otherwise a re-rendering widget would postpone the tooltip forever.
		manager.showHover(target, 'Previous Match');
		vi.advanceTimersByTime(HOVER_DELAY - 100);
		manager.showHover(target, 'Previous Match');
		vi.advanceTimersByTime(100);

		expect(shown).toStrictEqual(['Previous Match']);
		manager.dispose();
	});

	it('reschedules when the target or the content changes', () => {
		const { manager, shown } = createManager();
		const previous = document.createElement('button');
		const next = document.createElement('button');

		manager.showHover(previous, 'Previous Match');
		manager.showHover(next, 'Next Match');
		vi.advanceTimersByTime(HOVER_DELAY);

		expect(shown).toStrictEqual(['Next Match']);
		manager.dispose();
	});

	it('shows again after the hover is hidden', () => {
		const { manager, shown } = createManager();
		const target = document.createElement('button');

		manager.showHover(target, 'Previous Match');
		vi.advanceTimersByTime(HOVER_DELAY);
		manager.hideHover();
		manager.showHover(target, 'Previous Match');
		vi.advanceTimersByTime(HOVER_DELAY);

		expect(shown).toStrictEqual(['Previous Match', 'Previous Match']);
		manager.dispose();
	});
});
