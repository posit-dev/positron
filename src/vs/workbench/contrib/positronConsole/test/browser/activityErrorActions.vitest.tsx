/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Event } from '../../../../../base/common/event.js';
import { ANSIOutputLine } from '../../../../../base/common/ansiOutput.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { IErrorActionHandler, IErrorActionsService } from '../../../positronAssistant/common/errorActions.js';
import { ConsoleErrorActions } from '../../browser/components/activityErrorActions.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IPositronConsoleInstance } from '../../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { ILanguageRuntimeMetadata } from '../../../../services/languageRuntime/common/languageRuntimeService.js';

const line = (id: string, text: string): ANSIOutputLine => ({
	id,
	outputRuns: [{ id: `${id}-run`, text }],
});

const outputLines: ANSIOutputLine[] = [line('1', 'NameError: name "x" is not defined')];
const tracebackLines: ANSIOutputLine[] = [line('2', '  File "<stdin>", line 1')];

const positronConsoleInstance = stubInterface<IPositronConsoleInstance>({
	sessionId: 'python-1234',
	sessionName: 'Python 3.12.1',
	runtimeMetadata: stubInterface<ILanguageRuntimeMetadata>({ languageId: 'python' }),
});

const errorActionHandler: IErrorActionHandler = { id: 'test-agent', label: 'Test Agent', run: async () => { } };

describe('ConsoleErrorActions', () => {
	/** The handler errors go to; undefined when there is none. */
	let configuredHandler: IErrorActionHandler | undefined;
	let canContinueChat: boolean;
	const run = vi.fn().mockResolvedValue(undefined);
	const ctx = createTestContainer()
		.withReactServices()
		.stub(IErrorActionsService, { onDidChange: Event.None, getConfigured: () => configuredHandler, canContinueChat: () => canContinueChat, run })
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	beforeEach(() => {
		configuredHandler = errorActionHandler;
		canContinueChat = true;
	});

	it('sends the error and the console it came from to the current chat', async () => {
		const user = userEvent.setup();
		rtl.render(<ConsoleErrorActions code='print(x)' outputLines={outputLines} positronConsoleInstance={positronConsoleInstance} tracebackLines={tracebackLines} />);
		await user.click(screen.getByText('Explain'));

		expect(run).toHaveBeenCalledWith(errorActionHandler, 'explain', {
			error: 'NameError: name "x" is not defined\n  File "<stdin>", line 1',
			location: { kind: 'console', sessionId: 'python-1234', sessionName: 'Python 3.12.1', languageId: 'python', code: 'print(x)' },
			chat: 'current',
		});
	});

	it('starts a new chat when the handler cannot continue one', async () => {
		canContinueChat = false;
		const user = userEvent.setup();
		rtl.render(<ConsoleErrorActions outputLines={outputLines} positronConsoleInstance={positronConsoleInstance} tracebackLines={tracebackLines} />);
		await user.click(screen.getByText('Fix'));

		expect(run.mock.calls[0][2].chat).toBe('new');
	});

	it('renders nothing when there is no handler to send errors to', () => {
		configuredHandler = undefined;
		rtl.render(<ConsoleErrorActions outputLines={outputLines} positronConsoleInstance={positronConsoleInstance} tracebackLines={tracebackLines} />);

		expect(screen.queryByText('Fix')).not.toBeInTheDocument();
	});
});
