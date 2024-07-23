/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { observableValue } from 'vs/base/common/observable';
import { IRuntimeClientInstance, RuntimeClientState, RuntimeClientType } from 'vs/workbench/services/languageRuntime/common/languageRuntimeClientInstance';

export class TestRuntimeClientInstance extends Disposable implements IRuntimeClientInstance<any, any> {
	private readonly _dataEmitter = this._register(new Emitter<any>());

	readonly onDidReceiveData = this._dataEmitter.event;

	readonly messageCounter = observableValue(`msg-counter`, 0);

	readonly clientState = observableValue(`client-state`, RuntimeClientState.Uninitialized);

	constructor(
		private readonly _id: string,
		private readonly _type: RuntimeClientType,
	) {
		super();
	}

	performRpc(request: any, timeout: number): Promise<any> {
		if (!this.rpcHandler) {
			throw new Error('Configure an RPC handler via the onRpc method.');
		}
		return this.rpcHandler(request, timeout);
	}

	getClientId(): string {
		return this._id;
	}

	getClientType(): RuntimeClientType {
		return this._type;
	}

	sendMessage(data: any): void {
		this._sendMessageEmitter.fire(data);
	}

	override dispose(): void {
		this._disposeEmitter.fire();
		super.dispose();
	}

	// Test helpers

	private readonly _sendMessageEmitter = new Emitter<any>();
	private readonly _disposeEmitter = new Emitter<void>();

	/** Emitted when the sendMessage method is called. */
	readonly onDidSendMessage = this._sendMessageEmitter.event;

	/** Emitted when the dispose method is called. */
	readonly onDidDispose = this._disposeEmitter.event;

	/** Fire the onDidReceiveData event. */
	receiveData(data: any): void {
		this._dataEmitter.fire(data);
	}

	/** Invoked when the performRpc method is called. */
	rpcHandler: typeof this.performRpc | undefined;

	/** Set the client's state. */
	setClientState(state: RuntimeClientState): void {
		this.clientState.set(state, undefined);
	}
}
