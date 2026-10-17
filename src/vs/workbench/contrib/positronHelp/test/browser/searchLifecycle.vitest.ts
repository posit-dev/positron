/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

vi.hoisted(() => Object.assign(globalThis, {
	_VSCODE_FILE_ROOT: new URL('../../../../../../..', import.meta.url).pathname
}));

import { DeferredPromise } from '../../../../../base/common/async.js';
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

	beforeEach(() => {
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

	afterEach(() => vi.useRealTimers());

	const emitResult = (id: string | undefined, content = 'https://example.com/help') =>
		helpEvents.fire({ content, kind: ShowHelpKind.Url, focus: false, search_id: id });

	it('accepts navigation before its RPC acknowledgement', async () => {
		const ack = new DeferredPromise<boolean>();
		search.mockReturnValue(ack.p);
		const pending = service.searchHelp('linear model');
		emitResult(search.mock.calls[0][1]);
		await vi.waitFor(() => expect(open).toHaveBeenCalledOnce());
		void ack.complete(true);
		expect(await pending).toBe(true);
	});

	it('accepts navigation after its RPC acknowledgement', async () => {
		const pending = service.searchHelp('linear model');
		await Promise.resolve();
		emitResult(search.mock.calls[0][1]);
		expect(await pending).toBe(true);
	});

	it('drops late navigation after timeout but keeps console help', async () => {
		vi.useFakeTimers();
		const pending = service.searchHelp('linear model').catch(error => error);
		const id = search.mock.calls[0][1];
		await vi.advanceTimersByTimeAsync(HELP_SEARCH_TIMEOUT_MS);
		expect(await pending).toBeInstanceOf(Error);
		emitResult(id);
		expect(open).not.toHaveBeenCalled();
		emitResult(undefined);
		expect(open).toHaveBeenCalledOnce();
	});

	it('waits for the interpreter instead of sending while busy', async () => {
		state = RuntimeState.Busy;
		const pending = service.searchHelp('linear model');
		expect(search).not.toHaveBeenCalled();
		state = RuntimeState.Idle;
		stateEvents.fire(state);
		expect(search).toHaveBeenCalledOnce();
		emitResult(search.mock.calls[0][1]);
		expect(await pending).toBe(true);
	});

	it.each([RuntimeState.Busy, RuntimeState.Interrupting, RuntimeState.Idle])('explicit cancellation while %s prevents dispatch or late navigation', async initialState => {
		vi.useFakeTimers();
		state = initialState;
		const ack = new DeferredPromise<boolean>();
		search.mockReturnValueOnce(ack.p);
		const pending = service.searchHelp('old query').catch(error => error);
		const id = search.mock.calls[0]?.[1];
		service.cancelSearch();
		service.cancelSearch();
		expect(await pending).toBeInstanceOf(CancellationError);
		state = RuntimeState.Idle;
		stateEvents.fire(state);
		await ack.complete(true);
		if (id) {
			emitResult(id);
		}
		await vi.advanceTimersByTimeAsync(HELP_SEARCH_TIMEOUT_MS);
		expect(search).toHaveBeenCalledTimes(initialState === RuntimeState.Idle ? 1 : 0);
		expect(open).not.toHaveBeenCalled();
	});

	it('only dispatches the replacement after a busy interpreter becomes idle', async () => {
		state = RuntimeState.Busy;
		const oldRequest = service.searchHelp('old query').catch(error => error);
		const newRequest = service.searchHelp('new query');
		expect(await oldRequest).toBeInstanceOf(CancellationError);
		state = RuntimeState.Idle;
		stateEvents.fire(state);
		state = RuntimeState.Busy;
		stateEvents.fire(state);
		state = RuntimeState.Idle;
		stateEvents.fire(state);
		expect(search).toHaveBeenCalledExactlyOnceWith('new query', expect.any(String));
		emitResult(search.mock.calls[0][1]);
		expect(await newRequest).toBe(true);
		expect(open).toHaveBeenCalledOnce();
	});

	it('ignores the replaced search acknowledgement and navigation after the new result', async () => {
		const oldAck = new DeferredPromise<boolean>();
		search.mockReturnValueOnce(oldAck.p);
		const oldRequest = service.searchHelp('old query').catch(error => error);
		const oldId = search.mock.calls[0][1];
		const newRequest = service.searchHelp('new query');
		expect(await oldRequest).toBeInstanceOf(CancellationError);
		emitResult(search.mock.calls[1][1]);
		expect(await newRequest).toBe(true);
		await oldAck.complete(true);
		emitResult(oldId);
		expect(open).toHaveBeenCalledOnce();
	});

	it('rechecks explicit cancellation after asynchronously opening the Help view', async () => {
		const view = new DeferredPromise<undefined>();
		openView.mockReturnValueOnce(view.p);
		const pending = service.searchHelp('old query').catch(error => error);
		emitResult(search.mock.calls[0][1], 'http://localhost:12345/search');
		service.cancelSearch();
		expect(await pending).toBeInstanceOf(CancellationError);
		await view.complete(undefined);
		await Promise.resolve();
		expect(service.helpEntries).toHaveLength(0);
	});

	it('cancels navigation when the foreground session changes', async () => {
		const pending = service.searchHelp('linear model').catch(error => error);
		const id = search.mock.calls[0][1];
		foregroundEvents.fire(undefined);
		expect(await pending).toBeInstanceOf(CancellationError);
		emitResult(id);
		expect(open).not.toHaveBeenCalled();
	});

	it('rechecks expiry after asynchronously opening the Help view', async () => {
		vi.useFakeTimers();
		const view = new DeferredPromise<undefined>();
		openView.mockReturnValue(view.p);
		const pending = service.searchHelp('linear model').catch(error => error);
		emitResult(search.mock.calls[0][1], 'http://localhost:12345/search');
		expect(openView).toHaveBeenCalledOnce();
		await vi.advanceTimersByTimeAsync(HELP_SEARCH_TIMEOUT_MS);
		expect(await pending).toBeInstanceOf(Error);
		await view.complete(undefined);
		await Promise.resolve();
		expect(service.helpEntries).toHaveLength(0);
	});

});
