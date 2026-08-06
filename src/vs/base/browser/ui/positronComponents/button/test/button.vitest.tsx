/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Button } from '../button.js';
import { IHoverManager } from '../../../../../../platform/hover/browser/hoverManager.js';
import { setupRTLRenderer } from '../../../../../../test/vitest/reactTestingLibrary.js';

describe('Button hover', () => {
	const rtl = setupRTLRenderer();

	/**
	 * Recording IHoverManager. Mirrors the real manager's contract: hideHover()
	 * cancels whatever showHover() last requested.
	 */
	function createHoverManager() {
		const calls: { showHover: number; hideHover: number } = { showHover: 0, hideHover: 0 };
		const manager: IHoverManager = {
			showHover: () => { calls.showHover++; },
			hideHover: () => { calls.hideHover++; },
		};
		return { manager, calls };
	}

	it('re-shows the hover after an external hide cancels it while the pointer is still inside', async () => {
		const { manager, calls } = createHoverManager();
		const { rerender } = rtl.render(
			<Button hoverManager={manager} tooltip='Previous Match'>up</Button>
		);

		await userEvent.hover(screen.getByRole('button'));
		expect(calls.showHover).toBe(1);

		// Something else hides the hover inside the manager's delay window -- a
		// sibling button's mouseleave, a global hide, a re-mount. The real
		// manager clears its pending timeout here, so no tooltip will appear.
		manager.hideHover();

		// The pointer never moved, so there is no second mouseenter. The next
		// render of the widget is the only chance to notice the hover is gone.
		rerender(<Button hoverManager={manager} tooltip='Previous Match'>up</Button>);

		expect(calls.showHover).toBe(2);
	});
});
