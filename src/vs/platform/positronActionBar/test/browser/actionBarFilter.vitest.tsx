/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { ActionBarFilter } from '../../browser/components/actionBarFilter.js';
import { IHoverService } from '../../../hover/browser/hover.js';
import { createTestContainer } from '../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../test/vitest/reactTestingLibrary.js';

describe('ActionBarFilter tooltips', () => {
	const showInstantHover = vi.fn();
	const ctx = createTestContainer()
		.withReactServices()
		.stub(IHoverService, { showInstantHover, hideHover: vi.fn() })
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	beforeEach(() => {
		showInstantHover.mockClear();
	});

	// The buttons only show a tooltip when the component gives them a hover manager, so check
	// that hovering reaches the hover service rather than just that the label text exists.
	it('shows the "Clear filter" tooltip when hovering the clear button', async () => {
		rtl.render(<ActionBarFilter initialFilterText='abc' onFilterTextChanged={() => { }} />);
		const user = userEvent.setup();
		await user.hover(screen.getByRole('button', { name: 'Clear filter' }));
		await waitFor(() => expect(showInstantHover).toHaveBeenCalledWith(
			expect.objectContaining({ content: 'Clear filter' }),
			false
		));
	});

	it('shows the "Filter options" tooltip by default when hovering the filter button', async () => {
		rtl.render(<ActionBarFilter onFilterButtonPressed={() => { }} onFilterTextChanged={() => { }} />);
		const user = userEvent.setup();
		await user.hover(screen.getByRole('button', { name: 'Filter options' }));
		await waitFor(() => expect(showInstantHover).toHaveBeenCalledWith(
			expect.objectContaining({ content: 'Filter options' }),
			false
		));
	});

	it('shows a custom filterButtonTooltip when one is provided', async () => {
		rtl.render(
			<ActionBarFilter
				filterButtonTooltip='Sort and filter packages'
				onFilterButtonPressed={() => { }}
				onFilterTextChanged={() => { }}
			/>
		);
		const user = userEvent.setup();
		await user.hover(screen.getByRole('button', { name: 'Filter options' }));
		await waitFor(() => expect(showInstantHover).toHaveBeenCalledWith(
			expect.objectContaining({ content: 'Sort and filter packages' }),
			false
		));
	});
});
