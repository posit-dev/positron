/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { PositronReactServices } from '../../../../../base/browser/positronReactServices.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { showSaveDataConnectionConfirmation } from '../../browser/dialogs/saveDataConnectionConfirmation.js';

describe('showSaveDataConnectionConfirmation', () => {
	const ctx = createTestContainer().withReactServices().build();

	// The dialog renders itself through its own PositronModalReactRenderer rather than being
	// handed to rtl.render, so this only establishes the services context it renders into.
	setupRTLRenderer(() => ctx.reactServices);

	beforeEach(() => {
		// PositronModalReactRenderer reads the services singleton in its constructor to find the
		// container to render into, so the container's services have to be reachable from there.
		PositronReactServices.services = ctx.reactServices;
	});

	it('names the connection and the one Data Explorer that will close, and resolves true on Save', async () => {
		const confirmation = showSaveDataConnectionConfirmation('My Connection', 1);

		expect(await screen.findByText(/close the connection to 'My Connection'/)).toBeInTheDocument();
		expect(screen.getByText('The Data Explorer open on this connection will close.')).toBeInTheDocument();

		// Save is not destructive: nothing is lost that cannot be reopened.
		const saveButton = screen.getByRole('button', { name: 'Save' });
		expect(saveButton).not.toHaveClass('destructive');

		await userEvent.click(saveButton);
		expect(await confirmation).toBe(true);
	});

	it('counts several open Data Explorers, and resolves false on Cancel', async () => {
		const confirmation = showSaveDataConnectionConfirmation('My Connection', 2);

		expect(await screen.findByText('The 2 Data Explorers open on this connection will close.')).toBeInTheDocument();

		await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(await confirmation).toBe(false);
	});
});
