/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Event } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { LanguageRuntimeSessionMode, RuntimeState } from '../../../languageRuntime/common/languageRuntimeService.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IRuntimeSessionService, SessionStartReasonId } from '../../../runtimeSession/common/runtimeSessionService.js';
import { createTestLanguageRuntimeMetadata, startTestLanguageRuntimeSession } from '../../../runtimeSession/test/common/testRuntimeSessionService.js';
import { CodeAttributionSource, USER_INITIATED_METADATA_KEY } from '../../common/positronConsoleCodeExecution.js';
import { IConsoleFindWidget, IConsoleFindWidgetFactory, IPositronConsoleInstance } from '../../browser/interfaces/positronConsoleService.js';
import { PositronConsoleService } from '../../browser/positronConsoleService.js';
import { IViewDescriptorService, ViewContainer, ViewContainerLocation } from '../../../../common/views.js';
import { IViewsService } from '../../../views/common/viewsService.js';

describe('PositronConsoleService', () => {

	const ctx = createTestContainer()
		.withWorkbenchServices()
		// Console instances create a find widget on construction; the widget itself is UI that
		// nothing here exercises.
		.stub(IConsoleFindWidgetFactory, {
			createFindWidget: () => stubInterface<IConsoleFindWidget>({
				onDidHide: Event.None,
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
});
