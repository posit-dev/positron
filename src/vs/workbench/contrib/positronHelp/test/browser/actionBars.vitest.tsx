/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { act, configure, getConfig, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { CancellationError } from '../../../../../base/common/errors.js';
import { IReactComponentContainer } from '../../../../../base/browser/positronReactRenderer.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ILanguageRuntimeMetadata } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { HelpTopicSuggestion } from '../../../../services/languageRuntime/common/positronHelpComm.js';
import { ILanguageRuntimeSession, IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { HelpTopicResult, IPositronHelpService } from '../../browser/positronHelpService.js';
import { ActionBars } from '../../browser/components/actionBars.js';

describe('Help ActionBars', () => {
	const foregroundEvents = new Emitter<ILanguageRuntimeSession | undefined>();
	afterAll(() => foregroundEvents.dispose());
	const plotTopics: HelpTopicSuggestion[] = [
		{ label: 'plot', topic: 'plot', package: 'graphics', detail: 'graphics' },
		{ label: 'plot.lm', topic: 'stats::plot.lm', detail: 'stats' },
	];
	const latestTopics: HelpTopicSuggestion[] = [{ label: 'plot.new', topic: 'graphics::plot.new' }];
	const showHelpTopicForForegroundSession = vi.fn<IPositronHelpService['showHelpTopicForForegroundSession']>();
	const searchHelp = vi.fn<IPositronHelpService['searchHelp']>();
	const getHelpTopics = vi.fn<IPositronHelpService['getHelpTopics']>();
	const info = vi.fn<INotificationService['info']>();
	const warn = vi.fn<INotificationService['warn']>();
	const session = stubInterface<ILanguageRuntimeSession>({
		sessionId: 'r-session',
		runtimeMetadata: stubInterface<ILanguageRuntimeMetadata>({ languageId: 'r', languageName: 'R' }),
	});
	let foregroundSession: ILanguageRuntimeSession | undefined;
	const changeForegroundSession = (newSession: ILanguageRuntimeSession | undefined) => {
		foregroundSession = newSession;
		foregroundEvents.fire(newSession);
	};
	const ctx = createTestContainer()
		.withReactServices()
		.stub(IRuntimeSessionService, stubInterface<IRuntimeSessionService>({
			get foregroundSession() { return foregroundSession; },
			onDidChangeForegroundSession: foregroundEvents.event,
		}))
		.stub(IPositronHelpService, stubInterface<IPositronHelpService>({
			canNavigateBackward: false,
			canNavigateForward: false,
			currentHelpEntry: undefined,
			helpEntries: [],
			onDidChangeCurrentHelpEntry: Event.None,
			getHelpTopics,
			searchHelp,
			showHelpTopicForForegroundSession,
		}))
		.stub(INotificationService, { info, warn })
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);
	const componentContainer = stubInterface<IReactComponentContainer>({ onSizeChanged: Event.None });

	// Fake timers drive the suggestion delay. RTL's default async wrapper only
	// advances Jest timers, so advance Vitest's clock instead.
	const asyncWrapper = getConfig().asyncWrapper;
	beforeEach(() => {
		vi.useFakeTimers();
		configure({
			asyncWrapper: async callback => {
				const result = await callback();
				await vi.advanceTimersByTimeAsync(0);
				return result;
			}
		});
		foregroundSession = session;
		getHelpTopics.mockResolvedValue(plotTopics);
		searchHelp.mockResolvedValue(true);
		showHelpTopicForForegroundSession.mockResolvedValue(HelpTopicResult.Found);
	});
	afterEach(() => {
		configure({ asyncWrapper });
		vi.useRealTimers();
	});

	const notifications = () => ({ info: info.mock.calls, warn: warn.mock.calls });
	const waitForSuggestions = async () => {
		await act(async () => { await vi.advanceTimersByTimeAsync(200); });
	};
	const settle = async <T,>(request: DeferredPromise<T>, value: T) => {
		await act(async () => { await request.complete(value); });
	};
	const renderSearch = () => {
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
		const view = rtl.render(<ActionBars reactComponentContainer={componentContainer} onHome={() => { }} />);
		return { user, view, input: screen.getByRole('combobox') };
	};
	const renderSuggestions = async () => {
		const rendered = renderSearch();
		await rendered.user.type(rendered.input, 'plot');
		await waitForSuggestions();
		expect(screen.getAllByRole('option')).toHaveLength(2);
		return rendered;
	};
	const expectListClosed = (input: HTMLElement) => {
		expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
		expect(input).toHaveAttribute('aria-expanded', 'false');
		expect(input).not.toHaveAttribute('aria-controls');
		expect(input).not.toHaveAttribute('aria-activedescendant');
	};

	it('places interpreter search in the first row and searches on Enter', async () => {
		const { user, input } = renderSearch();
		await user.type(input, 'linear model{Enter}');

		expect(searchHelp).toHaveBeenCalledExactlyOnceWith('linear model', expect.anything());
		expect(input.closest('.positron-action-bar')).toContainElement(screen.getByRole('button', { name: 'Previous topic' }));
		expect(input).toHaveAttribute('aria-label', 'Search R Help');
	});

	it.each([
		{ label: 'plot graphics', topics: plotTopics, topic: 'plot', package: 'graphics' },
		{ label: ':= data.table', topics: [{ label: ':=', topic: ':=', package: 'data.table', detail: 'data.table' }], topic: ':=', package: 'data.table' },
	])('opens the selected suggestion $label with its package', async ({ label, topics, topic, package: packageName }) => {
		getHelpTopics.mockResolvedValue(topics);
		const { user, input } = renderSearch();
		await user.type(input, topic);
		await waitForSuggestions();
		await user.click(screen.getByRole('option', { name: label }));

		expect(showHelpTopicForForegroundSession).toHaveBeenCalledExactlyOnceWith(topic, packageName, expect.anything());
		expect(searchHelp).not.toHaveBeenCalled();
		expectListClosed(input);
		expect(notifications()).toEqual({ info: [], warn: [] });
	});

	it.each([
		{ kind: 'topic', outcome: HelpTopicResult.NotFound, expected: { info: [['No help found for \'plot\'.']], warn: [] } },
		{ kind: 'topic', outcome: HelpTopicResult.Unavailable, expected: { info: [['Help search is unavailable for the active interpreter.']], warn: [] } },
		{ kind: 'search', outcome: false, expected: { info: [['Help search is unavailable for the active interpreter.']], warn: [] } },
		{ kind: 'topic', outcome: new Error('request failed'), expected: { info: [], warn: [['An error occurred while searching help: request failed']] } },
		{ kind: 'search', outcome: new Error('request failed'), expected: { info: [], warn: [['An error occurred while searching help: request failed']] } },
		{ kind: 'search', outcome: new CancellationError(), expected: { info: [], warn: [] } },
	])('reports a $kind outcome of $outcome', async ({ kind, outcome, expected }) => {
		const request = kind === 'topic' ? showHelpTopicForForegroundSession : searchHelp;
		if (outcome instanceof Error) {
			request.mockRejectedValue(outcome);
		} else {
			request.mockResolvedValue(outcome as never);
		}
		const { user } = await renderSuggestions();
		await user.keyboard(kind === 'topic' ? '{ArrowDown}{Enter}' : '{Enter}');

		expect(notifications()).toEqual(expected);
		expect(screen.getByRole('status')).toHaveTextContent('');
	});

	describe('suggestions', () => {
		it('keeps the current list until the next one arrives, and ignores responses for older queries', async () => {
			const { user, input } = await renderSuggestions();
			const options = screen.getAllByRole('option');
			const older = new DeferredPromise<HelpTopicSuggestion[]>();
			const latest = new DeferredPromise<HelpTopicSuggestion[]>();
			getHelpTopics.mockReturnValueOnce(older.p).mockReturnValueOnce(latest.p);
			await user.keyboard('.');
			await waitForSuggestions();
			await user.keyboard('new');
			await waitForSuggestions();
			await user.keyboard('{ArrowDown>2/}');

			expect(getHelpTopics.mock.calls.map(([query]) => query)).toEqual(['plot', 'plot.', 'plot.new']);
			expect(screen.getAllByRole('option')).toEqual(options);
			expect(input).toHaveAttribute('aria-activedescendant', options[1].id);
			await settle(older, [{ label: 'stale', topic: 'stale' }]);
			expect(screen.getAllByRole('option')).toEqual(options);
			await settle(latest, latestTopics);
			expect(screen.getByRole('option', { name: 'plot.new' })).toHaveAttribute('aria-selected', 'false');
			expect(input).not.toHaveAttribute('aria-activedescendant');
			await user.keyboard('{ArrowDown}{Enter}');
			expect(showHelpTopicForForegroundSession).toHaveBeenCalledExactlyOnceWith('graphics::plot.new', undefined, expect.anything());
		});

		it.each(['clear', 'Escape', 'blur'])('closes the list on %s and ignores a late response', async dismissal => {
			const { user, input } = await renderSuggestions();
			const request = new DeferredPromise<HelpTopicSuggestion[]>();
			getHelpTopics.mockReturnValueOnce(request.p);
			await user.keyboard('.');
			await waitForSuggestions();
			if (dismissal === 'clear') {
				await user.click(screen.getByRole('button', { name: 'Clear help search' }));
			} else if (dismissal === 'Escape') {
				await user.keyboard('{Escape}');
			} else {
				await user.tab();
			}
			await settle(request, latestTopics);
			expectListClosed(input);
		});

		it.each(['typing', 'ArrowDown'])('reopens after Escape on %s without refocusing the input', async reopen => {
			const { user, input } = await renderSuggestions();
			await user.keyboard('{Escape}');
			expectListClosed(input);
			await user.keyboard(reopen === 'typing' ? '.' : '{ArrowDown}');
			await waitForSuggestions();
			expect(screen.getByRole('listbox')).toBeInTheDocument();
			expect(input).toHaveFocus();
		});

		it('searches the query when the latest response is empty', async () => {
			const { user, input } = await renderSuggestions();
			getHelpTopics.mockResolvedValueOnce([]);
			await user.keyboard('.{ArrowDown}');
			await waitForSuggestions();
			expectListClosed(input);
			await user.keyboard('{Enter}');
			expect(searchHelp).toHaveBeenCalledExactlyOnceWith('plot.', expect.anything());
			expect(showHelpTopicForForegroundSession).not.toHaveBeenCalled();
		});

		it.each(['switch', 'remove'])('ignores a response from before a foreground session %s', async change => {
			const { user, input } = await renderSuggestions();
			const request = new DeferredPromise<HelpTopicSuggestion[]>();
			getHelpTopics.mockReturnValueOnce(request.p);
			await user.keyboard('.');
			await waitForSuggestions();
			const newSession = change === 'switch' ? stubInterface<ILanguageRuntimeSession>({
				sessionId: 'new-r-session',
				runtimeMetadata: session.runtimeMetadata,
			}) : undefined;
			await act(async () => {
				changeForegroundSession(newSession);
				await request.complete([{ label: 'old session', topic: 'old' }]);
			});

			expectListClosed(input);
			expect(input).toHaveProperty('disabled', change === 'remove');
		});
	});

	describe('pending requests', () => {
		it.each(['search', 'topic'])('keeps the input editable and cancels a pending %s on Escape or Clear', async kind => {
			const request = new DeferredPromise<never>();
			(kind === 'topic' ? showHelpTopicForForegroundSession : searchHelp).mockReturnValue(request.p);
			const { user, input } = await renderSuggestions();
			await user.keyboard(kind === 'topic' ? '{ArrowDown}{Enter}' : '{Enter}');
			const token = (kind === 'topic' ? showHelpTopicForForegroundSession.mock.calls[0][2] : searchHelp.mock.calls[0][1]);
			expect(screen.getByRole('status')).toHaveTextContent('Searching...');
			await user.keyboard('.new');
			expect(input).toHaveValue('plot.new');

			await user.keyboard('{Escape}');
			expect(token.isCancellationRequested).toBe(true);
			expect(screen.getByRole('status')).toHaveTextContent('');
			expect(input).toHaveFocus();
			await act(async () => { await request.error(new Error('late failure')); });
			expect(notifications()).toEqual({ info: [], warn: [] });
		});

		it('cancels the previous request when a new one starts, and reports only the latest', async () => {
			const first = new DeferredPromise<boolean>();
			const second = new DeferredPromise<boolean>();
			searchHelp.mockReturnValueOnce(first.p).mockReturnValueOnce(second.p);
			const { user, input } = renderSearch();
			await user.type(input, 'plot{Enter}');
			await user.keyboard('.new{Enter}');

			expect(searchHelp.mock.calls.map(([query, token]) => [query, token.isCancellationRequested])).toEqual([['plot', true], ['plot.new', false]]);
			await act(async () => { await first.error(new CancellationError()); });
			expect(screen.getByRole('status')).toHaveTextContent('Searching...');
			await settle(second, false);
			expect(screen.getByRole('status')).toHaveTextContent('');
			expect(notifications()).toEqual({ info: [['Help search is unavailable for the active interpreter.']], warn: [] });
		});

		it('cancels a pending search when the component unmounts', async () => {
			searchHelp.mockReturnValue(new Promise(() => { }));
			const { user, input, view } = renderSearch();
			await user.type(input, 'plot{Enter}');
			view.unmount();
			expect(searchHelp.mock.calls[0][1].isCancellationRequested).toBe(true);
		});
	});

	describe('keyboard and pointer', () => {
		it('scrolls the active option into view when navigating through 50 suggestions', async () => {
			getHelpTopics.mockResolvedValue(Array.from({ length: 50 }, (_, index) => ({
				label: `topic ${index}`, topic: `package::topic${index}`,
			})));
			const { user, input } = renderSearch();
			await user.type(input, 'topic');
			await waitForSuggestions();
			const options = screen.getAllByRole('option');
			const scrolledOptions: Element[] = [];
			options.forEach(option => vi.spyOn(option, 'scrollIntoView').mockImplementation(() => {
				scrolledOptions.push(option);
			}));

			await user.keyboard('{ArrowDown>50/}');
			expect(scrolledOptions).toEqual(options);
			expect(input).toHaveAttribute('aria-activedescendant', options[49].id);
			await user.keyboard('{ArrowUp}');
			expect(scrolledOptions.at(-1)).toBe(options[48]);
			await user.keyboard('{Enter}');
			expect(showHelpTopicForForegroundSession).toHaveBeenCalledExactlyOnceWith('package::topic48', undefined, expect.anything());
		});

		it('keeps options out of the tab order', async () => {
			const { user, input } = await renderSuggestions();
			expect(screen.getAllByRole('option').map(option => option.tabIndex)).toEqual([-1, -1]);
			await user.tab();
			expect(screen.getByRole('button', { name: 'Clear help search' })).toHaveFocus();
			await user.tab({ shift: true });
			await waitForSuggestions();
			expect(screen.getByRole('listbox')).toBeInTheDocument();
			expect(input).toHaveFocus();
		});

		it('keeps input focus while a suggestion is pressed', async () => {
			const { user, input } = await renderSuggestions();
			const option = screen.getByRole('option', { name: /plot graphics/ });
			await user.pointer({ target: option, keys: '[MouseLeft>]' });
			expect(input).toHaveFocus();
			await user.pointer({ keys: '[/MouseLeft]' });
			expect(showHelpTopicForForegroundSession).toHaveBeenCalledExactlyOnceWith('plot', 'graphics', expect.anything());
		});

		it('points ARIA references only at the mounted list and the active option', async () => {
			const { user, input } = await renderSuggestions();
			const listbox = screen.getByRole('listbox', { name: 'Search R Help' });
			expect(input).toHaveAttribute('aria-expanded', 'true');
			expect(input).toHaveAttribute('aria-controls', listbox.id);
			expect(input).not.toHaveAttribute('aria-activedescendant');
			await user.keyboard('{ArrowDown}');
			expect(input).toHaveAttribute('aria-activedescendant', screen.getAllByRole('option')[0].id);
			await user.keyboard('{ArrowUp}');
			expect(input).not.toHaveAttribute('aria-activedescendant');
			await user.clear(input);
			expectListClosed(input);
		});
	});
});
