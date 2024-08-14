/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'assert';
import { timeout } from 'vs/base/common/async';
import { ensureNoDisposablesAreLeakedInTestSuite } from 'vs/base/test/common/utils';
import { ExtensionIdentifier } from 'vs/platform/extensions/common/extensions';
import { INotebookEditorService } from 'vs/workbench/contrib/notebook/browser/services/notebookEditorService';
import { NotebookEditorWidgetService } from 'vs/workbench/contrib/notebook/browser/services/notebookEditorServiceImpl';
import { NotebookRendererMessagingService } from 'vs/workbench/contrib/notebook/browser/services/notebookRendererMessagingServiceImpl';
import { INotebookRendererInfo, INotebookStaticPreloadInfo } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { NotebookOutputRendererInfo } from 'vs/workbench/contrib/notebook/common/notebookOutputRenderer';
import { INotebookRendererMessagingService } from 'vs/workbench/contrib/notebook/common/notebookRendererMessagingService';
import { INotebookService } from 'vs/workbench/contrib/notebook/common/notebookService';
import { PositronHoloViewsService } from 'vs/workbench/contrib/positronHoloViews/browser/positronHoloViewsService';
import { IPositronNotebookOutputWebviewService } from 'vs/workbench/contrib/positronOutputWebview/browser/notebookOutputWebviewService';
import { PositronNotebookOutputWebviewService } from 'vs/workbench/contrib/positronOutputWebview/browser/notebookOutputWebviewServiceImpl';
import { WebviewPlotClient } from 'vs/workbench/contrib/positronPlots/browser/webviewPlotClient';
import { IWebviewService } from 'vs/workbench/contrib/webview/browser/webview';
import { WebviewService } from 'vs/workbench/contrib/webview/browser/webviewService';
import { LanguageRuntimeSessionMode, RuntimeOutputKind } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IRuntimeSessionService } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';
import { TestLanguageRuntimeSession } from 'vs/workbench/services/runtimeSession/test/common/testLanguageRuntimeSession';
import { TestRuntimeSessionService } from 'vs/workbench/services/runtimeSession/test/common/testRuntimeSessionService';
import { workbenchInstantiationService } from 'vs/workbench/test/browser/workbenchTestServices';

class TestNotebookService implements Partial<INotebookService> {
	getRenderers(): INotebookRendererInfo[] {
		return [];
	}

	getPreferredRenderer(_mimeType: string): NotebookOutputRendererInfo | undefined {
		// Doesn't matter what the renderer is, just that it exists.
		return <NotebookOutputRendererInfo>{
			id: 'positron-ipywidgets',
			extensionId: new ExtensionIdentifier('vscode.positron-ipywidgets'),
		};
	}

	*getStaticPreloads(_viewType: string): Iterable<INotebookStaticPreloadInfo> {
		// Yield nothing.
	}
}

const hvPreloadMessage1 = {
	kind: RuntimeOutputKind.HoloViews,
	data: {
		'application/vnd.holoviews_load.v0+json': {},
	},
};

const hvPreloadMessage2 = {
	kind: RuntimeOutputKind.HoloViews,
	data: {
		'application/vnd.holoviews_load.v0+json': 'bar',
		'text/html': '<div></div>',
	},
};

const hvDisplayMessage = {
	kind: RuntimeOutputKind.HoloViews,
	data: {
		"application/vnd.holoviews_exec.v0+json": '',
		'text/html': '<div></div>',
		'text/plain': 'hello',
	},
};

suite('Positron - PositronHoloViewsService', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	let positronHoloViewsService: PositronHoloViewsService;
	let runtimeSessionService: TestRuntimeSessionService;
	let notebookEditorService: INotebookEditorService;

	setup(() => {
		const instantiationService = workbenchInstantiationService(undefined, disposables);
		instantiationService.stub(INotebookRendererMessagingService, disposables.add(instantiationService.createInstance(NotebookRendererMessagingService)));
		notebookEditorService = disposables.add(instantiationService.createInstance(NotebookEditorWidgetService));
		instantiationService.stub(INotebookEditorService, notebookEditorService);
		instantiationService.stub(INotebookService, new TestNotebookService());
		instantiationService.stub(IWebviewService, disposables.add(new WebviewService(instantiationService)));
		instantiationService.stub(IPositronNotebookOutputWebviewService, instantiationService.createInstance(PositronNotebookOutputWebviewService));
		runtimeSessionService = disposables.add(new TestRuntimeSessionService());
		instantiationService.stub(IRuntimeSessionService, runtimeSessionService);
		positronHoloViewsService = disposables.add(instantiationService.createInstance(PositronHoloViewsService));
	});

	async function createConsoleSession() {

		// Start a console session.
		const session = disposables.add(new TestLanguageRuntimeSession(LanguageRuntimeSessionMode.Console));
		runtimeSessionService.startSession(session);

		await timeout(0);

		const out: {
			session: TestLanguageRuntimeSession;
			plotClient: WebviewPlotClient | undefined;
		} = {
			session, plotClient: undefined,
		};

		disposables.add(positronHoloViewsService.onDidCreatePlot(client => {
			out.plotClient = client;
		}));

		return out;
	}

	test('console session: dependency messages are absorbed without emitting plot', async () => {
		const consoleSession = await createConsoleSession();

		// Simulate the runtime sending an HoloViews output message.
		consoleSession.session.receiveOutputMessage(hvPreloadMessage1);
		await timeout(0);

		// No plot should have been emitted.
		assert(!Boolean(consoleSession.plotClient));
		assert.equal(positronHoloViewsService.sessionInfo(consoleSession.session.sessionId)?.numberOfMessages, 1);

		// Send another preload message.
		consoleSession.session.receiveOutputMessage(hvPreloadMessage2);
		await timeout(0);
		assert.equal(positronHoloViewsService.sessionInfo(consoleSession.session.sessionId)?.numberOfMessages, 2);

		// End the session.
		consoleSession.session.endSession();
		await timeout(0);
	});

	test('console session: Service emits plot client after display message is received', async () => {
		const consoleSession = await createConsoleSession();

		// Send one preload message.
		consoleSession.session.receiveOutputMessage(hvPreloadMessage1);
		await timeout(0);

		// Send a display message
		const displayMessage = consoleSession.session.receiveOutputMessage(hvDisplayMessage);
		await timeout(0);

		// Display message shouldnt have been absorbed into preload messages
		assert.equal(positronHoloViewsService.sessionInfo(consoleSession.session.sessionId)?.numberOfMessages, 1);

		// Plot client should have been emitted and it should be linked to the display message.
		assert(Boolean(consoleSession.plotClient));
		assert.strictEqual(consoleSession.plotClient!.id, displayMessage.id);

		// End the session.
		consoleSession.session.endSession();
		await timeout(0);
	});

});
