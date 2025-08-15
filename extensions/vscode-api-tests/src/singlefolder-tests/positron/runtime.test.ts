/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { assertNoRpcFromEntry, disposeAll, poll } from '../../utils';
import { Disposable } from 'vscode';
import assert = require('assert');

class TestLanguageRuntimeSession implements positron.LanguageRuntimeSession {
	private readonly _onDidReceiveRuntimeMessage = new vscode.EventEmitter<positron.LanguageRuntimeMessage>();
	private readonly _onDidChangeRuntimeState = new vscode.EventEmitter<positron.RuntimeState>();
	private readonly _onDidEndSession = new vscode.EventEmitter<positron.LanguageRuntimeExit>();
	static messageId = 0;
	private _executingCode: string | undefined;
	private _executionCount = 0;
	private _currentExecutionId = '';
	private _variables: Map<string, any> = new Map();
	private _runtimeInfo: positron.LanguageRuntimeInfo | undefined;

	onDidReceiveRuntimeMessage: vscode.Event<positron.LanguageRuntimeMessage> = this._onDidReceiveRuntimeMessage.event;
	onDidChangeRuntimeState: vscode.Event<positron.RuntimeState> = this._onDidChangeRuntimeState.event;
	onDidEndSession: vscode.Event<positron.LanguageRuntimeExit> = this._onDidEndSession.event;
	dynState: positron.LanguageRuntimeDynState;

	constructor(
		readonly runtimeMetadata: positron.LanguageRuntimeMetadata,
		readonly metadata: positron.RuntimeSessionMetadata
	) {
		this.dynState = {
			sessionName: this.runtimeMetadata.runtimeName,
			inputPrompt: 'T>',
			continuationPrompt: 'T+',
		};
	}

	get runtimeInfo(): positron.LanguageRuntimeInfo | undefined {
		return this._runtimeInfo;
	}

	generateMessageId(): string {
		return `msg-${TestLanguageRuntimeSession.messageId++}`;
	}

	execute(code: string, id: string, _mode: positron.RuntimeCodeExecutionMode): void {
		this._currentExecutionId = id;
		this._executingCode = code;

		// Emit the busy message
		this._onDidReceiveRuntimeMessage.fire({
			id: this.generateMessageId(),
			parent_id: id,
			when: new Date().toISOString(),
			type: positron.LanguageRuntimeMessageType.State,
			state: positron.RuntimeOnlineState.Busy,
		} as positron.LanguageRuntimeState);

		// Simulate starting with busy state
		this._onDidChangeRuntimeState.fire(positron.RuntimeState.Busy);

		// Acknowledge the input
		this._onDidReceiveRuntimeMessage.fire({
			id: this.generateMessageId(),
			parent_id: id,
			when: new Date().toISOString(),
			type: positron.LanguageRuntimeMessageType.Input,
			code,
			execution_count: ++this._executionCount,
		} as positron.LanguageRuntimeInput);

		// Simulate an error if the code is 'error'
		if (code === 'error') {
			this.executeError(id);
			return;
		}

		// Parse variable assignment if the code looks like 'set variable name = value'
		const variableMatch = code.match(/^set\s+variable\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+)$/);
		if (variableMatch) {
			const varName = variableMatch[1];
			const varValue = variableMatch[2].trim();

			// Store the variable value
			this._variables.set(varName, varValue);

			// Simulate output acknowledging the variable creation
			this._onDidReceiveRuntimeMessage.fire({
				id: this.generateMessageId(),
				parent_id: id,
				when: new Date().toISOString(),
				type: positron.LanguageRuntimeMessageType.Stream,
				name: positron.LanguageRuntimeStreamName.Stdout,
				text: `Variable '${varName}' set to ${varValue}`
			} as positron.LanguageRuntimeStream);

			// Simulate result
			setTimeout(() => {
				this._onDidReceiveRuntimeMessage.fire({
					id: this.generateMessageId(),
					parent_id: id,
					when: new Date().toISOString(),
					type: positron.LanguageRuntimeMessageType.Result,
					data: { 'text/plain': `${varName} = ${varValue}` }
				} as positron.LanguageRuntimeResult);
				this.returnToIdle(id);
			}, 10);

			return;
		}

		// Simulate output
		this._onDidReceiveRuntimeMessage.fire({
			id: this.generateMessageId(),
			parent_id: id,
			when: new Date().toISOString(),
			type: positron.LanguageRuntimeMessageType.Stream,
			name: positron.LanguageRuntimeStreamName.Stdout,
			text: `Output: ${code}`
		} as positron.LanguageRuntimeStream);

		// Simulate error output
		this._onDidReceiveRuntimeMessage.fire({
			id: this.generateMessageId(),
			parent_id: id,
			when: new Date().toISOString(),
			type: positron.LanguageRuntimeMessageType.Stream,
			name: positron.LanguageRuntimeStreamName.Stderr,
			text: 'Warning message'
		} as positron.LanguageRuntimeStream);

		// Simulate result
		setTimeout(() => {
			this._onDidReceiveRuntimeMessage.fire({
				id: this.generateMessageId(),
				parent_id: id,
				when: new Date().toISOString(),
				type: positron.LanguageRuntimeMessageType.Result,
				data: { 'text/plain': 'Test result' }
			} as positron.LanguageRuntimeResult);
			this.returnToIdle(id);
		},
			this.getSimulationMs(code));
	}

	/**
	 * Given a code string, return the simulated execution time in milliseconds.
	 *
	 * @param code The code to execute.
	 */
	getSimulationMs(code: string): number {
		switch (code) {
			case 'slow':
				return 10000;
			case 'uninterruptible':
				return 500;
			default:
				return 10;
		}
	}

	executeError(id: string) {

		// Simulate starting with busy state
		this._onDidChangeRuntimeState.fire(positron.RuntimeState.Busy);

		// Simulate error
		this._onDidReceiveRuntimeMessage.fire({
			id: this.generateMessageId(),
			parent_id: id,
			when: new Date().toISOString(),
			type: positron.LanguageRuntimeMessageType.Error,
			name: 'TestError',
			message: 'Test error occurred',
			traceback: ['Line 1', 'Line 2']
		} as positron.LanguageRuntimeError);

		// Return to idle state
		setTimeout(() => {
			this.returnToIdle(id);
		}, 10);
	}

	returnToIdle(id: string) {
		// Emit the idle message
		this._onDidReceiveRuntimeMessage.fire({
			id: this.generateMessageId(),
			parent_id: id,
			when: new Date().toISOString(),
			type: positron.LanguageRuntimeMessageType.State,
			state: positron.RuntimeOnlineState.Idle,
		} as positron.LanguageRuntimeState);

		// Update state
		this._onDidChangeRuntimeState.fire(positron.RuntimeState.Idle);

		// No more current execution
		this._currentExecutionId = '';
	}

	async debug(_content: positron.DebugProtocolRequest, _id: string): Promise<positron.DebugProtocolResponse> {
		throw new Error('Not implemented.');
	}

	async isCodeFragmentComplete(_code: string): Promise<positron.RuntimeCodeFragmentStatus> {
		return Promise.resolve(positron.RuntimeCodeFragmentStatus.Complete);
	}

	async createClient(clientId: string, type: positron.RuntimeClientType, _params: any, _metadata?: any): Promise<void> {
		// If this is a variables client, handle variable requests
		if (type === positron.RuntimeClientType.Variables) {
			// Initialize with variables if we have any
			if (this._variables.size > 0) {
				// Create message to send initial variables
				const variables: positron.RuntimeVariable[] = [];
				const messageId = this.generateMessageId();

				for (const [name, value] of this._variables.entries()) {
					variables.push({
						access_key: name,
						display_name: name,
						display_value: String(value),
						display_type: 'string',
						type_info: 'string',
						length: String(value).length,
						size: String(value).length,
						has_children: false
					});
				}

				// Send a comm message with the variables
				setTimeout(() => {
					this._onDidReceiveRuntimeMessage.fire({
						id: messageId,
						parent_id: '',
						when: new Date().toISOString(),
						type: positron.LanguageRuntimeMessageType.CommData,
						comm_id: clientId,
						data: {
							jsonrpc: '2.0',
							method: 'refresh',
							params: {
								variables: variables,
								length: variables.length,
								version: 0
							}
						}
					} as positron.LanguageRuntimeCommMessage);
				}, 10);
			}
		}
		return Promise.resolve();
	}

	async listClients(_type?: positron.RuntimeClientType | undefined): Promise<Record<string, string>> {
		return Promise.resolve({});
	}

	removeClient(_id: string): void {
		return;
	}

	sendClientMessage(client_id: string, message_id: string, message: any): void {
		// Handle variable-specific requests
		if (message && message.method === 'list') {
			// Return list of all variables
			const variables: positron.RuntimeVariable[] = [];

			for (const [name, value] of this._variables.entries()) {
				variables.push({
					access_key: name,
					display_name: name,
					display_value: String(value),
					display_type: 'string',
					type_info: 'string',
					length: String(value).length,
					size: String(value).length,
					has_children: false
				});
			}

			// Send response
			this._onDidReceiveRuntimeMessage.fire({
				id: this.generateMessageId(),
				parent_id: message_id,
				when: new Date().toISOString(),
				type: positron.LanguageRuntimeMessageType.CommData,
				comm_id: client_id,
				data: {
					jsonrpc: '2.0',
					result: {
						variables: variables,
						length: variables.length,
						version: 0
					},
					id: message_id
				}
			} as positron.LanguageRuntimeCommMessage);
		} else if (message && message.method === 'inspect') {
			// Inspect specific variable(s)
			const path = message.params?.path;
			if (path && Array.isArray(path)) {
				// Find the variable at the specified path
				const varName = path[0];
				const value = this._variables.get(varName);

				if (value !== undefined) {
					// Send response with empty children since we don't have nested variables in this test
					this._onDidReceiveRuntimeMessage.fire({
						id: this.generateMessageId(),
						parent_id: message_id,
						when: new Date().toISOString(),
						type: positron.LanguageRuntimeMessageType.CommData,
						comm_id: client_id,
						data: {
							jsonrpc: '2.0',
							result: {
								children: [],
								length: 0
							},
							id: message_id
						}
					} as positron.LanguageRuntimeCommMessage);
				} else {
					// Variable not found
					this._onDidReceiveRuntimeMessage.fire({
						id: this.generateMessageId(),
						parent_id: message_id,
						when: new Date().toISOString(),
						type: positron.LanguageRuntimeMessageType.CommData,
						comm_id: client_id,
						data: {
							jsonrpc: '2.0',
							error: {
								code: -32602, // Invalid params code
								message: `Can't inspect; variable not found: ${path.join('.')}`
							},
							id: message_id
						}
					} as positron.LanguageRuntimeCommMessage);
				}
			}
		}
	}

	replyToPrompt(_id: string, _reply: string): void {
		throw new Error('Not implemented.');
	}

	setWorkingDirectory(_dir: string): Promise<void> {
		throw new Error('Not implemented.');
	}

	async start(): Promise<positron.LanguageRuntimeInfo> {
		this._onDidChangeRuntimeState.fire(positron.RuntimeState.Starting);
		this._runtimeInfo = {
			banner: 'Test runtime',
			implementation_version: '0.0.1',
			language_version: '0.0.1',
			continuation_prompt: this.dynState.continuationPrompt,
			input_prompt: this.dynState.inputPrompt,
		};
		setTimeout(() => {
			this._onDidChangeRuntimeState.fire(positron.RuntimeState.Ready);
		}, 10);
		return this._runtimeInfo;
	}

	async interrupt(): Promise<void> {
		// Interrupt the code ... if it's not uninterruptible.
		if (this._executingCode !== 'uninterruptible') {
			this.returnToIdle(this._currentExecutionId);
		}
	}

	async restart(): Promise<void> {
		throw new Error('Not implemented.');
	}

	async shutdown(_exitReason: positron.RuntimeExitReason): Promise<void> {
		throw new Error('Not implemented.');
	}

	async forceQuit(): Promise<void> {
		throw new Error('Not implemented.');
	}

	dispose() {
	}

	updateSessionName(sessionName: string): void {
		// Update the dynamic state of the session
		this.dynState.sessionName = sessionName;
	}
}

function testLanguageRuntimeMetadata(): positron.LanguageRuntimeMetadata {
	const languageVersion = '0.0.1';
	const runtimeShortName = languageVersion;
	return {
		base64EncodedIconSvg: '',
		extraRuntimeData: {},
		languageId: 'test',
		languageName: 'Test',
		languageVersion,
		runtimeId: '00000000-0000-0000-0000-100000000000',
		runtimeName: `Test ${runtimeShortName}`,
		runtimePath: '/test',
		runtimeShortName,
		runtimeSource: 'Test',
		runtimeVersion: '0.0.1',
		sessionLocation: positron.LanguageRuntimeSessionLocation.Browser,
		startupBehavior: positron.LanguageRuntimeStartupBehavior.Implicit,
	};
}

class TestLanguageRuntimeManager implements positron.LanguageRuntimeManager {
	readonly onDidDiscoverRuntimeEmitter = new vscode.EventEmitter<positron.LanguageRuntimeMetadata>();

	onDidDiscoverRuntime = this.onDidDiscoverRuntimeEmitter.event;

	async* discoverAllRuntimes(): AsyncGenerator<positron.LanguageRuntimeMetadata> {
		yield testLanguageRuntimeMetadata();
	}

	async recommendedWorkspaceRuntime(): Promise<positron.LanguageRuntimeMetadata | undefined> {
		return undefined;
	}

	async createSession(
		runtimeMetadata: positron.LanguageRuntimeMetadata,
		sessionMetadata: positron.RuntimeSessionMetadata
	): Promise<positron.LanguageRuntimeSession> {
		return new TestLanguageRuntimeSession(runtimeMetadata, sessionMetadata);
	}
}

suite('positron API - runtime', () => {

	let disposables: Disposable[];
	setup(() => {
		disposables = [];
	});

	teardown(async function () {
		assertNoRpcFromEntry([positron, 'positron']);
		disposeAll(disposables);
	});

	test('register a runtime manager', async () => {
		const getRegisteredRuntimes = async () =>
			(await positron.runtime.getRegisteredRuntimes())
				.filter(runtime => runtime.languageId === 'test');

		assert.deepStrictEqual(
			await getRegisteredRuntimes(),
			[],
			'no test runtimes should be registered');

		// Register a manager.
		const manager = new TestLanguageRuntimeManager();
		const managerDisposable = positron.runtime.registerLanguageRuntimeManager('test', manager);

		// The manager's runtimes should eventually be registered.
		await poll(
			getRegisteredRuntimes,
			(runtimes) => runtimes.length > 0,
			'runtimes should be registered',
		);

		managerDisposable.dispose();

		await poll(
			getRegisteredRuntimes,
			(runtimes) => runtimes.length === 0,
			'test runtimes should be unregistered',
		);
	});

});

suite('positron API - executeCode', () => {
	let disposables: Disposable[];

	setup(() => {
		disposables = [];
	});

	teardown(async () => {
		assertNoRpcFromEntry([positron, 'positron']);
		disposeAll(disposables);
	});

	test('observer events fire correctly', async () => {
		// Setup a runtime manager and session
		const manager = new TestLanguageRuntimeManager();
		const managerDisposable = positron.runtime.registerLanguageRuntimeManager('test', manager);
		disposables.push(managerDisposable);

		// Wait for the runtime to be registered
		await poll(
			async () => (await positron.runtime.getRegisteredRuntimes())
				.filter(runtime => runtime.languageId === 'test'),
			runtimes => runtimes.length > 0,
			'test runtime should be registered'
		);

		// Test results tracking
		const observerEvents: string[] = [];
		let startCalled = false;
		let finishCalled = false;
		let outputText: string | undefined;
		let errorText: string | undefined;
		let completionResult: Record<string, any> | undefined;

		// Create the observer
		const observer: positron.runtime.ExecutionObserver = {
			onStarted: () => {
				startCalled = true;
				observerEvents.push('started');
			},

			onOutput: (message: string) => {
				outputText = message;
				observerEvents.push('output');
			},

			onError: (message: string) => {
				errorText = message;
				observerEvents.push('error');
			},

			onCompleted: (result: Record<string, any>) => {
				completionResult = result;
				observerEvents.push('completed');
			},

			onFinished: () => {
				finishCalled = true;
				observerEvents.push('finished');
			}
		};

		// Execute the code with our observer
		const result = await Promise.race([
			positron.runtime.executeCode(
				'test',           // languageId
				'print("Hello")', // code
				false,            // focus
				false,            // allowIncomplete
				positron.RuntimeCodeExecutionMode.Interactive,
				positron.RuntimeErrorBehavior.Stop,
				observer
			),
			new Promise<any>((_, reject) => {
				setTimeout(() => {
					reject(new Error('Execution timed out after 2 seconds'));
				}, 2000);
			})
		]);

		// Verify the execution produced a result
		assert.ok(result, 'executeCode should return a result object');

		// Verify that all expected observer callbacks were called
		assert.strictEqual(startCalled, true, 'onStarted should be called');
		assert.strictEqual(finishCalled, true, 'onFinished should be called');
		assert.ok(outputText, 'onOutput should be called with text');
		assert.ok(errorText, 'onError should be called with text');
		assert.ok(completionResult, 'onCompleted should be called with result');

		// Verify events were called in correct order
		assert.deepStrictEqual(
			observerEvents,
			['started', 'output', 'error', 'completed', 'finished'],
			'Observer events should be called in the expected order'
		);
	});

	test('executeCode handles errors correctly', async () => {
		// Setup a runtime manager and session
		const manager = new TestLanguageRuntimeManager();
		const managerDisposable = positron.runtime.registerLanguageRuntimeManager('test', manager);
		disposables.push(managerDisposable);

		// Wait for the runtime to be registered
		await poll(
			async () => (await positron.runtime.getRegisteredRuntimes())
				.filter(runtime => runtime.languageId === 'test'),
			runtimes => runtimes.length > 0,
			'test runtime should be registered'
		);


		// Observer tracking for failures
		let failureCalled = false;
		let failureError: Error | undefined;

		// Create the observer that expects failure
		const observer: positron.runtime.ExecutionObserver = {
			onStarted: () => { },

			onFailed: (error: Error) => {
				failureCalled = true;
				failureError = error;
			},

			onFinished: () => { }
		};

		// Execute the code with our observer
		try {
			await positron.runtime.executeCode(
				'test',
				'error',
				false,
				false,
				positron.RuntimeCodeExecutionMode.Interactive,
				positron.RuntimeErrorBehavior.Stop,
				observer
			);
		} catch (e) {
			// Expected to either throw or call onFailed
		}

		// Verify the failure handler was called
		assert.strictEqual(failureCalled, true, 'onFailed should be called');
		assert.ok(failureError, 'onFailed should receive an error object');
	});

	test('executeCode can be cancelled', async () => {
		// Tracks whether the finished event was called
		let finishedCalled = false;

		// Create a cancellation token source
		const tokenSource = new vscode.CancellationTokenSource();
		const token = tokenSource.token;

		// Create the observer that simulates cancellation
		const observer: positron.runtime.ExecutionObserver = {
			token,

			onStarted: () => {
				// Once the request has started, let it run for 50ms and then
				// cancel it
				setTimeout(() => {
					tokenSource.cancel();
				}, 50);
			},

			onFinished: () => {
				finishedCalled = true;
			}
		};

		// Execute the code with our observer. This code takes 10 seconds to
		// "execute" but has a timeout after 1 second, so it will only succeed
		// if cancelled.
		await Promise.race([
			positron.runtime.executeCode(
				'test',           // languageId
				'slow',           // code
				false,            // focus
				false,            // allowIncomplete
				positron.RuntimeCodeExecutionMode.Interactive,
				positron.RuntimeErrorBehavior.Stop,
				observer
			),
			new Promise<any>((_resolve, reject) => {
				// timeout after 1 second
				setTimeout(() => {
					reject(new Error('Execution timed out after 1 second'));
				}, 1000);
			})
		]);

		// Verify that the execution was "finished"
		assert.ok(finishedCalled, 'onFinished should be called');
	});

	test('observer completes even if interrupt does not', async () => {
		// Tracks whether the failed event was called
		let failedCalled = false;

		// Tracks the value returned from the computation
		let result = {};

		// Create a cancellation token source
		const tokenSource = new vscode.CancellationTokenSource();
		const token = tokenSource.token;

		// Create the observer that simulates cancellation
		const observer: positron.runtime.ExecutionObserver = {
			token,

			onStarted: () => {
				// Once the request has started, let it run for 10ms and then
				// cancel it
				setTimeout(() => {
					tokenSource.cancel();
				}, 50);
			},

			onFailed: (_err) => {
				failedCalled = true;
			},

			onCompleted: (data) => {
				result = data;
			}
		};

		// Run the "uninterruptible" command which can't be interrupted but
		// returns a value after 500ms
		try {
			await Promise.race([
				positron.runtime.executeCode(
					'test',             // languageId
					'uninterruptible',  // code
					false,              // focus
					false,              // allowIncomplete
					positron.RuntimeCodeExecutionMode.Interactive,
					positron.RuntimeErrorBehavior.Stop,
					observer
				),
				new Promise<any>((_resolve, reject) => {
					// timeout after 1 second -- we should never hit this since the
					// computation should finish in 500ms, but do it anyway to
					// guarantee the tests don't hang
					setTimeout(() => {
						reject(new Error('Execution timed out after 1 second'));
					}, 1000);
				})
			]);
		} catch (e) {
			// Expected; interrupting during code execution can throw if the
			// code is uninterruptible
		}

		// Verify that the execution errored due to being interrupted
		assert.ok(failedCalled, 'onFailed should be called');

		// Verify that we didn't get the result -- if we did, it means we waited
		// for the computation to finish instead of bailing when requested
		assert.deepStrictEqual(result, {}, 'No result should be returned');
	});

	test('executeCode fires events', async () => {
		let event: positron.CodeExecutionEvent | undefined;

		// Create an event handler
		disposables.push(
			positron.runtime.onDidExecuteCode((e) => {
				event = e;
			})
		);

		// Execute the code
		await positron.runtime.executeCode(
			'test',            // languageId
			'print("event")',  // code
			false,             // focus
			false,             // allowIncomplete
		);

		// Assert that the event matches the expected values
		assert.ok(event, 'Event should be fired');
		assert.strictEqual(event.languageId, 'test', 'Language ID should match');
		assert.strictEqual(event.code, 'print("event")', 'Code should match');
		assert.strictEqual(event.attribution.source, positron.CodeAttributionSource.Extension,
			'Correctly attributed to execution via an extension');
	});

	test('getSessionVariables returns correct variables', async () => {
		// Setup a runtime manager and session
		const manager = new TestLanguageRuntimeManager();
		const managerDisposable = positron.runtime.registerLanguageRuntimeManager('test', manager);
		disposables.push(managerDisposable);

		// Wait for the runtime to be registered
		await poll(
			async () => (await positron.runtime.getRegisteredRuntimes())
				.filter(runtime => runtime.languageId === 'test'),
			runtimes => runtimes.length > 0,
			'test runtime should be registered'
		);

		// Execute some code to create variables in the session
		await positron.runtime.executeCode(
			'test',
			'set variable x = 42',
			false,
			false,
			positron.RuntimeCodeExecutionMode.Interactive,
			positron.RuntimeErrorBehavior.Stop
		);

		// Execute second variable
		await positron.runtime.executeCode(
			'test',
			'set variable y = hello',
			false,
			false,
			positron.RuntimeCodeExecutionMode.Interactive,
			positron.RuntimeErrorBehavior.Stop
		);

		// Get the session ID from the active sessions
		const activeSessions = await positron.runtime.getActiveSessions();
		const testSession = activeSessions.find(s => s.runtimeMetadata.languageId === 'test');
		assert.ok(testSession, 'There should be one test session');

		const sessionId = testSession.metadata.sessionId;

		// Test getting all variables
		const allVars = await positron.runtime.getSessionVariables(sessionId);
		assert.ok(Array.isArray(allVars), 'Result should be an array');
		assert.ok(allVars.length > 0, 'There should be at least one variable returned');

		// Find our test variables
		const xVar = allVars.flat().find(v => v.display_name === 'x');
		assert.ok(xVar, 'Variable "x" should be in the session');
		assert.strictEqual(xVar?.display_value, '42', 'Variable "x" should have value "42"');

		const yVar = allVars.flat().find(v => v.display_name === 'y');
		assert.ok(yVar, 'Variable "y" should be in the session');
		assert.strictEqual(yVar?.display_value, 'hello', 'Variable "y" should have value "hello"');

		// Test getting multiple specific variables
		const multiVars = await positron.runtime.getSessionVariables(
			sessionId,
			[['x'], ['y']] // Access key paths for multiple variables
		);
		console.log('multiVars', multiVars);
		assert.ok(Array.isArray(multiVars), 'Result should be an array');
		assert.strictEqual(multiVars.length, 2, 'Result should contain two variable paths');
		assert.strictEqual(multiVars[0].length, 0, 'x symbol should be empty');
		assert.strictEqual(multiVars[1].length, 0, 'y symbol should be empty');

		// Test requesting a variable that doesn't exist
		try {
			await positron.runtime.getSessionVariables(
				sessionId,
				[['z']] // Access key that doesn't exist
			);
			assert.fail('Expected getSessionVariables to throw for non-existent variable');
		} catch (error) {
			// Expected behavior - getSessionVariables should throw when the variable doesn't exist
			assert.ok(error.message.includes('z'), 'Error should mention the missing variable name');
		}
	});
});
