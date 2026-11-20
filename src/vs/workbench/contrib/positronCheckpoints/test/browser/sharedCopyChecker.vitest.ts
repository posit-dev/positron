/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Emitter } from '../../../../../base/common/event.js';
import { IConfigurationChangeEvent, IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { ILogService, NullLogService } from '../../../../../platform/log/common/log.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IHostService } from '../../../../services/host/browser/host.js';
import { CheckpointsService } from '../../../../services/positronCheckpoints/browser/checkpointsService.js';
import { ICheckpointsService } from '../../../../services/positronCheckpoints/common/checkpointsService.js';
import { IProposalController } from '../../browser/proposalController.js';
import { SharedCopyChecker } from '../../browser/sharedCopyChecker.js';
import { CHECKPOINTS_CHECK_SHARED_INTERVAL_KEY } from '../../common/checkpointsConfiguration.js';
import { FakeCheckpointsEngine, fakeEngineState } from './fakeCheckpointsEngine.js';

const MINUTE = 60 * 1000;

describe('SharedCopyChecker', () => {
	const focus = new Emitter<boolean>();
	const logError = vi.fn();
	const refreshProposal = vi.fn(async () => { });

	const ctx = createTestContainer()
		.stub(IHostService, { onDidChangeFocus: focus.event })
		.stub(IProposalController, { refresh: refreshProposal })
		.build();

	let engine: FakeCheckpointsEngine;
	let checkpointsService: CheckpointsService;
	let configuration: TestConfigurationService;

	beforeEach(() => {
		vi.useFakeTimers();
		logError.mockClear();
		refreshProposal.mockClear();
		engine = ctx.disposables.add(new FakeCheckpointsEngine());
		checkpointsService = ctx.disposables.add(new CheckpointsService(new NullLogService()));
		configuration = new TestConfigurationService();
		ctx.instantiationService.stub(ICheckpointsService, checkpointsService);
		ctx.instantiationService.stub(IConfigurationService, configuration);
		ctx.instantiationService.stub(ILogService, { error: logError });
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	function createChecker(): SharedCopyChecker {
		return ctx.disposables.add(ctx.instantiationService.createInstance(SharedCopyChecker));
	}

	function setInterval(minutes: number): void {
		configuration.setUserConfiguration(CHECKPOINTS_CHECK_SHARED_INTERVAL_KEY, minutes);
		configuration.onDidChangeConfigurationEmitter.fire(stubInterface<IConfigurationChangeEvent>({
			affectsConfiguration: key => key === CHECKPOINTS_CHECK_SHARED_INTERVAL_KEY,
		}));
	}

	const checks = () => engine.callsOf('checkShared').length;

	test('checker calls checkShared every 5 minutes by default', async () => {
		ctx.disposables.add(checkpointsService.registerEngine(engine));
		createChecker();

		await vi.advanceTimersByTimeAsync(5 * MINUTE - 1);
		expect(checks()).toBe(0);
		await vi.advanceTimersByTimeAsync(1);
		expect(checks()).toBe(1);
		await vi.advanceTimersByTimeAsync(5 * MINUTE);
		expect(checks()).toBe(2);
	});

	test('interval 0 stops the timer', async () => {
		configuration.setUserConfiguration(CHECKPOINTS_CHECK_SHARED_INTERVAL_KEY, 0);
		ctx.disposables.add(checkpointsService.registerEngine(engine));
		createChecker();

		await vi.advanceTimersByTimeAsync(60 * MINUTE);

		expect(checks()).toBe(0);
	});

	test('a changed interval takes effect without restart', async () => {
		ctx.disposables.add(checkpointsService.registerEngine(engine));
		createChecker();
		await vi.advanceTimersByTimeAsync(5 * MINUTE);
		expect(checks()).toBe(1);

		setInterval(1);
		await vi.advanceTimersByTimeAsync(3 * MINUTE);
		expect(checks()).toBe(4);

		setInterval(0);
		await vi.advanceTimersByTimeAsync(10 * MINUTE);
		expect(checks()).toBe(4);

		setInterval(2);
		await vi.advanceTimersByTimeAsync(2 * MINUTE);
		expect(checks()).toBe(5);
	});

	test('an interval under one minute is checked once a minute', async () => {
		configuration.setUserConfiguration(CHECKPOINTS_CHECK_SHARED_INTERVAL_KEY, 0.001);
		ctx.disposables.add(checkpointsService.registerEngine(engine));
		createChecker();

		await vi.advanceTimersByTimeAsync(MINUTE - 1);
		expect(checks()).toBe(0);
		await vi.advanceTimersByTimeAsync(1);
		expect(checks()).toBe(1);
	});

	test('a check in flight when the checker is disposed does nothing afterwards', async () => {
		ctx.disposables.add(checkpointsService.registerEngine(engine));
		const checker = createChecker();
		const release = engine.holdGetState();
		focus.fire(true);
		await vi.advanceTimersByTimeAsync(0);
		expect(engine.callsOf('getState')).toHaveLength(1);

		checker.dispose();
		release(fakeEngineState());
		await vi.advanceTimersByTimeAsync(10 * MINUTE);

		expect(checks()).toBe(0);
	});

	test('a failure of a check in flight when the checker is disposed is not logged', async () => {
		ctx.disposables.add(checkpointsService.registerEngine(engine));
		const checker = createChecker();
		let fail!: () => void;
		engine.checkShared = () => new Promise((_resolve, reject) => { fail = () => reject(new Error('offline')); });
		focus.fire(true);
		await vi.advanceTimersByTimeAsync(0);

		checker.dispose();
		fail();
		await vi.advanceTimersByTimeAsync(0);

		expect(logError).not.toHaveBeenCalled();
	});

	test('focus triggers a check at most once per minute', async () => {
		ctx.disposables.add(checkpointsService.registerEngine(engine));
		createChecker();

		focus.fire(true);
		await vi.advanceTimersByTimeAsync(0);
		expect(checks()).toBe(1);

		focus.fire(false);
		focus.fire(true);
		await vi.advanceTimersByTimeAsync(59 * 1000);
		focus.fire(true);
		await vi.advanceTimersByTimeAsync(0);
		expect(checks()).toBe(1);

		await vi.advanceTimersByTimeAsync(1000);
		focus.fire(true);
		await vi.advanceTimersByTimeAsync(0);
		expect(checks()).toBe(2);
	});

	test('interval 0 also turns off the check on focus', async () => {
		configuration.setUserConfiguration(CHECKPOINTS_CHECK_SHARED_INTERVAL_KEY, 0);
		ctx.disposables.add(checkpointsService.registerEngine(engine));
		createChecker();

		focus.fire(true);
		await vi.advanceTimersByTimeAsync(0);
		expect(checks()).toBe(0);

		setInterval(5);
		focus.fire(true);
		await vi.advanceTimersByTimeAsync(0);
		expect(checks()).toBe(1);
	});

	test('losing focus does not check', async () => {
		ctx.disposables.add(checkpointsService.registerEngine(engine));
		createChecker();

		focus.fire(false);
		await vi.advanceTimersByTimeAsync(0);

		expect(checks()).toBe(0);
	});

	test('no check when there is no shared copy, an unusual state, or no tracking', async () => {
		ctx.disposables.add(checkpointsService.registerEngine(engine));
		createChecker();

		engine.state = fakeEngineState({ shared: { exists: false, ahead: 0, behind: 0 } });
		await vi.advanceTimersByTimeAsync(5 * MINUTE);
		engine.state = fakeEngineState({ unusual: { kind: 'detached', detail: 'd' } });
		await vi.advanceTimersByTimeAsync(5 * MINUTE);
		engine.state = fakeEngineState({ tracking: 'not-a-project' });
		await vi.advanceTimersByTimeAsync(5 * MINUTE);

		expect(engine.callsOf('getState')).toHaveLength(3);
		expect(checks()).toBe(0);
	});

	test('a check does not start while another one runs', async () => {
		ctx.disposables.add(checkpointsService.registerEngine(engine));
		createChecker();
		let release!: () => void;
		engine.checkShared = () => new Promise(resolve => { release = () => resolve({ kind: 'done', operationId: 'op', hookEditedFiles: [] }); });

		await vi.advanceTimersByTimeAsync(5 * MINUTE);
		await vi.advanceTimersByTimeAsync(5 * MINUTE);
		focus.fire(true);
		await vi.advanceTimersByTimeAsync(0);

		expect(engine.callsOf('getState')).toHaveLength(1);
		release();
		await vi.advanceTimersByTimeAsync(5 * MINUTE);
		expect(engine.callsOf('getState')).toHaveLength(2);
	});

	test('a failed check is logged and the next one still runs', async () => {
		ctx.disposables.add(checkpointsService.registerEngine(engine));
		createChecker();
		const failure = new Error('offline');
		engine.checkShared = async () => { throw failure; };

		await vi.advanceTimersByTimeAsync(5 * MINUTE);
		expect(logError).toHaveBeenCalledWith(expect.any(String), failure);

		engine.checkShared = async () => ({ kind: 'done', operationId: 'op', hookEditedFiles: [] });
		const getStateCalls = engine.callsOf('getState').length;
		await vi.advanceTimersByTimeAsync(5 * MINUTE);
		expect(engine.callsOf('getState').length).toBe(getStateCalls + 1);
	});

	test('each check reads the state of a proposal on GitHub, and only while a proposal exists', async () => {
		ctx.disposables.add(checkpointsService.registerEngine(engine));
		createChecker();

		await vi.advanceTimersByTimeAsync(5 * MINUTE);
		expect(refreshProposal).not.toHaveBeenCalled();

		engine.state = fakeEngineState({ proposal: { branch: 'proposal/fit-3fa29c', base: 'main', sent: true } });
		await vi.advanceTimersByTimeAsync(5 * MINUTE);
		expect({ checks: checks(), refreshes: refreshProposal.mock.calls.length }).toEqual({ checks: 2, refreshes: 1 });
	});

	test('the timer stops when the engine goes away and starts when one registers', async () => {
		createChecker();
		const registration = checkpointsService.registerEngine(engine);
		await vi.advanceTimersByTimeAsync(5 * MINUTE);
		expect(checks()).toBe(1);

		registration.dispose();
		await vi.advanceTimersByTimeAsync(30 * MINUTE);
		expect(checks()).toBe(1);

		ctx.disposables.add(checkpointsService.registerEngine(engine));
		await vi.advanceTimersByTimeAsync(5 * MINUTE);
		expect(checks()).toBe(2);
	});
});
