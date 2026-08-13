/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { PositronReactServices } from '../../../../../base/browser/positronReactServices.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { showRemoveDataConnectionConfirmation } from '../../browser/dialogs/removeDataConnectionConfirmation.js';

describe('showRemoveDataConnectionConfirmation', () => {
	const ctx = createTestContainer().withReactServices().build();

	// The dialog renders itself through its own PositronModalDialogReactRenderer rather than being
	// handed to rtl.render, so this only establishes the services context it renders into.
	setupRTLRenderer(() => ctx.reactServices);

	beforeEach(() => {
		// PositronModalDialogReactRenderer reads the services singleton in its constructor to find the
		// container to render into, so the container's services have to be reachable from there.
		PositronReactServices.services = ctx.reactServices;
	});

	it('names the connection and warns that the removal cannot be undone', async () => {
		const confirmation = showRemoveDataConnectionConfirmation('My Connection', 0);

		expect(await screen.findByText(/'My Connection' will be deleted/)).toBeInTheDocument();
		expect(screen.getByText(/cannot be undone/)).toBeInTheDocument();

		// No Data Explorers are open, so the dialog says nothing about closing any.
		expect(screen.queryByText(/Data Explorer/)).not.toBeInTheDocument();

		await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(await confirmation).toBe(false);
	});

	it('warns about a single open Data Explorer', async () => {
		const confirmation = showRemoveDataConnectionConfirmation('My Connection', 1);

		expect(await screen.findByText('The Data Explorer open on this connection will close.'))
			.toBeInTheDocument();

		await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
		expect(await confirmation).toBe(true);
	});

	it('opens with the focus on Cancel, not on the confirming button', async () => {
		const confirmation = showRemoveDataConnectionConfirmation('My Connection', 0);

		// Removing a connection cannot be undone, so the keystrokes that dismiss a dialog must not
		// carry it out: Enter on the focused Cancel button backs out.
		const cancelButton = await screen.findByRole('button', { name: 'Cancel' });
		expect(cancelButton).toHaveFocus();
		expect(screen.getByRole('button', { name: 'Remove' })).not.toHaveFocus();

		await userEvent.keyboard('{Enter}');
		expect(await confirmation).toBe(false);
	});

	it('styles the confirming button as destructive rather than as the default', async () => {
		const confirmation = showRemoveDataConnectionConfirmation('My Connection', 0);

		// The class is what the destructive footer contributes, and carries the red; a default-styled
		// primary would take the accent fill instead and leave that red unreadable.
		const removeButton = await screen.findByRole('button', { name: 'Remove' });
		expect(removeButton).toHaveClass('destructive');
		expect(removeButton).not.toHaveClass('default');

		// Settle the dialog: it renders into the layout container through its own renderer, which
		// outlives RTL's cleanup, so a dialog left open would still be there for the next test.
		await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(await confirmation).toBe(false);
	});

	it('warns about several open Data Explorers', async () => {
		const confirmation = showRemoveDataConnectionConfirmation('My Connection', 3);

		expect(await screen.findByText('The 3 Data Explorers open on this connection will close.'))
			.toBeInTheDocument();

		await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
		expect(await confirmation).toBe(true);
	});
});
