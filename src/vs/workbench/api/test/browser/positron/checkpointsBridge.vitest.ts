/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import type * as positron from 'positron';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { IMessagePassingProtocol } from '../../../../../base/parts/ipc/common/ipc.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IExtHostContext } from '../../../../services/extensions/common/extHostCustomers.js';
import { RPCProtocol } from '../../../../services/extensions/common/rpcProtocol.js';
import { CheckpointsService } from '../../../../services/positronCheckpoints/browser/checkpointsService.js';
import { ExtHostCheckpoints } from '../../../common/positron/extHostCheckpoints.js';
import { ExtHostPositronContext, MainPositronContext } from '../../../common/positron/extHost.positron.protocol.js';
import { MainThreadCheckpoints } from '../../../browser/positron/mainThreadCheckpoints.js';

/** One end of an in-memory connection; each message reaches the other end asynchronously, as over IPC. */
class MessagePassingProtocol implements IMessagePassingProtocol {
	private _pair?: MessagePassingProtocol;
	readonly onMessageEmitter = new Emitter<VSBuffer>();
	readonly onMessage: Event<VSBuffer> = this.onMessageEmitter.event;

	setPair(other: MessagePassingProtocol): void {
		this._pair = other;
	}

	send(buffer: VSBuffer): void {
		void Promise.resolve().then(() => this._pair!.onMessageEmitter.fire(buffer));
	}
}

const STATE: positron.checkpoints.EngineState = {
	tracking: 'tracking', projectName: 'dose-model', projectRoot: '/work/dose-model', openedFolderIsInsideProject: false,
	branch: 'main', shared: { exists: true, ahead: 1, behind: 0, name: 'origin/main' }, identityMissing: false,
	syncAvailable: true, requiredGitVersion: '2.40', pendingOverlap: false, recoverySnapshots: [],
	undo: { operationId: 'op1', description: 'Create checkpoint', kind: 'create-checkpoints', restoresFiles: false },
	keptFileCount: 0,
};

/**
 * The engine bridge end to end: an engine registered in the extension host, `ICheckpointsService`
 * in the main thread, and two RPC protocols between them that serialize every message.
 */
describe('checkpoints engine bridge', () => {
	const disposables = ensureNoLeakedDisposables();

	let service: CheckpointsService;
	let extHost: ExtHostCheckpoints;
	let stateEmitter: Emitter<void>;

	beforeEach(() => {
		const mainEnd = new MessagePassingProtocol();
		const extHostEnd = new MessagePassingProtocol();
		disposables.add(mainEnd.onMessageEmitter);
		disposables.add(extHostEnd.onMessageEmitter);
		mainEnd.setPair(extHostEnd);
		extHostEnd.setPair(mainEnd);
		const mainRpc = disposables.add(new RPCProtocol(mainEnd));
		const extHostRpc = disposables.add(new RPCProtocol(extHostEnd));

		const logService = new NullLogService();
		service = disposables.add(new CheckpointsService(logService));
		const extHostContext = stubInterface<IExtHostContext>({
			getProxy: (identifier => mainRpc.getProxy(identifier)) as IExtHostContext['getProxy'],
		});
		mainRpc.set(MainPositronContext.MainThreadCheckpoints, disposables.add(new MainThreadCheckpoints(extHostContext, service, logService)));
		extHost = new ExtHostCheckpoints(extHostRpc);
		extHostRpc.set(ExtHostPositronContext.ExtHostCheckpoints, extHost);
		stateEmitter = disposables.add(new Emitter<void>());
	});

	/** Registers an engine with the given methods and waits until the main thread has it. */
	async function register(methods: Partial<positron.checkpoints.CheckpointsEngine>) {
		const registration = disposables.add(extHost.registerEngine(stubInterface<positron.checkpoints.CheckpointsEngine>({ onDidChangeState: stateEmitter.event, ...methods })));
		await vi.waitFor(() => expect(service.hasEngine).toBe(true));
		return registration;
	}

	it('returns the engine state to the main thread unchanged', async () => {
		await register({ getState: async () => STATE });

		await expect(service.engine!.getState()).resolves.toEqual(STATE);
	});

	it('passes the arguments of a call to the engine', async () => {
		const getIncoming = vi.fn(async (): Promise<positron.checkpoints.OperationResult> => ({ kind: 'done', operationId: 'op2', hookEditedFiles: [] }));
		await register({ getIncoming });

		const result = await service.engine!.getIncoming('basis', [{ overlapId: 'o1', choice: { type: 'take', side: 'theirs' } }], [{ path: 'data.csv', choice: 'use-theirs-keep-copy' }]);

		expect(getIncoming).toHaveBeenCalledWith('basis', [{ overlapId: 'o1', choice: { type: 'take', side: 'theirs' } }], [{ path: 'data.csv', choice: 'use-theirs-keep-copy' }]);
		expect(result).toEqual({ kind: 'done', operationId: 'op2', hookEditedFiles: [] });
	});

	it('returns the proposal and the shared URL of the state unchanged', async () => {
		const state: positron.checkpoints.EngineState = {
			...STATE,
			branch: 'proposal/fit-the-dose-model',
			proposal: { branch: 'proposal/fit-the-dose-model', base: 'main', sent: true },
			sharedUrl: 'https://github.com/posit-dev/dose-model.git',
			undo: { operationId: 'op3', description: 'Ask for a review', kind: 'start-proposal', restoresFiles: false },
		};
		await register({ getState: async () => state });

		await expect(service.engine!.getState()).resolves.toEqual(state);
	});

	it('passes the proposal calls and their results', async () => {
		const done = (operationId: string): positron.checkpoints.OperationResult => ({ kind: 'done', operationId, hookEditedFiles: [] });
		const startProposal = vi.fn(async () => done('op-start'));
		const finishProposal = vi.fn(async () => done('op-finish'));
		const stopProposal = vi.fn(async (): Promise<positron.checkpoints.OperationResult> => ({ kind: 'unavailable', reason: 'nothing-to-do', detail: 'get-changes-first' }));
		await register({ startProposal, finishProposal, stopProposal });

		const results = [
			await service.engine!.startProposal(),
			await service.engine!.finishProposal('abc123'),
			await service.engine!.stopProposal(),
		];

		expect(finishProposal).toHaveBeenCalledWith('abc123');
		expect({ start: startProposal.mock.calls.length, stop: stopProposal.mock.calls.length }).toEqual({ start: 1, stop: 1 });
		expect(results).toEqual([done('op-start'), done('op-finish'), { kind: 'unavailable', reason: 'nothing-to-do', detail: 'get-changes-first' }]);
	});

	it('returns the bytes of a Node buffer from readBlob', async () => {
		// The engine reads blobs into a Node `Buffer`, which may be a view into a larger pool.
		const pooled = Buffer.from('xxpixelsxx', 'latin1').subarray(2, 8);
		await register({ readBlob: async () => pooled });

		const blob = await service.engine!.readBlob('abc');

		expect(blob.toString()).toBe('pixels');
	});

	it('rejects a failed read with the engine error message, so the view can read its prefix', async () => {
		await register({ getChanges: async () => { throw new Error('checkpoints:timed-out: git status'); } });

		await expect(service.engine!.getChanges()).rejects.toThrow(/^checkpoints:timed-out: git status$/);
	});

	it('forwards the engine change event, and unregisters the engine', async () => {
		const registration = await register({});
		const onDidChangeState = vi.fn();
		disposables.add(service.onDidChangeState(onDidChangeState));

		stateEmitter.fire();
		await vi.waitFor(() => expect(onDidChangeState).toHaveBeenCalledTimes(1));
		registration.dispose();

		await vi.waitFor(() => expect(service.hasEngine).toBe(false));
	});
});
