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

	// The dialog renders itself through its own PositronModalDialogReactRenderer rather than being
	// handed to rtl.render, so this only establishes the services context it renders into.
	setupRTLRenderer(() => ctx.reactServices);

	beforeEach(() => {
		// PositronModalDialogReactRenderer reads the services singleton in its constructor to find
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

	it('resolves with the primary button title when Enter submits the form', async () => {
		const choice = show();
		expect(await screen.findByText(options.title)).toBeInTheDocument();

		await userEvent.keyboard('{Enter}');

		expect(await choice).toBe(options.primaryButtonTitle);
	});

	it('resolves with undefined when the close button dismisses the dialog', async () => {
		const choice = show();
		expect(await screen.findByText(options.title)).toBeInTheDocument();

		await userEvent.click(screen.getByRole('button', { name: 'Close' }));

		expect(await choice).toBeUndefined();
	});

	it('resolves with undefined when the native dialog is closed directly', async () => {
		// In a real browser, Escape closes the native <dialog> directly and disposes the
		// renderer without going through onCancel, so the prompt has to settle on disposal
		// too or it would hang here. jsdom does not wire Escape to <dialog>'s own close-on-
		// Escape default action, so this drives the same close() the browser would call,
		// leaving Escape's keyboard path covered by Task 8's e2e dismiss tests.
		const choice = show();
		expect(await screen.findByText(options.title)).toBeInTheDocument();

		const dialog = screen.getByRole('dialog') as HTMLDialogElement;
		dialog.close();

		expect(await choice).toBeUndefined();
	});
});
