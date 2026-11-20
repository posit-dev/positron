/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import type * as positron from 'positron';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { Emitter } from '../../../../../base/common/event.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ExtHostCheckpoints } from '../../../common/positron/extHostCheckpoints.js';
import { IMainPositronContext, MainThreadCheckpointsShape } from '../../../common/positron/extHost.positron.protocol.js';

const CHECKPOINT: positron.checkpoints.Checkpoint = {
	id: 'c1', title: 'Fixed the plot', body: '', authorName: 'Maya', authorIsMe: false,
	time: '2026-11-19T10:00:00Z', shared: true, partialFiles: [],
};

describe('ExtHostCheckpoints', () => {
	const disposables = ensureNoLeakedDisposables();

	let proxy: { [K in keyof MainThreadCheckpointsShape]: ReturnType<typeof vi.fn> };
	let extHost: ExtHostCheckpoints;
	let stateEmitter: Emitter<void>;

	/** An engine with the change event of `stateEmitter` and the given methods. */
	function engine(methods: Partial<positron.checkpoints.CheckpointsEngine>): positron.checkpoints.CheckpointsEngine {
		return stubInterface<positron.checkpoints.CheckpointsEngine>({ onDidChangeState: stateEmitter.event, ...methods });
	}

	beforeEach(() => {
		proxy = { $registerEngine: vi.fn(), $unregisterEngine: vi.fn(), $onDidChangeState: vi.fn(), dispose: vi.fn() };
		stateEmitter = disposables.add(new Emitter<void>());
		extHost = new ExtHostCheckpoints(stubInterface<IMainPositronContext>({
			// getProxy is generic over every proxy identifier; this class asks for exactly one.
			getProxy: (() => proxy) as unknown as IMainPositronContext['getProxy'],
		}));
	});

	it('registers an engine and runs a call of the main thread with its arguments', async () => {
		const getHistory = vi.fn(async () => [CHECKPOINT]);
		disposables.add(extHost.registerEngine(engine({ getHistory })));

		const response = await extHost.$call(0, { method: 'getHistory', args: [5, 10] });

		expect(proxy.$registerEngine).toHaveBeenCalledWith(0);
		expect(getHistory).toHaveBeenCalledWith(5, 10);
		expect(response.value).toEqual({ method: 'getHistory', result: [CHECKPOINT] });
	});

	it('tells the main thread when the engine state changes, until the engine is unregistered', () => {
		const registration = extHost.registerEngine(engine({}));

		stateEmitter.fire();
		registration.dispose();
		stateEmitter.fire();

		expect(proxy.$onDidChangeState).toHaveBeenCalledTimes(1);
		expect(proxy.$onDidChangeState).toHaveBeenCalledWith(0);
		expect(proxy.$unregisterEngine).toHaveBeenCalledWith(0);
	});

	it('returns the bytes of a blob as a buffer', async () => {
		disposables.add(extHost.registerEngine(engine({ readBlob: async () => new TextEncoder().encode('data') })));

		const response = await extHost.$call(0, { method: 'readBlob', args: ['abc'] });

		expect(response.value.method).toBe('readBlob');
		expect(response.value.result).toBeInstanceOf(VSBuffer);
		expect((response.value.result as VSBuffer).toString()).toBe('data');
	});

	it('rejects with the engine error message unchanged', async () => {
		disposables.add(extHost.registerEngine(engine({ getChanges: async () => { throw new Error('checkpoints:timed-out: git status'); } })));

		await expect(extHost.$call(0, { method: 'getChanges', args: [] })).rejects.toThrow(/^checkpoints:timed-out: git status$/);
	});
});
