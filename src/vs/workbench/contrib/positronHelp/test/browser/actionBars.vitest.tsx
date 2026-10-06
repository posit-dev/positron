/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { CancellationError } from '../../../../../base/common/errors.js';
import { IReactComponentContainer } from '../../../../../base/browser/positronReactRenderer.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ILanguageRuntimeMetadata, RuntimeState } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession, IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { HelpTopicResult, IPositronHelpService } from '../../browser/positronHelpService.js';
import { ActionBars } from '../../browser/components/actionBars.js';

describe('Help ActionBars', () => {
	let runtimeState = RuntimeState.Idle;
	const runtimeEvents = new Emitter<RuntimeState>();
	afterAll(() => runtimeEvents.dispose());
	const showHelpTopicForForegroundSession = vi.fn<IPositronHelpService['showHelpTopicForForegroundSession']>().mockResolvedValue(HelpTopicResult.Found);
	const searchHelp = vi.fn<IPositronHelpService['searchHelp']>().mockResolvedValue(true);
	const info = vi.fn<INotificationService['info']>();
	const warn = vi.fn<INotificationService['warn']>();
	const getHelpTopics = vi.fn<IPositronHelpService['getHelpTopics']>().mockResolvedValue([
		{ label: 'plot', topic: 'graphics::plot', detail: 'graphics' },
		{ label: 'plot.lm', topic: 'stats::plot.lm', detail: 'stats' },
	]);
	const session = stubInterface<ILanguageRuntimeSession>({
		sessionId: 'r-session',
		getRuntimeState: () => runtimeState,
		onDidChangeRuntimeState: runtimeEvents.event,
		runtimeMetadata: stubInterface<ILanguageRuntimeMetadata>({ languageId: 'r', languageName: 'R' }),
	});
	const runtimeSessionService = stubInterface<IRuntimeSessionService>({
		foregroundSession: session,
		onDidChangeForegroundSession: Event.None,
	});
	const helpService = stubInterface<IPositronHelpService>({
		canNavigateBackward: false,
		canNavigateForward: false,
		currentHelpEntry: undefined,
		helpEntries: [],
		onDidChangeCurrentHelpEntry: Event.None,
		getHelpTopics,
		searchHelp,
		showHelpTopicForForegroundSession,
	});
	const ctx = createTestContainer()
		.withReactServices()
		.stub(IRuntimeSessionService, runtimeSessionService)
		.stub(IPositronHelpService, helpService)
		.stub(INotificationService, { info, warn })
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);
	const componentContainer = stubInterface<IReactComponentContainer>({ onSizeChanged: Event.None });

	beforeEach(() => {
		runtimeState = RuntimeState.Idle;
		vi.clearAllMocks();
	});

	it('places interpreter search in the first row and searches on Enter', async () => {
		const user = userEvent.setup();
		rtl.render(<ActionBars reactComponentContainer={componentContainer} onHome={() => { }} />);

		const input = screen.getByRole('combobox', { name: 'Search R Help' });
		await user.type(input, 'linear model{Enter}');

		expect(searchHelp).toHaveBeenCalledWith('linear model');
		expect(input.closest('.positron-action-bar')).toContainElement(screen.getByRole('button', { name: 'Previous topic' }));
	});

	it('offers interpreter topics and opens a selected suggestion', async () => {
		const user = userEvent.setup();
		rtl.render(<ActionBars reactComponentContainer={componentContainer} onHome={() => { }} />);

		const input = screen.getByRole('combobox', { name: 'Search R Help' });
		await user.click(input);
		await user.type(input, 'plot');
		const option = await screen.findByRole('option', { name: /plot graphics/ });
		await user.click(option);

		expect(showHelpTopicForForegroundSession).toHaveBeenCalledWith('graphics::plot');
		expect(searchHelp).not.toHaveBeenCalled();
		expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
		expect({ info: info.mock.calls, warn: warn.mock.calls }).toEqual({ info: [], warn: [] });
	});

	it.each([
		{ result: HelpTopicResult.NotFound, message: 'No help found for \'graphics::plot\'.' },
		{ result: HelpTopicResult.Unavailable, message: 'Help search is unavailable for the active interpreter.' },
	])('reports a $result topic result', async ({ result, message }) => {
		showHelpTopicForForegroundSession.mockResolvedValueOnce(result);
		const user = userEvent.setup();
		rtl.render(<ActionBars reactComponentContainer={componentContainer} onHome={() => { }} />);
		await user.type(screen.getByRole('combobox'), 'plot');
		await user.click(await screen.findByRole('option', { name: /plot graphics/ }));

		expect({ info: info.mock.calls, warn: warn.mock.calls }).toEqual({ info: [[message]], warn: [] });
	});

	it('reports when full search is unavailable', async () => {
		searchHelp.mockResolvedValueOnce(false);
		const user = userEvent.setup();
		rtl.render(<ActionBars reactComponentContainer={componentContainer} onHome={() => { }} />);
		await user.type(screen.getByRole('combobox'), 'linear model{Enter}');

		expect({ info: info.mock.calls, warn: warn.mock.calls }).toEqual({
			info: [['Help search is unavailable for the active interpreter.']], warn: [],
		});
	});

	it.each(['topic', 'search'])('reports a genuine %s request error', async kind => {
		const request = kind === 'topic' ? showHelpTopicForForegroundSession : searchHelp;
		request.mockRejectedValueOnce(new Error('request failed'));
		const user = userEvent.setup();
		rtl.render(<ActionBars reactComponentContainer={componentContainer} onHome={() => { }} />);
		await user.type(screen.getByRole('combobox'), 'plot');
		if (kind === 'topic') {
			await user.click(await screen.findByRole('option', { name: /plot graphics/ }));
		} else {
			await user.keyboard('{Enter}');
		}

		expect({ info: info.mock.calls, warn: warn.mock.calls }).toEqual({
			info: [], warn: [['An error occurred while searching help: request failed']],
		});
	});

	it('does not report a cancelled request as an error', async () => {
		searchHelp.mockRejectedValueOnce(new CancellationError());
		const user = userEvent.setup();
		rtl.render(<ActionBars reactComponentContainer={componentContainer} onHome={() => { }} />);
		await user.type(screen.getByRole('combobox'), 'linear model{Enter}');

		expect({ info: info.mock.calls, warn: warn.mock.calls }).toEqual({ info: [], warn: [] });
	});

	it('waits while busy and does not repeat requests for comm Busy/Idle events', async () => {
		runtimeState = RuntimeState.Busy;
		let resolve!: (topics: Awaited<ReturnType<IPositronHelpService['getHelpTopics']>>) => void;
		getHelpTopics.mockImplementationOnce(() => {
			runtimeState = RuntimeState.Busy;
			runtimeEvents.fire(runtimeState);
			return new Promise(done => { resolve = done; });
		});
		const user = userEvent.setup();
		rtl.render(<ActionBars reactComponentContainer={componentContainer} onHome={() => { }} />);
		await user.type(screen.getByRole('combobox'), 'plot');
		await new Promise(done => setTimeout(done, 250));
		expect(getHelpTopics).not.toHaveBeenCalled();
		act(() => {
			runtimeState = RuntimeState.Idle;
			runtimeEvents.fire(runtimeState);
		});
		await waitFor(() => expect(getHelpTopics).toHaveBeenCalledExactlyOnceWith('plot', 50));
		await act(async () => {
			resolve([{ label: 'plot', topic: 'graphics::plot', detail: 'graphics' }]);
			await Promise.resolve();
			runtimeState = RuntimeState.Idle;
			runtimeEvents.fire(runtimeState);
		});
		expect(await screen.findByRole('option', { name: /plot graphics/ })).toBeInTheDocument();
		await new Promise(done => setTimeout(done, 250));
		expect(getHelpTopics).toHaveBeenCalledOnce();
	});

});
