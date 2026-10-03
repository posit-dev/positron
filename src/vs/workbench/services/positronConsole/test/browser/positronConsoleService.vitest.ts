/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Event } from '../../../../../base/common/event.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IRuntimeSessionService, SessionStartReasonId } from '../../../runtimeSession/common/runtimeSessionService.js';
import { createTestLanguageRuntimeMetadata, startTestLanguageRuntimeSession } from '../../../runtimeSession/test/common/testRuntimeSessionService.js';
import { CodeAttributionSource, USER_INITIATED_METADATA_KEY } from '../../common/positronConsoleCodeExecution.js';
import { IConsoleFindWidget, IConsoleFindWidgetFactory, IPositronConsoleInstance } from '../../browser/interfaces/positronConsoleService.js';
import { PositronConsoleService } from '../../browser/positronConsoleService.js';

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
		{ name: 'code an AI assistant ran', attribution: { source: CodeAttributionSource.Assistant }, expected: { id: SessionStartReasonId.AssistantRanCodeWithoutSession, requestingExtensionId: undefined } },
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
});
