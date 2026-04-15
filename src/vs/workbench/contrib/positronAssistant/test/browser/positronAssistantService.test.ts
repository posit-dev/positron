/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as sinon from 'sinon';
import { RuntimeState, LanguageRuntimeSessionMode } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { IPositronAssistantService, IPositronChatContext, IChatRequestData } from '../../common/interfaces/positronAssistantService.js';
import { PositronAssistantService } from '../../browser/positronAssistantService.js';
import { ChatAgentLocation } from '../../../chat/common/constants.js';
import { createTestLanguageRuntimeMetadata, startTestLanguageRuntimeSession } from '../../../../services/runtimeSession/test/common/testRuntimeSessionService.js';
import { TestLanguageRuntimeSession, waitForRuntimeState } from '../../../../services/runtimeSession/test/common/testLanguageRuntimeSession.js';
import { IPositronVariablesService } from '../../../../services/positronVariables/common/interfaces/positronVariablesService.js';
import { TestPositronVariablesService } from '../../../../services/positronVariables/test/common/testPositronVariablesService.js';
import { IPositronPlotsService } from '../../../../services/positronPlots/common/positronPlots.js';
import { IRuntimeStartupService } from '../../../../services/runtimeStartup/common/runtimeStartupService.js';
import { TestRuntimeStartupService } from '../../../../services/runtimeStartup/test/common/testRuntimeStartupService.js';
import { createTestPlotsServiceWithPlots } from '../../../../services/positronPlots/test/common/testPlotsServiceHelper.js';
import { URI } from '../../../../../base/common/uri.js';
import { createTestContainer } from '../../../../../workbench/test/browser/positronTestContainer.js';

suite('PositronAssistantService', () => {
	const ctx = createTestContainer()
		.withRuntimeServices()
		.build();

	let testVariablesService: TestPositronVariablesService;
	let positronAssistantService: IPositronAssistantService;
	let testConsoleSession: TestLanguageRuntimeSession;
	let testNotebookSession: TestLanguageRuntimeSession;

	setup(async () => {
		// Create fresh mutable stubs per test to avoid state leakage
		ctx.instantiationService.stub(IRuntimeStartupService, new TestRuntimeStartupService());
		testVariablesService = new TestPositronVariablesService();

		// Stub services that need disposables or createInstance
		ctx.instantiationService.stub(IPositronVariablesService, ctx.disposables.add(testVariablesService));
		ctx.instantiationService.stub(IPositronPlotsService, ctx.disposables.add(createTestPlotsServiceWithPlots()));

		// Create test runtime sessions
		const runtime = createTestLanguageRuntimeMetadata(ctx.instantiationService, ctx.disposables);
		testConsoleSession = await startTestLanguageRuntimeSession(
			ctx.instantiationService,
			ctx.disposables,
			{
				runtime,
				sessionName: "Test Session",
				sessionMode: LanguageRuntimeSessionMode.Console,
				startReason: "Test"
			}
		);
		testNotebookSession = await startTestLanguageRuntimeSession(
			ctx.instantiationService,
			ctx.disposables,
			{
				runtime,
				sessionName: "Test Notebook Session",
				sessionMode: LanguageRuntimeSessionMode.Notebook,
				startReason: "Test",
				notebookUri: URI.file('/path/to/notebook.ipynb')
			}
		);

		// Wait for the sessions to be ready
		await Promise.all([
			waitForRuntimeState(testConsoleSession, RuntimeState.Ready),
			waitForRuntimeState(testNotebookSession, RuntimeState.Ready),
		]);

		// Create variables instances for each session and set the active session
		testVariablesService.createPositronVariablesInstance(testConsoleSession, true);
		testVariablesService.createPositronVariablesInstance(testNotebookSession);

		// Create the service under test with all required services
		positronAssistantService = ctx.disposables.add(ctx.instantiationService.createInstance(PositronAssistantService));
	});

	teardown(() => {
		sinon.restore();
	});

	test('getPositronChatContext returns the global context properties', async () => {
		// Create a chat request
		const chatRequest: IChatRequestData = {
			location: ChatAgentLocation.Chat
		};

		// Get the chat context
		const context: IPositronChatContext = positronAssistantService.getPositronChatContext(chatRequest);

		// Verify the global context properties are present
		assert.ok(context.currentDate, 'Current date should be present');
		assert.ok(context.plots, 'Plots information should be present');
		assert.ok(context.positronVersion, 'Positron version should be present');
	});

	test('getPositronChatContext handles plot information', async () => {
		// Create a chat request
		const chatRequest: IChatRequestData = {
			location: ChatAgentLocation.Chat
		};

		// Get the chat context
		const context: IPositronChatContext = positronAssistantService.getPositronChatContext(chatRequest);

		// Verify plot information is included
		assert.ok(context.plots, 'Plot information should be present');
		assert.strictEqual(typeof context.plots.hasPlots, 'boolean', 'hasPlots should be a boolean');
	});

});
