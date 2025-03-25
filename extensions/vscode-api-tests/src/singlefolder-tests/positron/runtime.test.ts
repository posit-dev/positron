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

	onDidReceiveRuntimeMessage: vscode.Event<positron.LanguageRuntimeMessage> = this._onDidReceiveRuntimeMessage.event;
	onDidChangeRuntimeState: vscode.Event<positron.RuntimeState> = this._onDidChangeRuntimeState.event;
	onDidEndSession: vscode.Event<positron.LanguageRuntimeExit> = this._onDidEndSession.event;

	readonly dynState = {
		inputPrompt: `T>`,
		continuationPrompt: 'T+',
	};

	constructor(
		readonly runtimeMetadata: positron.LanguageRuntimeMetadata,
		readonly metadata: positron.RuntimeSessionMetadata
	) { }

	execute(code: string, _id: string, _mode: positron.RuntimeCodeExecutionMode): void {
		// Simulate an error if the code is 'error'
		if (code === 'error') {
			this.executeError();
			return;
		}

		// Simulate starting with busy state
		this._onDidChangeRuntimeState.fire(positron.RuntimeState.Busy);

		// Simulate output
		this._onDidReceiveRuntimeMessage.fire({
			id: '1',
			parent_id: '',
			when: new Date().toISOString(),
			type: positron.LanguageRuntimeMessageType.Stream,
			name: positron.LanguageRuntimeStreamName.Stdout,
			text: `Output: ${code}`
		} as positron.LanguageRuntimeStream);

		// Simulate error output
		this._onDidReceiveRuntimeMessage.fire({
			id: '2',
			parent_id: '',
			when: new Date().toISOString(),
			type: positron.LanguageRuntimeMessageType.Stream,
			name: positron.LanguageRuntimeStreamName.Stderr,
			text: 'Warning message'
		} as positron.LanguageRuntimeStream);

		// Simulate result
		setTimeout(() => {
			this._onDidReceiveRuntimeMessage.fire({
				id: '3',
				parent_id: '',
				when: new Date().toISOString(),
				type: positron.LanguageRuntimeMessageType.Result,
				data: { 'text/plain': 'Test result' }
			} as positron.LanguageRuntimeResult);

			// Return to idle state
			this._onDidChangeRuntimeState.fire(positron.RuntimeState.Idle);
		}, 10);
	}

	executeError() {

		// Simulate starting with busy state
		this._onDidChangeRuntimeState.fire(positron.RuntimeState.Busy);

		// Simulate error
		this._onDidReceiveRuntimeMessage.fire({
			id: '1',
			parent_id: '',
			when: new Date().toISOString(),
			type: positron.LanguageRuntimeMessageType.Error,
			name: 'TestError',
			message: 'Test error occurred',
			traceback: ['Line 1', 'Line 2']
		} as positron.LanguageRuntimeError);

		// Return to idle state
		setTimeout(() => {
			this._onDidChangeRuntimeState.fire(positron.RuntimeState.Idle);
		}, 10);
	}

	async isCodeFragmentComplete(_code: string): Promise<positron.RuntimeCodeFragmentStatus> {
		throw new Error('Not implemented.');
	}

	async createClient(_id: string, _type: positron.RuntimeClientType, _params: any, _metadata?: any): Promise<void> {
		throw new Error('Not implemented.');
	}

	async listClients(_type?: positron.RuntimeClientType | undefined): Promise<Record<string, string>> {
		throw new Error('Not implemented.');
	}

	removeClient(_id: string): void {
		throw new Error('Not implemented.');
	}

	sendClientMessage(_client_id: string, _message_id: string, _message: any): void {
		throw new Error('Not implemented.');
	}

	replyToPrompt(_id: string, _reply: string): void {
		throw new Error('Not implemented.');
	}

	setWorkingDirectory(_dir: string): Promise<void> {
		throw new Error('Not implemented.');
	}

	async start(): Promise<positron.LanguageRuntimeInfo> {
		throw new Error('Not implemented.');
	}

	async interrupt(): Promise<void> {
		throw new Error('Not implemented.');
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

		// TODO: Unregistering a manager unregisters its runtimes, but doesn't remove them from
		//       the list returned by positron.runtime.getRegisteredRuntimes. Is that a bug?
		//       It also means that this test will currently fail if run out of order.
		// await poll(
		// 	getRegisteredRuntimes,
		// 	(runtimes) => runtimes.length === 0,
		// 	'test runtimes should be unregistered',
		// );
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
		const result = await positron.runtime.executeCode(
			'test',           // languageId
			'print("Hello")', // code
			false,            // focus
			false,            // allowIncomplete
			positron.RuntimeCodeExecutionMode.Interactive,
			positron.RuntimeErrorBehavior.Stop,
			observer
		);

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
		let failureError: any;

		// Create the observer that expects failure
		const observer: positron.runtime.ExecutionObserver = {
			onStarted: () => { },

			onFailed: (error: any) => {
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
});
