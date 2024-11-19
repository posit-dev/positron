/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'assert';
import { timeout } from '../../../../../base/common/async.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { NotebookRendererMessagingService } from '../../../notebook/browser/services/notebookRendererMessagingServiceImpl.js';
import { INotebookRendererMessagingService } from '../../../notebook/common/notebookRendererMessagingService.js';
import { INotebookService } from '../../../notebook/common/notebookService.js';
import { PositronWebviewPreloadService } from '../../browser/positronWebviewPreloadsService.js';
import { TestNotebookService } from '../../../positronIPyWidgets/test/browser/positronIPyWidgetsService.test.js';
import { IPositronNotebookOutputWebviewService } from '../../../positronOutputWebview/browser/notebookOutputWebviewService.js';
import { PositronNotebookOutputWebviewService } from '../../../positronOutputWebview/browser/notebookOutputWebviewServiceImpl.js';
import { WebviewPlotClient } from '../../../positronPlots/browser/webviewPlotClient.js';
import { IWebviewService } from '../../../webview/browser/webview.js';
import { WebviewService } from '../../../webview/browser/webviewService.js';
import { LanguageRuntimeSessionMode, RuntimeOutputKind } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { TestLanguageRuntimeSession } from '../../../../services/runtimeSession/test/common/testLanguageRuntimeSession.js';
import { TestRuntimeSessionService } from '../../../../services/runtimeSession/test/common/testRuntimeSessionService.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';


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

suite('Positron - PositronWebviewPreloadService', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	let positronWebviewPreloadService: PositronWebviewPreloadService;
	let runtimeSessionService: TestRuntimeSessionService;

	setup(() => {
		const instantiationService = workbenchInstantiationService(undefined, disposables);
		instantiationService.stub(INotebookRendererMessagingService, disposables.add(instantiationService.createInstance(NotebookRendererMessagingService)));
		instantiationService.stub(INotebookService, new TestNotebookService());
		instantiationService.stub(IWebviewService, disposables.add(new WebviewService(instantiationService)));
		instantiationService.stub(IPositronNotebookOutputWebviewService, instantiationService.createInstance(PositronNotebookOutputWebviewService));
		runtimeSessionService = disposables.add(new TestRuntimeSessionService());
		instantiationService.stub(IRuntimeSessionService, runtimeSessionService);
		positronWebviewPreloadService = disposables.add(instantiationService.createInstance(PositronWebviewPreloadService));
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

});
