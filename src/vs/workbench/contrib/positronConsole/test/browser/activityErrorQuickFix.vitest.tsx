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
import { IErrorAssistant } from '../../../positronAssistant/common/errorAssistant.js';
import { registerTestErrorAssistant } from '../../../positronAssistant/test/browser/errorAssistantTestUtils.js';
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

	/** Register the assistant errors are sent to. */
	function registerAssistant(options: Partial<IErrorAssistant> = {}) {
		registerTestErrorAssistant(ctx, { run, ...options });
	}

	it('sends the message and traceback to the active chat', async () => {
		registerAssistant();
		const user = userEvent.setup();
		rtl.render(<ConsoleQuickFix outputLines={outputLines} tracebackLines={tracebackLines} />);
		await user.click(screen.getByText('Fix'));
		await user.click(screen.getByText('Explain'));

		const context = {
			error: 'NameError: name "x" is not defined\n  File "<stdin>", line 1',
			location: { kind: 'console' },
		};
		const options = { continueChat: true };
		expect(run.mock.calls).toEqual([['fix', context, options], ['explain', context, options]]);
	});

	it('sends only the message, untrimmed, when there is no traceback', async () => {
		registerAssistant();
		const user = userEvent.setup();
		rtl.render(<ConsoleQuickFix outputLines={[line('1', '  Error: boom'), line('2', '')]} tracebackLines={[]} />);
		await user.click(screen.getByText('Fix'));

		expect(run.mock.calls[0][1].error).toBe('  Error: boom\n');
	});

	it('sends errors to a new chat when the assistant cannot continue the active chat', async () => {
		registerAssistant({ supportsChatContinuation: false });
		const user = userEvent.setup();
		rtl.render(<ConsoleQuickFix outputLines={outputLines} tracebackLines={tracebackLines} />);
		await user.click(screen.getByText('Fix'));

		expect(run.mock.calls[0][2]).toEqual({ continueChat: false });
	});

	it('offers only Fix and Explain', () => {
		registerAssistant();
		rtl.render(<ConsoleQuickFix outputLines={outputLines} tracebackLines={tracebackLines} />);
		expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual(['Fix', 'Explain']);
	});

	it('renders nothing when there is no active assistant', () => {
		rtl.render(<ConsoleQuickFix outputLines={outputLines} tracebackLines={tracebackLines} />);
		expect(screen.queryByRole('button')).not.toBeInTheDocument();
	});
});
