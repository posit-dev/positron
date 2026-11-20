/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as positron from 'positron';
import * as extHostProtocol from './extHost.positron.protocol.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { SerializableObjectWithBuffers } from '../../../services/extensions/common/proxyIdentifier.js';
import { ICheckpointsRequest, ICheckpointsResponse } from '../../../services/positronCheckpoints/common/checkpointsTypes.js';
import { Disposable } from '../extHostTypes.js';

interface IRegisteredEngine {
	readonly engine: positron.checkpoints.CheckpointsEngine;
	readonly stateListener: IDisposable;
}

/**
 * Keeps the checkpoints engines that extensions register and runs the engine calls that the main
 * thread sends. Each request is passed to the engine with the core types and each result is
 * returned with the core types, so the compiler checks that the `positron.d.ts` types and the
 * protocol types agree.
 */
export class ExtHostCheckpoints implements extHostProtocol.ExtHostCheckpointsShape {

	private readonly _proxy: extHostProtocol.MainThreadCheckpointsShape;
	private readonly _engines = new Map<number, IRegisteredEngine>();
	private _nextHandle = 0;

	constructor(
		mainContext: extHostProtocol.IMainPositronContext,
	) {
		this._proxy = mainContext.getProxy(extHostProtocol.MainPositronContext.MainThreadCheckpoints);
	}

	public registerEngine(engine: positron.checkpoints.CheckpointsEngine): Disposable {
		const handle = this._nextHandle++;
		const stateListener = engine.onDidChangeState(() => this._proxy.$onDidChangeState(handle));
		this._engines.set(handle, { engine, stateListener });
		this._proxy.$registerEngine(handle);

		return new Disposable(() => {
			const registered = this._engines.get(handle);
			if (!registered) {
				return;
			}
			this._engines.delete(handle);
			registered.stateListener.dispose();
			this._proxy.$unregisterEngine(handle);
		});
	}

	public async $call(handle: number, request: ICheckpointsRequest): Promise<SerializableObjectWithBuffers<ICheckpointsResponse>> {
		const registered = this._engines.get(handle);
		if (!registered) {
			throw new Error(`No checkpoints engine is registered with handle ${handle}`);
		}
		return new SerializableObjectWithBuffers(await this.callEngine(registered.engine, request));
	}

	private async callEngine(engine: positron.checkpoints.CheckpointsEngine, request: ICheckpointsRequest): Promise<ICheckpointsResponse> {
		switch (request.method) {
			case 'getState':
				return { method: request.method, result: await engine.getState(...request.args) };
			case 'getHistory':
				return { method: request.method, result: await engine.getHistory(...request.args) };
			case 'getChanges':
				return { method: request.method, result: await engine.getChanges(...request.args) };
			case 'getDiff':
				return { method: request.method, result: await engine.getDiff(...request.args) };
			case 'readBlob':
				return { method: request.method, result: VSBuffer.wrap(await engine.readBlob(...request.args)) };
			case 'createCheckpoints':
				return { method: request.method, result: await engine.createCheckpoints(...request.args) };
			case 'acceptCheckedCheckpoint':
				return { method: request.method, result: await engine.acceptCheckedCheckpoint(...request.args) };
			case 'declineCheckedCheckpoint':
				return { method: request.method, result: await engine.declineCheckedCheckpoint(...request.args) };
			case 'editDescription':
				return { method: request.method, result: await engine.editDescription(...request.args) };
			case 'reverseCheckpoint':
				return { method: request.method, result: await engine.reverseCheckpoint(...request.args) };
			case 'checkShared':
				return { method: request.method, result: await engine.checkShared(...request.args) };
			case 'previewIncoming':
				return { method: request.method, result: await engine.previewIncoming(...request.args) };
			case 'getIncoming':
				return { method: request.method, result: await engine.getIncoming(...request.args) };
			case 'sendChanges':
				return { method: request.method, result: await engine.sendChanges(...request.args) };
			case 'goBackTo':
				return { method: request.method, result: await engine.goBackTo(...request.args) };
			case 'undo':
				return { method: request.method, result: await engine.undo(...request.args) };
			case 'redo':
				return { method: request.method, result: await engine.redo(...request.args) };
			case 'getKeptFiles':
				return { method: request.method, result: await engine.getKeptFiles(...request.args) };
			case 'restoreKeptFile':
				return { method: request.method, result: await engine.restoreKeptFile(...request.args) };
			case 'deleteKeptFile':
				return { method: request.method, result: await engine.deleteKeptFile(...request.args) };
			case 'resolveInterrupted':
				return { method: request.method, result: await engine.resolveInterrupted(...request.args) };
			case 'removeRecoverySnapshot':
				return { method: request.method, result: await engine.removeRecoverySnapshot(...request.args) };
			case 'startTracking':
				return { method: request.method, result: await engine.startTracking(...request.args) };
			case 'proposedGitignore':
				return { method: request.method, result: await engine.proposedGitignore(...request.args) };
			case 'connectSharedCopy':
				return { method: request.method, result: await engine.connectSharedCopy(...request.args) };
		}
	}
}
