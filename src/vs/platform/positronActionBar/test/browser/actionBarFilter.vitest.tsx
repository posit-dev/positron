/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { ActionBarFilter } from '../../browser/components/actionBarFilter.js';
import { IHoverService } from '../../../hover/browser/hover.js';
import { IHoverManager } from '../../../hover/browser/hoverManager.js';
import { createTestContainer } from '../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../test/vitest/reactTestingLibrary.js';

describe('ActionBarFilter tooltips', () => {
	const showInstantHover = vi.fn();
	const ctx = createTestContainer()
		.withReactServices()
		.stub(IHoverService, { showInstantHover, hideHover: vi.fn() })
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);
	const hoverManager = { showHover: vi.fn(), hideHover: vi.fn() } satisfies IHoverManager;

	beforeEach(() => {
		showInstantHover.mockClear();
	});

	describe('with a hoverManager prop', () => {
		it('shows the "Clear filter" tooltip through the given manager', async () => {
			rtl.render(<ActionBarFilter hoverManager={hoverManager} initialFilterText='abc' onFilterTextChanged={() => { }} />);
			const user = userEvent.setup();
			const clear = screen.getByRole('button', { name: 'Clear filter' });
			await user.hover(clear);
			expect(hoverManager.showHover).toHaveBeenCalledWith(clear, 'Clear filter');
			await user.unhover(clear);
			expect(hoverManager.hideHover).toHaveBeenCalled();
		});

		it('shows the "Filter options" tooltip by default and a custom filterButtonTooltip when given', async () => {
			rtl.render(
				<>
					<ActionBarFilter hoverManager={hoverManager} onFilterButtonPressed={() => { }} onFilterTextChanged={() => { }} />
					<ActionBarFilter
						filterButtonTooltip='Sort and filter packages'
						hoverManager={hoverManager}
						onFilterButtonPressed={() => { }}
						onFilterTextChanged={() => { }}
					/>
				</>
			);
			const user = userEvent.setup();
			const [defaultFilter, customFilter] = screen.getAllByRole('button', { name: 'Filter options' });
			await user.hover(defaultFilter);
			expect(hoverManager.showHover).toHaveBeenCalledWith(defaultFilter, 'Filter options');
			await user.hover(customFilter);
			expect(hoverManager.showHover).toHaveBeenCalledWith(customFilter, 'Sort and filter packages');
		});

		it('does not create its own hover manager', async () => {
			rtl.render(<ActionBarFilter hoverManager={hoverManager} initialFilterText='abc' onFilterTextChanged={() => { }} />);
			const user = userEvent.setup();
			await user.hover(screen.getByRole('button', { name: 'Clear filter' }));
			// Wait past any hover delay: only the given manager may have been used.
			await new Promise(resolve => setTimeout(resolve, 50));
			expect(showInstantHover).not.toHaveBeenCalled();
		});
	});

	// Without a prop the component creates its own manager, which reaches the hover service.
	describe('without a hoverManager prop', () => {
		it('falls back to its own manager for the clear button', async () => {
			rtl.render(<ActionBarFilter initialFilterText='abc' onFilterTextChanged={() => { }} />);
			const user = userEvent.setup();
			await user.hover(screen.getByRole('button', { name: 'Clear filter' }));
			await waitFor(() => expect(showInstantHover).toHaveBeenCalledWith(
				expect.objectContaining({ content: 'Clear filter' }),
				false
			));
		});

		it('falls back to its own manager for the filter button', async () => {
			rtl.render(<ActionBarFilter onFilterButtonPressed={() => { }} onFilterTextChanged={() => { }} />);
			const user = userEvent.setup();
			await user.hover(screen.getByRole('button', { name: 'Filter options' }));
			await waitFor(() => expect(showInstantHover).toHaveBeenCalledWith(
				expect.objectContaining({ content: 'Filter options' }),
				false
			));
		});
	});
});
