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
import { PositronModalDialogs } from '../../browser/positronModalDialogs.js';

describe('showThreeButtonModalDialogPrompt', () => {
	const ctx = createTestContainer().withReactServices().build();

	// The dialog renders itself through its own PositronModalReactRenderer rather than being
	// handed to rtl.render, so this only establishes the services context it renders into.
	setupRTLRenderer(() => ctx.reactServices);

	beforeEach(() => {
		// PositronModalReactRenderer reads the services singleton in its constructor to find
		// the container to render into, so the container's services have to be reachable from there.
		PositronReactServices.services = ctx.reactServices;
	});

	const options = {
		title: 'Create a virtual environment for this workspace?',
		message: '/usr/bin/python3 is managed by your operating system.',
		primaryButtonTitle: 'Create Environment',
		secondaryButtonTitle: 'Not Now',
		tertiaryButtonTitle: 'Do Not Ask Again',
	};

	const show = () => new PositronModalDialogs().showThreeButtonModalDialogPrompt(options);

	it('shows the title, the message, and all three buttons', async () => {
		const choice = show();

		expect(await screen.findByText(options.title)).toBeInTheDocument();
		expect(screen.getByText(options.message)).toBeInTheDocument();
		expect(screen.getByRole('button', { name: options.primaryButtonTitle })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: options.secondaryButtonTitle })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: options.tertiaryButtonTitle })).toBeInTheDocument();

		await userEvent.click(screen.getByRole('button', { name: options.secondaryButtonTitle }));
		await choice;
	});

	it('resolves with the title of whichever button was clicked', async () => {
		const clicked: (string | undefined)[] = [];
		for (const title of [
			options.primaryButtonTitle,
			options.secondaryButtonTitle,
			options.tertiaryButtonTitle,
		]) {
			const choice = show();
			const button = await screen.findByRole('button', { name: title });
			expect(button).toBeInTheDocument();
			await userEvent.click(button);
			clicked.push(await choice);
		}

		expect(clicked).toEqual([
			options.primaryButtonTitle,
			options.secondaryButtonTitle,
			options.tertiaryButtonTitle,
		]);
	});

	it('resolves with undefined when the close button dismisses the dialog', async () => {
		const choice = show();
		expect(await screen.findByText(options.title)).toBeInTheDocument();

		await userEvent.click(screen.getByRole('button', { name: 'Close' }));

		expect(await choice).toBeUndefined();
	});

	it('resolves with undefined when Escape dismisses the dialog', async () => {
		// The renderer listens for keydowns at the window and hands them to the dialog, which cancels
		// on Escape. Nothing settles the prompt on that path unless the dialog's onCancel does.
		const choice = show();
		expect(await screen.findByText(options.title)).toBeInTheDocument();

		await userEvent.keyboard('{Escape}');

		expect(await choice).toBeUndefined();
	});
});
