/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { URI } from '../../../../../base/common/uri.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { IProductService } from '../../../../../platform/product/common/productService.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IPositronDocsService } from '../../../../services/positronDocs/browser/positronDocsService.js';
import { WelcomeHeader } from '../../browser/positronWelcomePage/components/welcomeHeader.js';

describe('WelcomeHeader', () => {
	const executeCommand = vi.fn();
	const open = vi.fn(async (_resource: URI | string) => true);
	const publicLog2 = vi.fn();

	const ctx = createTestContainer()
		.withReactServices()
		.stub(ICommandService, { executeCommand })
		.stub(IOpenerService, stubInterface<IOpenerService>({ open }))
		.stub(ITelemetryService, { publicLog2 })
		// A build-variant name, so a hardcoded "Positron" would fail this.
		.stub(IProductService, { nameLong: 'Positron Dev' })
		.stub(IPositronDocsService, stubInterface<IPositronDocsService>({
			getUrl: path => `https://positron.posit.co/docs/${path}`,
		}))
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	beforeEach(() => {
		executeCommand.mockReset();
		open.mockClear();
		publicLog2.mockClear();
	});

	it('greets with the product name, and gives the page its top heading', () => {
		rtl.render(<WelcomeHeader />);

		expect(screen.getByRole('heading', { level: 1, name: 'Welcome to Positron Dev' })).toBeInTheDocument();
	});

	it('says what Positron is', () => {
		rtl.render(<WelcomeHeader />);

		expect(screen.getByText('an IDE for data science from Posit')).toBeInTheDocument();
	});

	it('opens the help pane and logs the press', async () => {
		const user = userEvent.setup();
		rtl.render(<WelcomeHeader />);

		await user.click(screen.getByRole('button', { name: 'Help' }));

		expect(executeCommand).toHaveBeenCalledWith('workbench.action.positron.openHelp');
		expect(publicLog2).toHaveBeenCalledWith('gettingStarted.ActionExecuted', {
			command: 'welcomeHeaderOpenHelp',
			argument: undefined,
			walkthroughId: undefined,
		});
	});

	it('shows release notes to the left of Help and runs the release notes command', async () => {
		const user = userEvent.setup();
		rtl.render(<WelcomeHeader />);

		const buttons = screen.getAllByRole('button');
		expect(buttons.map(button => button.textContent)).toEqual(['Release Notes', 'Help']);

		await user.click(screen.getByRole('button', { name: 'Release Notes' }));

		expect(executeCommand).toHaveBeenCalledWith('update.showCurrentReleaseNotes');
		expect(open).not.toHaveBeenCalled();
	});

	it('opens the hosted release notes when the command fails', async () => {
		executeCommand.mockRejectedValueOnce(new Error('no release notes available'));
		const user = userEvent.setup();
		rtl.render(<WelcomeHeader />);

		await user.click(screen.getByRole('button', { name: 'Release Notes' }));

		expect(open.mock.calls[0][0].toString()).toBe('https://positron.posit.co/docs/release-notes.html');
	});
});
