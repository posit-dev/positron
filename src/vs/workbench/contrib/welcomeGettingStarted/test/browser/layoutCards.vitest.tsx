/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { LayoutCardList } from '../../browser/positronWelcomePage/components/layoutCards.js';

const SIMPLIFIED = 'workbench.action.positronSimplifiedLayout';
const STACKED = 'workbench.action.positronFourPaneDataScienceLayout';

describe('LayoutCardList', () => {
	const ctx = createTestContainer().withReactServices().build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	it('shows a card for each layout, with the picked one checked', () => {
		rtl.render(<LayoutCardList currentLayoutId={undefined} labelledBy='title' selectedLayoutId={STACKED} onSelect={vi.fn()} />);

		expect(screen.getAllByRole('radio')).toHaveLength(4);
		expect(screen.getByRole('radio', { name: /^Stacked/ })).toBeChecked();
		expect(screen.getByRole('radio', { name: /^Simplified/ })).not.toBeChecked();
		expect(screen.queryByText('Current')).not.toBeInTheDocument();
	});

	it('marks the layout the window is in as current', () => {
		rtl.render(<LayoutCardList currentLayoutId={SIMPLIFIED} labelledBy='title' selectedLayoutId={STACKED} onSelect={vi.fn()} />);

		expect(screen.getByRole('radio', { name: /^Simplified\s*Current/ })).toBeInTheDocument();
	});

	it('reports the picked layout without applying it', async () => {
		const user = userEvent.setup();
		const onSelect = vi.fn();
		rtl.render(<LayoutCardList currentLayoutId={undefined} labelledBy='title' selectedLayoutId={SIMPLIFIED} onSelect={onSelect} />);

		await user.click(screen.getByRole('radio', { name: /^Stacked/ }));

		expect(onSelect).toHaveBeenCalledWith(STACKED);
	});
});
