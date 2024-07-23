/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'assert';
import { timeout } from 'vs/base/common/async';
import { Emitter } from 'vs/base/common/event';
import { generateUuid } from 'vs/base/common/uuid';
import { ensureNoDisposablesAreLeakedInTestSuite } from 'vs/base/test/common/utils';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { ILogService, NullLogger } from 'vs/platform/log/common/log';
import { NotebookRendererMessagingService } from 'vs/workbench/contrib/notebook/browser/services/notebookRendererMessagingServiceImpl';
import { INotebookRendererMessagingService } from 'vs/workbench/contrib/notebook/common/notebookRendererMessagingService';
import { IPyWidgetsInstance, PositronIPyWidgetsService } from 'vs/workbench/contrib/positronIPyWidgets/browser/positronIPyWidgetsService';
import { IPositronNotebookOutputWebviewService } from 'vs/workbench/contrib/positronOutputWebview/browser/notebookOutputWebviewService';
import { RuntimeClientState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeClientInstance';
import { LanguageRuntimeMessageType, RuntimeOutputKind, RuntimeState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { ToWebviewMessage } from 'vs/workbench/services/languageRuntime/common/positronIPyWidgetsWebviewMessages';
import { TestIPyWidgetsWebviewMessaging } from 'vs/workbench/services/languageRuntime/test/common/testIPyWidgetsWebviewMessaging';
import { IRuntimeSessionService, IRuntimeSessionWillStartEvent, RuntimeClientType } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';
import { TestLanguageRuntimeSession } from 'vs/workbench/services/runtimeSession/test/common/testLanguageRuntimeSession';

suite('Positron - PositronIPyWidgetsService', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	let testInstantiationService: TestInstantiationService;
	let onWillStartSession: Emitter<IRuntimeSessionWillStartEvent>;
	let positronIpywidgetsService: PositronIPyWidgetsService;

	setup(async () => {
		testInstantiationService = disposables.add(new TestInstantiationService());
		onWillStartSession = disposables.add(new Emitter<IRuntimeSessionWillStartEvent>());

		const runtimeSessionService: Partial<IRuntimeSessionService> = {
			activeSessions: [],
			onWillStartSession: onWillStartSession.event,
		};
		testInstantiationService.stub(IRuntimeSessionService, runtimeSessionService);

		// const onShouldPostMessage = disposables.add(
		// 	new Emitter<INotebookRendererMessagingService['onShouldPostMessage']['arguments']>()
		// );
		// const notebookRendererMessagingService: Partial<INotebookRendererMessagingService> = {
		// 	onShouldPostMessage: onShouldPostMessage.event,
		// };
		// testInstantiationService.stub(INotebookRendererMessagingService, notebookRendererMessagingService);
		const notebookRendererMessagingService = disposables.add(new NotebookRendererMessagingService({} as any));
		testInstantiationService.stub(INotebookRendererMessagingService, notebookRendererMessagingService);

		// TODO: Mock out createNotebookOutputWebview
		const notebookOutputWebviewService: Partial<IPositronNotebookOutputWebviewService> = {
			createNotebookOutputWebview(runtime, output, viewType) {
				const webview = {
				};
				return Promise.resolve(webview as any);
			}
		};
		testInstantiationService.stub(IPositronNotebookOutputWebviewService, notebookOutputWebviewService);

		positronIpywidgetsService = disposables.add(testInstantiationService.createInstance(PositronIPyWidgetsService));
	});

	test('attach console session', async () => {
		const session = disposables.add(new TestLanguageRuntimeSession());
		onWillStartSession.fire({ session, isNew: true });
		await timeout(0);

		// TODO: Receive runtime message output
		const id = generateUuid();
		session.receiveOutputMessage({
			id,
			type: LanguageRuntimeMessageType.Output,
			event_clock: 0,
			when: new Date().toISOString(),
			data: {},
			metadata: new Map(),
			kind: RuntimeOutputKind.IPyWidget,
			parent_id: '',
		});
		await timeout(0);

		// assert(positronIpywidgetsService.hasInstance(id));

		// TODO: Fire onDidEndSession
	});
});

suite('Positron - IPyWidgetsInstance constructor', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	let logService: ILogService;
	let session: TestLanguageRuntimeSession;
	let messaging: TestIPyWidgetsWebviewMessaging;

	setup(async () => {
		logService = new NullLogger() as unknown as ILogService;
		session = disposables.add(new TestLanguageRuntimeSession());
		messaging = disposables.add(new TestIPyWidgetsWebviewMessaging);
	});

	test('uninitialized session', async () => {
		const messages = new Array<ToWebviewMessage>();
		disposables.add(messaging.onDidPostMessage(event => messages.push(event)));

		disposables.add(new IPyWidgetsInstance(session, messaging, logService));
		await timeout(0);

		assert.deepStrictEqual(messages, [{ type: 'initialize_result' } as ToWebviewMessage]);
	});

	test('initialized session - no clients', async () => {
		session.setRuntimeState(RuntimeState.Ready);

		const messages = new Array<ToWebviewMessage>();
		disposables.add(messaging.onDidPostMessage(event => messages.push(event)));

		disposables.add(new IPyWidgetsInstance(session, messaging, logService));
		await timeout(0);

		assert.deepStrictEqual(messages, [{ type: 'initialize_result' } as ToWebviewMessage]);
	});

	test('initialized session - one ipywidget client', async () => {
		session.setRuntimeState(RuntimeState.Ready);
		const client = await session.createClient(RuntimeClientType.IPyWidget, {}, {}, 'test-client-id');

		const messages = new Array<ToWebviewMessage>();
		disposables.add(messaging.onDidPostMessage(event => messages.push(event)));

		const ipywidgetsInstance = disposables.add(new IPyWidgetsInstance(session, messaging, logService));
		await timeout(0);

		assert.deepStrictEqual(messages, [{ type: 'initialize_result' } as ToWebviewMessage]);

		assert(ipywidgetsInstance.hasClient(client.getClientId()));

		client.setClientState(RuntimeClientState.Closed);
		await timeout(0);

		assert(!ipywidgetsInstance.hasClient(client.getClientId()));
	});
});

suite('IPyWidgetsInstance', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	let session: TestLanguageRuntimeSession;
	let messaging: TestIPyWidgetsWebviewMessaging;
	let ipywidgetsInstance: IPyWidgetsInstance;

	setup(async () => {
		const logService = new NullLogger() as unknown as ILogService;
		session = disposables.add(new TestLanguageRuntimeSession());
		messaging = disposables.add(new TestIPyWidgetsWebviewMessaging);
		ipywidgetsInstance = disposables.add(new IPyWidgetsInstance(
			session,
			messaging,
			logService,
		));
	});

	test('from webview: initialize_request', async () => {
		const messages = new Array<ToWebviewMessage>();
		disposables.add(messaging.onDidPostMessage(event => messages.push(event)));

		messaging.receiveMessage({ type: 'initialize_request' });

		assert.deepStrictEqual(messages, [{ type: 'initialize_result' }]);
	});

	// TODO: wrong runtime client type
	test('from webview: comm_open', async () => {
		const clientId = 'test-client-id';
		messaging.receiveMessage({
			type: 'comm_open',
			comm_id: clientId,
			target_name: RuntimeClientType.IPyWidgetControl,
			data: {},
			metadata: {},
		});
		await timeout(0);

		assert(ipywidgetsInstance.hasClient(clientId));
	});

	test('to webview: comm_open', async () => {
		const messages = new Array<ToWebviewMessage>();
		disposables.add(messaging.onDidPostMessage(event => messages.push(event)));

		const client = await session.createClient(RuntimeClientType.IPyWidget, {}, {}, 'test-client-id');
		await timeout(0);

		assert(ipywidgetsInstance.hasClient(client.getClientId()));

		assert.deepStrictEqual(messages, [{
			type: 'comm_open',
			comm_id: client.getClientId(),
			target_name: client.getClientType(),
			data: {},
			metadata: {},
		} as ToWebviewMessage]);

		client.setClientState(RuntimeClientState.Closed);
		await timeout(0);

		assert(!ipywidgetsInstance.hasClient(client.getClientId()));
	});
});
