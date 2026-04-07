/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Event } from '../../../../../base/common/event.js';
import { DisposableStore, toDisposable } from '../../../../../base/common/lifecycle.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { timeout } from '../../../../../base/common/async.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { PositronWebviewPreloadService } from '../../browser/positronWebviewPreloadsService.js';
import { PositronTestServiceAccessor } from '../../../../test/browser/positronWorkbenchTestServices.js';
import { CellEditType, CellKind } from '../../../notebook/common/notebookCommon.js';
import { INotebookOutputWebview, IPositronNotebookOutputWebviewService } from '../../../positronOutputWebview/browser/notebookOutputWebviewService.js';
import { RuntimeOutputKind, LanguageRuntimeSessionMode } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { IPositronIPyWidgetsService } from '../../../../services/positronIPyWidgets/common/positronIPyWidgetsService.js';
import { IPositronWebviewPreloadService } from '../../../../services/positronWebviewPreloads/browser/positronWebviewPreloadService.js';
import { TestLanguageRuntimeSession } from '../../../../services/runtimeSession/test/common/testLanguageRuntimeSession.js';
import { startTestLanguageRuntimeSession } from '../../../../services/runtimeSession/test/common/testRuntimeSessionService.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { NotebookMultiMessagePlotClient } from '../../../positronPlots/browser/notebookMultiMessagePlotClient.js';
import { instantiateTestNotebookInstance, positronNotebookInstantiationService } from '../../../positronNotebook/test/browser/testPositronNotebookInstance.js';


const hvPreloadMessage = {
	kind: RuntimeOutputKind.WebviewPreload,
	data: {
		'application/vnd.holoviews_load.v0+json': {},
	},
};

const hvDisplayMessage = {
	kind: RuntimeOutputKind.WebviewPreload,
	data: {
		"application/vnd.holoviews_exec.v0+json": '',
		'text/html': '<div></div>',
		'text/plain': 'hello',
	},
};

const bokehPreloadMessage = {
	kind: RuntimeOutputKind.WebviewPreload,
	data: {
		'application/vnd.bokehjs_load.v0+json': {},
	},
};

const bokehDisplayMessage = {
	kind: RuntimeOutputKind.WebviewPreload,
	data: {
		"application/vnd.bokehjs_exec.v0+json": '',
		"application/javascript": 'console.log("hello")',
	},
};

function complexHtmlOutputItem() {
	return { mime: 'text/html', data: VSBuffer.fromString('<iframe src="https://example.com"></iframe>') };
}

function widgetOutputItem() {
	return { mime: 'application/vnd.jupyter.widget-view+json', data: VSBuffer.fromString('{}') };
}

function createFakeNotebookOutputWebview(id: string) {
	const disposeCount = { value: 0 };
	const webview = {
		id,
		sessionId: id,
		webview: {} as any,
		onDidRender: Event.None,
		dispose: () => {
			disposeCount.value++;
		},
	} as unknown as INotebookOutputWebview;

	return { webview, disposeCount };
}

function createPreloadServiceHarness(instantiationService: TestInstantiationService, disposables: Pick<DisposableStore, 'add'>) {
	const rawHtmlDisposeCounts = new Map<string, { value: number }>();
	const widgetDisposeCounts = new Map<string, { value: number }>();
	const widgetInstanceIds = new Set<string>();
	let rawHtmlCreateCount = 0;
	let widgetCreateCount = 0;

	const notebookOutputWebviewService: IPositronNotebookOutputWebviewService = {
		_serviceBrand: undefined,
		createNotebookOutputWebview: async ({ id }) => {
			widgetCreateCount++;
			const created = createFakeNotebookOutputWebview(id);
			widgetDisposeCounts.set(id, created.disposeCount);
			return created.webview;
		},
		createMultiMessageWebview: async () => undefined,
		createRawHtmlOutputWebview: async (id) => {
			rawHtmlCreateCount++;
			const created = createFakeNotebookOutputWebview(id);
			rawHtmlDisposeCounts.set(id, created.disposeCount);
			return created.webview;
		},
	};

	const ipyWidgetsService: IPositronIPyWidgetsService = {
		_serviceBrand: undefined,
		onDidCreatePlot: Event.None,
		initialize: () => { },
		hasPositronNotebookWidgetInstance: outputId => widgetInstanceIds.has(outputId),
		createPositronNotebookWidgetInstance: (_session, outputId) => {
			widgetInstanceIds.add(outputId);
			return toDisposable(() => {
				widgetInstanceIds.delete(outputId);
			});
		},
	};

	instantiationService.stub(IPositronNotebookOutputWebviewService, notebookOutputWebviewService);
	instantiationService.stub(IPositronIPyWidgetsService, ipyWidgetsService);

	const service = disposables.add(instantiationService.createInstance(PositronWebviewPreloadService));
	instantiationService.stub(IPositronWebviewPreloadService, service);

	return {
		instantiationService,
		service,
		rawHtmlCreateCount: () => rawHtmlCreateCount,
		widgetCreateCount: () => widgetCreateCount,
		rawHtmlDisposeCount: (id: string) => rawHtmlDisposeCounts.get(id)?.value ?? 0,
		widgetDisposeCount: (id: string) => widgetDisposeCounts.get(id)?.value ?? 0,
	};
}

suite('Positron - PositronWebviewPreloadService', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	let instantiationService: TestInstantiationService;
	let positronWebviewPreloadService: PositronWebviewPreloadService;

	setup(() => {
		instantiationService = positronNotebookInstantiationService(disposables);
		const accessor = instantiationService.createInstance(PositronTestServiceAccessor);
		positronWebviewPreloadService = accessor.positronWebviewPreloadService;
	});

	async function createConsoleSession() {

		// Start a console session.
		const session = await startTestLanguageRuntimeSession(instantiationService, disposables);

		const out: {
			session: TestLanguageRuntimeSession;
			plotClient: NotebookMultiMessagePlotClient | undefined;
		} = {
			session, plotClient: undefined,
		};

		disposables.add(positronWebviewPreloadService.onDidCreatePlot(client => {
			out.plotClient = client;
		}));

		return out;
	}

	test('console session: dependency messages are absorbed without emitting plot', async () => {
		const consoleSession = await createConsoleSession();

		// Simulate the runtime sending an HoloViews output message.
		consoleSession.session.receiveOutputMessage(hvPreloadMessage);
		await timeout(0);

		// No plot should have been emitted.
		assert(!Boolean(consoleSession.plotClient));
		assert.equal(positronWebviewPreloadService.sessionInfo(consoleSession.session.sessionId)?.numberOfMessages, 1);

		// Send another preload message.
		consoleSession.session.receiveOutputMessage(bokehPreloadMessage);
		await timeout(0);
		assert.equal(positronWebviewPreloadService.sessionInfo(consoleSession.session.sessionId)?.numberOfMessages, 2);

		// End the session.
		consoleSession.session.endSession();
		await timeout(0);
	});

	test('console session: Service emits plot client after display message is received', async () => {
		const consoleSession = await createConsoleSession();

		// Send one preload message.
		consoleSession.session.receiveOutputMessage(hvPreloadMessage);
		await timeout(0);

		// Send a display message
		const displayMessageHv = consoleSession.session.receiveOutputMessage(hvDisplayMessage);
		await timeout(0);

		// Display message shouldnt have been absorbed into preload messages
		assert.equal(positronWebviewPreloadService.sessionInfo(consoleSession.session.sessionId)?.numberOfMessages, 1);

		// Plot client should have been emitted and it should be linked to the display message.
		assert(Boolean(consoleSession.plotClient));
		assert.strictEqual(consoleSession.plotClient!.id, displayMessageHv.id);

		// Emit a bokeh display message and another plot should be created
		const displayMessageBokeh = consoleSession.session.receiveOutputMessage(bokehDisplayMessage);
		await timeout(0);
		assert.strictEqual(consoleSession.plotClient!.id, displayMessageBokeh.id);

		// End the session.
		consoleSession.session.endSession();
		await timeout(0);
	});

	test('raw HTML webviews are reused for identical HTML and disposed when removed', async () => {
		const harness = createPreloadServiceHarness(instantiationService, disposables);
		const notebook = instantiateTestNotebookInstance(
			[['print("hello")', 'python', CellKind.Code]],
			harness.instantiationService,
			disposables
		);

		const first = harness.service.addRawHtmlOutput({
			instance: notebook,
			outputId: 'raw-html-output',
			html: '<iframe src="https://example.com"></iframe>',
		});
		const second = harness.service.addRawHtmlOutput({
			instance: notebook,
			outputId: 'raw-html-output',
			html: '<iframe src="https://example.com"></iframe>',
		});

		if (first.preloadMessageType !== 'display' || second.preloadMessageType !== 'display') {
			assert.fail('Expected raw HTML outputs to use the display webview path');
		}

		assert.strictEqual(first.webview, second.webview);
		assert.strictEqual(harness.rawHtmlCreateCount(), 1);

		await first.webview;
		harness.service.removeRawHtmlOutput({
			instance: notebook,
			outputId: 'raw-html-output',
		});
		await timeout(0);

		assert.strictEqual(harness.rawHtmlDisposeCount('raw-html-output'), 1);

		const third = harness.service.addRawHtmlOutput({
			instance: notebook,
			outputId: 'raw-html-output',
			html: '<iframe src="https://example.com"></iframe>',
		});

		if (third.preloadMessageType !== 'display') {
			assert.fail('Expected raw HTML outputs to use the display webview path');
		}

		assert.notStrictEqual(third.webview, first.webview);
		assert.strictEqual(harness.rawHtmlCreateCount(), 2);
	});

	test('output replacement disposes stale raw HTML webviews', async () => {
		const harness = createPreloadServiceHarness(instantiationService, disposables);
		const notebook = instantiateTestNotebookInstance([{
			source: 'map()',
			language: 'python',
			mime: undefined,
			cellKind: CellKind.Code,
			outputs: [{
				outputId: 'old-output',
				outputs: [complexHtmlOutputItem()],
			}],
		}], harness.instantiationService, disposables);

		harness.service.addRawHtmlOutput({
			instance: notebook,
			outputId: 'old-output',
			html: '<iframe src="https://example.com"></iframe>',
		});

		notebook.textModel!.applyEdits([{
			editType: CellEditType.Output,
			index: 0,
			outputs: [{
				outputId: 'new-output',
				outputs: [complexHtmlOutputItem()],
			}],
			append: false,
		}], true, undefined, () => undefined, undefined, false);
		await timeout(0);

		assert.strictEqual(harness.rawHtmlDisposeCount('old-output'), 1);
	});

	test('clearing outputs disposes stale raw HTML webviews', async () => {
		const harness = createPreloadServiceHarness(instantiationService, disposables);
		const notebook = instantiateTestNotebookInstance([{
			source: 'map()',
			language: 'python',
			mime: undefined,
			cellKind: CellKind.Code,
			outputs: [{
				outputId: 'clear-output',
				outputs: [complexHtmlOutputItem()],
			}],
		}], harness.instantiationService, disposables);

		harness.service.addRawHtmlOutput({
			instance: notebook,
			outputId: 'clear-output',
			html: '<iframe src="https://example.com"></iframe>',
		});

		const cell = notebook.cells.get()[0];
		notebook.clearCellOutput(cell);
		await timeout(0);

		assert.strictEqual(harness.rawHtmlDisposeCount('clear-output'), 1);
	});

	test('cell deletion disposes stale raw HTML webviews', async () => {
		const harness = createPreloadServiceHarness(instantiationService, disposables);
		const notebook = instantiateTestNotebookInstance([{
			source: 'map()',
			language: 'python',
			mime: undefined,
			cellKind: CellKind.Code,
			outputs: [{
				outputId: 'deleted-output',
				outputs: [complexHtmlOutputItem()],
			}],
		}], harness.instantiationService, disposables);

		harness.service.addRawHtmlOutput({
			instance: notebook,
			outputId: 'deleted-output',
			html: '<iframe src="https://example.com"></iframe>',
		});

		notebook.textModel!.applyEdits([{
			editType: CellEditType.Replace,
			index: 0,
			count: 1,
			cells: [],
		}], true, undefined, () => undefined, undefined, false);
		await timeout(0);

		assert.strictEqual(harness.rawHtmlDisposeCount('deleted-output'), 1);
	});

	test('widget outputs still reuse the cached webview path', async () => {
		const harness = createPreloadServiceHarness(instantiationService, disposables);
		const notebook = instantiateTestNotebookInstance(
			[['widget()', 'python', CellKind.Code]],
			harness.instantiationService,
			disposables
		);

		await startTestLanguageRuntimeSession(harness.instantiationService, disposables, {
			sessionMode: LanguageRuntimeSessionMode.Notebook,
			notebookUri: notebook.uri,
			sessionName: 'notebook-widget-session',
		});

		const first = harness.service.addNotebookOutput({
			instance: notebook,
			outputId: 'widget-output',
			outputs: [widgetOutputItem()],
		});
		const second = harness.service.addNotebookOutput({
			instance: notebook,
			outputId: 'widget-output',
			outputs: [widgetOutputItem()],
		});

		assert.ok(first);
		assert.ok(second);
		assert.strictEqual(first.preloadMessageType, 'widget');
		assert.strictEqual(second.preloadMessageType, 'widget');
		assert.strictEqual(first.webview, second.webview);
		assert.strictEqual(harness.widgetCreateCount(), 1);
		assert.strictEqual(harness.widgetDisposeCount('widget-output'), 0);
	});

});
