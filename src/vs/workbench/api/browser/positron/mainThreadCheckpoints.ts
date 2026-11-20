/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../base/common/event.js';
import { DisposableMap, DisposableStore } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { extHostNamedCustomer, IExtHostContext } from '../../../services/extensions/common/extHostCustomers.js';
import { ICheckpointsService } from '../../../services/positronCheckpoints/common/checkpointsService.js';
import { CheckpointsMethod, CheckpointsMethodMap, ICheckpointsEngineProxy, ICheckpointsRequest } from '../../../services/positronCheckpoints/common/checkpointsTypes.js';
import { ExtHostCheckpointsShape, ExtHostPositronContext, MainPositronContext, MainThreadCheckpointsShape } from '../../common/positron/extHost.positron.protocol.js';

/**
 * Registers each checkpoints engine of the extension host with `ICheckpointsService`, as a proxy
 * that sends every engine call to the extension host.
 */
@extHostNamedCustomer(MainPositronContext.MainThreadCheckpoints)
export class MainThreadCheckpoints implements MainThreadCheckpointsShape {
	private readonly _proxy: ExtHostCheckpointsShape;

	/** For each registered handle: its state emitter and its service registration. */
	private readonly _registrations = new DisposableMap<number, DisposableStore>();

	/** The state emitter of each registered handle. */
	private readonly _stateEmitters = new Map<number, Emitter<void>>();

	constructor(
		extHostContext: IExtHostContext,
		@ICheckpointsService private readonly _checkpointsService: ICheckpointsService,
		@ILogService private readonly _logService: ILogService,
	) {
		this._proxy = extHostContext.getProxy(ExtHostPositronContext.ExtHostCheckpoints);
	}

	$registerEngine(handle: number): void {
		const store = new DisposableStore();
		const stateEmitter = store.add(new Emitter<void>());
		store.add(this._checkpointsService.registerEngine(this.createEngineProxy(handle, stateEmitter)));
		this._stateEmitters.set(handle, stateEmitter);
		this._registrations.set(handle, store);
		this._logService.info('Checkpoints engine registered');
	}

	$unregisterEngine(handle: number): void {
		this._stateEmitters.delete(handle);
		this._registrations.deleteAndDispose(handle);
	}

	$onDidChangeState(handle: number): void {
		this._stateEmitters.get(handle)?.fire();
	}

	dispose(): void {
		this._stateEmitters.clear();
		this._registrations.dispose();
	}

	private createEngineProxy(handle: number, stateEmitter: Emitter<void>): ICheckpointsEngineProxy {
		const call = async <M extends CheckpointsMethod>(method: M, ...args: CheckpointsMethodMap[M]['args']): Promise<CheckpointsMethodMap[M]['result']> => {
			// TypeScript cannot narrow the request and response unions by a generic method name.
			// The request pairs `method` with its own arguments, and the extension host answers
			// with the result of the same method, which is checked below.
			const request: { method: M; args: CheckpointsMethodMap[M]['args'] } = { method, args };
			const response = (await this._proxy.$call(handle, request as ICheckpointsRequest)).value;
			if (response.method !== method) {
				throw new Error(`The checkpoints engine answered ${response.method} for a call of ${method}`);
			}
			return response.result as CheckpointsMethodMap[M]['result'];
		};

		return {
			getState: (...args) => call('getState', ...args),
			getHistory: (...args) => call('getHistory', ...args),
			getChanges: (...args) => call('getChanges', ...args),
			getDiff: (...args) => call('getDiff', ...args),
			readBlob: (...args) => call('readBlob', ...args),
			createCheckpoints: (...args) => call('createCheckpoints', ...args),
			acceptCheckedCheckpoint: (...args) => call('acceptCheckedCheckpoint', ...args),
			declineCheckedCheckpoint: (...args) => call('declineCheckedCheckpoint', ...args),
			editDescription: (...args) => call('editDescription', ...args),
			reverseCheckpoint: (...args) => call('reverseCheckpoint', ...args),
			checkShared: (...args) => call('checkShared', ...args),
			previewIncoming: (...args) => call('previewIncoming', ...args),
			getIncoming: (...args) => call('getIncoming', ...args),
			sendChanges: (...args) => call('sendChanges', ...args),
			goBackTo: (...args) => call('goBackTo', ...args),
			undo: (...args) => call('undo', ...args),
			redo: (...args) => call('redo', ...args),
			getKeptFiles: (...args) => call('getKeptFiles', ...args),
			restoreKeptFile: (...args) => call('restoreKeptFile', ...args),
			deleteKeptFile: (...args) => call('deleteKeptFile', ...args),
			resolveInterrupted: (...args) => call('resolveInterrupted', ...args),
			removeRecoverySnapshot: (...args) => call('removeRecoverySnapshot', ...args),
			startTracking: (...args) => call('startTracking', ...args),
			proposedGitignore: (...args) => call('proposedGitignore', ...args),
			connectSharedCopy: (...args) => call('connectSharedCopy', ...args),
			onDidChangeState: stateEmitter.event,
		};
	}
}
