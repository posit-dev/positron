/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { timeout } from '../../../../../base/common/async.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ILogService, NullLogger } from '../../../../../platform/log/common/log.js';
import { RuntimeClientState, RuntimeClientType } from '../../common/languageRuntimeClientInstance.js';
import { IPyWidgetClientInstance } from '../../common/languageRuntimeIPyWidgetClient.js';
import { TestIPyWidgetsWebviewMessaging } from './testIPyWidgetsWebviewMessaging.js';
import { TestRuntimeClientInstance } from './testRuntimeClientInstance.js';

suite('Positron - IPyWidgetClientInstance', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	const rpcMethod = 'test-rpc-method';

	let client: TestRuntimeClientInstance;
	let messaging: TestIPyWidgetsWebviewMessaging;
	let ipywidgetClient: IPyWidgetClientInstance;

	setup(async () => {
		const logService = new NullLogger() as unknown as ILogService;
		client = disposables.add(new TestRuntimeClientInstance(
			'test-client-id', RuntimeClientType.IPyWidget
		));
		messaging = disposables.add(new TestIPyWidgetsWebviewMessaging());
		ipywidgetClient = disposables.add(new IPyWidgetClientInstance(
			client, messaging, logService, [rpcMethod]
		));
	});

	test('from webview: ignore message with no comm_id', async () => {
		// Simulate a message from the webview with no comm_id.
		messaging.receiveMessage({ type: 'initialize' });
		await timeout(0);

		// Check that no replies were sent.
		assert.deepStrictEqual(messaging.messagesToWebview, []);
	});

	test('from webview: ignore message to a different comm_id', async () => {
		// Simulate a message from the webview with a different comm_id.
		messaging.receiveMessage({
			type: 'comm_msg',
			comm_id: 'other-client-id',
			data: '',
			msg_id: '',
		});
		await timeout(0);

		// Check that no replies were sent.
		assert.deepStrictEqual(messaging.messagesToWebview, []);
	});

	test('from webview: fire-and-forget comm_msg', async () => {
		// Listen to messages sent to the client.
		const messagesToClient = new Array<unknown>();
		disposables.add(client.onDidSendMessage(message => messagesToClient.push(message)));

		// Simulate a comm_msg from the webview directed to this client.
		const data = { some_key: 'some_value' };
		messaging.receiveMessage({
			type: 'comm_msg',
			comm_id: client.getClientId(),
			data,
			msg_id: '',
		});
		await timeout(0);

		// Check that the message's data was forwarded to the client.
		assert.deepStrictEqual(messagesToClient, [data]);
	});

	test('from webview: rpc comm_msg', async () => {
		// Setup a static RPC handler.
		const reply = {
			buffers: [VSBuffer.wrap(new Uint8Array([1, 2, 3]))],
			data: { some_key: 'some_value' },
		};
		client.rpcHandler = async () => reply;

		// Simulate a message from the webview for a known RPC method.
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

		// Check that the reply was sent to the webview.
		assert.deepStrictEqual(messaging.messagesToWebview, [{
			type: 'comm_msg',
			comm_id: client.getClientId(),
			data: reply.data,
			parent_id: msgId,
			buffers: reply.buffers.map(buffer => buffer.buffer),
		}]);
	});

	test('from webview: comm_close', async () => {
		// Track the client's disposed state.
		let disposed = false;
		disposables.add(client.onDidDispose(() => disposed = true));

		// Simulate a comm_close from the webview.
		messaging.receiveMessage({
			type: 'comm_close',
			comm_id: client.getClientId(),
		});
		await timeout(0);

		// Check that the client was disposed.
		assert(disposed);
	});

	test('to webview: ignore message with unknown method', async () => {
		// Simulate a message from the client with an unknown method.
		client.receiveData({ data: { method: 'unknown-method' } });
		await timeout(0);

		// Check that no messages were sent to the webview.
		assert.deepStrictEqual(messaging.messagesToWebview, []);
	});

	test('to webview: comm_msg update', async () => {
		// Simulate an 'update' message from the client.
		const event = { data: { method: 'update', some_key: 'some_value' } };
		client.receiveData(event);
		await timeout(0);

		// Check that the message was forwarded to the webview.
		assert.deepStrictEqual(messaging.messagesToWebview, [{
			type: 'comm_msg',
			comm_id: client.getClientId(),
			data: event.data,
			buffers: undefined,
			parent_id: undefined,
		}]);
	});

	test('to webview: comm_msg custom with buffers', async () => {
		// Simulate a 'custom' message from the client with buffers.
		const event = {
			data: { method: 'update', some_key: 'some_value' },
			buffers: [VSBuffer.wrap(new Uint8Array([1, 2, 3]))],
		};
		client.receiveData(event);
		await timeout(0);

		// Check that the message was forwarded to the webview.
		assert.deepStrictEqual(messaging.messagesToWebview, [{
			type: 'comm_msg',
			comm_id: client.getClientId(),
			data: event.data,
			buffers: event.buffers.map(buffer => buffer.buffer),
			parent_id: undefined,
		}]);
	});

	test('to webview: comm_close', async () => {
		// Track the IPyWidget client's closed state.
		let closed = false;
		disposables.add(ipywidgetClient.onDidClose(() => closed = true));

		// Close the wrapped client.
		client.setClientState(RuntimeClientState.Closed);
		await timeout(0);

		// Check that the comm_close message was forwarded to the webview.
		assert.deepStrictEqual(messaging.messagesToWebview, [{
			type: 'comm_close',
			comm_id: client.getClientId(),
		}]);

		// Check that the IPyWidget client was closed.
		assert(closed);
	});
});
