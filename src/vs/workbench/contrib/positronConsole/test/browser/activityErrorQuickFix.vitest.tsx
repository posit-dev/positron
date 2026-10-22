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
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ILanguageRuntimeMetadata } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { IPositronConsoleInstance } from '../../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { IErrorAssistant } from '../../../positronAssistant/common/errorAssistant.js';
import { registerTestErrorAssistant } from '../../../positronAssistant/test/browser/errorAssistantTestUtils.js';
import { ConsoleQuickFix } from '../../browser/components/activityErrorQuickFix.js';

const line = (id: string, text: string): ANSIOutputLine => ({
	id,
	outputRuns: [{ id: `${id}-run`, text }],
});

const outputLines: ANSIOutputLine[] = [line('1', 'NameError: name "x" is not defined')];
const tracebackLines: ANSIOutputLine[] = [line('2', '  File "<stdin>", line 1')];

const positronConsoleInstance = stubInterface<IPositronConsoleInstance>({
	sessionId: 'python-1',
	sessionName: 'Python 3.12.1',
	runtimeMetadata: stubInterface<ILanguageRuntimeMetadata>({ languageId: 'python' }),
});

describe('ConsoleQuickFix', () => {
	const ctx = createTestContainer()
		.withReactServices()
		.build();

	const rtl = setupRTLRenderer(() => ctx.reactServices);

	const ask = vi.fn();

	beforeEach(() => {
		ask.mockReset().mockResolvedValue(undefined);
	});

	/** Register the assistant errors are sent to. */
	function registerAssistant(options: Partial<IErrorAssistant> = {}) {
		registerTestErrorAssistant(ctx, { ask, ...options });
	}

	it('sends the message, traceback, session, and code to the active chat', async () => {
		registerAssistant();
		const user = userEvent.setup();
		rtl.render(<ConsoleQuickFix code='print(x)' outputLines={outputLines} positronConsoleInstance={positronConsoleInstance} tracebackLines={tracebackLines} />);
		await user.click(screen.getByRole('button', { name: 'Ask Test Assistant to fix' }));
		await user.click(screen.getByRole('button', { name: 'Ask Test Assistant to explain' }));

		const context = {
			kind: 'console',
			error: 'NameError: name "x" is not defined\n  File "<stdin>", line 1',
			sessionId: 'python-1',
			sessionName: 'Python 3.12.1',
			languageId: 'python',
			code: 'print(x)',
		};
		const options = { continueChat: true };
		expect(ask.mock.calls).toEqual([['fix', context, options], ['explain', context, options]]);
	});

	it('sends only the message, untrimmed, when there is no traceback', async () => {
		registerAssistant();
		const user = userEvent.setup();
		rtl.render(<ConsoleQuickFix outputLines={[line('1', '  Error: boom'), line('2', '')]} positronConsoleInstance={positronConsoleInstance} tracebackLines={[]} />);
		await user.click(screen.getByText('Fix'));

		expect(ask.mock.calls[0][1].error).toBe('  Error: boom\n');
	});

	it('offers only Fix and Explain', () => {
		registerAssistant();
		rtl.render(<ConsoleQuickFix outputLines={outputLines} positronConsoleInstance={positronConsoleInstance} tracebackLines={tracebackLines} />);
		expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual(['Fix', 'Explain']);
	});

	it('renders nothing when there is no active assistant', () => {
		rtl.render(<ConsoleQuickFix outputLines={outputLines} positronConsoleInstance={positronConsoleInstance} tracebackLines={tracebackLines} />);
		expect(screen.queryByRole('button')).not.toBeInTheDocument();
	});
});
