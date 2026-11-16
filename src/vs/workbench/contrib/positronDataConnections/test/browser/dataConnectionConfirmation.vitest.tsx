/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { screen } from '@testing-library/react';
import { PositronModalReactRenderer } from '../../../../../base/browser/positronModalReactRenderer.js';
import { PositronReactServices } from '../../../../../base/browser/positronReactServices.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { dataExplorersClosingDetail, showDataConnectionConfirmation } from '../../browser/dialogs/dataConnectionConfirmation.js';

describe('showDataConnectionConfirmation', () => {
	const ctx = createTestContainer().withReactServices().build();

	// The dialog renders itself through its own PositronModalReactRenderer rather than being
	// handed to rtl.render, so this only establishes the services context it renders into.
	setupRTLRenderer(() => ctx.reactServices);

	beforeEach(() => {
		// PositronModalReactRenderer reads the services singleton in its constructor to find the
		// container to render into, so the container's services have to be reachable from there.
		PositronReactServices.services = ctx.reactServices;
	});

	it('resolves false when something else closes the dialog', async () => {
		// For example, a parent modal closing takes its child confirmations with it. Without this,
		// the caller awaiting the confirmation would wait forever.
		const confirmation = showDataConnectionConfirmation({
			title: 'Title',
			details: ['Detail'],
			confirmButtonTitle: 'Confirm',
		});
		expect(await screen.findByText('Detail')).toBeInTheDocument();

		PositronModalReactRenderer.disposeAll();

		expect(await confirmation).toBe(false);
		expect(screen.queryByText('Detail')).not.toBeInTheDocument();
	});
});

describe('dataExplorersClosingDetail', () => {
	it('says nothing when no Data Explorers are open, and names one or several otherwise', () => {
		expect([0, 1, 3].map(dataExplorersClosingDetail)).toEqual([
			undefined,
			'The Data Explorer open on this connection will close.',
			'The 3 Data Explorers open on this connection will close.',
		]);
	});
});
