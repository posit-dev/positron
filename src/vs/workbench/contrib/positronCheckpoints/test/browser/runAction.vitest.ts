/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { extUri } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { IDialogService, IPrompt } from '../../../../../platform/dialogs/common/dialogs.js';
import { ILogService, NullLogService } from '../../../../../platform/log/common/log.js';
import { IUriIdentityService } from '../../../../../platform/uriIdentity/common/uriIdentity.js';
import { IWorkspace, IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { CheckpointsService } from '../../../../services/positronCheckpoints/browser/checkpointsService.js';
import { ICheckpointsService } from '../../../../services/positronCheckpoints/common/checkpointsService.js';
import { UnsavedEditorsDecision } from '../../../../services/positronCheckpoints/browser/unsavedEditorsGuard.js';
import { IWorkingCopy, WorkingCopyCapabilities } from '../../../../services/workingCopy/common/workingCopy.js';
import { IWorkingCopyService } from '../../../../services/workingCopy/common/workingCopyService.js';
import { CheckpointsMessageService, ICheckpointsMessageService } from '../../browser/checkpointsMessages.js';
import { runAction, RunActionMode } from '../../browser/runAction.js';
import { FakeCheckpointsEngine } from './fakeCheckpointsEngine.js';

describe('runAction', () => {
	let dirty: IWorkingCopy[] = [];
	let prompted: IPrompt<UnsavedEditorsDecision>[] = [];

	const ctx = createTestContainer()
		.stub(IWorkingCopyService, { get dirtyWorkingCopies() { return dirty; } })
		.stub(IUriIdentityService, { extUri })
		.stub(IDialogService, {
			// Presses the cancel button of every prompt.
			prompt: async (prompt: IPrompt<UnsavedEditorsDecision>) => {
				prompted.push(prompt);
				return { result: await (prompt.cancelButton as { run: () => UnsavedEditorsDecision }).run() };
			},
		})
		.stub(IWorkspaceContextService, {
			getWorkspace: () => stubInterface<IWorkspace>({ folders: [{ uri: URI.file('/work/dose-model/analysis'), name: 'analysis', index: 0, toResource: path => URI.file(path) }] }),
		})
		.build();

	const logError = vi.fn();

	let engine: FakeCheckpointsEngine;
	let checkpointsService: CheckpointsService;
	let messageService: CheckpointsMessageService;

	beforeEach(() => {
		dirty = [];
		prompted = [];
		logError.mockClear();
		ctx.instantiationService.stub(ILogService, { error: logError });
		engine = ctx.disposables.add(new FakeCheckpointsEngine());
		checkpointsService = ctx.disposables.add(new CheckpointsService(new NullLogService()));
		messageService = ctx.disposables.add(new CheckpointsMessageService());
		ctx.instantiationService.stub(ICheckpointsService, checkpointsService);
		ctx.instantiationService.stub(ICheckpointsMessageService, messageService);
	});

	function run(mode: RunActionMode) {
		return ctx.instantiationService.invokeFunction(accessor => runAction(accessor, mode, e => e.sendChanges()));
	}

	function unsavedFile(path: string): IWorkingCopy {
		return stubInterface<IWorkingCopy>({ resource: URI.file(path), capabilities: WorkingCopyCapabilities.None });
	}

	test('without an engine nothing runs and the view says checkpoints are not available', async () => {
		const result = await run('no-guard');

		expect(result).toBeUndefined();
		expect(messageService.message).toBe('Checkpoints are not available yet.');
	});

	test('no-guard calls the engine without asking about unsaved files', async () => {
		ctx.disposables.add(checkpointsService.registerEngine(engine));
		dirty = [unsavedFile('/work/dose-model/dose.R')];

		const result = await run('no-guard');

		expect(result).toEqual(engine.nextResult);
		expect(prompted).toEqual([]);
		expect(engine.calls.map(call => call.method)).toEqual(['sendChanges']);
	});

	test('an unsaved file in the project is asked about, and Cancel calls nothing', async () => {
		ctx.disposables.add(checkpointsService.registerEngine(engine));
		dirty = [unsavedFile('/work/dose-model/dose.R')];

		const result = await run('file-changing');

		expect(result).toBeUndefined();
		expect(prompted).toHaveLength(1);
		expect(engine.callsOf('sendChanges')).toEqual([]);
	});

	test('an unsaved file outside the project is not asked about', async () => {
		ctx.disposables.add(checkpointsService.registerEngine(engine));
		dirty = [unsavedFile('/work/other/notes.R')];

		await run('checkpoint');

		expect(prompted).toEqual([]);
		expect(engine.callsOf('sendChanges')).toEqual([[]]);
	});

	test('a result other than done shows its sentence, and a plain done empties the line', async () => {
		ctx.disposables.add(checkpointsService.registerEngine(engine));
		engine.nextResult = { kind: 'rejected', reason: 'sign-in-required', detail: 'git said no' };

		const rejected = await run('no-guard');

		expect(rejected).toEqual(engine.nextResult);
		expect(messageService.message).toBe('Sign in to the service that hosts the shared copy, then try again.');

		engine.nextResult = { kind: 'done', operationId: 'op-2', hookEditedFiles: [] };
		await run('no-guard');

		expect(messageService.message).toBeUndefined();
	});

	test('an engine call that throws is logged, shown as could-not-finish, and returns undefined', async () => {
		ctx.disposables.add(checkpointsService.registerEngine(engine));
		const failure = new Error('engine exploded');

		const result = await ctx.instantiationService.invokeFunction(accessor => runAction(accessor, 'no-guard', async () => { throw failure; }));

		expect(result).toBeUndefined();
		expect(logError).toHaveBeenCalledWith(expect.any(String), failure);
		expect(messageService.message).toBe('That action could not finish. Your project is as it was.');
	});

	test('checkpoint mode passes the guard decision to the call, and the other modes pass undefined', async () => {
		ctx.disposables.add(checkpointsService.registerEngine(engine));
		const decisions: unknown[] = [];
		const record = async (_engine: unknown, decision: unknown) => { decisions.push(decision); return engine.nextResult; };

		await ctx.instantiationService.invokeFunction(accessor => runAction(accessor, 'checkpoint', record));
		await ctx.instantiationService.invokeFunction(accessor => runAction(accessor, 'file-changing', record));
		await ctx.instantiationService.invokeFunction(accessor => runAction(accessor, 'no-guard', record));

		expect(decisions).toEqual(['proceed', undefined, undefined]);
	});
});
