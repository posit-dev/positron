/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { timeout } from 'vs/base/common/async';
import { Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { observableValue } from 'vs/base/common/observable';
import { ensureNoDisposablesAreLeakedInTestSuite } from 'vs/base/test/common/utils';
import { ILogService, NullLogger } from 'vs/platform/log/common/log';
import { IRuntimeClientInstance, RuntimeClientState, RuntimeClientType } from 'vs/workbench/services/languageRuntime/common/languageRuntimeClientInstance';
import { IIPyWidgetsWebviewMessaging, IPyWidgetClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeIPyWidgetClient';
import { FromWebviewMessage, ToWebviewMessage } from 'vs/workbench/services/languageRuntime/common/positronIPyWidgetsWebviewMessages';

class TestRuntimeClientInstance extends Disposable implements IRuntimeClientInstance<any, any> {
	private readonly _dataEmitter = this._register(new Emitter<any>());

	readonly onDidReceiveData = this._dataEmitter.event;

	readonly messageCounter = observableValue(`msg-counter`, 0);

	readonly clientState = observableValue(`client-state`, RuntimeClientState.Uninitialized);

	performRpc(request: any, timeout: number): Promise<any> {
		if (!this.rpcHandler) {
			throw new Error('Configure an RPC handler via the onRpc method.');
		}
		return this.rpcHandler(request, timeout);
	}

	getClientId(): string {
		return 'test-client-id';
	}

	getClientType(): RuntimeClientType {
		throw new Error('Method not implemented.');
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

class TestIPyWidgetsWebviewMessaging extends Disposable implements IIPyWidgetsWebviewMessaging {
	private readonly _messageEmitter = new Emitter<FromWebviewMessage>();

	readonly onDidReceiveMessage = this._messageEmitter.event;

	postMessage(message: ToWebviewMessage): void {
		this._postMessageEmitter.fire(message);
	}

	// Test helpers

	/** Fire the onDidReceiveMessage event. */
	receiveMessage(message: FromWebviewMessage): void {
		this._messageEmitter.fire(message);
	}

	private readonly _postMessageEmitter = new Emitter<ToWebviewMessage>();

	/** Emitted when the postMessage method is called. */
	readonly onDidPostMessage = this._postMessageEmitter.event;
}

suite('IPyWidgetClientInstance', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	const rpcMethod = 'test-rpc-method';

	let client: TestRuntimeClientInstance;
	let messaging: TestIPyWidgetsWebviewMessaging;
	let ipywidgetClient: IPyWidgetClientInstance;

	setup(async () => {
		const logService = new NullLogger() as unknown as ILogService;
		client = disposables.add(new TestRuntimeClientInstance());
		messaging = disposables.add(new TestIPyWidgetsWebviewMessaging());
		ipywidgetClient = disposables.add(new IPyWidgetClientInstance(
			client, messaging, logService, [rpcMethod]
		));
	});

	test('from webview: ignore message with no comm_id', async () => {
		const messages = new Array<unknown>();
		disposables.add(client.onDidSendMessage(message => messages.push(message)));

		messaging.receiveMessage({ type: 'initialize_request' });
		await timeout(0);

		assert.deepStrictEqual(messages, []);
	});

	test('from webview: ignore message to a different comm_id', async () => {
		const messages = new Array<unknown>();
		disposables.add(client.onDidSendMessage(message => messages.push(message)));

		messaging.receiveMessage({
			type: 'comm_msg',
			comm_id: 'other-client-id',
			data: '',
			msg_id: '',
		});
		await timeout(0);

		assert.deepStrictEqual(messages, []);
	});

	test('from webview: fire-and-forget comm_msg', async () => {
		const messages = new Array<unknown>();
		disposables.add(client.onDidSendMessage(message => messages.push(message)));

		const data = { some_key: 'some_value' };
		messaging.receiveMessage({
			type: 'comm_msg',
			comm_id: client.getClientId(),
			data,
			msg_id: '',
		});
		await timeout(0);

		assert.deepStrictEqual(messages, [data]);
	});

	test('from webview: rpc comm_msg', async () => {
		const messages = new Array<unknown>();
		disposables.add(messaging.onDidPostMessage(message => messages.push(message)));

		const reply = { some_key: 'some_value' };
		client.rpcHandler = async () => reply;

		const msgId = 'test-msg-id';
		messaging.receiveMessage({
			type: 'comm_msg',
			comm_id: client.getClientId(),
			data: {
				method: rpcMethod,
			},
			msg_id: msgId,
		});
		await timeout(0);

		assert.deepStrictEqual(messages, [{
			type: 'comm_msg',
			comm_id: client.getClientId(),
			data: reply,
			parent_id: msgId,
		}]);
	});

	test('from webview: comm_close', async () => {
		let disposed = false;
		disposables.add(client.onDidDispose(() => disposed = true));

		messaging.receiveMessage({
			type: 'comm_close',
			comm_id: client.getClientId(),
		});
		await timeout(0);

		assert(disposed);
	});

	test('to webview: ignore message with unknown method', async () => {
		const messages = new Array<unknown>();
		disposables.add(messaging.onDidPostMessage(message => messages.push(message)));

		client.receiveData({ method: 'unknown-method' });
		await timeout(0);

		assert.deepStrictEqual(messages, []);
	});

	test('to webview: update', async () => {
		const messages = new Array<unknown>();
		disposables.add(messaging.onDidPostMessage(message => messages.push(message)));

		const data = { method: 'update', some_key: 'some_value' };
		client.receiveData(data);
		await timeout(0);

		assert.deepStrictEqual(messages, [{
			type: 'comm_msg',
			comm_id: client.getClientId(),
			data,
		}]);
	});

	test('to webview: comm_close', async () => {
		const messages = new Array<unknown>();
		disposables.add(messaging.onDidPostMessage(message => messages.push(message)));

		let closed = false;
		disposables.add(ipywidgetClient.onDidClose(() => closed = true));

		client.setClientState(RuntimeClientState.Closed);
		await timeout(0);

		assert.deepStrictEqual(messages, [{
			type: 'comm_close',
			comm_id: client.getClientId(),
		}]);

		assert(closed);
	});
});
