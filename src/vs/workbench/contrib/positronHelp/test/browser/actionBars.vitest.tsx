/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { act, configure, getConfig, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { DeferredPromise } from '../../../../../base/common/async.js';
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
	const foregroundEvents = new Emitter<ILanguageRuntimeSession | undefined>();
	afterAll(() => { runtimeEvents.dispose(); foregroundEvents.dispose(); });
	const showHelpTopicForForegroundSession = vi.fn<IPositronHelpService['showHelpTopicForForegroundSession']>().mockResolvedValue(HelpTopicResult.Found);
	const searchHelp = vi.fn<IPositronHelpService['searchHelp']>().mockResolvedValue(true);
	const cancelSearch = vi.fn<IPositronHelpService['cancelSearch']>();
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
		onDidChangeForegroundSession: foregroundEvents.event,
	});
	const helpService = stubInterface<IPositronHelpService>({
		canNavigateBackward: false,
		canNavigateForward: false,
		currentHelpEntry: undefined,
		helpEntries: [],
		onDidChangeCurrentHelpEntry: Event.None,
		getHelpTopics,
		searchHelp,
		cancelSearch,
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

		expect(showHelpTopicForForegroundSession).toHaveBeenCalledExactlyOnceWith('graphics::plot');
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

	describe('pending suggestions', () => {
		type Topics = Awaited<ReturnType<IPositronHelpService['getHelpTopics']>>;
		const latestTopics: Topics = [{ label: 'plot.new', topic: 'graphics::plot.new' }];

		const asyncWrapper = getConfig().asyncWrapper;
		beforeEach(() => {
			vi.useFakeTimers();
			// RTL's default microtask drain advances Jest timers only. Use Vitest's
			// clock here so user-event can finish without real debounce delays.
			configure({
				asyncWrapper: async callback => {
					const result = await callback();
					await vi.advanceTimersByTimeAsync(0);
					return result;
				}
			});
		});
		afterEach(() => {
			configure({ asyncWrapper });
			vi.useRealTimers();
		});

		const advanceDebounce = async () => {
			await act(async () => { await vi.advanceTimersByTimeAsync(200); });
		};
		const settle = async (request: DeferredPromise<Topics>, topics: Topics) => {
			await act(async () => { await request.complete(topics); });
		};
		const renderSuggestions = async () => {
			const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
			rtl.render(<ActionBars reactComponentContainer={componentContainer} onHome={() => { }} />);
			const input = screen.getByRole('combobox');
			await user.type(input, 'plot');
			await advanceDebounce();
			expect(screen.getAllByRole('option')).toHaveLength(2);
			return { user, input };
		};

		it('retains the list through debounce and RPC, then resets selection for a shorter list', async () => {
			const { user, input } = await renderSuggestions();
			const listbox = screen.getByRole('listbox');
			const options = screen.getAllByRole('option');
			const request = new DeferredPromise<Topics>();
			getHelpTopics.mockReturnValueOnce(request.p);
			await user.keyboard('.');

			expect(screen.getByRole('listbox')).toBe(listbox);
			expect(screen.getAllByRole('option')).toEqual(options);
			expect(getHelpTopics).toHaveBeenCalledOnce();
			await advanceDebounce();
			expect(getHelpTopics).toHaveBeenLastCalledWith('plot.', 50);
			expect(screen.getAllByRole('option')).toEqual(options);
			await user.keyboard('{ArrowDown>2/}');
			expect(input).toHaveAttribute('aria-activedescendant', options[1].id);
			await settle(request, latestTopics);

			expect(screen.getAllByRole('option')).toHaveLength(1);
			expect(screen.getByRole('option', { name: 'plot.new' })).toHaveAttribute('aria-selected', 'false');
			expect(input).not.toHaveAttribute('aria-activedescendant');
			expect(input).toHaveAttribute('aria-controls', screen.getByRole('listbox').id);
			await user.keyboard('{ArrowDown}{Enter}');
			expect(showHelpTopicForForegroundSession).toHaveBeenCalledExactlyOnceWith('graphics::plot.new');
		});

		it('skips intermediate queries and ignores an old response while the latest query waits', async () => {
			const { user } = await renderSuggestions();
			const oldRequest = new DeferredPromise<Topics>();
			const latestRequest = new DeferredPromise<Topics>();
			getHelpTopics.mockReturnValueOnce(oldRequest.p).mockReturnValueOnce(latestRequest.p);
			await user.keyboard('.');
			await advanceDebounce();
			await user.keyboard('n');
			await advanceDebounce();
			await user.keyboard('ew');
			await advanceDebounce();
			await settle(oldRequest, [{ label: 'stale', topic: 'stale' }]);

			expect(getHelpTopics.mock.calls.map(([query]) => query)).toEqual(['plot', 'plot.', 'plot.new']);
			expect(screen.queryByRole('option', { name: 'stale' })).not.toBeInTheDocument();
			expect(screen.getByRole('option', { name: /plot graphics/ })).toBeInTheDocument();
			await settle(latestRequest, latestTopics);
			expect(screen.getByRole('option', { name: 'plot.new' })).toBeInTheDocument();
			expect(screen.queryByRole('option', { name: /plot graphics/ })).not.toBeInTheDocument();
		});

		it.each(['clear', 'Escape', 'blur'])('clears the retained list on %s and ignores a late response', async dismissal => {
			const { user, input } = await renderSuggestions();
			const request = new DeferredPromise<Topics>();
			getHelpTopics.mockReturnValueOnce(request.p);
			await user.keyboard('.');
			await advanceDebounce();
			await user.keyboard('{ArrowDown}');
			if (dismissal === 'clear') {
				await user.clear(input);
			} else if (dismissal === 'Escape') {
				await user.keyboard('{Escape}');
			} else {
				await user.tab();
			}
			await settle(request, latestTopics);

			expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
			expect(input).toHaveAttribute('aria-expanded', 'false');
			expect(input).not.toHaveAttribute('aria-controls');
			expect(input).not.toHaveAttribute('aria-activedescendant');
			if (dismissal !== 'clear') {
				await user.type(input, 'n');
				expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
				await advanceDebounce();
				expect(screen.getByRole('option', { name: /plot graphics/ })).toBeInTheDocument();
			}
		});

		it('removes the list and ARIA references when the latest response is empty', async () => {
			const { user, input } = await renderSuggestions();
			const request = new DeferredPromise<Topics>();
			getHelpTopics.mockReturnValueOnce(request.p);
			await user.keyboard('.');
			await advanceDebounce();
			await user.keyboard('{ArrowDown}');
			await settle(request, []);

			expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
			expect(input).not.toHaveAttribute('aria-controls');
			expect(input).not.toHaveAttribute('aria-activedescendant');
			await user.keyboard('{Enter}');
			expect(searchHelp).toHaveBeenCalledExactlyOnceWith('plot.');
			expect(showHelpTopicForForegroundSession).not.toHaveBeenCalled();
		});

		it.each(['switch', 'remove'])('ignores a response resolved in the same batch as a foreground session %s', async change => {
			const { user, input } = await renderSuggestions();
			const oldRequest = new DeferredPromise<Topics>();
			getHelpTopics.mockReturnValueOnce(oldRequest.p);
			await user.keyboard('.');
			await advanceDebounce();
			await user.keyboard('{ArrowDown}');
			const newSession = change === 'switch' ? stubInterface<ILanguageRuntimeSession>({
				sessionId: 'new-r-session',
				getRuntimeState: () => RuntimeState.Idle,
				onDidChangeRuntimeState: Event.None,
				runtimeMetadata: session.runtimeMetadata,
			}) : undefined;
			await act(async () => {
				foregroundEvents.fire(newSession);
				await oldRequest.complete([{ label: 'old session', topic: 'old' }]);
			});

			expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
			expect(input).not.toHaveAttribute('aria-controls');
			expect(input).not.toHaveAttribute('aria-activedescendant');
			await advanceDebounce();
			if (change === 'switch') {
				expect(screen.getByRole('option', { name: /plot graphics/ })).toBeInTheDocument();
				expect(screen.queryByRole('option', { name: 'old session' })).not.toBeInTheDocument();
			} else {
				expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
				expect(input).toBeDisabled();
			}
		});

		it('ignores an old session response arriving after the new session results', async () => {
			const { user, input } = await renderSuggestions();
			const oldRequest = new DeferredPromise<Topics>();
			const newRequest = new DeferredPromise<Topics>();
			getHelpTopics.mockReturnValueOnce(oldRequest.p).mockReturnValueOnce(newRequest.p);
			await user.keyboard('.');
			await advanceDebounce();
			await user.keyboard('{ArrowDown}');
			const newSession = stubInterface<ILanguageRuntimeSession>({
				sessionId: 'new-r-session',
				getRuntimeState: () => RuntimeState.Idle,
				onDidChangeRuntimeState: Event.None,
				runtimeMetadata: session.runtimeMetadata,
			});
			act(() => foregroundEvents.fire(newSession));
			expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
			expect(input).not.toHaveAttribute('aria-controls');
			expect(input).not.toHaveAttribute('aria-activedescendant');
			await advanceDebounce();
			await settle(newRequest, latestTopics);
			await settle(oldRequest, [{ label: 'old session', topic: 'old' }]);

			expect(screen.getByRole('option', { name: 'plot.new' })).toBeInTheDocument();
			expect(screen.queryByRole('option', { name: 'old session' })).not.toBeInTheDocument();
			expect(input).not.toHaveAttribute('aria-activedescendant');
		});
	});

	describe('pending submissions', () => {
		it.each([RuntimeState.Busy, RuntimeState.Interrupting, RuntimeState.Idle])('keeps the query and Clear editable while %s', async state => {
			runtimeState = state;
			const request = new DeferredPromise<boolean>();
			searchHelp.mockReturnValueOnce(request.p);
			const user = userEvent.setup();
			rtl.render(<ActionBars reactComponentContainer={componentContainer} onHome={() => { }} />);
			const input = screen.getByRole('combobox');
			await user.type(input, 'plot{Enter}');
			expect(input).toBeEnabled();
			expect(input).toHaveFocus();
			expect(screen.getByRole('status')).toHaveTextContent(state === RuntimeState.Idle ? 'Searching...' : 'Waiting for interpreter...');
			await user.keyboard('.new');
			expect(input).toHaveValue('plot.new');
			expect(searchHelp).toHaveBeenCalledExactlyOnceWith('plot');
			await user.click(screen.getByRole('button', { name: 'Clear help search' }));
			expect(input).toHaveValue('');
			expect(cancelSearch).toHaveBeenCalledOnce();
			expect(screen.queryByRole('status')).not.toBeInTheDocument();
			await act(async () => { await request.complete(false); });
			expect({ info: info.mock.calls, warn: warn.mock.calls }).toEqual({ info: [], warn: [] });
		});

		it.each(['search', 'topic'])('Escape dismisses a pending %s and ignores its late error', async kind => {
			const searchRequest = new DeferredPromise<boolean>();
			const topicRequest = new DeferredPromise<HelpTopicResult>();
			if (kind === 'topic') {
				showHelpTopicForForegroundSession.mockReturnValueOnce(topicRequest.p);
			} else {
				searchHelp.mockReturnValueOnce(searchRequest.p);
			}
			const user = userEvent.setup();
			rtl.render(<ActionBars reactComponentContainer={componentContainer} onHome={() => { }} />);
			const input = screen.getByRole('combobox');
			await user.type(input, 'plot');
			if (kind === 'topic') {
				await user.click(await screen.findByRole('option', { name: /plot graphics/ }));
			} else {
				await user.keyboard('{Enter}');
			}
			await user.keyboard('{Escape}{Escape}');
			expect(cancelSearch).toHaveBeenCalledOnce();
			expect(input).toHaveFocus();
			expect(input).toHaveValue('plot');
			expect(screen.queryByRole('status')).not.toBeInTheDocument();
			await act(async () => { await (kind === 'topic' ? topicRequest : searchRequest).error(new Error('late failure')); });
			expect({ info: info.mock.calls, warn: warn.mock.calls }).toEqual({ info: [], warn: [] });
		});

		it.each(['old first', 'new first'])('replaces pending searches and ignores obsolete completion: %s', async order => {
			const oldRequest = new DeferredPromise<boolean>();
			const newRequest = new DeferredPromise<boolean>();
			searchHelp.mockReturnValueOnce(oldRequest.p).mockReturnValueOnce(newRequest.p);
			const user = userEvent.setup();
			rtl.render(<ActionBars reactComponentContainer={componentContainer} onHome={() => { }} />);
			await user.type(screen.getByRole('combobox'), 'plot{Enter}{Enter}');
			expect(searchHelp).toHaveBeenCalledOnce();
			await user.keyboard('.new{Enter}{Enter}');
			expect(searchHelp.mock.calls).toEqual([['plot'], ['plot.new']]);
			expect(cancelSearch).toHaveBeenCalledOnce();
			if (order === 'old first') {
				await act(async () => { await oldRequest.complete(false); });
				expect(screen.getByRole('status')).toBeInTheDocument();
				await act(async () => { await newRequest.complete(false); });
			} else {
				await act(async () => { await newRequest.complete(false); });
				await act(async () => { await oldRequest.error(new Error('obsolete')); });
			}
			expect(screen.queryByRole('status')).not.toBeInTheDocument();
			expect({ info: info.mock.calls, warn: warn.mock.calls }).toEqual({
				info: [['Help search is unavailable for the active interpreter.']], warn: [],
			});
		});

		it('replaces a full search with a selected topic without duplicate pointer submissions', async () => {
			const oldRequest = new DeferredPromise<boolean>();
			const topicRequest = new DeferredPromise<HelpTopicResult>();
			searchHelp.mockReturnValueOnce(oldRequest.p);
			showHelpTopicForForegroundSession.mockReturnValueOnce(topicRequest.p);
			const user = userEvent.setup();
			rtl.render(<ActionBars reactComponentContainer={componentContainer} onHome={() => { }} />);
			await user.type(screen.getByRole('combobox'), 'plot{Enter}');
			await user.keyboard('.');
			await user.dblClick(await screen.findByRole('option', { name: /plot graphics/ }));
			await user.keyboard('{Enter}{Enter}');
			expect(searchHelp).toHaveBeenCalledExactlyOnceWith('plot');
			expect(cancelSearch).toHaveBeenCalledOnce();
			expect(showHelpTopicForForegroundSession).toHaveBeenCalledExactlyOnceWith('graphics::plot');
			await act(async () => { await oldRequest.complete(false); });
			expect(screen.getByRole('status')).toBeInTheDocument();
			await act(async () => { await topicRequest.complete(HelpTopicResult.NotFound); });
			expect({ info: info.mock.calls, warn: warn.mock.calls }).toEqual({
				info: [['No help found for \'graphics::plot\'.']], warn: [],
			});
		});

		it.each(['switch', 'remove'])('ignores completion in the same batch as session %s', async change => {
			const request = new DeferredPromise<boolean>();
			searchHelp.mockReturnValueOnce(request.p);
			const user = userEvent.setup();
			rtl.render(<ActionBars reactComponentContainer={componentContainer} onHome={() => { }} />);
			const input = screen.getByRole('combobox');
			await user.type(input, 'plot{Enter}');
			await act(async () => {
				foregroundEvents.fire(change === 'switch' ? stubInterface<ILanguageRuntimeSession>({
					sessionId: 'new-r-session',
					getRuntimeState: () => RuntimeState.Idle,
					onDidChangeRuntimeState: Event.None,
					runtimeMetadata: session.runtimeMetadata,
				}) : undefined);
				await request.complete(false);
			});
			expect(screen.queryByRole('status')).not.toBeInTheDocument();
			expect(input).toHaveValue('plot');
			expect({ info: info.mock.calls, warn: warn.mock.calls }).toEqual({ info: [], warn: [] });
			if (change === 'remove') {
				expect(input).toBeDisabled();
			} else {
				await user.keyboard('{Enter}');
				expect(searchHelp).toHaveBeenCalledTimes(2);
			}
		});

		it('updates busy/idle status without submitting again', async () => {
			runtimeState = RuntimeState.Busy;
			const request = new DeferredPromise<boolean>();
			searchHelp.mockReturnValueOnce(request.p);
			const user = userEvent.setup();
			rtl.render(<ActionBars reactComponentContainer={componentContainer} onHome={() => { }} />);
			await user.type(screen.getByRole('combobox'), 'plot{Enter}');
			for (const state of [RuntimeState.Idle, RuntimeState.Busy, RuntimeState.Idle]) {
				act(() => { runtimeState = state; runtimeEvents.fire(state); });
				expect(screen.getByRole('status')).toHaveTextContent(state === RuntimeState.Busy ? 'Waiting for interpreter...' : 'Searching...');
			}
			expect(searchHelp).toHaveBeenCalledOnce();
			await act(async () => { await request.complete(true); });
			expect(screen.queryByRole('status')).not.toBeInTheDocument();
		});

		it('cancels a pending search when the component unmounts', async () => {
			const request = new DeferredPromise<boolean>();
			searchHelp.mockReturnValueOnce(request.p);
			const user = userEvent.setup();
			const view = rtl.render(<ActionBars reactComponentContainer={componentContainer} onHome={() => { }} />);
			await user.type(screen.getByRole('combobox'), 'plot{Enter}');
			view.unmount();
			expect(cancelSearch).toHaveBeenCalledOnce();
			await act(async () => { await request.error(new Error('unmounted')); });
			expect({ info: info.mock.calls, warn: warn.mock.calls }).toEqual({ info: [], warn: [] });
		});
	});

	it('reopens suggestions when typing after Escape without refocusing the input', async () => {
		const user = userEvent.setup();
		rtl.render(<ActionBars reactComponentContainer={componentContainer} onHome={() => { }} />);
		const input = screen.getByRole('combobox');
		await user.type(input, 'plot');
		expect(await screen.findByRole('listbox')).toBeInTheDocument();
		await user.keyboard('{ArrowDown}{Escape}');

		expect(input).toHaveFocus();
		expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
		expect(input).not.toHaveAttribute('aria-controls');
		expect(input).not.toHaveAttribute('aria-activedescendant');
		await user.keyboard('.');
		expect(await screen.findByRole('listbox')).toBeInTheDocument();
		expect(getHelpTopics).toHaveBeenLastCalledWith('plot.', 50);
		expect(input).toHaveFocus();
	});

	it('scrolls the active option into view when navigating down and up through 50 suggestions', async () => {
		getHelpTopics.mockResolvedValueOnce(Array.from({ length: 50 }, (_, index) => ({
			label: `topic ${index}`, topic: `package::topic${index}`,
		})));
		const user = userEvent.setup();
		rtl.render(<ActionBars reactComponentContainer={componentContainer} onHome={() => { }} />);
		const input = screen.getByRole('combobox');
		await user.type(input, 'topic');
		expect(await screen.findByRole('listbox')).toBeInTheDocument();
		const options = screen.getAllByRole('option');
		const scrolledOptions: Element[] = [];
		options.forEach(option => vi.spyOn(option, 'scrollIntoView').mockImplementation(() => {
			scrolledOptions.push(option);
		}));

		await user.keyboard('{ArrowDown>50/}');
		expect(scrolledOptions).toEqual(options);
		expect(options[49].scrollIntoView).toHaveBeenLastCalledWith({ block: 'nearest' });
		expect(input).toHaveAttribute('aria-activedescendant', options[49].id);
		expect(options[49]).toHaveAttribute('aria-selected', 'true');
		await user.keyboard('{ArrowUp}');
		expect(scrolledOptions.at(-1)).toBe(options[48]);
		expect(input).toHaveFocus();
		await user.keyboard('{Enter}');
		expect(showHelpTopicForForegroundSession).toHaveBeenCalledExactlyOnceWith('package::topic48');
	});

	it('keeps options out of the tab order and closes immediately on blur', async () => {
		const user = userEvent.setup();
		rtl.render(<ActionBars reactComponentContainer={componentContainer} onHome={() => { }} />);
		const input = screen.getByRole('combobox');
		await user.type(input, 'plot');
		expect(await screen.findByRole('listbox')).toBeInTheDocument();
		expect(screen.getAllByRole('option').map(option => option.tabIndex)).toEqual([-1, -1]);
		await user.keyboard('{ArrowDown}');
		await user.tab();

		expect(screen.getByRole('button', { name: 'Clear help search' })).toHaveFocus();
		expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
		expect(input).toHaveAttribute('aria-expanded', 'false');
		expect(input).not.toHaveAttribute('aria-controls');
		expect(input).not.toHaveAttribute('aria-activedescendant');
		await user.tab({ shift: true });
		expect(await screen.findByRole('listbox')).toBeInTheDocument();
		expect(input).toHaveFocus();
		expect(input).not.toHaveAttribute('aria-activedescendant');
	});

	it('does not close newly focused suggestions because of an earlier blur', async () => {
		const user = userEvent.setup();
		rtl.render(<ActionBars reactComponentContainer={componentContainer} onHome={() => { }} />);
		const input = screen.getByRole('combobox');
		await user.type(input, 'plot');
		expect(await screen.findByRole('listbox')).toBeInTheDocument();
		await user.tab();
		await user.tab({ shift: true });
		expect(await screen.findByRole('listbox')).toBeInTheDocument();
		expect(input).toHaveFocus();
	});

	it('keeps input focus during suggestion pointer selection', async () => {
		const user = userEvent.setup();
		rtl.render(<ActionBars reactComponentContainer={componentContainer} onHome={() => { }} />);
		const input = screen.getByRole('combobox');
		await user.type(input, 'plot');
		const option = await screen.findByRole('option', { name: /plot graphics/ });
		await user.pointer({ target: option, keys: '[MouseLeft>]' });
		expect(input).toHaveFocus();
		expect(option).toBeInTheDocument();
		await user.pointer({ keys: '[/MouseLeft]' });
		expect(showHelpTopicForForegroundSession).toHaveBeenCalledExactlyOnceWith('graphics::plot');
		expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
	});

	it('exposes ARIA references only for mounted suggestions and the active option', async () => {
		const user = userEvent.setup();
		rtl.render(<ActionBars reactComponentContainer={componentContainer} onHome={() => { }} />);
		const input = screen.getByRole('combobox');
		expect(input).toHaveAttribute('aria-expanded', 'false');
		expect(input).not.toHaveAttribute('aria-controls');
		await user.type(input, 'plot');
		const listbox = await screen.findByRole('listbox', { name: 'Search R Help' });
		expect(input).toHaveAttribute('aria-expanded', 'true');
		expect(input).toHaveAttribute('aria-controls', listbox.id);
		expect(input).not.toHaveAttribute('aria-activedescendant');
		await user.keyboard('{ArrowDown}');
		const option = screen.getAllByRole('option')[0];
		expect(input).toHaveAttribute('aria-activedescendant', option.id);
		await user.keyboard('{ArrowUp}');
		expect(input).not.toHaveAttribute('aria-activedescendant');
		await user.clear(input);
		expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
		expect(input).not.toHaveAttribute('aria-controls');
		expect(input).not.toHaveAttribute('aria-activedescendant');
	});

});
