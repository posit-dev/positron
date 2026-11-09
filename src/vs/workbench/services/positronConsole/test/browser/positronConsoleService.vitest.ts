/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../../base/common/event.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { URI } from '../../../../../base/common/uri.js';
import { ILanguageRuntimeService, LanguageRuntimeSessionMode, RuntimeCodeExecutionMode, RuntimeState } from '../../../languageRuntime/common/languageRuntimeService.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IRuntimeSessionService, RuntimeStartMode, SessionStartReasonId } from '../../../runtimeSession/common/runtimeSessionService.js';
import { createTestLanguageRuntimeMetadata, startTestLanguageRuntimeSession } from '../../../runtimeSession/test/common/testRuntimeSessionService.js';
import { CodeAttributionSource, COMPLETENESS_VERIFIED_METADATA_KEY, USER_INITIATED_METADATA_KEY } from '../../common/positronConsoleCodeExecution.js';
import { IConsoleFindWidget, IConsoleFindWidgetFactory, IPositronConsoleInstance } from '../../browser/interfaces/positronConsoleService.js';
import { PositronConsoleService } from '../../browser/positronConsoleService.js';
import { IViewDescriptorService, ViewContainer, ViewContainerLocation } from '../../../../common/views.js';
import { IViewsService } from '../../../views/common/viewsService.js';
import { ILanguageFeaturesService } from '../../../../../editor/common/services/languageFeatures.js';
import type { IInputBoundary } from '../../../../../editor/common/languages.js';

describe('PositronConsoleService', () => {

	const ctx = createTestContainer()
		.withWorkbenchServices()
		// Console instances create a find widget on construction; the widget itself is UI that
		// nothing here exercises.
		.stub(IConsoleFindWidgetFactory, {
			createFindWidget: () => stubInterface<IConsoleFindWidget>({
				onDidHide: Event.None,
				refreshSearch: () => { },
				dispose: () => { }
			})
		})
		.build();

	it('clears the active console instance when the active console is deleted', async () => {
		const consoleService = ctx.disposables.add(
			ctx.instantiationService.createInstance(PositronConsoleService));
		const session = await startTestLanguageRuntimeSession(ctx.instantiationService, ctx.disposables);
		expect(consoleService.activePositronConsoleInstance?.sessionId).toBe(session.sessionId);

		const active: (IPositronConsoleInstance | undefined)[] = [];
		ctx.disposables.add(consoleService.onDidChangeActivePositronConsoleInstance(
			instance => active.push(instance)));

		// There is no other console to fall back to, so nothing else reports an active console
		// change here: the foreground session becomes `undefined`, which the foreground session
		// handler ignores. Consumers that track the active console -- the extension host behind
		// `positron.window.activeConsoleEditor` among them -- would keep the deleted console.
		consoleService.deletePositronConsoleSession(session.sessionId);

		expect(active.map(instance => instance?.sessionId)).toEqual([undefined]);
		expect(consoleService.activePositronConsoleInstance).toBeUndefined();
	});

	it.each([
		{ name: 'code an extension sent', attribution: { source: CodeAttributionSource.Extension, metadata: { extensionId: 'posit.shiny' } }, expected: { id: SessionStartReasonId.CodeExecutedWithoutSession, requestingExtensionId: 'posit.shiny' } },
		{ name: 'code an extension sent for a file', attribution: { source: CodeAttributionSource.Script, metadata: { extensionId: 'positron.positron-r' } }, expected: { id: SessionStartReasonId.CodeExecutedWithoutSession, requestingExtensionId: 'positron.positron-r' } },
		{ name: 'code a kernel sent through an extension', attribution: { source: CodeAttributionSource.Extension, metadata: { extensionId: 'positron.positron-supervisor', callerSessionId: 'r-notebook-1' } }, expected: { id: SessionStartReasonId.CodeExecutedWithoutSession, requestingExtensionId: undefined } },
		{ name: 'code the user ran from an editor', attribution: { source: CodeAttributionSource.Script }, expected: { id: SessionStartReasonId.UserRanCodeWithoutSession, requestingExtensionId: undefined } },
		{ name: 'code the user ran from the History pane', attribution: { source: CodeAttributionSource.Interactive }, expected: { id: SessionStartReasonId.UserRanCodeWithoutSession, requestingExtensionId: undefined } },
		{ name: 'code from AI chat', attribution: { source: CodeAttributionSource.Assistant }, expected: { id: SessionStartReasonId.AiChatCodeExecutedWithoutSession, requestingExtensionId: undefined } },
		{ name: 'chat code the user ran with Run in Console', attribution: { source: CodeAttributionSource.Assistant, metadata: { [USER_INITIATED_METADATA_KEY]: true } }, expected: { id: SessionStartReasonId.UserRanCodeWithoutSession, requestingExtensionId: undefined } },
		{ name: 'code from an unknown caller', attribution: { source: CodeAttributionSource.Extension }, expected: { id: SessionStartReasonId.CodeExecutedWithoutSession, requestingExtensionId: undefined } },
	])('records why it started a console for $name', async ({ attribution, expected }) => {
		const consoleService = ctx.disposables.add(
			ctx.instantiationService.createInstance(PositronConsoleService));
		const runtime = createTestLanguageRuntimeMetadata(ctx.instantiationService, ctx.disposables);
		const willStart = Event.toPromise(ctx.get(IRuntimeSessionService).onWillStartSession);

		const executing = consoleService.executeCode(runtime.languageId, undefined, '1 + 1', attribution, false);
		const { session } = await willStart;
		ctx.disposables.add(session);

		const { startReasonId: id, requestingExtensionId } = session.metadata;
		expect({ id, requestingExtensionId }).toEqual(expected);
		await executing.catch(() => { });
	});

	describe('completeness-verified code', () => {
		// A boundary provider that never answers, like Ark's LSP while the requesting session is blocked.
		async function startWithHungBoundaryProvider() {
			const consoleService = ctx.disposables.add(
				ctx.instantiationService.createInstance(PositronConsoleService));
			const session = await startTestLanguageRuntimeSession(ctx.instantiationService, ctx.disposables);
			ctx.disposables.add(ctx.get(ILanguageFeaturesService).inputBoundaryProvider.register(
				{ language: '*', scheme: 'inmemory' },
				{ provideInputBoundaries: () => new Promise<IInputBoundary[]>(() => { }) }
			));
			// Code only goes through the completeness check when the runtime is idle or ready.
			session.setRuntimeState(RuntimeState.Ready);
			const executeSpy = vi.spyOn(session, 'execute');
			return { consoleService, session, executeSpy };
		}

		function run(consoleService: PositronConsoleService, sessionId: string, languageId: string, verified: boolean) {
			const attribution = {
				source: CodeAttributionSource.Extension,
				metadata: verified ? { [COMPLETENESS_VERIFIED_METADATA_KEY]: true } : undefined,
			};
			return consoleService.executeCode(languageId, sessionId, '1 + 1', attribution, false, false,
				RuntimeCodeExecutionMode.Interactive, undefined, 'exec-1', undefined, undefined, true, false);
		}

		const pending = Symbol('pending');
		const settle = <T>(promise: Promise<T>) =>
			Promise.race([promise.then(() => 'resolved' as const), new Promise<typeof pending>(resolve => setTimeout(() => resolve(pending), 200))]);

		it('runs without waiting on a boundary provider that never answers', async () => {
			const { consoleService, session, executeSpy } = await startWithHungBoundaryProvider();

			const outcome = await settle(run(consoleService, session.sessionId, session.runtimeMetadata.languageId, true));

			expect({ outcome, executed: executeSpy.mock.calls.map(call => call[0]) }).toEqual({ outcome: 'resolved', executed: ['1 + 1'] });
		});

		it('waits on a boundary provider that never answers when the code is not marked verified', async () => {
			const { consoleService, session, executeSpy } = await startWithHungBoundaryProvider();

			const outcome = await settle(run(consoleService, session.sessionId, session.runtimeMetadata.languageId, false));

			expect({ outcome, executed: executeSpy.mock.calls.length }).toEqual({ outcome: pending, executed: 0 });

			// Cancel the stuck submission so its listeners do not outlive the test.
			consoleService.positronConsoleInstances.find(instance => instance.sessionId === session.sessionId)?.cancelCodeSubmission();
		});
	});

	describe('preserveActiveTab', () => {
		const attribution = { source: CodeAttributionSource.Extension };

		// Another container (e.g. the Assistant) is the active tab where the Console lives.
		async function startWithOtherContainerShowing() {
			const consoleService = ctx.disposables.add(
				ctx.instantiationService.createInstance(PositronConsoleService));
			const session = await startTestLanguageRuntimeSession(ctx.instantiationService, ctx.disposables);
			vi.spyOn(ctx.get(IViewDescriptorService), 'getViewContainerByViewId')
				.mockReturnValue(stubInterface<ViewContainer>({ id: 'consoleContainer' }));
			vi.spyOn(ctx.get(IViewDescriptorService), 'getViewContainerLocation').mockReturnValue(ViewContainerLocation.Panel);
			vi.spyOn(ctx.get(IViewsService), 'getVisibleViewContainer')
				.mockReturnValue(stubInterface<ViewContainer>({ id: 'otherContainer' }));
			const openViewSpy = vi.spyOn(ctx.get(IViewsService), 'openView');
			return { consoleService, session, openViewSpy };
		}

		it('runs the code without switching tabs', async () => {
			const { consoleService, session, openViewSpy } = await startWithOtherContainerShowing();

			await consoleService.executeCode(session.runtimeMetadata.languageId, session.sessionId, '1 + 1',
				attribution, false, true, undefined, undefined, 'exec-1', undefined, undefined, true);

			expect(openViewSpy).not.toHaveBeenCalled();
			expect(consoleService.shouldPreserveActiveTab('exec-1')).toBe(true);
		});

		it('reveals the console when the caller also asks for focus', async () => {
			const { consoleService, session, openViewSpy } = await startWithOtherContainerShowing();

			await consoleService.executeCode(session.runtimeMetadata.languageId, session.sessionId, '1 + 1',
				attribution, true, true, undefined, undefined, 'exec-1', undefined, undefined, true);

			expect(openViewSpy).toHaveBeenCalled();
			expect(consoleService.shouldPreserveActiveTab('exec-1')).toBe(false);
		});

		it.each([
			{ preserveActiveTab: true, expected: 'foreground' as const },
			{ preserveActiveTab: false, expected: 'background' as const },
		])('leaves $expected in the foreground after running in a background console when preserveActiveTab is $preserveActiveTab', async ({ preserveActiveTab, expected }) => {
			const consoleService = ctx.disposables.add(
				ctx.instantiationService.createInstance(PositronConsoleService));
			const background = await startTestLanguageRuntimeSession(ctx.instantiationService, ctx.disposables);
			const foreground = await startTestLanguageRuntimeSession(ctx.instantiationService, ctx.disposables);
			const sessions = { foreground, background };

			await consoleService.executeCode(background.runtimeMetadata.languageId, background.sessionId, '1 + 1',
				attribution, false, true, undefined, undefined, 'exec-1', undefined, undefined, preserveActiveTab);

			expect(ctx.get(IRuntimeSessionService).foregroundSession?.sessionId).toBe(sessions[expected].sessionId);
			expect(consoleService.activePositronConsoleInstance?.sessionId).toBe(sessions[expected].sessionId);
		});

		it('runs code in a notebook session that has no console, in the background', async () => {
			const consoleService = ctx.disposables.add(
				ctx.instantiationService.createInstance(PositronConsoleService));
			const foreground = await startTestLanguageRuntimeSession(ctx.instantiationService, ctx.disposables);
			const notebook = await startTestLanguageRuntimeSession(ctx.instantiationService, ctx.disposables, {
				sessionMode: LanguageRuntimeSessionMode.Notebook,
				notebookUri: URI.file('/test/notebook.ipynb'),
			});
			notebook.setRuntimeState(RuntimeState.Idle);
			ctx.get(IRuntimeSessionService).foregroundSession = foreground;
			expect(consoleService.positronConsoleInstances.map(instance => instance.sessionId)).not.toContain(notebook.sessionId);

			await consoleService.executeCode(notebook.runtimeMetadata.languageId, notebook.sessionId, '1 + 1',
				attribution, false, true, undefined, undefined, 'exec-1', undefined, undefined, true);

			expect(consoleService.positronConsoleInstances.map(instance => instance.sessionId)).toContain(notebook.sessionId);
			expect(ctx.get(IRuntimeSessionService).foregroundSession?.sessionId).toBe(foreground.sessionId);
			expect(consoleService.activePositronConsoleInstance?.sessionId).toBe(foreground.sessionId);
		});

		it('activates a notebook session\'s new console when no console is active', async () => {
			const consoleService = ctx.disposables.add(
				ctx.instantiationService.createInstance(PositronConsoleService));
			const notebook = await startTestLanguageRuntimeSession(ctx.instantiationService, ctx.disposables, {
				sessionMode: LanguageRuntimeSessionMode.Notebook,
				notebookUri: URI.file('/test/notebook.ipynb'),
			});
			notebook.setRuntimeState(RuntimeState.Idle);
			expect(consoleService.activePositronConsoleInstance).toBeUndefined();

			await consoleService.executeCode(notebook.runtimeMetadata.languageId, notebook.sessionId, '1 + 1',
				attribution, false, true, undefined, undefined, 'exec-1', undefined, undefined, true);

			expect(consoleService.activePositronConsoleInstance?.sessionId).toBe(notebook.sessionId);
			expect(ctx.get(IRuntimeSessionService).foregroundSession?.sessionId).toBe(notebook.sessionId);
		});

		it('does not attach a console to a notebook session that has exited', async () => {
			const consoleService = ctx.disposables.add(
				ctx.instantiationService.createInstance(PositronConsoleService));
			const notebook = await startTestLanguageRuntimeSession(ctx.instantiationService, ctx.disposables, {
				sessionMode: LanguageRuntimeSessionMode.Notebook,
				notebookUri: URI.file('/test/notebook.ipynb'),
			});
			notebook.setRuntimeState(RuntimeState.Exited);

			await expect(consoleService.executeCode(notebook.runtimeMetadata.languageId, notebook.sessionId, '1 + 1',
				attribution, false, true, undefined, undefined, 'exec-1', undefined, undefined, true)).rejects.toThrow();
			expect(consoleService.positronConsoleInstances.map(instance => instance.sessionId)).not.toContain(notebook.sessionId);
		});
	});

	describe('activate: false', () => {
		const attribution = { source: CodeAttributionSource.Extension };

		// Two console sessions; the first is made the foreground and active console.
		async function startTwoSessions() {
			const consoleService = ctx.disposables.add(
				ctx.instantiationService.createInstance(PositronConsoleService));
			const first = await startTestLanguageRuntimeSession(ctx.instantiationService, ctx.disposables);
			const second = await startTestLanguageRuntimeSession(ctx.instantiationService, ctx.disposables);
			ctx.get(IRuntimeSessionService).foregroundSession = first;
			expect(consoleService.activePositronConsoleInstance?.sessionId).toBe(first.sessionId);
			const openViewSpy = vi.spyOn(ctx.get(IViewsService), 'openView');
			return { consoleService, first, second, openViewSpy };
		}

		it.each([false, true])('runs code in a background session without changing the active console or foreground session (focus: %s)', async (focus) => {
			const { consoleService, first, second, openViewSpy } = await startTwoSessions();
			const firstEnqueueSpy = vi.spyOn(consoleService.positronConsoleInstances.find(instance => instance.sessionId === first.sessionId)!, 'enqueueCode');
			const secondEnqueueSpy = vi.spyOn(consoleService.positronConsoleInstances.find(instance => instance.sessionId === second.sessionId)!, 'enqueueCode');

			await consoleService.executeCode('test', second.sessionId, '1 + 1',
				attribution, focus, true, undefined, undefined, 'exec-1', undefined, undefined, undefined, false);

			expect(consoleService.activePositronConsoleInstance?.sessionId).toBe(first.sessionId);
			expect(ctx.get(IRuntimeSessionService).foregroundSession?.sessionId).toBe(first.sessionId);
			expect(openViewSpy).not.toHaveBeenCalled();
			expect(secondEnqueueSpy).toHaveBeenCalledTimes(1);
			expect(secondEnqueueSpy.mock.calls[0][0]).toBe('1 + 1');
			expect(firstEnqueueSpy).not.toHaveBeenCalled();
		});

		it('remembers a generated execution id with preserveActiveTab so its plots do not switch tabs', async () => {
			const { consoleService, second } = await startTwoSessions();
			const secondEnqueueSpy = vi.spyOn(consoleService.positronConsoleInstances.find(instance => instance.sessionId === second.sessionId)!, 'enqueueCode');

			await consoleService.executeCode('test', second.sessionId, '1 + 1',
				attribution, false, false, undefined, undefined, undefined, undefined, undefined, true, false);

			const executionId = secondEnqueueSpy.mock.calls[0][5];
			expect({
				hasExecutionId: typeof executionId === 'string' && executionId.length > 0,
				shouldPreserveActiveTab: executionId !== undefined && consoleService.shouldPreserveActiveTab(executionId),
			}).toEqual({ hasExecutionId: true, shouldPreserveActiveTab: true });
		});

		it.each([undefined, ''])('rejects activate: false without a session id (%j)', async (sessionId) => {
			const { consoleService, first } = await startTwoSessions();
			const firstInstance = consoleService.positronConsoleInstances.find(instance => instance.sessionId === first.sessionId)!;
			const enqueueSpy = vi.spyOn(firstInstance, 'enqueueCode');

			await expect(consoleService.executeCode('test', sessionId, 'x',
				attribution, false, true, undefined, undefined, 'exec-1', undefined, undefined, undefined, false)).rejects.toThrow();

			expect(enqueueSpy).not.toHaveBeenCalled();
		});
	});

	describe('no session id', () => {
		it('prefers the last active console for the language over the newest one', async () => {
			const consoleService = ctx.disposables.add(
				ctx.instantiationService.createInstance(PositronConsoleService));
			const runtime = createTestLanguageRuntimeMetadata(ctx.instantiationService, ctx.disposables);
			const older = await startTestLanguageRuntimeSession(ctx.instantiationService, ctx.disposables, { runtime });

			// A newer console for the same language that never becomes active, like a background job.
			// Wait (with margin for early timers) so that its creation timestamp is strictly newer.
			await new Promise(resolve => setTimeout(resolve, 15));
			const newerId = await ctx.get(IRuntimeSessionService).startNewRuntimeSession(
				runtime.runtimeId, 'job', LanguageRuntimeSessionMode.Console, undefined,
				{ id: SessionStartReasonId.CodeRequestedNewSession }, RuntimeStartMode.Starting, false,
				{ owner: 'user', requireNewSession: true, takeForegroundIfEmpty: false });

			ctx.disposables.add(ctx.get(IRuntimeSessionService).getSession(newerId)!);

			// Make a console of another language the active one.
			const otherRuntime = createTestLanguageRuntimeMetadata(ctx.instantiationService, ctx.disposables);
			const otherLanguageRuntime = { ...otherRuntime, runtimeId: generateUuid(), languageId: 'other' };
			ctx.disposables.add(ctx.get(ILanguageRuntimeService).registerRuntime(otherLanguageRuntime));
			const other = await startTestLanguageRuntimeSession(ctx.instantiationService, ctx.disposables, { runtime: otherLanguageRuntime });
			expect(consoleService.activePositronConsoleInstance?.sessionId).toBe(other.sessionId);

			const olderSpy = vi.spyOn(consoleService.positronConsoleInstances.find(instance => instance.sessionId === older.sessionId)!, 'enqueueCode').mockImplementation(async () => { });
			const newerSpy = vi.spyOn(consoleService.positronConsoleInstances.find(instance => instance.sessionId === newerId)!, 'enqueueCode').mockImplementation(async () => { });

			await consoleService.executeCode('test', undefined, '1 + 1', { source: CodeAttributionSource.Extension }, false);

			expect([olderSpy.mock.calls.length, newerSpy.mock.calls.length]).toEqual([1, 0]);
		});

		it('skips the last active console when it has exited and uses the newest running one', async () => {
			const consoleService = ctx.disposables.add(
				ctx.instantiationService.createInstance(PositronConsoleService));
			const runtime = createTestLanguageRuntimeMetadata(ctx.instantiationService, ctx.disposables);
			const older = await startTestLanguageRuntimeSession(ctx.instantiationService, ctx.disposables, { runtime });

			// A newer, running console for the same language that never becomes active.
			await new Promise(resolve => setTimeout(resolve, 15));
			const newerId = await ctx.get(IRuntimeSessionService).startNewRuntimeSession(
				runtime.runtimeId, 'job', LanguageRuntimeSessionMode.Console, undefined,
				{ id: SessionStartReasonId.CodeRequestedNewSession }, RuntimeStartMode.Starting, false,
				{ owner: 'user', requireNewSession: true, takeForegroundIfEmpty: false });
			ctx.disposables.add(ctx.get(IRuntimeSessionService).getSession(newerId)!);

			// Make a console of another language the active one.
			const otherRuntime = createTestLanguageRuntimeMetadata(ctx.instantiationService, ctx.disposables);
			const otherLanguageRuntime = { ...otherRuntime, runtimeId: generateUuid(), languageId: 'other' };
			ctx.disposables.add(ctx.get(ILanguageRuntimeService).registerRuntime(otherLanguageRuntime));
			const other = await startTestLanguageRuntimeSession(ctx.instantiationService, ctx.disposables, { runtime: otherLanguageRuntime });
			expect(consoleService.activePositronConsoleInstance?.sessionId).toBe(other.sessionId);

			older.setRuntimeState(RuntimeState.Exited);

			const olderSpy = vi.spyOn(consoleService.positronConsoleInstances.find(instance => instance.sessionId === older.sessionId)!, 'enqueueCode').mockImplementation(async () => { });
			const newerSpy = vi.spyOn(consoleService.positronConsoleInstances.find(instance => instance.sessionId === newerId)!, 'enqueueCode').mockImplementation(async () => { });

			await consoleService.executeCode('test', undefined, '1 + 1', { source: CodeAttributionSource.Extension }, false);

			expect([olderSpy.mock.calls.length, newerSpy.mock.calls.length]).toEqual([0, 1]);
		});
	});
});
