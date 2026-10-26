/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

vi.hoisted(() => Object.assign(globalThis, {
	_VSCODE_FILE_ROOT: new URL('../../../../../../..', import.meta.url).pathname
}));

import { DeferredPromise } from '../../../../../base/common/async.js';
import { CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { CancellationError } from '../../../../../base/common/errors.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { HELP_SEARCH_TIMEOUT_MS, HelpClientInstance } from '../../../../services/languageRuntime/common/languageRuntimeHelpClient.js';
import { ILanguageRuntimeMetadata, RuntimeState } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { ShowHelpEvent, ShowHelpKind } from '../../../../services/languageRuntime/common/positronHelpComm.js';
import { ILanguageRuntimeSession, IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { IViewsService } from '../../../../services/views/common/viewsService.js';
import { PositronHelpService } from '../../browser/positronHelpService.js';

describe('Help search lifecycle', () => {
	let state: RuntimeState;
	let stateEvents: Emitter<RuntimeState>;
	let foregroundEvents: Emitter<ILanguageRuntimeSession | undefined>;
	let helpEvents: Emitter<ShowHelpEvent>;
	let session: ILanguageRuntimeSession;
	let service: PositronHelpService;
	const search = vi.fn<HelpClientInstance['searchHelp']>();
	const open = vi.fn().mockResolvedValue(true);
	const openView = vi.fn().mockResolvedValue(undefined);
	const ctx = createTestContainer().withRuntimeServices()
		.stub(IFileService, { readFile: () => Promise.reject(new Error('not needed')) })
		.stub(IThemeService, { onDidColorThemeChange: Event.None })
		.stub(IOpenerService, { open })
		.stub(IViewsService, { openView })
		.build();

	let cts: CancellationTokenSource;

	beforeEach(() => {
		cts = new CancellationTokenSource();
		state = RuntimeState.Idle;
		stateEvents = ctx.disposables.add(new Emitter<RuntimeState>());
		foregroundEvents = ctx.disposables.add(new Emitter<ILanguageRuntimeSession | undefined>());
		helpEvents = ctx.disposables.add(new Emitter<ShowHelpEvent>());
		session = stubInterface<ILanguageRuntimeSession>({
			sessionId: 'r-session',
			runtimeMetadata: stubInterface<ILanguageRuntimeMetadata>({ languageId: 'r', languageName: 'R' }),
			getRuntimeState: () => state,
			onDidChangeRuntimeState: stateEvents.event,
		});
		ctx.instantiationService.stub(IRuntimeSessionService, stubInterface<IRuntimeSessionService>({
			foregroundSession: session,
			onDidChangeForegroundSession: foregroundEvents.event,
			onDidChangeRuntimeState: Event.None,
		}));
		service = ctx.disposables.add(ctx.instantiationService.createInstance(PositronHelpService));
		search.mockReset().mockResolvedValue(true);
		open.mockClear();
		openView.mockReset().mockResolvedValue(undefined);
		service.attachClientInstance(session, stubInterface<HelpClientInstance>({
			searchHelp: search,
			onDidEmitHelpContent: helpEvents.event,
			onDidClose: Event.None,
			dispose: () => { },
		}));
	});

	afterEach(() => {
		cts.dispose();
		vi.useRealTimers();
	});

	const startSearch = (query = 'linear model') => service.searchHelp(query, cts.token);
	// The search is sent after the idle check settles, one microtask later.
	const searchId = async (call = 0) => {
		await vi.waitFor(() => expect(search.mock.calls.length).toBeGreaterThan(call));
		return search.mock.calls[call][1];
	};
	const setState = (newState: RuntimeState) => {
		state = newState;
		stateEvents.fire(newState);
	};
	const emitPage = (id: string | undefined, content = 'https://example.com/help', kind = ShowHelpKind.Url) =>
		helpEvents.fire({ content, kind, focus: false, search_id: id });

	it.each(['reply', 'page'])('shows the results page when the %s arrives first', async first => {
		const reply = new DeferredPromise<boolean>();
		search.mockReturnValue(reply.p);
		const pending = startSearch();
		if (first === 'reply') {
			await reply.complete(true);
			emitPage(await searchId());
		} else {
			emitPage(await searchId());
			await reply.complete(true);
		}
		expect(await pending).toBe(true);
		expect(open).toHaveBeenCalledOnce();
	});

	it('returns false without waiting for a page when the interpreter declines', async () => {
		search.mockResolvedValue(false);
		expect(await startSearch()).toBe(false);
	});

	it.each([RuntimeState.Busy, RuntimeState.Interrupting, RuntimeState.Starting])('waits while %s, then searches once', async initialState => {
		state = initialState;
		const pending = startSearch();
		expect(search).not.toHaveBeenCalled();
		setState(RuntimeState.Idle);
		// The search request itself makes the interpreter busy, then idle.
		setState(RuntimeState.Busy);
		setState(RuntimeState.Idle);
		emitPage(await searchId());
		expect(await pending).toBe(true);
		expect(search).toHaveBeenCalledExactlyOnceWith('linear model', expect.any(String));
	});

	it('does not time out while waiting, then times out after dispatch and ignores the late page', async () => {
		vi.useFakeTimers();
		state = RuntimeState.Busy;
		search.mockReturnValue(new Promise(() => { }));
		const pending = startSearch().catch(error => error);
		await vi.advanceTimersByTimeAsync(2 * HELP_SEARCH_TIMEOUT_MS);
		expect(search).not.toHaveBeenCalled();
		setState(RuntimeState.Idle);
		await vi.advanceTimersByTimeAsync(HELP_SEARCH_TIMEOUT_MS);
		expect(await pending).toEqual(new Error('Help search timed out.'));
		emitPage(await searchId());
		expect(open).not.toHaveBeenCalled();
		// Console help has no search ID and is still shown.
		emitPage(undefined);
		expect(open).toHaveBeenCalledOnce();
	});

	it('cancellation before the request is sent prevents the request', async () => {
		const pending = startSearch().catch(error => error);
		cts.cancel();
		expect(await pending).toBeInstanceOf(CancellationError);
		expect(search).not.toHaveBeenCalled();
	});

	it('cancellation after the request is sent ignores its late page', async () => {
		const reply = new DeferredPromise<boolean>();
		search.mockReturnValue(reply.p);
		const pending = startSearch().catch(error => error);
		const id = await searchId();
		cts.cancel();
		expect(await pending).toBeInstanceOf(CancellationError);
		await reply.complete(true);
		emitPage(id);
		expect(open).not.toHaveBeenCalled();
	});

	it('replaces the pending search and ignores its late page', async () => {
		const oldReply = new DeferredPromise<boolean>();
		search.mockReturnValueOnce(oldReply.p);
		const oldSearch = startSearch('old query').catch(error => error);
		const oldId = await searchId(0);
		const newSearch = startSearch('new query');
		expect(await oldSearch).toBeInstanceOf(CancellationError);
		emitPage(await searchId(1));
		expect(await newSearch).toBe(true);
		await oldReply.complete(true);
		emitPage(oldId);
		expect(open).toHaveBeenCalledOnce();
	});

	it.each([
		{ change: 'the foreground session changes', act: () => foregroundEvents.fire(undefined) },
		{ change: 'the session exits', act: () => setState(RuntimeState.Exited) },
	])('cancels the search when $change', async ({ act }) => {
		state = RuntimeState.Busy;
		const pending = startSearch().catch(error => error);
		act();
		expect(await pending).toBeInstanceOf(CancellationError);
		expect(search).not.toHaveBeenCalled();
	});

	it('drops a page that becomes stale while the Help view opens', async () => {
		const view = new DeferredPromise<undefined>();
		openView.mockReturnValueOnce(view.p);
		const pending = startSearch().catch(error => error);
		emitPage(await searchId(), 'http://localhost:12345/search');
		cts.cancel();
		expect(await pending).toBeInstanceOf(CancellationError);
		await view.complete(undefined);
		await Promise.resolve();
		expect(service.helpEntries).toHaveLength(0);
	});

	it.each([
		{ failure: 'the page kind is not supported', emit: async () => emitPage(await searchId(), 'html', ShowHelpKind.Html) },
		{ failure: 'the page cannot be opened', emit: async () => { open.mockRejectedValueOnce(new Error('no browser')); emitPage(await searchId()); } },
	])('finishes without a timeout when $failure', async ({ emit }) => {
		vi.useFakeTimers();
		const pending = startSearch();
		await emit();
		await vi.advanceTimersByTimeAsync(0);
		expect(await pending).toBe(true);
	});
});
