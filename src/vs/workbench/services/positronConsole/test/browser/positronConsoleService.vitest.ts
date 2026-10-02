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
import { CodeAttributionSource } from '../../common/positronConsoleCodeExecution.js';
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

	it('records why it started a console when code runs with no console running', async () => {
		const consoleService = ctx.disposables.add(
			ctx.instantiationService.createInstance(PositronConsoleService));
		const runtime = createTestLanguageRuntimeMetadata(ctx.instantiationService, ctx.disposables);
		const willStart = Event.toPromise(ctx.get(IRuntimeSessionService).onWillStartSession);

		const executing = consoleService.executeCode(runtime.languageId, undefined, '1 + 1', { source: CodeAttributionSource.Script }, false);
		const { session } = await willStart;
		ctx.disposables.add(session);

		expect([session.metadata.startReasonId, session.metadata.startReason]).toEqual([
			SessionStartReasonId.CodeExecutedWithoutSession,
			`Code was sent to the console with no ${runtime.languageName} session`,
		]);
		// The code runs once the session is ready; this test only covers the start.
		await executing.catch(() => { });
	});

	it.each([
		{ name: 'code an extension sent', attribution: { source: CodeAttributionSource.Extension, metadata: { extensionId: 'posit.shiny' } }, expected: 'posit.shiny' },
		{ name: 'code an extension sent for a file', attribution: { source: CodeAttributionSource.Script, metadata: { extensionId: 'positron.positron-r' } }, expected: 'positron.positron-r' },
		{ name: 'code a kernel sent through an extension', attribution: { source: CodeAttributionSource.Extension, metadata: { extensionId: 'positron.positron-supervisor', callerSessionId: 'r-notebook-1' } }, expected: undefined },
		{ name: 'code the user ran', attribution: { source: CodeAttributionSource.Interactive }, expected: undefined },
	])('records the requesting extension for $name', async ({ attribution, expected }) => {
		const consoleService = ctx.disposables.add(
			ctx.instantiationService.createInstance(PositronConsoleService));
		const runtime = createTestLanguageRuntimeMetadata(ctx.instantiationService, ctx.disposables);
		const willStart = Event.toPromise(ctx.get(IRuntimeSessionService).onWillStartSession);

		const executing = consoleService.executeCode(runtime.languageId, undefined, '1 + 1', attribution, false);
		const { session } = await willStart;
		ctx.disposables.add(session);

		expect(session.metadata.requestingExtensionId).toBe(expected);
		await executing.catch(() => { });
	});
});
