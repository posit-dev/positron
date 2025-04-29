/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as sinon from 'sinon';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { RuntimeCodeExecutionMode, RuntimeErrorBehavior, RuntimeState, LanguageRuntimeSessionMode } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { IPositronAssistantService, IPositronChatContext, IChatRequestData } from '../../common/interfaces/positronAssistantService.js';
import { PositronAssistantService } from '../../browser/positronAssistantService.js';
import { ChatAgentLocation } from '../../../chat/common/constants.js';
import { createRuntimeServices, createTestLanguageRuntimeMetadata, startTestLanguageRuntimeSession } from '../../../../services/runtimeSession/test/common/testRuntimeSessionService.js';
import { TestLanguageRuntimeSession, waitForRuntimeState } from '../../../../services/runtimeSession/test/common/testLanguageRuntimeSession.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IPositronVariablesService } from '../../../../services/positronVariables/common/interfaces/positronVariablesService.js';
import { TestPositronVariablesService } from '../../../../services/positronVariables/test/common/testPositronVariablesService.js';
import { IPositronConsoleService } from '../../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { TestPositronConsoleService } from '../../../../test/common/positronWorkbenchTestServices.js';
import { IPositronPlotsService } from '../../../../services/positronPlots/common/positronPlots.js';
import { TestPositronPlotsService } from '../../../../services/positronPlots/test/common/testPositronPlotsService.js';
// import { IExecutionHistoryService } from '../../../../services/positronHistory/common/executionHistoryService.js';
import { ExecutionHistoryService } from '../../../../services/positronHistory/common/executionHistory.js';

suite('PositronAssistantService', () => {
	const disposables = new DisposableStore();
	let instantiationService: TestInstantiationService;
	let positronAssistantService: IPositronAssistantService;
	let testSession: TestLanguageRuntimeSession;

	setup(async () => {
		instantiationService = new TestInstantiationService();

		// Set up the test runtime services
		instantiationService.stub(IPositronVariablesService, new TestPositronVariablesService());
		instantiationService.stub(IPositronConsoleService, new TestPositronConsoleService());
		instantiationService.stub(IPositronPlotsService, new TestPositronPlotsService());
		createRuntimeServices(instantiationService, disposables);
		instantiationService.createInstance(ExecutionHistoryService);

		// Create a test runtime session that will be used to execute code
		const runtime = createTestLanguageRuntimeMetadata(instantiationService, disposables);
		testSession = await startTestLanguageRuntimeSession(
			instantiationService,
			disposables,
			{
				runtime,
				sessionName: "Test Session",
				sessionMode: LanguageRuntimeSessionMode.Console,
				startReason: "Test"
			}
		);

		// Wait for the session to be ready
		await waitForRuntimeState(testSession, RuntimeState.Ready);

		// Create the service under test with all required services
		positronAssistantService = instantiationService.createInstance(PositronAssistantService);
	});

	teardown(() => {
		sinon.restore();
		ensureNoDisposablesAreLeakedInTestSuite();
		disposables.clear();
	});

	test('getPositronChatContext includes console executions in chat context', async () => {
		// Execute code in the test session
		const executionId1 = 'exec1';
		const executionId2 = 'exec2';

		// First execution: x <- 1 + 2
		console.log('KNKX: executing first code');
		testSession.execute('x <- 1 + 2', executionId1, RuntimeCodeExecutionMode.Interactive, RuntimeErrorBehavior.Stop);

		// Simulate input and output messages
		testSession.receiveInputMessage({
			id: executionId1,
			code: 'x <- 1 + 2',
			execution_count: 1
		});

		testSession.receiveStreamMessage({
			parent_id: executionId1,
			name: 'stdout',
			text: '3'
		});

		// Mark session as ready for next execution
		testSession.setRuntimeState(RuntimeState.Ready);

		// Second execution: sqrt(16)
		testSession.execute('sqrt(16)', executionId2, RuntimeCodeExecutionMode.Interactive, RuntimeErrorBehavior.Stop);

		// Simulate input and output messages
		testSession.receiveInputMessage({
			id: executionId2,
			code: 'sqrt(16)',
			execution_count: 2
		});

		testSession.receiveStreamMessage({
			parent_id: executionId2,
			name: 'stdout',
			text: '[1] 4'
		});

		// Mark session as ready again
		testSession.setRuntimeState(RuntimeState.Ready);

		// Create a chat request
		const chatRequest: IChatRequestData = {
			location: ChatAgentLocation.Panel
		};

		// Get the chat context
		const context: IPositronChatContext = positronAssistantService.getPositronChatContext(chatRequest);

		// Verify the console data is included in the context
		assert.ok(context.console, 'Console data should be present');
		assert.strictEqual(context.console?.executions.length, 2, 'Should have 2 executions');
		assert.strictEqual(context.console?.executions[0].input, 'x <- 1 + 2');
		assert.strictEqual(context.console?.executions[0].output, '3');
		assert.strictEqual(context.console?.executions[1].input, 'sqrt(16)');
		assert.strictEqual(context.console?.executions[1].output, '[1] 4');
	});

	test('getPositronChatContext handles console executions with errors', async () => {
		// Execute code in the test session
		const executionId1 = 'exec1';
		const executionId2 = 'exec2';

		// First execution: print("Hello, world!")
		testSession.execute('print("Hello, world!")', executionId1, RuntimeCodeExecutionMode.Interactive, RuntimeErrorBehavior.Stop);

		// Simulate input and output messages
		testSession.receiveInputMessage({
			id: executionId1,
			code: 'print("Hello, world!")',
			execution_count: 1
		});

		testSession.receiveStreamMessage({
			parent_id: executionId1,
			name: 'stdout',
			text: 'Hello, world!'
		});

		// Mark session as ready for next execution
		testSession.setRuntimeState(RuntimeState.Ready);

		// Second execution with error: undefined_variable
		testSession.execute('undefined_variable', executionId2, RuntimeCodeExecutionMode.Interactive, RuntimeErrorBehavior.Stop);

		// Simulate input message
		testSession.receiveInputMessage({
			id: executionId2,
			code: 'undefined_variable',
			execution_count: 2
		});

		// Simulate error message
		testSession.receiveErrorMessage({
			parent_id: executionId2,
			name: 'NameError',
			message: 'name "undefined_variable" is not defined',
			traceback: ['Traceback (most recent call last):', 'NameError: name "undefined_variable" is not defined']
		});

		// Mark session as ready again
		testSession.setRuntimeState(RuntimeState.Ready);

		// Create a chat request
		const chatRequest: IChatRequestData = {
			location: ChatAgentLocation.Editor
		};

		// Get the chat context
		const context: IPositronChatContext = positronAssistantService.getPositronChatContext(chatRequest);

		// Verify the executions are included in the context
		assert.ok(context.console, 'Console data should be present');
		assert.strictEqual(context.console?.executions.length, 2, 'Should have 2 executions');

		// Check first execution
		assert.strictEqual(context.console?.executions[0].input, 'print("Hello, world!")');
		assert.strictEqual(context.console?.executions[0].output, 'Hello, world!');

		// Check second execution with error
		assert.strictEqual(context.console?.executions[1].input, 'undefined_variable');
		assert.ok(context.console?.executions[1].error, 'Error should be present');
		assert.ok(context.console?.executions[1].error.includes('not defined'), 'Error message should mention variable is not defined');
	});

	test('getPositronChatContext with empty console history returns empty executions array', async () => {
		// Don't execute any code, which will result in an empty history

		// Create a chat request
		const chatRequest: IChatRequestData = {
			location: ChatAgentLocation.Panel
		};

		// Get the chat context
		const context: IPositronChatContext = positronAssistantService.getPositronChatContext(chatRequest);

		// Verify that an empty array is returned for executions
		assert.ok(context.console, 'Console data should be present');
		assert.strictEqual(context.console?.executions.length, 0, 'Should have 0 executions');
	});
});
