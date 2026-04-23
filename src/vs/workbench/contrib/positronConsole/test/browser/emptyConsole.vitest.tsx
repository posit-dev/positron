/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { LANGUAGE_RUNTIME_START_NEW_CONSOLE_SESSION_ID } from '../../../languageRuntime/browser/languageRuntimeActions.js';
import { EmptyConsole } from '../../browser/components/emptyConsole.js';

describe('EmptyConsole', () => {
	const ctx = createTestContainer()
		.withReactServices()
		.stub(ICommandService, { executeCommand: vi.fn().mockResolvedValue(undefined) })
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	it('renders the empty state message', () => {
		const { container } = rtl.render(<EmptyConsole />);
		expect(container.textContent).toContain('There is no session running.');
		expect(container.textContent).toContain('Start Session');
		expect(container.textContent).toContain('to start one.');
	});

	it('renders a Start Session button', () => {
		rtl.render(<EmptyConsole />);
		screen.getByText('Start Session');
	});

	it('executes startNewConsoleSession command when button is pressed', async () => {
		const user = userEvent.setup();
		rtl.render(<EmptyConsole />);
		await user.click(screen.getByText('Start Session'));

		expect(ctx.get(ICommandService).executeCommand).toHaveBeenCalledWith(
			LANGUAGE_RUNTIME_START_NEW_CONSOLE_SESSION_ID
		);
	});

});
