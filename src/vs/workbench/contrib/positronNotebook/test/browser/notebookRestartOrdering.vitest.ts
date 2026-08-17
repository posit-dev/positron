/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Event } from '../../../../../base/common/event.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { ILanguageRuntimeMetadata, LanguageRuntimeSessionMode, RuntimeExitReason, RuntimeState } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { TestLanguageRuntimeSession } from '../../../../services/runtimeSession/test/common/testLanguageRuntimeSession.js';
import { createTestLanguageRuntimeMetadata, startTestLanguageRuntimeSession } from '../../../../services/runtimeSession/test/common/testRuntimeSessionService.js';
import { CellKind } from '../../../notebook/common/notebookCommon.js';
import { INotebookKernelService } from '../../../notebook/common/notebookKernelService.js';
import { INotebookService } from '../../../notebook/common/notebookService.js';
import { createTestPositronNotebookInstance, TestPositronNotebookInstance } from './testPositronNotebookInstance.js';

/**
 * Regression tests for https://github.com/posit-dev/positron/issues/10016.
 *
 * An in-place kernel restart produces two independent signals: the replacement
 * kernel's `Starting` state and the outgoing kernel's `Restart` exit. Their order
 * is not guaranteed. The notebook re-attaches to the (same) session on `Starting`,
 * so a `Restart` exit that lands afterwards describes a kernel that is already
 * gone -- acting on it detaches a session that is coming back online, and the
 * kernel status badge never leaves "Disconnected".
 */
describe('Positron - notebook restart ordering', () => {
	const ctx = createTestContainer().withNotebookEditorServices().build();

	let runtime: ILanguageRuntimeMetadata;
	let notebook: TestPositronNotebookInstance;

	beforeEach(async () => {
		const runtimeSessionService = ctx.instantiationService.get(IRuntimeSessionService);
		// Selecting a kernel would otherwise auto-start a session that races the
		// one the test starts explicitly.
		runtimeSessionService.implicitStartupSuppressed = true;
		ctx.disposables.add(toDisposable(() => {
			runtimeSessionService.activeSessions.forEach(session => session.dispose());
		}));

		// RuntimeNotebookKernelService creates the notebook kernel when the
		// runtime registers.
		const notebookKernelService = ctx.instantiationService.get(INotebookKernelService);
		const kernelAdded = Event.toPromise(notebookKernelService.onDidAddKernel);
		runtime = createTestLanguageRuntimeMetadata(ctx.instantiationService, ctx.disposables);
		const kernel = await kernelAdded;

		notebook = createTestPositronNotebookInstance(
			[['print("hello")', 'python', CellKind.Code]],
			ctx,
		);

		// The test notebook model is created directly rather than through
		// INotebookService, which RuntimeNotebookKernelService looks it up in
		// when a kernel is selected.
		const notebookService = ctx.instantiationService.get(INotebookService);
		vi.spyOn(notebookService, 'getNotebookTextModel').mockReturnValue(notebook.textModel);

		notebookKernelService.selectKernelForNotebook(
			kernel, { uri: notebook.uri, notebookType: notebook.viewType });
		expect(notebook.kernel.get()).toBe(kernel);
	});

	/** Starts a notebook session for the notebook and lets its start complete. */
	async function startNotebookSession(): Promise<TestLanguageRuntimeSession> {
		const session = await startTestLanguageRuntimeSession(
			ctx.instantiationService,
			ctx.disposables,
			{
				runtime,
				notebookUri: notebook.uri,
				sessionName: runtime.runtimeName,
				sessionMode: LanguageRuntimeSessionMode.Notebook,
				startReason: 'Test requested a notebook session',
			});
		session.setRuntimeState(RuntimeState.Ready);
		expect(notebook.runtimeSession.get()).toBe(session);
		return session;
	}

	it('stays attached when the restart exit arrives before the new kernel starts', async () => {
		const session = await startNotebookSession();

		session.setRuntimeState(RuntimeState.Exited);
		session.endSession({ reason: RuntimeExitReason.Restart });
		session.setRuntimeState(RuntimeState.Starting);
		session.setRuntimeState(RuntimeState.Ready);

		expect(notebook.runtimeSession.get()).toBe(session);
	});

	it('stays attached when the restart exit arrives after the new kernel starts', async () => {
		const session = await startNotebookSession();

		session.setRuntimeState(RuntimeState.Exited);
		session.setRuntimeState(RuntimeState.Starting);
		// The exit of the previous kernel lands late, after the replacement has
		// already begun starting and the notebook has re-attached.
		session.endSession({ reason: RuntimeExitReason.Restart });
		session.setRuntimeState(RuntimeState.Ready);

		// Detaching here leaves the badge showing "Disconnected" for a session
		// that is online, with nothing left to trigger a re-attach.
		expect(notebook.runtimeSession.get()).toBe(session);
	});

	it('detaches when the session ends for good', async () => {
		const session = await startNotebookSession();

		session.setRuntimeState(RuntimeState.Exited);
		session.endSession({ reason: RuntimeExitReason.Shutdown });

		expect(notebook.runtimeSession.get()).toBeUndefined();
	});
});
