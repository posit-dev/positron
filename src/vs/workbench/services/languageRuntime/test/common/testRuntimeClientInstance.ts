/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { observableValue } from '../../../../../base/common/observable.js';
import { IRuntimeClientInstance, IRuntimeClientOutput, RuntimeClientState, RuntimeClientStatus, RuntimeClientType } from '../../common/languageRuntimeClientInstance.js';
import { ILanguageRuntimeMessageState } from '../../common/languageRuntimeService.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';

export class TestRuntimeClientInstance extends Disposable implements IRuntimeClientInstance<any, any> {
	private readonly _dataEmitter = this._register(new Emitter<IRuntimeClientOutput<any>>());

	readonly onDidReceiveData = this._dataEmitter.event;

	readonly messageCounter = observableValue(`msg-counter`, 0);

	readonly clientState = observableValue(`client-state`, RuntimeClientState.Uninitialized);
	readonly clientStatus = observableValue(`client-status`, RuntimeClientStatus.Disconnected);

	constructor(
		private readonly _id: string,
		private readonly _type: RuntimeClientType,
	) {
		super();
	}

	performRpcWithBuffers(request: any, timeout: number): Promise<IRuntimeClientOutput<any>> {
		if (!this.rpcHandler) {
			throw new Error('Configure an RPC handler by setting `rpcHandler`.');
		}
		return this.rpcHandler(request, timeout);
	}

	async performRpc(request: any, timeout: number): Promise<any> {
		return (await this.performRpcWithBuffers(request, timeout)).data;
	}

	getClientId(): string {
		return this._id;
	}

	getClientType(): RuntimeClientType {
		return this._type;
	}

	sendMessage(data: any, buffers?: VSBuffer[]): void {
		this._sendMessageEmitter.fire({ data, buffers });
	}

	override dispose(): void {
		this._disposeEmitter.fire();
		super.dispose();
	}

	// Test helpers

	private readonly _sendMessageEmitter = new Emitter<{ data: any; buffers?: VSBuffer[] }>();
	private readonly _disposeEmitter = new Emitter<void>();

	/** Emitted when the sendMessage method is called. */
	readonly onDidSendMessage = this._sendMessageEmitter.event;

	/** Emitted when the dispose method is called. */
	readonly onDidDispose = this._disposeEmitter.event;

	/** Fire the onDidReceiveData event. */
	receiveData(data: IRuntimeClientOutput<any>): void {
		this._dataEmitter.fire(data);
	}

	/** Invoked when the performRpc method is called. */
	rpcHandler: typeof this.performRpc | undefined;

	/** Set the client's state. */
	setClientState(state: RuntimeClientState): void {
		this.clientState.set(state, undefined);
	}

	updatePendingRpcState(message: ILanguageRuntimeMessageState): void {
		// No-op
	}
}
