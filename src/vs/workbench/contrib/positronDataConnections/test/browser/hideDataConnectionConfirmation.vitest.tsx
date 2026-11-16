/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { PositronReactServices } from '../../../../../base/browser/positronReactServices.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { showHideDataConnectionConfirmation } from '../../browser/dialogs/hideDataConnectionConfirmation.js';

describe('showHideDataConnectionConfirmation', () => {
	const ctx = createTestContainer().withReactServices().build();

	// The dialog renders itself through its own PositronModalReactRenderer rather than being
	// handed to rtl.render, so this only establishes the services context it renders into.
	setupRTLRenderer(() => ctx.reactServices);

	beforeEach(() => {
		// PositronModalReactRenderer reads the services singleton in its constructor to find the
		// container to render into, so the container's services have to be reachable from there.
		PositronReactServices.services = ctx.reactServices;
	});

	it('names the connection and the one Data Explorer that will close, and resolves true on Hide', async () => {
		const confirmation = showHideDataConnectionConfirmation('My Connection', 1);

		expect(await screen.findByText(/Hiding 'My Connection' closes its connection/)).toBeInTheDocument();
		expect(screen.getByText('The Data Explorer open on this connection will close.')).toBeInTheDocument();

		await userEvent.click(screen.getByRole('button', { name: 'Hide' }));
		expect(await confirmation).toBe(true);
	});

	it('counts several open Data Explorers, and resolves false on Cancel', async () => {
		const confirmation = showHideDataConnectionConfirmation('My Connection', 3);

		expect(await screen.findByText('The 3 Data Explorers open on this connection will close.')).toBeInTheDocument();

		await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(await confirmation).toBe(false);
	});
});
