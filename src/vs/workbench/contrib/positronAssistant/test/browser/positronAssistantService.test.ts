/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as sinon from 'sinon';
import { RuntimeCodeExecutionMode, RuntimeErrorBehavior, RuntimeState, LanguageRuntimeSessionMode, RuntimeOnlineState, RuntimeOutputKind } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
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

	test('getPositronChatContext returns the active session context', async () => {
		// Create a chat request
		const chatRequest: IChatRequestData = {
			location: ChatAgentLocation.Panel
		};

		// Get the chat context
		const context: IPositronChatContext = positronAssistantService.getPositronChatContext(chatRequest);

		// Verify the console session is active
		assert.ok(context.activeSession, 'Session data should be present');
		assert.strictEqual(context.activeSession.identifier, testConsoleSession.sessionId, 'Console session should be active');

		// Make the notebook session active
		testVariablesService.setActivePositronVariablesSession(testNotebookSession.sessionId);

		// Get the chat context again
		const newContext: IPositronChatContext = positronAssistantService.getPositronChatContext(chatRequest);

		// Verify the notebook session is active
		assert.ok(newContext.activeSession, 'Session data should be present');
		assert.strictEqual(newContext.activeSession.identifier, testNotebookSession.sessionId, 'Notebook session should be active');
	});

	test('getPositronChatContext includes session executions in chat context', async () => {
		// Execute code in the test session
		const executionId1 = 'exec1';
		const executionId2 = 'exec2';

		// First execution: x <- 1 + 2

		// Simulate input and output messages
		testConsoleSession.receiveInputMessage({
			parent_id: executionId1,
			code: 'x <- 1 + 2',
			execution_count: 1
		});

		testConsoleSession.receiveStateMessage({
			parent_id: executionId1,
			state: RuntimeOnlineState.Busy
		});

		testConsoleSession.receiveOutputMessage({
			parent_id: executionId1,
			kind: RuntimeOutputKind.Text,
			data: {
				'text/plain': '3'
			},
		});

		testConsoleSession.receiveStateMessage({
			parent_id: executionId1,
			state: RuntimeOnlineState.Idle
		});

		// Second execution: sqrt(16)

		testConsoleSession.receiveInputMessage({
			parent_id: executionId2,
			code: 'sqrt(16)',
			execution_count: 2
		});

		testConsoleSession.receiveStateMessage({
			parent_id: executionId2,
			state: RuntimeOnlineState.Busy
		});

		testConsoleSession.receiveStreamMessage({
			parent_id: executionId2,
			name: 'stdout',
			text: '[1] 4'
		});

		testConsoleSession.receiveStateMessage({
			parent_id: executionId2,
			state: RuntimeOnlineState.Idle
		});

		// Create a chat request
		const chatRequest: IChatRequestData = {
			location: ChatAgentLocation.Panel
		};

		// Get the chat context
		const context: IPositronChatContext = positronAssistantService.getPositronChatContext(chatRequest);

		// Verify the session data is included in the context
		assert.ok(context.activeSession, 'Session data should be present');
		assert.strictEqual(context.activeSession?.executions.length, 2, 'Should have 2 executions');
		assert.strictEqual(context.activeSession?.executions[0].input, 'x <- 1 + 2');
		assert.strictEqual(context.activeSession?.executions[0].output, '3');
		assert.strictEqual(context.activeSession?.executions[1].input, 'sqrt(16)');
		assert.strictEqual(context.activeSession?.executions[1].output, '[1] 4');
	});

	test('getPositronChatContext handles session executions with errors', async () => {
		// Execute code in the test session
		const executionId1 = 'exec1';
		const executionId2 = 'exec2';

		// First execution: print("Hello, world!")
		testConsoleSession.receiveInputMessage({
			parent_id: executionId1,
			code: 'print("Hello, world!")',
			execution_count: 1
		});

		testConsoleSession.receiveStateMessage({
			parent_id: executionId1,
			state: RuntimeOnlineState.Busy
		});

		testConsoleSession.receiveStreamMessage({
			parent_id: executionId1,
			name: 'stdout',
			text: 'Hello, world!'
		});

		testConsoleSession.receiveStateMessage({
			parent_id: executionId1,
			state: RuntimeOnlineState.Idle
		});

		// Second execution with error: undefined_variable
		testConsoleSession.execute('undefined_variable', executionId2, RuntimeCodeExecutionMode.Interactive, RuntimeErrorBehavior.Stop);

		// Simulate input message
		testConsoleSession.receiveInputMessage({
			parent_id: executionId2,
			code: 'undefined_variable',
			execution_count: 2
		});

		testConsoleSession.receiveStateMessage({
			parent_id: executionId2,
			state: RuntimeOnlineState.Busy
		});

		// Simulate error message
		testConsoleSession.receiveErrorMessage({
			parent_id: executionId2,
			name: 'NameError',
			message: 'name "undefined_variable" is not defined',
			traceback: ['Traceback (most recent call last):', 'NameError: name "undefined_variable" is not defined']
		});

		testConsoleSession.receiveStateMessage({
			parent_id: executionId2,
			state: RuntimeOnlineState.Idle
		});

		// Create a chat request
		const chatRequest: IChatRequestData = {
			location: ChatAgentLocation.Editor
		};

		// Get the chat context
		const context: IPositronChatContext = positronAssistantService.getPositronChatContext(chatRequest);

		// Verify the executions are included in the context
		assert.ok(context.activeSession, 'Session data should be present');
		assert.strictEqual(context.activeSession?.executions.length, 2, 'Should have 2 executions');

		// Check first execution
		assert.strictEqual(context.activeSession?.executions[0].input, 'print("Hello, world!")');
		assert.strictEqual(context.activeSession?.executions[0].output, 'Hello, world!');

		// Check second execution with error
		assert.strictEqual(context.activeSession?.executions[1].input, 'undefined_variable');
		assert.ok(context.activeSession?.executions[1].error, 'Error should be present');
		assert.ok(JSON.stringify(context.activeSession?.executions[1].error).includes('not defined'), 'Error message should mention variable is not defined');
	});

	test('getPositronChatContext with empty session history returns empty executions array', async () => {
		// Don't execute any code, which will result in an empty history

		// Create a chat request
		const chatRequest: IChatRequestData = {
			location: ChatAgentLocation.Panel
		};

		// Get the chat context
		const context: IPositronChatContext = positronAssistantService.getPositronChatContext(chatRequest);

		// Verify that an empty array is returned for executions
		assert.ok(context.activeSession, 'Session data should be present');
		assert.strictEqual(context.activeSession?.executions.length, 0, 'Should have 0 executions');
	});
});
