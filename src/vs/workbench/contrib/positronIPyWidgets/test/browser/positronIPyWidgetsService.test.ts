/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'assert';
import { timeout } from 'vs/base/common/async';
import { Emitter } from 'vs/base/common/event';
import { ensureNoDisposablesAreLeakedInTestSuite } from 'vs/base/test/common/utils';
import { ExtensionIdentifier } from 'vs/platform/extensions/common/extensions';
import { ILogService, NullLogger } from 'vs/platform/log/common/log';
import { TestThemeService } from 'vs/platform/theme/test/common/testThemeService';
import { INotebookEditor } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { INotebookEditorService } from 'vs/workbench/contrib/notebook/browser/services/notebookEditorService';
import { NotebookEditorWidgetService } from 'vs/workbench/contrib/notebook/browser/services/notebookEditorServiceImpl';
import { NotebookRendererMessagingService } from 'vs/workbench/contrib/notebook/browser/services/notebookRendererMessagingServiceImpl';
import { NotebookTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookTextModel';
import { INotebookRendererInfo, INotebookStaticPreloadInfo } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { NotebookOutputRendererInfo } from 'vs/workbench/contrib/notebook/common/notebookOutputRenderer';
import { INotebookRendererMessagingService } from 'vs/workbench/contrib/notebook/common/notebookRendererMessagingService';
import { INotebookService } from 'vs/workbench/contrib/notebook/common/notebookService';
import { IPyWidgetsInstance, PositronIPyWidgetsService } from 'vs/workbench/contrib/positronIPyWidgets/browser/positronIPyWidgetsService';
import { IPositronNotebookOutputWebviewService } from 'vs/workbench/contrib/positronOutputWebview/browser/notebookOutputWebviewService';
import { PositronNotebookOutputWebviewService } from 'vs/workbench/contrib/positronOutputWebview/browser/notebookOutputWebviewServiceImpl';
import { WebviewPlotClient } from 'vs/workbench/contrib/positronPlots/browser/webviewPlotClient';
import { IWebviewService } from 'vs/workbench/contrib/webview/browser/webview';
import { WebviewService } from 'vs/workbench/contrib/webview/browser/webviewService';
import { RuntimeClientState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeClientInstance';
import { LanguageRuntimeSessionMode, RuntimeExitReason, RuntimeOutputKind, RuntimeState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { ToWebviewMessage } from 'vs/workbench/services/languageRuntime/common/positronIPyWidgetsWebviewMessages';
import { TestIPyWidgetsWebviewMessaging } from 'vs/workbench/services/languageRuntime/test/common/testIPyWidgetsWebviewMessaging';
import { INotebookDocumentService, NotebookDocumentWorkbenchService } from 'vs/workbench/services/notebook/common/notebookDocumentService';
import { IRuntimeSessionService, RuntimeClientType } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';
import { TestLanguageRuntimeSession } from 'vs/workbench/services/runtimeSession/test/common/testLanguageRuntimeSession';
import { TestRuntimeSessionService } from 'vs/workbench/services/runtimeSession/test/common/testRuntimeSessionService';
import { IWorkbenchThemeService } from 'vs/workbench/services/themes/common/workbenchThemeService';
import { workbenchInstantiationService } from 'vs/workbench/test/browser/workbenchTestServices';

class TestNotebookService implements Partial<INotebookService> {
	getRenderers(): INotebookRendererInfo[] {
		return [];
	}

	getPreferredRenderer(_mimeType: string, _viewType?: string): NotebookOutputRendererInfo | undefined {
		return <NotebookOutputRendererInfo>{
			id: 'positron-ipywidgets',
			extensionId: new ExtensionIdentifier('vscode.positron-ipywidgets'),
		};
	}

	*getStaticPreloads(_viewType: string): Iterable<INotebookStaticPreloadInfo> {
		// Yield nothing.
	}
}

suite('Positron - PositronIPyWidgetsService', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	let positronIpywidgetsService: PositronIPyWidgetsService;
	let runtimeSessionService: TestRuntimeSessionService;
	let notebookEditorService: INotebookEditorService;

	setup(() => {
		const instantiationService = workbenchInstantiationService(undefined, disposables);
		instantiationService.stub(INotebookRendererMessagingService, disposables.add(instantiationService.createInstance(NotebookRendererMessagingService)));
		notebookEditorService = disposables.add(instantiationService.createInstance(NotebookEditorWidgetService));
		instantiationService.stub(INotebookEditorService, notebookEditorService);
		instantiationService.stub(IWorkbenchThemeService, new TestThemeService() as any);
		instantiationService.stub(INotebookDocumentService, new NotebookDocumentWorkbenchService());
		instantiationService.stub(INotebookService, new TestNotebookService());
		instantiationService.stub(IWebviewService, disposables.add(new WebviewService(instantiationService)));
		instantiationService.stub(IPositronNotebookOutputWebviewService, instantiationService.createInstance(PositronNotebookOutputWebviewService));
		runtimeSessionService = disposables.add(new TestRuntimeSessionService());
		instantiationService.stub(IRuntimeSessionService, runtimeSessionService);
		positronIpywidgetsService = disposables.add(instantiationService.createInstance(PositronIPyWidgetsService));
	});

	test('attach console session', async () => {
		// Listen for the plot client to be created.
		let plotClient: WebviewPlotClient | undefined;
		disposables.add(positronIpywidgetsService.onDidCreatePlot(client => plotClient = client));

		// Start a console session.
		const session = disposables.add(new TestLanguageRuntimeSession(LanguageRuntimeSessionMode.Console));
		runtimeSessionService.startSession(session);
		await timeout(0);

		// Simulate the runtime sending an IPyWidgets output message.
		const message = session.receiveOutputMessage({
			kind: RuntimeOutputKind.IPyWidget,
			data: {
				'application/vnd.jupyter.widget-view+json': {},
			},
		});
		await timeout(0);

		assert(positronIpywidgetsService.hasInstance(message.id));

		assert(!!plotClient);
		assert.strictEqual(plotClient.id, message.id);
		assert.deepStrictEqual(plotClient.metadata, {
			id: message.id,
			parent_id: message.parent_id,
			created: Date.parse(message.when),
			session_id: session.sessionId,
			code: '',
		});

		session.endSession({
			runtime_name: session.runtimeMetadata.runtimeName,
			exit_code: 0,
			message: '',
			reason: RuntimeExitReason.Shutdown,
		});
		await timeout(0);

		assert(!positronIpywidgetsService.hasInstance(message.id));
	});

	test('attach notebook session', async () => {
		const onDidChangeModel = disposables.add(new Emitter<NotebookTextModel | undefined>());
		notebookEditorService.addNotebookEditor(<INotebookEditor>{
			getId() { return 'test-notebook-editor-id'; },
			// TODO: Test that instance is disposed when model changes
			onDidChangeModel: onDidChangeModel.event,
		});

		const session = disposables.add(
			new TestLanguageRuntimeSession(LanguageRuntimeSessionMode.Notebook)
		);
		runtimeSessionService.startSession(session);
		await timeout(0);

		assert(positronIpywidgetsService.hasInstance(session.sessionId));

		// TODO: Dispose when notebook text model changes

		// TODO: Dispose when notebook editor is removed

		session.endSession({
			runtime_name: session.runtimeMetadata.runtimeName,
			exit_code: 0,
			message: '',
			reason: RuntimeExitReason.Shutdown,
		});
		await timeout(0);

		assert(!positronIpywidgetsService.hasInstance(session.sessionId));
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
		messaging = disposables.add(new TestIPyWidgetsWebviewMessaging());
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

suite('Positron - IPyWidgetsInstance', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	let session: TestLanguageRuntimeSession;
	let messaging: TestIPyWidgetsWebviewMessaging;
	let ipywidgetsInstance: IPyWidgetsInstance;

	setup(async () => {
		const logService = new NullLogger() as unknown as ILogService;
		session = disposables.add(new TestLanguageRuntimeSession());
		messaging = disposables.add(new TestIPyWidgetsWebviewMessaging());
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
