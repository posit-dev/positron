/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { LayoutCardList } from '../../browser/positronWelcomePage/components/layoutCards.js';

const DATA_ANALYSIS = 'workbench.action.positronTwoPaneDataScienceLayout';
const DEFAULT = 'workbench.action.positronFourPaneDataScienceLayout';

describe('LayoutCardList', () => {
	const ctx = createTestContainer().withReactServices().build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	it('shows a card for each layout, with the picked one checked', () => {
		rtl.render(<LayoutCardList currentLayoutId={undefined} labelledBy='title' selectedLayoutId={DEFAULT} onSelect={vi.fn()} />);

		expect(screen.getAllByRole('radio')).toHaveLength(4);
		expect(screen.getByRole('radio', { name: /^Default/ })).toBeChecked();
		expect(screen.getByRole('radio', { name: /^Data Analysis/ })).not.toBeChecked();
		expect(screen.queryByText('Current')).not.toBeInTheDocument();
	});

	it('marks the layout the window is in as current', () => {
		rtl.render(<LayoutCardList currentLayoutId={DATA_ANALYSIS} labelledBy='title' selectedLayoutId={DEFAULT} onSelect={vi.fn()} />);

		expect(screen.getByRole('radio', { name: /^Data Analysis\s*Current/ })).toBeInTheDocument();
	});

	it('reports the picked layout without applying it', async () => {
		const user = userEvent.setup();
		const onSelect = vi.fn();
		rtl.render(<LayoutCardList currentLayoutId={undefined} labelledBy='title' selectedLayoutId={DATA_ANALYSIS} onSelect={onSelect} />);

		await user.click(screen.getByRole('radio', { name: /^Default/ }));

		expect(onSelect).toHaveBeenCalledWith(DEFAULT);
	});
});
