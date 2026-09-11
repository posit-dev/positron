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
import { showMissingPackagesInstallModal } from '../../browser/missingPackagesInstallModal.js';
import { showMissingPackagesPreflightModal } from '../../browser/missingPackagesPreflightModal.js';

// Escape reaches these modals through the dialog's keyboard hook, which calls the same onCancel the
// Cancel button does. A modal that forgets to pass onCancel would leave its caller waiting forever,
// with nothing in the UI to say so, so each modal is checked here rather than only at the hook.
describe('dismissing a missing packages modal with Escape', () => {
	const ctx = createTestContainer().withReactServices().build();

	// The modals render themselves through their own PositronModalReactRenderer rather than being
	// handed to rtl.render, so this only establishes the services context they render into.
	setupRTLRenderer(() => ctx.reactServices);

	beforeEach(() => {
		// PositronModalReactRenderer reads the services singleton in its constructor to find the
		// container to render into, so the container's services have to be reachable from there.
		PositronReactServices.services = ctx.reactServices;
	});

	it('resolves the install modal as declined', async () => {
		const decision = showMissingPackagesInstallModal('a.py', 'Python', ['numpy'], 'Install');
		expect(await screen.findByRole('button', { name: 'Install' })).toBeInTheDocument();

		await userEvent.keyboard('{Escape}');

		expect(await decision).toBe(false);
	});

	it('resolves the preflight modal as cancelled', async () => {
		const decision = showMissingPackagesPreflightModal('a.py', 'Python', ['numpy']);
		expect(await screen.findByRole('button', { name: 'Cancel' })).toBeInTheDocument();

		await userEvent.keyboard('{Escape}');

		expect(await decision).toEqual({ decision: 'cancel', dontShowAgain: false });
	});
});
