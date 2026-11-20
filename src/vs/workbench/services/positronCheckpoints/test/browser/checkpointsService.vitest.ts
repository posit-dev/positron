/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Emitter } from '../../../../../base/common/event.js';
import { ILogService, NullLogService } from '../../../../../platform/log/common/log.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { CheckpointsService } from '../../browser/checkpointsService.js';
import { ICheckpointsEngineProxy } from '../../common/checkpointsTypes.js';

describe('CheckpointsService', () => {
	const disposables = ensureNoLeakedDisposables();

	let logService: ILogService;
	let service: CheckpointsService;

	beforeEach(() => {
		logService = new NullLogService();
		service = disposables.add(new CheckpointsService(logService));
	});

	/** A fake engine whose state event the test fires. Its methods are never called. */
	function fakeEngine(): { engine: ICheckpointsEngineProxy; stateChanged: Emitter<void> } {
		const stateChanged = disposables.add(new Emitter<void>());
		return { engine: stubInterface<ICheckpointsEngineProxy>({ onDidChangeState: stateChanged.event }), stateChanged };
	}

	it('hasEngine is false until an engine registers', () => {
		expect(service.hasEngine).toBe(false);
		expect(service.engine).toBeUndefined();

		const { engine } = fakeEngine();
		disposables.add(service.registerEngine(engine));

		expect(service.hasEngine).toBe(true);
		expect(service.engine).toBe(engine);
	});

	it('the first engine is used and a second logs a warning', () => {
		const warn = vi.spyOn(logService, 'warn');
		const first = fakeEngine();
		const second = fakeEngine();
		const onDidChangeEngine = vi.fn();
		disposables.add(service.onDidChangeEngine(onDidChangeEngine));

		disposables.add(service.registerEngine(first.engine));
		const secondRegistration = service.registerEngine(second.engine);

		expect(service.engine).toBe(first.engine);
		expect(warn).toHaveBeenCalledTimes(1);
		expect(onDidChangeEngine).toHaveBeenCalledTimes(1);

		// Removing the ignored registration leaves the first engine in use.
		secondRegistration.dispose();
		expect(service.engine).toBe(first.engine);
		expect(onDidChangeEngine).toHaveBeenCalledTimes(1);
	});

	it('disposing the registration removes the engine and fires onDidChangeEngine', () => {
		const { engine } = fakeEngine();
		const registration = service.registerEngine(engine);
		const onDidChangeEngine = vi.fn();
		disposables.add(service.onDidChangeEngine(onDidChangeEngine));

		registration.dispose();

		expect(service.hasEngine).toBe(false);
		expect(service.engine).toBeUndefined();
		expect(onDidChangeEngine).toHaveBeenCalledTimes(1);
	});

	it('engine state events are forwarded', () => {
		const first = fakeEngine();
		const second = fakeEngine();
		const onDidChangeState = vi.fn();
		disposables.add(service.onDidChangeState(onDidChangeState));
		const registration = service.registerEngine(first.engine);
		disposables.add(service.registerEngine(second.engine));

		first.stateChanged.fire();
		expect(onDidChangeState).toHaveBeenCalledTimes(1);

		// Only the engine in use is forwarded, and only while it is registered.
		second.stateChanged.fire();
		registration.dispose();
		first.stateChanged.fire();
		expect(onDidChangeState).toHaveBeenCalledTimes(1);
	});
});
