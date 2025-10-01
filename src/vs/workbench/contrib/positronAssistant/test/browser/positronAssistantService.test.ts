/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as sinon from 'sinon';
import { RuntimeState, LanguageRuntimeSessionMode } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { IPositronAssistantService, IPositronChatContext, IChatRequestData } from '../../common/interfaces/positronAssistantService.js';
import { PositronAssistantService } from '../../browser/positronAssistantService.js';
import { ChatAgentLocation } from '../../../chat/common/constants.js';
import { createRuntimeServices, createTestLanguageRuntimeMetadata, startTestLanguageRuntimeSession } from '../../../../services/runtimeSession/test/common/testRuntimeSessionService.js';
import { TestLanguageRuntimeSession, waitForRuntimeState } from '../../../../services/runtimeSession/test/common/testLanguageRuntimeSession.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IPositronVariablesService } from '../../../../services/positronVariables/common/interfaces/positronVariablesService.js';
import { TestPositronVariablesService } from '../../../../services/positronVariables/test/common/testPositronVariablesService.js';
import { IPositronPlotsService } from '../../../../services/positronPlots/common/positronPlots.js';
import { ExecutionHistoryService } from '../../../../services/positronHistory/common/executionHistory.js';
import { IRuntimeStartupService } from '../../../../services/runtimeStartup/common/runtimeStartupService.js';
import { TestRuntimeStartupService } from '../../../../services/runtimeStartup/test/common/testRuntimeStartupService.js';
import { IExecutionHistoryService } from '../../../../services/positronHistory/common/executionHistoryService.js';
import { createTestPlotsServiceWithPlots } from '../../../../services/positronPlots/test/common/testPlotsServiceHelper.js';
import { URI } from '../../../../../base/common/uri.js';
import { IPositronConsoleService } from '../../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { PositronConsoleService } from '../../../../services/positronConsole/browser/positronConsoleService.js';

suite('PositronAssistantService', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	let instantiationService: TestInstantiationService;
	let testVariablesService: TestPositronVariablesService;
	let positronAssistantService: IPositronAssistantService;
	let testConsoleSession: TestLanguageRuntimeSession;
	let testNotebookSession: TestLanguageRuntimeSession;

	setup(async () => {
		instantiationService = new TestInstantiationService();
		testVariablesService = new TestPositronVariablesService();

		// Set up the test runtime services
		instantiationService.stub(IPositronVariablesService, disposables.add(testVariablesService));
		instantiationService.stub(IPositronPlotsService, disposables.add(createTestPlotsServiceWithPlots()));
		instantiationService.stub(IRuntimeStartupService, new TestRuntimeStartupService());
		createRuntimeServices(instantiationService, disposables);
		instantiationService.stub(IExecutionHistoryService, disposables.add(instantiationService.createInstance(ExecutionHistoryService)));
		instantiationService.stub(IPositronConsoleService, disposables.add(instantiationService.createInstance(PositronConsoleService)));

		// Create test runtime sessions
		const runtime = createTestLanguageRuntimeMetadata(instantiationService, disposables);
		testConsoleSession = await startTestLanguageRuntimeSession(
			instantiationService,
			disposables,
			{
				runtime,
				sessionName: "Test Session",
				sessionMode: LanguageRuntimeSessionMode.Console,
				startReason: "Test"
			}
		);
		testNotebookSession = await startTestLanguageRuntimeSession(
			instantiationService,
			disposables,
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
		testVariablesService.createPositronVariablesInstance(testConsoleSession);
		testVariablesService.createPositronVariablesInstance(testNotebookSession);
		testVariablesService.setActivePositronVariablesSession(testConsoleSession.sessionId);

		// Create the service under test with all required services
		positronAssistantService = disposables.add(instantiationService.createInstance(PositronAssistantService));
	});

	teardown(() => {
		sinon.restore();
	});

	test('getPositronChatContext returns the global context properties', async () => {
		// Create a chat request
		const chatRequest: IChatRequestData = {
			location: ChatAgentLocation.Panel
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
			location: ChatAgentLocation.Panel
		};

		// Get the chat context
		const context: IPositronChatContext = positronAssistantService.getPositronChatContext(chatRequest);

		// Verify plot information is included
		assert.ok(context.plots, 'Plot information should be present');
		assert.strictEqual(typeof context.plots.hasPlots, 'boolean', 'hasPlots should be a boolean');
	});

});
