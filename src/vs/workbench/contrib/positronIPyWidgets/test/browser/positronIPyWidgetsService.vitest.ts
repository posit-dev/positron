/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { timeout } from '../../../../../base/common/async.js';
import { Emitter } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { INotebookEditor } from '../../../notebook/browser/notebookBrowser.js';
import { INotebookEditorService } from '../../../notebook/browser/services/notebookEditorService.js';
import { NotebookTextModel } from '../../../notebook/common/model/notebookTextModel.js';
import { INotebookService } from '../../../notebook/common/notebookService.js';
import { IPyWidgetsInstance, PositronIPyWidgetsService } from '../../browser/positronIPyWidgetsService.js';
import { NotebookOutputPlotClient } from '../../../positronPlots/browser/notebookOutputPlotClient.js';
import { RuntimeClientState } from '../../../../services/languageRuntime/common/languageRuntimeClientInstance.js';
import { ILanguageRuntimeMessageClearOutput, ILanguageRuntimeMessageError, ILanguageRuntimeMessageOutput, ILanguageRuntimeMessageResult, ILanguageRuntimeMessageStream, LanguageRuntimeMessageType, LanguageRuntimeSessionMode, RuntimeOutputKind } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { ToWebviewMessage } from '../../../../services/languageRuntime/common/positronIPyWidgetsWebviewMessages.js';
import { TestIPyWidgetsWebviewMessaging } from '../../../../services/languageRuntime/test/common/testIPyWidgetsWebviewMessaging.js';
import { RuntimeClientType } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { TestLanguageRuntimeSession } from '../../../../services/runtimeSession/test/common/testLanguageRuntimeSession.js';
import { startTestLanguageRuntimeSession } from '../../../../services/runtimeSession/test/common/testRuntimeSessionService.js';
import { PositronTestServiceAccessor } from '../../../../test/browser/positronWorkbenchTestServices.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { INotebookRendererInfo, INotebookStaticPreloadInfo } from '../../../notebook/common/notebookCommon.js';
import { NotebookOutputRendererInfo } from '../../../notebook/common/notebookOutputRenderer.js';
import { ExtensionIdentifier } from '../../../../../platform/extensions/common/extensions.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { IPositronPlotMetadata } from '../../../../services/languageRuntime/common/languageRuntimePlotClient.js';

class TestNotebookService implements Partial<INotebookService> {
	getRenderers(): INotebookRendererInfo[] {
		return [];
	}

	getPreferredRenderer(_mimeType: string): NotebookOutputRendererInfo | undefined {
		return <NotebookOutputRendererInfo>{
			id: 'positron-ipywidgets',
			extensionId: new ExtensionIdentifier('positron.positron-ipywidgets'),
		};
	}

	*getStaticPreloads(_viewType: string): Iterable<INotebookStaticPreloadInfo> {
		// Yield nothing.
	}
}

interface TestNotebookEditor extends INotebookEditor {
	changeModel(uri: URI): void;
}

describe('Positron - PositronIPyWidgetsService', () => {
	const ctx = createTestContainer().withWorkbenchServices().build();

	let positronIpywidgetsService: PositronIPyWidgetsService;
	let notebookEditorService: INotebookEditorService;

	beforeEach(() => {
		const accessor = ctx.instantiationService.createInstance(PositronTestServiceAccessor);
		notebookEditorService = accessor.notebookEditorService;
		positronIpywidgetsService = accessor.positronIPyWidgetsService;
	});

	async function receiveIPyWidgetsResultMessage(
		session: TestLanguageRuntimeSession,
		parentId?: string,
	) {
		// Simulate the runtime sending a result message to the parent ID
		// that the output client will handle.
		const message = session.receiveResultMessage({
			parent_id: parentId,
			kind: RuntimeOutputKind.IPyWidget,
			data: {
				'application/vnd.jupyter.widget-view+json': {},
			},
		});
		await timeout(0);

		return message;
	}

	async function createConsoleInstance() {
		// Listen for the plot client to be created.
		let plotClient: NotebookOutputPlotClient | undefined;
		ctx.disposables.add(positronIpywidgetsService.onDidCreatePlot(client => plotClient = client));

		// Start a console session.
		const session = await startTestLanguageRuntimeSession(ctx.instantiationService, ctx.disposables);

		// Simulate the runtime sending an IPyWidgets output message.
		const message = await receiveIPyWidgetsResultMessage(session);

		// Check that an instance was created with the expected properties.
		expect(positronIpywidgetsService.hasConsoleWidgetInstance(message.id)).toBe(true);
		expect(plotClient).toBeDefined();
		expect(plotClient!.id).toBe(message.id);
		expect(plotClient!.metadata).toEqual({
			id: message.id,
			created: Date.parse(message.when),
			execution_id: '',
			session_id: session.sessionId,
			code: '',
			output_id: message.output_id,
		} satisfies IPositronPlotMetadata);

		return { session, plotClient: plotClient! };
	}

	it('console session: create and end session', async () => {
		const { session, plotClient } = await createConsoleInstance();

		// End the session.
		session.endSession();
		await timeout(0);

		// Check that the instance was removed.
		expect(positronIpywidgetsService.hasConsoleWidgetInstance(plotClient.id)).toBe(false);
	});

	it('console session: respond to result message type and check for memory leaks', async () => {
		const { session } = await createConsoleInstance();

		// Simulate the runtime sending a result message.
		const message = session.receiveResultMessage({
			kind: RuntimeOutputKind.IPyWidget,
			data: {
				'application/vnd.jupyter.widget-view+json': {},
			},
		});

		await timeout(0);

		expect(positronIpywidgetsService.hasConsoleWidgetInstance(message.id)).toBe(true);
		// Note that we don't end the session here. This helps us check for memory leaks caused by
		// improper disposal of listeners
	});


	it('notebook session: check for memory leaks', async () => {
		const { session } = await createNotebookInstance();

		await timeout(0);

		expect(positronIpywidgetsService.hasNotebookWidgetInstance(session.sessionId)).toBe(true);
		// Note that we don't end the session here. This helps us check for memory leaks caused by
		// improper disposal of listeners
	});

	function createNotebookEditor(notebookUri: URI): TestNotebookEditor {
		const onDidChangeModel = ctx.disposables.add(new Emitter<NotebookTextModel | undefined>());
		return <TestNotebookEditor>{
			getId() { return 'test-notebook-editor-id'; },
			onDidChangeModel: onDidChangeModel.event,
			textModel: { uri: notebookUri },
			getViewModel() { return undefined; },
			changeModel(uri) { onDidChangeModel.fire(<NotebookTextModel>{ uri }); },
		};
	}

	async function createNotebookInstance() {
		const notebookUri = URI.file('notebook.ipynb');

		// Add a mock notebook editor.
		const notebookEditor = createNotebookEditor(notebookUri);
		notebookEditorService.addNotebookEditor(notebookEditor);

		// Start a notebook session.
		const session = await startTestLanguageRuntimeSession(
			ctx.instantiationService,
			ctx.disposables,
			{ sessionMode: LanguageRuntimeSessionMode.Notebook, notebookUri },
		);

		// Check that an instance was created.
		expect(positronIpywidgetsService.hasNotebookWidgetInstance(session.sessionId)).toBe(true);

		return { session, notebookEditor };
	}

	it('notebook session: create and end session', async () => {
		const { session } = await createNotebookInstance();

		// Check that an instance was created.
		expect(positronIpywidgetsService.hasNotebookWidgetInstance(session.sessionId)).toBe(true);

		// End the session.
		session.endSession();
		await timeout(0);

		// Check that the instance was removed.
		expect(positronIpywidgetsService.hasNotebookWidgetInstance(session.sessionId)).toBe(false);
	});

	it('notebook session: change notebook text model', async () => {
		const { session, notebookEditor } = await createNotebookInstance();

		// Change the notebook's text model.
		notebookEditor.changeModel(URI.file('other.ipynb'));
		await timeout(0);

		// Check that the instance was removed.
		expect(positronIpywidgetsService.hasNotebookWidgetInstance(session.sessionId)).toBe(false);
	});

	it('notebook session: remove notebook editor', async () => {
		const { session, notebookEditor } = await createNotebookInstance();

		// Check that an instance was created.
		expect(positronIpywidgetsService.hasNotebookWidgetInstance(session.sessionId)).toBe(true);

		// Remove notebook editor.
		notebookEditorService.removeNotebookEditor(notebookEditor);
		await timeout(0);

		// Check that the instance was removed.
		expect(positronIpywidgetsService.hasNotebookWidgetInstance(session.sessionId)).toBe(false);
	});

	it('notebook session: attaches widget when the editor appears after the session starts', async () => {
		// Regression (win/electron flake): after a window reload, the notebook
		// session can re-register before its editor is recreated. The attach
		// must defer and bind once the matching editor appears, rather than
		// giving up on a one-shot lookup and leaving the widget unrendered.
		const notebookUri = URI.file('notebook.ipynb');

		// Start the notebook session BEFORE its editor exists.
		const session = await startTestLanguageRuntimeSession(
			ctx.instantiationService,
			ctx.disposables,
			{ sessionMode: LanguageRuntimeSessionMode.Notebook, notebookUri },
		);
		await timeout(0);

		// No matching editor yet, so no instance yet.
		expect(positronIpywidgetsService.hasNotebookWidgetInstance(session.sessionId)).toBe(false);

		// The editor appears afterward.
		notebookEditorService.addNotebookEditor(createNotebookEditor(notebookUri));
		await timeout(0);

		// The widget should now be attached to the late-arriving editor.
		expect(positronIpywidgetsService.hasNotebookWidgetInstance(session.sessionId)).toBe(true);
	});

	it('notebook session: does not attach a widget when the session ends before its editor appears', async () => {
		// The deferred-attach listener must be torn down when the session ends,
		// so an editor that appears for an already-ended session never triggers
		// a phantom attach (guards the up-front onDidEndSession registration).
		const notebookUri = URI.file('notebook.ipynb');

		// Start the notebook session before its editor exists.
		const session = await startTestLanguageRuntimeSession(
			ctx.instantiationService,
			ctx.disposables,
			{ sessionMode: LanguageRuntimeSessionMode.Notebook, notebookUri },
		);
		await timeout(0);

		// End the session while it is still waiting for an editor.
		session.endSession();
		await timeout(0);

		// A matching editor appears afterward: it must not resurrect the session.
		notebookEditorService.addNotebookEditor(createNotebookEditor(notebookUri));
		await timeout(0);

		expect(positronIpywidgetsService.hasNotebookWidgetInstance(session.sessionId)).toBe(false);
	});

});

describe('Positron - IPyWidgetsInstance constructor', () => {
	const ctx = createTestContainer().withWorkbenchServices().build();

	let logService: ILogService;
	let session: TestLanguageRuntimeSession;
	let messaging: TestIPyWidgetsWebviewMessaging;
	let notebookService: INotebookService;

	beforeEach(async () => {
		const accessor = ctx.instantiationService.createInstance(PositronTestServiceAccessor);
		logService = accessor.logService;
		session = await startTestLanguageRuntimeSession(ctx.instantiationService, ctx.disposables);
		messaging = ctx.disposables.add(new TestIPyWidgetsWebviewMessaging());
		notebookService = new TestNotebookService() as INotebookService;
	});

	async function createIPyWidgetsInstance() {
		const ipywidgetsInstance = ctx.disposables.add(new IPyWidgetsInstance(session, messaging, notebookService, logService));
		await timeout(0);
		return ipywidgetsInstance;
	}

	it('initialized session, no clients', async () => {
		// Create an instance.
		await createIPyWidgetsInstance();

		// Check that the initialize message was sent.
		expect(messaging.messagesToWebview).toEqual([{ type: 'initialize_result' }]);
	});

	it('forwards comm_open with buffers when client is created via session.createClient', async () => {
		// Create instance and clear initial messages
		await createIPyWidgetsInstance();
		messaging.messagesToWebview.length = 0; // Clear initialize_result message

		// Make some sample client data
		const clientId = 'new-widget-client-id';
		const clientType = RuntimeClientType.IPyWidget;
		const messageData = { initial_state: 'some_value' };
		const messageMetadata = { source: 'test' };
		const messageBuffers = [
			VSBuffer.wrap(new Uint8Array([1, 2, 3])),
			VSBuffer.wrap(new Uint8Array([4, 5]))
		];

		// Act: Call session.createClient to simulate client creation and trigger the event
		await session.createClient(
			clientType,
			messageData,
			messageMetadata,
			clientId,
			messageBuffers
		);
		await timeout(0);

		// Sanity check: only one message should be sent.
		expect(messaging.messagesToWebview.length, 'Expected exactly one message (comm_open) to be sent to the webview').toBe(1);
		const sentMessage = messaging.messagesToWebview[0];

		// The message should be comm_open and contain the correct buffers.
		expect(sentMessage.type, 'Expected message type to be comm_open').toBe('comm_open');
		expect(sentMessage.buffers, 'Expected buffers to be passed correctly in the comm_open message').toEqual(messageBuffers);
	});

	it('initialized session, one ipywidget client', async () => {
		const client = await session.createClient(RuntimeClientType.IPyWidget, {}, {}, 'test-client-id');

		// Create an instance.
		const ipywidgetsInstance = await createIPyWidgetsInstance();

		// Check that the initialize message was sent.
		expect(messaging.messagesToWebview).toEqual([{ type: 'initialize_result' }]);

		// Check that the client was registered.
		expect(ipywidgetsInstance.hasClient(client.getClientId())).toBe(true);

		// Close the client.
		client.setClientState(RuntimeClientState.Closed);
		await timeout(0);

		// Check that the client was removed.
		expect(ipywidgetsInstance.hasClient(client.getClientId())).toBe(false);
	});
});

describe('Positron - IPyWidgetsInstance', () => {
	const ctx = createTestContainer().withWorkbenchServices().build();

	let session: TestLanguageRuntimeSession;
	let messaging: TestIPyWidgetsWebviewMessaging;
	let ipywidgetsInstance: IPyWidgetsInstance;

	beforeEach(async () => {
		const accessor = ctx.instantiationService.createInstance(PositronTestServiceAccessor);
		session = await startTestLanguageRuntimeSession(ctx.instantiationService, ctx.disposables);
		messaging = ctx.disposables.add(new TestIPyWidgetsWebviewMessaging());
		const notebookService = new TestNotebookService() as INotebookService;
		ipywidgetsInstance = ctx.disposables.add(new IPyWidgetsInstance(
			session,
			messaging,
			notebookService,
			accessor.logService,
		));

		// Clear initial messages.
		messaging.messagesToWebview.splice(0);
	});

	it('from webview: initialize_request', async () => {
		// Simulate the webview sending an initialize request.
		messaging.receiveMessage({ type: 'initialize' });

		// Check that the initialize result was sent.
		expect(messaging.messagesToWebview).toEqual([{ type: 'initialize_result' }]);
	});

	it('from webview: comm_open jupyter.widget.control', async () => {
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
		expect(ipywidgetsInstance.hasClient(clientId)).toBe(true);
	});

	it('from webview: comm_open unrelated type', async () => {
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
		expect(ipywidgetsInstance.hasClient(clientId)).toBe(false);
	});

	it('from webview: get_preferred_renderer', async () => {
		// Simulate the webview sending a get preferred renderer message.
		const msgId = 'test-msg-id';
		messaging.receiveMessage({
			type: 'get_preferred_renderer',
			msg_id: msgId,
			mime_type: 'test-mime-type',
		});

		// Check that the initialize result was sent.
		expect(messaging.messagesToWebview).toEqual([{
			type: 'get_preferred_renderer_result',
			parent_id: msgId,
			// The positron-ipywidgets renderer ID is currently always returned by
			// TestNotebookService.getPreferredRenderer.
			renderer_id: 'positron-ipywidgets',
		} as ToWebviewMessage]);
	});

	it('to webview: comm_open', async () => {
		// Create a client.
		const client = await session.createClient(RuntimeClientType.IPyWidget, {}, {}, 'test-client-id');
		await timeout(0);

		// Check that the client was registered.
		expect(ipywidgetsInstance.hasClient(client.getClientId())).toBe(true);

		// Check that the comm open message was sent to the webview.
		expect(messaging.messagesToWebview).toEqual([{
			type: 'comm_open',
			comm_id: client.getClientId(),
			target_name: client.getClientType(),
			data: {},
			metadata: {},
			buffers: [],
		} as ToWebviewMessage]);

		// Close the client.
		client.setClientState(RuntimeClientState.Closed);
		await timeout(0);

		// Check that the client was removed.
		expect(ipywidgetsInstance.hasClient(client.getClientId())).toBe(false);
	});

	it('to webview: kernel_message, display_data', async () => {
		const ipywidgetMessage = session.receiveIPyWidgetMessage({}, { type: LanguageRuntimeMessageType.Output });
		const message = ipywidgetMessage.original_message as ILanguageRuntimeMessageOutput;

		// Check that the display_data kernel_message was sent to the webview.
		expect(messaging.messagesToWebview).toEqual([{
			type: 'kernel_message',
			parent_id: message.parent_id,
			content: {
				type: 'display_data',
				data: message.data,
				metadata: message.metadata,
			}
		} as ToWebviewMessage]);
	});

	it('to webview: kernel_message, execute_result', async () => {
		const ipywidgetMessage = session.receiveIPyWidgetMessage({}, { type: LanguageRuntimeMessageType.Result });
		const message = ipywidgetMessage.original_message as ILanguageRuntimeMessageResult;

		// Check that the display_data kernel_message was sent to the webview.
		expect(messaging.messagesToWebview).toEqual([{
			type: 'kernel_message',
			parent_id: message.parent_id,
			content: {
				type: 'execute_result',
				data: message.data,
				metadata: message.metadata,
			}
		} as ToWebviewMessage]);
	});

	it('to webview: kernel_message, stream', async () => {
		const ipywidgetMessage = session.receiveIPyWidgetMessage({}, { type: LanguageRuntimeMessageType.Stream });
		const message = ipywidgetMessage.original_message as ILanguageRuntimeMessageStream;

		// Check that the stream kernel_message was sent to the webview.
		expect(messaging.messagesToWebview).toEqual([{
			type: 'kernel_message',
			parent_id: message.parent_id,
			content: {
				type: 'stream',
				name: message.name,
				text: message.text,
			}
		} as ToWebviewMessage]);
	});

	it('to webview: kernel_message, error', async () => {
		const ipywidgetMessage = session.receiveIPyWidgetMessage({}, { type: LanguageRuntimeMessageType.Error });
		const message = ipywidgetMessage.original_message as ILanguageRuntimeMessageError;

		// Check that the error kernel_message was sent to the webview.
		expect(messaging.messagesToWebview).toEqual([{
			type: 'kernel_message',
			parent_id: message.parent_id,
			content: {
				type: 'error',
				name: message.name,
				message: message.message,
				traceback: message.traceback,
			}
		} as ToWebviewMessage]);
	});

	it('to webview: kernel_message, clear_output', async () => {
		const ipywidgetMessage = session.receiveIPyWidgetMessage({}, { type: LanguageRuntimeMessageType.ClearOutput });
		const message = ipywidgetMessage.original_message as ILanguageRuntimeMessageClearOutput;

		// Check that the clear_output kernel_message was sent to the webview.
		expect(messaging.messagesToWebview).toEqual([{
			type: 'kernel_message',
			parent_id: message.parent_id,
			content: {
				type: 'clear_output',
				wait: message.wait,
			}
		} as ToWebviewMessage]);
	});

});
