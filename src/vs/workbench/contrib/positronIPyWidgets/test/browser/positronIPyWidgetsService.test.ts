/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'assert';
import { timeout } from 'vs/base/common/async';
import { Emitter } from 'vs/base/common/event';
import { URI } from 'vs/base/common/uri';
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
import { LanguageRuntimeSessionMode, RuntimeOutputKind, RuntimeState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { ToWebviewMessage } from 'vs/workbench/services/languageRuntime/common/positronIPyWidgetsWebviewMessages';
import { TestIPyWidgetsWebviewMessaging } from 'vs/workbench/services/languageRuntime/test/common/testIPyWidgetsWebviewMessaging';
import { INotebookDocumentService, NotebookDocumentWorkbenchService } from 'vs/workbench/services/notebook/common/notebookDocumentService';
import { IRuntimeSessionService, RuntimeClientType } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';
import { TestLanguageRuntimeSession } from 'vs/workbench/services/runtimeSession/test/common/testLanguageRuntimeSession';
import { TestRuntimeSessionService } from 'vs/workbench/services/runtimeSession/test/common/testRuntimeSessionService';
import { IWorkbenchThemeService } from 'vs/workbench/services/themes/common/workbenchThemeService';
import { workbenchInstantiationService } from 'vs/workbench/test/browser/workbenchTestServices';

export class TestNotebookService implements Partial<INotebookService> {
	getRenderers(): INotebookRendererInfo[] {
		return [];
	}

	getPreferredRenderer(_mimeType: string): NotebookOutputRendererInfo | undefined {
		return <NotebookOutputRendererInfo>{
			id: 'positron-ipywidgets',
			extensionId: new ExtensionIdentifier('vscode.positron-ipywidgets'),
		};
	}

	*getStaticPreloads(_viewType: string): Iterable<INotebookStaticPreloadInfo> {
		// Yield nothing.
	}
}

interface TestNotebookEditor extends INotebookEditor {
	changeModel(uri: URI): void;
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

	async function createConsoleSession() {
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

		// Check that an instance was created with the expected properties.
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

		return { session, plotClient };
	}

	test('console session: create and end session', async () => {
		const { session, plotClient } = await createConsoleSession();

		// End the session.
		session.endSession();
		await timeout(0);

		// Check that the instance was removed.
		assert(!positronIpywidgetsService.hasInstance(plotClient.id));
	});

	test('console session: respond to result message type and check for memory leaks', async () => {
		const { session } = await createConsoleSession();

		// Simulate the runtime sending a result message.
		const message = session.receiveResultMessage({
			kind: RuntimeOutputKind.IPyWidget,
			data: {
				'application/vnd.jupyter.widget-view+json': {},
			},
		});

		await timeout(0);

		assert(positronIpywidgetsService.hasInstance(message.id));
		// Note that we don't end the session here. This helps us check for memory leaks caused by
		// improper disposal of listeners
	});

	test('notebook session: check for memory leaks', async () => {
		const { session } = await createNotebookSession();

		await timeout(0);

		assert(positronIpywidgetsService.hasInstance(session.sessionId));
		// Note that we don't end the session here. This helps us check for memory leaks caused by
		// improper disposal of listeners
	});

	async function createNotebookSession() {
		const notebookUri = URI.file('notebook.ipynb');

		// Add a mock notebook editor.
		const onDidChangeModel = disposables.add(new Emitter<NotebookTextModel | undefined>());
		const notebookEditor = <TestNotebookEditor>{
			getId() { return 'test-notebook-editor-id'; },
			onDidChangeModel: onDidChangeModel.event,
			textModel: { uri: notebookUri },
			changeModel(uri) { onDidChangeModel.fire(<NotebookTextModel>{ uri }); },
		};
		notebookEditorService.addNotebookEditor(notebookEditor);

		// Start a notebook session.
		const session = disposables.add(new TestLanguageRuntimeSession(
			LanguageRuntimeSessionMode.Notebook,
			notebookUri,
		));
		runtimeSessionService.startSession(session);
		await timeout(0);

		// Check that an instance was created.
		assert(positronIpywidgetsService.hasInstance(session.sessionId));

		return { session, notebookEditor };
	}

	test('notebook session: create and end session', async () => {
		const { session } = await createNotebookSession();

		// Check that an instance was created.
		assert(positronIpywidgetsService.hasInstance(session.sessionId));

		// End the session.
		session.endSession();
		await timeout(0);

		// Check that the instance was removed.
		assert(!positronIpywidgetsService.hasInstance(session.sessionId));
	});

	test('notebook session: change notebook text model', async () => {
		const { session, notebookEditor } = await createNotebookSession();

		// Change the notebook's text model.
		notebookEditor.changeModel(URI.file('other.ipynb'));
		await timeout(0);

		// Check that the instance was removed.
		assert(!positronIpywidgetsService.hasInstance(session.sessionId));
	});

	test('notebook session: remove notebook editor', async () => {
		const { session, notebookEditor } = await createNotebookSession();

		// Check that an instance was created.
		assert(positronIpywidgetsService.hasInstance(session.sessionId));

		// Remove notebook editor.
		notebookEditorService.removeNotebookEditor(notebookEditor);
		await timeout(0);

		// Check that the instance was removed.
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

		// Set the runtime state to ready.
		session.setRuntimeState(RuntimeState.Ready);
	});

	async function createIPyWidgetsInstance() {
		const ipywidgetsInstance = disposables.add(new IPyWidgetsInstance(session, messaging, logService));
		await timeout(0);
		return ipywidgetsInstance;
	}

	test('initialized session, no clients', async () => {
		// Create an instance.
		await createIPyWidgetsInstance();

		// Check that the initialize message was sent.
		assert.deepStrictEqual(messaging.messagesToWebview, [{ type: 'initialize_result' }]);
	});

	test('initialized session, one ipywidget client', async () => {
		const client = await session.createClient(RuntimeClientType.IPyWidget, {}, {}, 'test-client-id');

		// Create an instance.
		const ipywidgetsInstance = await createIPyWidgetsInstance();

		// Check that the initialize message was sent.
		assert.deepStrictEqual(messaging.messagesToWebview, [{ type: 'initialize_result' }]);

		// Check that the client was registered.
		assert(ipywidgetsInstance.hasClient(client.getClientId()));

		// Close the client.
		client.setClientState(RuntimeClientState.Closed);
		await timeout(0);

		// Check that the client was removed.
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

		// Clear initial messages.
		messaging.messagesToWebview.splice(0);
	});

	test('from webview: initialize_request', async () => {
		// Simulate the webview sending an initialize request.
		messaging.receiveMessage({ type: 'initialize_request' });

		// Check that the initialize result was sent.
		assert.deepStrictEqual(messaging.messagesToWebview, [{ type: 'initialize_result' }]);
	});

	test('from webview: comm_open jupyter.widget.control', async () => {
		// Simulate the webview sending a comm open.
		const clientId = 'test-client-id';
		messaging.receiveMessage({
			type: 'comm_open',
			comm_id: clientId,
			target_name: RuntimeClientType.IPyWidgetControl,
			data: {},
			metadata: {},
		});
		await timeout(0);

		// Check that the client was registered.
		assert(ipywidgetsInstance.hasClient(clientId));
	});

	test('from webview: comm_open unrelated type', async () => {
		// Simulate the webview sending a comm open of an unrelated comm type.
		const clientId = 'test-client-id';
		messaging.receiveMessage({
			type: 'comm_open',
			comm_id: clientId,
			target_name: RuntimeClientType.Plot,
			data: {},
			metadata: {},
		});
		await timeout(0);

		// Check that the client was *not* registered.
		assert(!ipywidgetsInstance.hasClient(clientId));
	});

	test('to webview: comm_open', async () => {
		// Create a client.
		const client = await session.createClient(RuntimeClientType.IPyWidget, {}, {}, 'test-client-id');
		await timeout(0);

		// Check that the client was registered.
		assert(ipywidgetsInstance.hasClient(client.getClientId()));

		// Check that the comm open message was sent to the webview.
		assert.deepStrictEqual(messaging.messagesToWebview, [{
			type: 'comm_open',
			comm_id: client.getClientId(),
			target_name: client.getClientType(),
			data: {},
			metadata: {},
		} as ToWebviewMessage]);

		// Close the client.
		client.setClientState(RuntimeClientState.Closed);
		await timeout(0);

		// Check that the client was removed.
		assert(!ipywidgetsInstance.hasClient(client.getClientId()));
	});
});
