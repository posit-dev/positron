/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { ANSIOutputLine } from '../../../../../base/common/ansiOutput.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { IErrorActionHandler, IErrorActionsService } from '../../../positronAssistant/common/errorActions.js';
import { ConsoleQuickFix } from '../../browser/components/activityErrorQuickFix.js';

const line = (id: string, text: string): ANSIOutputLine => ({
	id,
	outputRuns: [{ id: `${id}-run`, text }],
});

const outputLines: ANSIOutputLine[] = [line('1', 'NameError: name "x" is not defined')];
const tracebackLines: ANSIOutputLine[] = [line('2', '  File "<stdin>", line 1')];

describe('ConsoleQuickFix', () => {
	const ctx = createTestContainer()
		.withReactServices()
		.build();

	const rtl = setupRTLRenderer(() => ctx.reactServices);

	const run = vi.fn();

	beforeEach(() => {
		run.mockReset().mockResolvedValue(undefined);
	});

	/** Register the handler errors are sent to. */
	function registerHandler(options: Partial<IErrorActionHandler> = {}) {
		ctx.disposables.add(ctx.get(IErrorActionsService).register({ id: 'test-agent', label: 'Test Agent', canContinueChat: true, run, ...options }));
	}

	it('sends the message and traceback to the current chat', async () => {
		registerHandler();
		const user = userEvent.setup();
		rtl.render(<ConsoleQuickFix outputLines={outputLines} tracebackLines={tracebackLines} />);
		await user.click(screen.getByText('Fix'));
		await user.click(screen.getByText('Explain'));

		const context = {
			error: 'NameError: name "x" is not defined\n  File "<stdin>", line 1',
			location: { kind: 'console' },
			chat: 'current',
		};
		expect(run.mock.calls).toEqual([['fix', context], ['explain', context]]);
	});

	it('sends only the message, untrimmed, when there is no traceback', async () => {
		registerHandler();
		const user = userEvent.setup();
		rtl.render(<ConsoleQuickFix outputLines={[line('1', '  Error: boom'), line('2', '')]} tracebackLines={[]} />);
		await user.click(screen.getByText('Fix'));

		expect(run.mock.calls[0][1].error).toBe('  Error: boom\n');
	});

	it('sends errors to a new chat when the handler cannot continue the current chat', async () => {
		registerHandler({ canContinueChat: false });
		const user = userEvent.setup();
		rtl.render(<ConsoleQuickFix outputLines={outputLines} tracebackLines={tracebackLines} />);
		await user.click(screen.getByText('Fix'));

		expect(run.mock.calls[0][1].chat).toBe('new');
	});

	it('offers only Fix and Explain', () => {
		registerHandler();
		rtl.render(<ConsoleQuickFix outputLines={outputLines} tracebackLines={tracebackLines} />);
		expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual(['Fix', 'Explain']);
	});

	it('renders nothing when there is no active handler', () => {
		rtl.render(<ConsoleQuickFix outputLines={outputLines} tracebackLines={tracebackLines} />);
		expect(screen.queryByRole('button')).not.toBeInTheDocument();
	});
});
