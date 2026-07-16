/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
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
		expect(container).toHaveTextContent(/There is no session running\./);
		expect(container).toHaveTextContent(/Start Session/);
		expect(container).toHaveTextContent(/to start one\./);
	});

	it('renders a Start Session button', () => {
		rtl.render(<EmptyConsole />);
		expect(screen.getByText('Start Session')).toBeInTheDocument();
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
