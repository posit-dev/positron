/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen } from '@testing-library/react';
import { PositronReactServices } from '../../../../../base/browser/positronReactServices.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { showMissingPackagesInstallModal } from '../../browser/missingPackagesInstallModal.js';
import { showMissingPackagesPreflightModal } from '../../browser/missingPackagesPreflightModal.js';

/**
 * Dismisses the open modal the way Escape does. Escape closes the native <dialog>, which fires its
 * close event and disposes the renderer without ever calling onCancel. jsdom does not wire Escape
 * to that default action, so close the dialog directly, which is the same path.
 */
function dismissTheOpenDialog() {
	// eslint-disable-next-line no-restricted-syntax
	document.querySelector<HTMLDialogElement>('dialog.positron-modal-dialog')!.close();
}

describe('missing packages modals settle when dismissed with Escape', () => {
	const ctx = createTestContainer().withReactServices().build();

	// The modals render themselves through their own PositronModalDialogReactRenderer rather than
	// being handed to rtl.render, so this only establishes the services context they render into.
	setupRTLRenderer(() => ctx.reactServices);

	beforeEach(() => {
		// PositronModalDialogReactRenderer reads the services singleton in its constructor to find the
		// container to render into, so the container's services have to be reachable from there.
		PositronReactServices.services = ctx.reactServices;
	});

	it('the install modal resolves false', async () => {
		const decision = showMissingPackagesInstallModal('a.py', 'Python', ['numpy'], 'Install');
		expect(await screen.findByRole('button', { name: 'Install' })).toBeInTheDocument();

		dismissTheOpenDialog();

		expect(await decision).toBe(false);
	});

	it('the preflight modal resolves the same result as Cancel', async () => {
		const decision = showMissingPackagesPreflightModal('a.py', 'Python', ['numpy']);
		expect(await screen.findByRole('button', { name: 'Cancel' })).toBeInTheDocument();

		dismissTheOpenDialog();

		expect(await decision).toEqual({ decision: 'cancel', dontShowAgain: false });
	});
});
