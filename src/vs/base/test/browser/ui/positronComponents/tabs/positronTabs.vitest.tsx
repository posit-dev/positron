/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { setupRTLRenderer } from '../../../../../../test/vitest/reactTestingLibrary.js';
import { PositronTab, PositronTabs } from '../../../../../browser/ui/positronComponents/tabs/positronTabs.js';

const OVERVIEW: PositronTab = { id: 'overview', label: 'Overview', content: <p>Overview panel</p> };
const DEFINITION: PositronTab = { id: 'definition', label: 'Definition', content: <p>Definition panel</p> };
const ACCESS: PositronTab = { id: 'access', label: 'Access', content: <p>Access panel</p> };

describe('PositronTabs', () => {
	const rtl = setupRTLRenderer();

	it('shows the first tab\'s panel, wired to its tab, and hides the rest', () => {
		rtl.render(<PositronTabs ariaLabel='Details' tabs={[OVERVIEW, DEFINITION]} />);

		const overviewTab = screen.getByRole('tab', { name: 'Overview' });
		const overviewPanel = screen.getByRole('tabpanel', { name: 'Overview' });
		expect(overviewTab).toHaveAttribute('aria-selected', 'true');
		expect(overviewTab).toHaveAttribute('aria-controls', overviewPanel.id);
		expect(overviewPanel).toHaveTextContent('Overview panel');
		expect(screen.getByRole('tab', { name: 'Definition' })).toHaveAttribute('aria-selected', 'false');
		// Rendered, but hidden: every tab's panel exists so its aria-controls resolves.
		expect(screen.getByText('Definition panel')).not.toBeVisible();
	});

	it('names a tab by its ariaLabel when its label would not read well on its own', () => {
		// E.g. a tab whose label carries a bare count badge.
		const security: PositronTab = { id: 'security', label: <>Security 3</>, ariaLabel: 'Security, 3 known vulnerabilities', content: <p>Advisories</p> };
		rtl.render(<PositronTabs ariaLabel='Details' tabs={[OVERVIEW, security]} />);

		expect(screen.getByRole('tab', { name: 'Security, 3 known vulnerabilities' })).toBeInTheDocument();
	});

	it('shows a tab\'s panel when the tab is clicked, and keeps only that tab in the tab order', async () => {
		rtl.render(<PositronTabs ariaLabel='Details' tabs={[OVERVIEW, DEFINITION, ACCESS]} />);
		const user = userEvent.setup();

		await user.click(screen.getByRole('tab', { name: 'Definition' }));

		expect(screen.getByRole('tab', { name: 'Definition' })).toHaveAttribute('aria-selected', 'true');
		expect(screen.getByText('Definition panel')).toBeVisible();
		expect(screen.getByText('Overview panel')).not.toBeVisible();

		// Tabbing into the strip lands on the selected tab, not the first one. (Where the next Tab goes
		// isn't asserted: jsdom, unlike a browser, lets focus land in the hidden panels.)
		await user.tab();
		expect(screen.getByRole('tab', { name: 'Definition' })).toHaveFocus();
	});

	it('moves the selection and focus with the arrow keys, wrapping, and with Home and End', async () => {
		rtl.render(<PositronTabs ariaLabel='Details' tabs={[OVERVIEW, DEFINITION, ACCESS]} />);
		const user = userEvent.setup();
		// Tab in, as a keyboard user does: the selected tab is the one in the tab order. (A click
		// would not focus it; Button consumes mousedown.)
		await user.tab();
		expect(screen.getByRole('tab', { name: 'Overview' })).toHaveFocus();

		await user.keyboard('{ArrowRight}');
		expect(screen.getByRole('tab', { name: 'Definition' })).toHaveFocus();
		expect(screen.getByText('Definition panel')).toBeVisible();

		await user.keyboard('{ArrowLeft}');
		expect(screen.getByRole('tab', { name: 'Overview' })).toHaveFocus();

		// Left from the first tab wraps to the last.
		await user.keyboard('{ArrowLeft}');
		expect(screen.getByRole('tab', { name: 'Access' })).toHaveFocus();
		expect(screen.getByText('Access panel')).toBeVisible();

		// Right from the last tab wraps to the first.
		await user.keyboard('{ArrowRight}');
		expect(screen.getByRole('tab', { name: 'Overview' })).toHaveFocus();

		await user.keyboard('{End}');
		expect(screen.getByRole('tab', { name: 'Access' })).toHaveAttribute('aria-selected', 'true');

		await user.keyboard('{Home}');
		expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
		expect(screen.getByText('Overview panel')).toBeVisible();
	});

	it('falls back to the first tab when the selected tab goes away', async () => {
		const { rerender } = rtl.render(<PositronTabs ariaLabel='Details' tabs={[OVERVIEW, DEFINITION, ACCESS]} />);
		const user = userEvent.setup();
		await user.click(screen.getByRole('tab', { name: 'Definition' }));

		// E.g. the Packages editor dropping its Security tab when advisories are turned off. Access is
		// left as a neighbour, so falling back to anything but the first tab would show.
		rerender(<PositronTabs ariaLabel='Details' tabs={[OVERVIEW, ACCESS]} />);

		expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
		expect(screen.getByText('Overview panel')).toBeVisible();
	});
});
