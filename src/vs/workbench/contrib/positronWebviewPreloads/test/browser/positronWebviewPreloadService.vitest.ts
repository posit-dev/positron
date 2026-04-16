/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />


import { timeout } from '../../../../../base/common/async.js';
import { PositronWebviewPreloadService } from '../../browser/positronWebviewPreloadsService.js';
import { PositronTestServiceAccessor } from '../../../../test/browser/positronWorkbenchTestServices.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { RuntimeOutputKind } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { TestLanguageRuntimeSession } from '../../../../services/runtimeSession/test/common/testLanguageRuntimeSession.js';
import { startTestLanguageRuntimeSession } from '../../../../services/runtimeSession/test/common/testRuntimeSessionService.js';
import { NotebookMultiMessagePlotClient } from '../../../positronPlots/browser/notebookMultiMessagePlotClient.js';


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

describe('Positron - PositronWebviewPreloadService', () => {
	const ctx = createTestContainer().withWorkbenchServices().build();

	let positronWebviewPreloadService: PositronWebviewPreloadService;

	beforeEach(() => {
		const accessor = ctx.instantiationService.createInstance(PositronTestServiceAccessor);
		positronWebviewPreloadService = accessor.positronWebviewPreloadService;
	});

	async function createConsoleSession() {

		// Start a console session.
		const session = await startTestLanguageRuntimeSession(ctx.instantiationService, ctx.disposables);

		const out: {
			session: TestLanguageRuntimeSession;
			plotClient: NotebookMultiMessagePlotClient | undefined;
		} = {
			session, plotClient: undefined,
		};

		ctx.disposables.add(positronWebviewPreloadService.onDidCreatePlot(client => {
			out.plotClient = client;
		}));

		return out;
	}

	it('console session: dependency messages are absorbed without emitting plot', async () => {
		const consoleSession = await createConsoleSession();

		// Simulate the runtime sending an HoloViews output message.
		consoleSession.session.receiveOutputMessage(hvPreloadMessage);
		await timeout(0);

		// No plot should have been emitted.
		expect(consoleSession.plotClient).toBeFalsy();
		expect(positronWebviewPreloadService.sessionInfo(consoleSession.session.sessionId)?.numberOfMessages).toBe(1);

		// Send another preload message.
		consoleSession.session.receiveOutputMessage(bokehPreloadMessage);
		await timeout(0);
		expect(positronWebviewPreloadService.sessionInfo(consoleSession.session.sessionId)?.numberOfMessages).toBe(2);

		// End the session.
		consoleSession.session.endSession();
		await timeout(0);
	});

	it('console session: Service emits plot client after display message is received', async () => {
		const consoleSession = await createConsoleSession();

		// Send one preload message.
		consoleSession.session.receiveOutputMessage(hvPreloadMessage);
		await timeout(0);

		// Send a display message
		const displayMessageHv = consoleSession.session.receiveOutputMessage(hvDisplayMessage);
		await timeout(0);

		// Display message shouldnt have been absorbed into preload messages
		expect(positronWebviewPreloadService.sessionInfo(consoleSession.session.sessionId)?.numberOfMessages).toBe(1);

		// Plot client should have been emitted and it should be linked to the display message.
		expect(consoleSession.plotClient).toBeDefined();
		expect(consoleSession.plotClient!.id).toBe(displayMessageHv.id);

		// Emit a bokeh display message and another plot should be created
		const displayMessageBokeh = consoleSession.session.receiveOutputMessage(bokehDisplayMessage);
		await timeout(0);
		expect(consoleSession.plotClient!.id).toBe(displayMessageBokeh.id);

		// End the session.
		consoleSession.session.endSession();
		await timeout(0);
	});

});
