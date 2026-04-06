/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
/// <reference types="vitest/globals" />

import * as sinon from 'sinon';
import { RuntimeState, LanguageRuntimeSessionMode } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { IPositronAssistantService, IPositronChatContext, IChatRequestData } from '../../common/interfaces/positronAssistantService.js';
import { PositronAssistantService } from '../../browser/positronAssistantService.js';
import { ChatAgentLocation } from '../../../chat/common/constants.js';
import { createRuntimeServices, createTestLanguageRuntimeMetadata, startTestLanguageRuntimeSession } from '../../../../services/runtimeSession/test/common/testRuntimeSessionService.js';
import { TestLanguageRuntimeSession, waitForRuntimeState } from '../../../../services/runtimeSession/test/common/testLanguageRuntimeSession.js';
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
import { createTestContainer } from '../../../../test/browser/positronTestContainer.js';

describe('PositronAssistantService', () => {
	const ctx = createTestContainer().withRuntimeServices().build();
	let instantiationService: TestInstantiationService;
	let testVariablesService: TestPositronVariablesService;
	let positronAssistantService: IPositronAssistantService;
	let testConsoleSession: TestLanguageRuntimeSession;
	let testNotebookSession: TestLanguageRuntimeSession;

	beforeEach(async () => {
		instantiationService = new TestInstantiationService();
		testVariablesService = new TestPositronVariablesService();

		// Set up the test runtime services
		instantiationService.stub(IPositronVariablesService, ctx.disposables.add(testVariablesService));
		instantiationService.stub(IPositronPlotsService, ctx.disposables.add(createTestPlotsServiceWithPlots()));
		instantiationService.stub(IRuntimeStartupService, new TestRuntimeStartupService());
		createRuntimeServices(instantiationService, ctx.disposables);
		instantiationService.stub(IExecutionHistoryService, ctx.disposables.add(instantiationService.createInstance(ExecutionHistoryService)));
		instantiationService.stub(IPositronConsoleService, ctx.disposables.add(instantiationService.createInstance(PositronConsoleService)));

		// Create test runtime sessions
		const runtime = createTestLanguageRuntimeMetadata(instantiationService, ctx.disposables);
		testConsoleSession = await startTestLanguageRuntimeSession(
			instantiationService,
			ctx.disposables,
			{
				runtime,
				sessionName: "Test Session",
				sessionMode: LanguageRuntimeSessionMode.Console,
				startReason: "Test"
			}
		);
		testNotebookSession = await startTestLanguageRuntimeSession(
			instantiationService,
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
		testVariablesService.createPositronVariablesInstance(testConsoleSession);
		testVariablesService.createPositronVariablesInstance(testNotebookSession);
		testVariablesService.setActivePositronVariablesSession(testConsoleSession.sessionId);

		// Create the service under test with all required services
		positronAssistantService = ctx.disposables.add(instantiationService.createInstance(PositronAssistantService));
	});

	afterEach(() => {
		sinon.restore();
	});

	it('getPositronChatContext returns the global context properties', async () => {
		// Create a chat request
		const chatRequest: IChatRequestData = {
			location: ChatAgentLocation.Chat
		};

		// Get the chat context
		const context: IPositronChatContext = positronAssistantService.getPositronChatContext(chatRequest);

		// Verify the global context properties are present
		expect(context.currentDate).toBeTruthy();
		expect(context.plots).toBeTruthy();
		expect(context.positronVersion).toBeTruthy();
	});

	it('getPositronChatContext handles plot information', async () => {
		// Create a chat request
		const chatRequest: IChatRequestData = {
			location: ChatAgentLocation.Chat
		};

		// Get the chat context
		const context: IPositronChatContext = positronAssistantService.getPositronChatContext(chatRequest);

		// Verify plot information is included
		expect(context.plots).toBeTruthy();
		expect(typeof context.plots.hasPlots).toBe('boolean');
	});
});
