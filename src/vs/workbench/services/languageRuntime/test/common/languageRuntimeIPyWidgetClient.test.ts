/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { timeout } from 'vs/base/common/async';
import { ensureNoDisposablesAreLeakedInTestSuite } from 'vs/base/test/common/utils';
import { ILogService, NullLogger } from 'vs/platform/log/common/log';
import { RuntimeClientState, RuntimeClientType } from 'vs/workbench/services/languageRuntime/common/languageRuntimeClientInstance';
import { IPyWidgetClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeIPyWidgetClient';
import { TestIPyWidgetsWebviewMessaging } from 'vs/workbench/services/languageRuntime/test/common/testIPyWidgetsWebviewMessaging';
import { TestRuntimeClientInstance } from 'vs/workbench/services/languageRuntime/test/common/testRuntimeClientInstance';

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
