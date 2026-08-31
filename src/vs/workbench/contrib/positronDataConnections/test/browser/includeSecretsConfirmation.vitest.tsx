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
import { showIncludeSecretsConfirmation } from '../../browser/dialogs/includeSecretsConfirmation.js';

describe('showIncludeSecretsConfirmation', () => {
	const ctx = createTestContainer().withReactServices().build();

	// The dialog renders itself through its own PositronModalReactRenderer rather than being
	// handed to rtl.render, so this only establishes the services context it renders into.
	setupRTLRenderer(() => ctx.reactServices);

	beforeEach(() => {
		// PositronModalReactRenderer reads the services singleton in its constructor to find the
		// container to render into, so the container's services have to be reachable from there.
		PositronReactServices.services = ctx.reactServices;
	});

	it('warns that the secrets end up in the connection code', async () => {
		const confirmation = showIncludeSecretsConfirmation();

		expect(await screen.findByText(/written into the connection code/)).toBeInTheDocument();

		await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(await confirmation).toBe(false);
	});

	it('resolves false when the dialog is dismissed with Escape', async () => {
		const confirmation = showIncludeSecretsConfirmation();
		expect(await screen.findByText(/written into the connection code/)).toBeInTheDocument();

		await userEvent.keyboard('{Escape}');

		expect(await confirmation).toBe(false);
	});
});
