/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { IRuntimeClientInstance, IRuntimeClientOutput, RuntimeClientState } from './languageRuntimeClientInstance.js';
import { FromWebviewMessage, ICommMessageFromWebview, ToWebviewMessage } from './positronIPyWidgetsWebviewMessages.js';
import { ILogService } from '../../../../platform/log/common/log.js';

/**
 * Interface for communicating with an IPyWidgets webview.
 */
export interface IIPyWidgetsWebviewMessaging {
	onDidReceiveMessage: Event<FromWebviewMessage>;
	postMessage(message: ToWebviewMessage): Promise<boolean>;
}

/**
 * An IPyWidgetClientInstance is responsible for routing messages to/from an IPyWidgets webview and a runtime client.
*/
export class IPyWidgetClientInstance extends Disposable {
	private readonly _closeEmitter = this._register(new Emitter<void>());

	/** Whether the client is closed. */
	private _closed = false;

	/** Emitted when the runtime client is closed. */
	onDidClose = this._closeEmitter.event;

	/**
	 * @param _client The wrapped runtime client instance.
	 * @param _messaging The IPyWidgets webview messaging interface.
	 * @param _logService The log service.
	 * @param _rpcMethods A list of methods that should be treated as RPCs. Other methods will be
	 *   sent as fire-and-forget messages.
	 */
	constructor(
		private readonly _client: IRuntimeClientInstance<any, any>,
		private readonly _messaging: IIPyWidgetsWebviewMessaging,
		private readonly _logService: ILogService,
		private readonly _rpcMethods: string[],
	) {
		super();

		// Forward messages from the webview to the runtime client.
		this._register(_messaging.onDidReceiveMessage(async (message) => {
			// Only handle messages for this client.
			if (!('comm_id' in message) || message.comm_id !== this._client.getClientId()) {
				return;
			}

			switch (message.type) {
				case 'comm_close':
					this.handleCommCloseFromWebview();
					break;
				case 'comm_msg':
					this.handleCommMessageFromWebview(message);
					break;
				default:
					this._logService.warn(
						`Unhandled message from webview for client ${this._client.getClientId()}: `
						+ JSON.stringify(message)
					);
					break;
			}
		}));

		// Forward messages from the runtime client to the webview.
		this._register(_client.onDidReceiveData(event => {
			const data = event.data;
			if (event.buffers && event.buffers.length > 0) {
				this._logService.trace(`RECV comm_msg: ${JSON.stringify(data)} with ${event.buffers.length} buffers`);
			} else {
				this._logService.trace(`RECV comm_msg: ${JSON.stringify(data)}`);
			}

			switch (data.method) {
				case 'custom':
				case 'update':
					this.postCommMessage(event);
					break;
				default:
					this._logService.warn(
						`Unhandled message from client ${this._client.getClientId()} for webview: `
						+ JSON.stringify(data)
					);
					break;
			}
		}));

		// When the client is closed, notify the webview and emit the close event.
		const stateChangeEvent = Event.fromObservable(_client.clientState);
		this._register(stateChangeEvent(state => {
			if (!this._closed && state === RuntimeClientState.Closed) {
				this._closed = true;
				this._messaging.postMessage({
					type: 'comm_close',
					comm_id: this._client.getClientId(),
				});
				this._closeEmitter.fire();
			}
		}));
	}

	private async handleCommCloseFromWebview() {
		// Mark the client as closed, so we don't send another comm_close to the webview.
		this._closed = true;

		// Dispose the client when the webview requests it.
		this._client.dispose();
	}

	private async handleCommMessageFromWebview(message: ICommMessageFromWebview) {
		const data = message.data as any;
		if (
			data.method !== undefined &&
			this._rpcMethods.includes(data.method)) {
			// It's a known RPC request, perform the RPC with the client.
			this._logService.trace('SEND comm_msg:', data);
			const reply = await this._client.performRpcWithBuffers(data, 5000);

			// Forward the output to the webview.
			this._logService.trace('RECV comm_msg:', reply);
			this.postCommMessage(reply, message.msg_id);
		} else {
			// It's not a known RPC request, send a fire-and-forget message to the client.
			this._logService.trace('SEND comm_msg:', data);
			this._client.sendMessage(message.data);
		}
	}

	private postCommMessage(message: IRuntimeClientOutput<any>, parentId?: string) {
		this._messaging.postMessage({
			type: 'comm_msg',
			comm_id: this._client.getClientId(),
			data: message.data,
			buffers: message.buffers?.map(vsBuffer => vsBuffer.buffer),
			parent_id: parentId,
		});
	}
}
