/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { assertNoRpcFromEntry, disposeAll, poll } from '../../utils';
import { Disposable } from 'vscode';
import assert = require('assert');

/**
 * Test Language Runtime Session for tracking execution
 */
class TestLanguageRuntimeSession implements positron.LanguageRuntimeSession {
	private readonly _onDidReceiveRuntimeMessage = new vscode.EventEmitter<positron.LanguageRuntimeMessage>();
	private readonly _onDidChangeRuntimeState = new vscode.EventEmitter<positron.RuntimeState>();
	private readonly _onDidEndSession = new vscode.EventEmitter<positron.LanguageRuntimeExit>();
	private readonly _onDidUpdateResourceUsage = new vscode.EventEmitter<positron.RuntimeResourceUsage>();
	static messageId = 0;

	// Track executed code for test verification
	public executedCode: { code: string; id: string }[] = [];

	onDidReceiveRuntimeMessage: vscode.Event<positron.LanguageRuntimeMessage> = this._onDidReceiveRuntimeMessage.event;
	onDidChangeRuntimeState: vscode.Event<positron.RuntimeState> = this._onDidChangeRuntimeState.event;
	onDidEndSession: vscode.Event<positron.LanguageRuntimeExit> = this._onDidEndSession.event;
	onDidUpdateResourceUsage: vscode.Event<positron.RuntimeResourceUsage> = this._onDidUpdateResourceUsage.event;
	dynState: positron.LanguageRuntimeDynState;
	private _runtimeInfo: positron.LanguageRuntimeInfo | undefined;

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

	getDynState(): Promise<positron.LanguageRuntimeDynState> {
		return Promise.resolve(this.dynState);
	}

	generateMessageId(): string {
		return `msg-${TestLanguageRuntimeSession.messageId++}`;
	}

	execute(code: string, id: string, _mode: positron.RuntimeCodeExecutionMode): void {
		// Track the execution
		this.executedCode.push({ code, id });

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
			execution_count: this.executedCode.length,
		} as positron.LanguageRuntimeInput);

		// Simulate output
		this._onDidReceiveRuntimeMessage.fire({
			id: this.generateMessageId(),
			parent_id: id,
			when: new Date().toISOString(),
			type: positron.LanguageRuntimeMessageType.Stream,
			name: positron.LanguageRuntimeStreamName.Stdout,
			text: `Output: ${code}`
		} as positron.LanguageRuntimeStream);

		// Return to idle after a short delay
		setTimeout(() => {
			this._onDidReceiveRuntimeMessage.fire({
				id: this.generateMessageId(),
				parent_id: id,
				when: new Date().toISOString(),
				type: positron.LanguageRuntimeMessageType.State,
				state: positron.RuntimeOnlineState.Idle,
			} as positron.LanguageRuntimeState);

			this._onDidChangeRuntimeState.fire(positron.RuntimeState.Idle);
		}, 10);
	}

	async debug(_content: positron.DebugProtocolRequest): Promise<positron.DebugProtocolResponse> {
		throw new Error('Not implemented.');
	}

	async isCodeFragmentComplete(_code: string): Promise<positron.RuntimeCodeFragmentStatus> {
		return positron.RuntimeCodeFragmentStatus.Complete;
	}

	async createClient(_clientId: string, _type: positron.RuntimeClientType, _params: any, _metadata?: any): Promise<void> {
		return Promise.resolve();
	}

	async listClients(_type?: positron.RuntimeClientType): Promise<Record<string, string>> {
		return Promise.resolve({});
	}

	removeClient(_id: string): void { }

	sendClientMessage(_client_id: string, _message_id: string, _message: any): void { }

	replyToPrompt(_id: string, _reply: string): void { }

	setWorkingDirectory(_dir: string): Promise<void> {
		throw new Error('Not implemented.');
	}

	async start(): Promise<positron.LanguageRuntimeInfo> {
		this._onDidChangeRuntimeState.fire(positron.RuntimeState.Starting);
		this._runtimeInfo = {
			banner: 'Test runtime for Quarto',
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

	async interrupt(): Promise<void> { }

	async restart(): Promise<void> { }

	async shutdown(_exitReason: positron.RuntimeExitReason): Promise<void> { }

	async forceQuit(): Promise<void> { }

	dispose() { }

	updateSessionName(sessionName: string): void {
		this.dynState.sessionName = sessionName;
	}
}

/**
 * Test Language Runtime Manager that tracks created sessions
 */
class TestLanguageRuntimeManager implements positron.LanguageRuntimeManager {
	readonly onDidDiscoverRuntimeEmitter = new vscode.EventEmitter<positron.LanguageRuntimeMetadata>();
	onDidDiscoverRuntime = this.onDidDiscoverRuntimeEmitter.event;

	// Track created sessions for test verification
	public createdSessions: TestLanguageRuntimeSession[] = [];

	private readonly _metadata: positron.LanguageRuntimeMetadata;

	constructor() {
		const languageVersion = '0.0.1';
		const runtimeShortName = languageVersion;
		this._metadata = {
			base64EncodedIconSvg: '',
			extraRuntimeData: {},
			languageId: 'test',
			languageName: 'Test',
			languageVersion,
			runtimeId: '00000000-0000-0000-0000-200000000000',
			runtimeName: `Test Quarto ${runtimeShortName}`,
			runtimePath: '/test-quarto',
			runtimeShortName,
			runtimeSource: 'Test',
			runtimeVersion: '0.0.1',
			sessionLocation: positron.LanguageRuntimeSessionLocation.Browser,
			startupBehavior: positron.LanguageRuntimeStartupBehavior.Implicit,
		};
	}

	async* discoverAllRuntimes(): AsyncGenerator<positron.LanguageRuntimeMetadata> {
		yield this._metadata;
	}

	async recommendedWorkspaceRuntime(): Promise<positron.LanguageRuntimeMetadata | undefined> {
		return undefined;
	}

	async createSession(
		runtimeMetadata: positron.LanguageRuntimeMetadata,
		sessionMetadata: positron.RuntimeSessionMetadata
	): Promise<positron.LanguageRuntimeSession> {
		const session = new TestLanguageRuntimeSession(runtimeMetadata, sessionMetadata);
		this.createdSessions.push(session);
		return session;
	}

	getLastSession(): TestLanguageRuntimeSession | undefined {
		return this.createdSessions[this.createdSessions.length - 1];
	}
}

/**
 * Tests for the positron.runtime.executeInlineCell API.
 *
 * This API is used to execute code cells inline in Quarto documents (e.g., .qmd files).
 * The code is executed in a language runtime session matching the cell's language.
 */
suite('positron API - executeInlineCell', () => {
	let disposables: Disposable[];

	setup(() => {
		disposables = [];
	});

	teardown(async () => {
		// Close all editors to clean up test state
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		assertNoRpcFromEntry([positron, 'positron']);
		disposeAll(disposables);
	});

	test('executeInlineCell API exists and is callable', async () => {
		// Verify the API exists on the runtime namespace
		assert.ok(positron.runtime.executeInlineCell, 'executeInlineCell API should exist');
		assert.strictEqual(typeof positron.runtime.executeInlineCell, 'function', 'executeInlineCell should be a function');
	});

	test('executeInlineCell with empty ranges completes without error', async () => {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		assert.ok(workspaceFolders && workspaceFolders.length > 0, 'Should have a workspace folder');

		// Use existing simple.qmd test file
		const testFileUri = vscode.Uri.joinPath(workspaceFolders[0].uri, 'simple.qmd');
		const document = await vscode.workspace.openTextDocument(testFileUri);
		await vscode.window.showTextDocument(document);

		// Wait for document to load
		await new Promise(resolve => setTimeout(resolve, 200));

		// Call with empty ranges - should complete without error
		await positron.runtime.executeInlineCell(testFileUri, []);
	});

	test('executeInlineCell executes code in the correct session', async () => {
		// Register a test runtime manager for the 'test' language
		const manager = new TestLanguageRuntimeManager();
		const managerDisposable = positron.runtime.registerLanguageRuntimeManager('test', manager);
		disposables.push(managerDisposable);

		// Wait for the runtime to be registered
		await poll(
			async () => (await positron.runtime.getRegisteredRuntimes())
				.filter(runtime => runtime.languageId === 'test'),
			runtimes => runtimes.length > 0,
			'test runtime should be registered',
		);

		const workspaceFolders = vscode.workspace.workspaceFolders;
		assert.ok(workspaceFolders && workspaceFolders.length > 0, 'Should have a workspace folder');

		// Use the simple.qmd test file which has a {test} code block
		const testFileUri = vscode.Uri.joinPath(workspaceFolders[0].uri, 'simple.qmd');
		const document = await vscode.workspace.openTextDocument(testFileUri);
		await vscode.window.showTextDocument(document);

		// Wait for document to be ready
		await new Promise(resolve => setTimeout(resolve, 500));

		// The code block is on line 7-9 (1-indexed):
		// ```{test}
		// test code
		// ```
		// The code content is on line 8
		const codeRange = new vscode.Range(7, 0, 7, 9); // "test code"

		// Execute the inline cell
		await positron.runtime.executeInlineCell(testFileUri, [codeRange]);

		// Wait for execution to complete
		await new Promise(resolve => setTimeout(resolve, 1000));

		// Verify that a session was created and code was executed
		const session = manager.getLastSession();
		assert.ok(session, 'A test session should have been created');
		assert.ok(session.executedCode.length > 0, 'Code should have been executed');

		// Verify the executed code matches what we expected
		const lastExecution = session.executedCode[session.executedCode.length - 1];
		assert.ok(lastExecution.code.includes('test code'), `Executed code should contain 'test code', got: ${lastExecution.code}`);
	});

	test('executeInlineCell handles non-existent cell range gracefully', async () => {
		// Register a test runtime manager
		const manager = new TestLanguageRuntimeManager();
		const managerDisposable = positron.runtime.registerLanguageRuntimeManager('test', manager);
		disposables.push(managerDisposable);

		// Wait for the runtime to be registered
		await poll(
			async () => (await positron.runtime.getRegisteredRuntimes())
				.filter(runtime => runtime.languageId === 'test'),
			runtimes => runtimes.length > 0,
			'test runtime should be registered',
		);

		const workspaceFolders = vscode.workspace.workspaceFolders;
		assert.ok(workspaceFolders && workspaceFolders.length > 0, 'Should have a workspace folder');

		const testFileUri = vscode.Uri.joinPath(workspaceFolders[0].uri, 'simple.qmd');
		const document = await vscode.workspace.openTextDocument(testFileUri);
		await vscode.window.showTextDocument(document);

		await new Promise(resolve => setTimeout(resolve, 200));

		// Try to execute a range that doesn't correspond to any code cell (line 5 is markdown)
		const invalidRange = new vscode.Range(4, 0, 4, 10);

		// Should complete without error even if no cell is found
		await positron.runtime.executeInlineCell(testFileUri, [invalidRange]);

		// Wait a bit
		await new Promise(resolve => setTimeout(resolve, 500));

		// No code should have been executed since the range doesn't match a code cell
		const session = manager.getLastSession();
		// Session might not exist if no execution was attempted
		if (session) {
			assert.strictEqual(session.executedCode.length, 0, 'No code should have been executed for invalid range');
		}
	});
});
