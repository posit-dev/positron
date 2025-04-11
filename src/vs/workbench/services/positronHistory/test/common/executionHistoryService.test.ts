/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as sinon from 'sinon';
import { Disposable, IDisposable } from '../../../../../base/common/lifecycle.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { ILogService, NullLogService } from '../../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { ILanguageRuntimeSession, IRuntimeSessionService, RuntimeStartMode, ILanguageRuntimeSessionStateEvent, ILanguageRuntimeGlobalEvent, IRuntimeSessionMetadata, IRuntimeSessionWillStartEvent, INotebookSessionUriChangedEvent } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { IExecutionHistoryService, ExecutionEntryType } from '../../common/executionHistoryService.js';
import { IRuntimeAutoStartEvent, IRuntimeStartupService, ISessionRestoreFailedEvent, SerializedSessionMetadata } from '../../../../services/runtimeStartup/common/runtimeStartupService.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { ExecutionHistoryService } from '../../common/executionHistory.js';
import { IWorkspace, IWorkspaceContextService, IWorkspaceFoldersWillChangeEvent } from '../../../../../platform/workspace/common/workspace.js';
import { ILanguageRuntimeExit, ILanguageRuntimeMetadata, ILanguageRuntimeSessionState, IRuntimeManager, LanguageRuntimeSessionLocation, LanguageRuntimeSessionMode, LanguageRuntimeStartupBehavior, RuntimeExitReason, RuntimeState } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { Emitter } from '../../../../../base/common/event.js';
import { TestStorageService } from '../../../../test/common/workbenchTestServices.js';
import { ExtensionIdentifier } from '../../../../../platform/extensions/common/extensions.js';
import { URI } from '../../../../../base/common/uri.js';
import { ActiveRuntimeSession } from '../../../runtimeSession/common/activeRuntimeSession.js';

class TestWorkspaceContextService implements IWorkspaceContextService {
	private readonly _onWillChangeWorkspaceFolders = new Emitter<IWorkspaceFoldersWillChangeEvent>();
	readonly onWillChangeWorkspaceFolders = this._onWillChangeWorkspaceFolders.event;
	getCompleteWorkspace(): Promise<IWorkspace> {
		throw new Error('Method not implemented.');
	}
	_serviceBrand: undefined;

	private readonly _onDidChangeWorkspaceFolders = new Emitter<any>();
	readonly onDidChangeWorkspaceFolders = this._onDidChangeWorkspaceFolders.event;

	private readonly _onDidChangeWorkspaceName = new Emitter<void>();
	readonly onDidChangeWorkspaceName = this._onDidChangeWorkspaceName.event;

	private readonly _onDidChangeWorkbenchState = new Emitter<any>();
	readonly onDidChangeWorkbenchState = this._onDidChangeWorkbenchState.event;

	getWorkspace(): any {
		return { folders: [], id: 'test-workspace', name: 'Test Workspace' };
	}

	getWorkbenchState(): any {
		return 1; // WorkbenchState.EMPTY
	}

	getWorkspaceFolder(): any {
		return undefined;
	}

	isInsideWorkspace(): boolean {
		return false;
	}

	isCurrentWorkspace(): boolean {
		return false;
	}
}

class TestRuntimeSessionService implements IRuntimeSessionService {
	_serviceBrand: undefined;

	readonly sessions: Map<string, ILanguageRuntimeSession> = new Map();
	readonly activeSessions: ILanguageRuntimeSession[] = [];

	// Event handlers
	private readonly _onDidChangeActiveSession = new Emitter<void>();
	readonly onDidChangeActiveSession = this._onDidChangeActiveSession.event;

	private readonly _onDidEndSession = new Emitter<void>();
	readonly onDidEndSession = this._onDidEndSession.event;

	private readonly _onDidStartSession = new Emitter<void>();
	readonly onDidStartSession = this._onDidStartSession.event;

	private readonly _onDidDisposeSession = new Emitter<void>();
	readonly onDidDisposeSession = this._onDidDisposeSession.event;

	private readonly _onDidStartRuntime = new Emitter<ILanguageRuntimeSession>();
	readonly onDidStartRuntime = this._onDidStartRuntime.event;

	private readonly _onDidFailStartRuntime = new Emitter<ILanguageRuntimeSession>();
	readonly onDidFailStartRuntime = this._onDidFailStartRuntime.event;

	private readonly _onDidChangeRuntimeState = new Emitter<ILanguageRuntimeSessionStateEvent>();
	readonly onDidChangeRuntimeState = this._onDidChangeRuntimeState.event;

	private readonly _onDidReceiveRuntimeEvent = new Emitter<ILanguageRuntimeGlobalEvent>();
	readonly onDidReceiveRuntimeEvent = this._onDidReceiveRuntimeEvent.event;

	private readonly _onDidChangeForegroundSession = new Emitter<ILanguageRuntimeSession | undefined>();
	readonly onDidChangeForegroundSession = this._onDidChangeForegroundSession.event;

	private readonly _onDidDeleteRuntimeSession = new Emitter<string>();
	readonly onDidDeleteRuntimeSession = this._onDidDeleteRuntimeSession.event;

	private readonly _onWillStartSession = new Emitter<IRuntimeSessionWillStartEvent>();
	readonly onWillStartSession = this._onWillStartSession.event;

	private readonly _onDidUpdateNotebookSessionUri = new Emitter<INotebookSessionUriChangedEvent>();
	readonly onDidUpdateNotebookSessionUri = this._onDidUpdateNotebookSessionUri.event;

	foregroundSession: ILanguageRuntimeSession | undefined;

	updateNotebookSessionUri(oldUri: URI, newUri: URI): string | undefined {
		return undefined;
	}

	activateSession(_sessionId: string): Promise<void> {
		throw new Error('Method not implemented.');
	}

	getSession(sessionId: string): ILanguageRuntimeSession | undefined {
		return this.sessions.get(sessionId);
	}

	// Helper method to fire session start event with proper structure
	fireWillStartSession(session: ILanguageRuntimeSession, startMode: RuntimeStartMode): void {
		this._onWillStartSession.fire({
			session,
			startMode,
			activate: true
		});
	}

	startSession(_sessionId: string): Promise<ILanguageRuntimeSession> {
		throw new Error('Method not implemented.');
	}

	restoreSession(_sessionId: string): Promise<ILanguageRuntimeSession> {
		throw new Error('Method not implemented.');
	}

	getActiveSession(_sessionId: string): any {
		throw new Error('Method not implemented.');
	}

	getConsoleSessionForRuntime(_runtimeId: string): ILanguageRuntimeSession | undefined {
		throw new Error('Method not implemented.');
	}

	getConsoleSessionForLanguage(_languageId: string): ILanguageRuntimeSession | undefined {
		throw new Error('Method not implemented.');
	}

	getNotebookSessionForNotebookUri(_notebookUri: any): ILanguageRuntimeSession | undefined {
		throw new Error('Method not implemented.');
	}

	getActiveSessions(): ActiveRuntimeSession[] {
		throw new Error('Method not implemented.');
	}

	hasStartingOrRunningConsole(_languageId?: string | undefined): boolean {
		throw new Error('Method not implemented.');
	}

	startNewRuntimeSession(_runtimeId: string, _sessionName: string, _sessionMode: any, _notebookUri: any, _source: string, _startMode: RuntimeStartMode, _activate: boolean): Promise<string> {
		throw new Error('Method not implemented.');
	}

	validateRuntimeSession(_runtimeMetadata: any, _sessionId: string): Promise<boolean> {
		throw new Error('Method not implemented.');
	}

	restoreRuntimeSession(_runtimeMetadata: any, _sessionMetadata: any, _activate: boolean): Promise<void> {
		throw new Error('Method not implemented.');
	}

	autoStartRuntime(_metadata: any, _source: string, _activate: boolean): Promise<string> {
		throw new Error('Method not implemented.');
	}

	selectRuntime(_runtimeId: string, _source: string, _notebookUri?: any): Promise<void> {
		throw new Error('Method not implemented.');
	}

	deleteSession(_sessionId: string): Promise<void> {
		throw new Error('Method not implemented.');
	}

	focusSession(_sessionId: string): void {
		throw new Error('Method not implemented.');
	}

	restartSession(_sessionId: string, _source: string): Promise<void> {
		throw new Error('Method not implemented.');
	}

	interruptSession(_sessionId: string): Promise<void> {
		throw new Error('Method not implemented.');
	}

	shutdownNotebookSession(_notebookUri: any, _exitReason: RuntimeExitReason, _source: string): Promise<void> {
		throw new Error('Method not implemented.');
	}

	updateActiveLanguages(): void {
		throw new Error('Method not implemented.');
	}

	registerSessionManager(_manager: any): IDisposable {
		throw new Error('Method not implemented.');
	}

	// Expose emitters for testing purposes
	get onDidChangeActiveSessionEmitter() {
		return this._onDidChangeActiveSession;
	}

	get onDidEndSessionEmitter() {
		return this._onDidEndSession;
	}

	get onDidStartSessionEmitter() {
		return this._onDidStartSession;
	}

	get onDidDisposeSessionEmitter() {
		return this._onDidDisposeSession;
	}

	get onDidStartRuntimeEmitter() {
		return this._onDidStartRuntime;
	}

	get onDidFailStartRuntimeEmitter() {
		return this._onDidFailStartRuntime;
	}

	get onDidChangeRuntimeStateEmitter() {
		return this._onDidChangeRuntimeState;
	}

	get onDidReceiveRuntimeEventEmitter() {
		return this._onDidReceiveRuntimeEvent;
	}

	get onDidChangeForegroundSessionEmitter() {
		return this._onDidChangeForegroundSession;
	}

	get onDidDeleteRuntimeSessionEmitter() {
		return this._onDidDeleteRuntimeSession;
	}

	get onWillStartSessionEmitter() {
		return this._onWillStartSession;
	}
}

class TestRuntimeStartupService implements IRuntimeStartupService {
	_serviceBrand: undefined;

	private readonly _onWillAutoStartRuntime = new Emitter<IRuntimeAutoStartEvent>();
	readonly onWillAutoStartRuntime = this._onWillAutoStartRuntime.event;

	private readonly _onSessionRestoreFailure = new Emitter<ISessionRestoreFailedEvent>();
	readonly onSessionRestoreFailure = this._onSessionRestoreFailure.event;

	private readonly _onSessionStartupFinished = new Emitter<void>();
	readonly onSessionStartupFinished = this._onSessionStartupFinished.event;

	private readonly _onWillStartSessionStartup = new Emitter<void>();
	readonly onWillStartSessionStartup = this._onWillStartSessionStartup.event;

	private readonly _storedSessions: SerializedSessionMetadata[] = [];

	setRestoredSessions(sessions: SerializedSessionMetadata[]): void {
		this._storedSessions.length = 0;
		this._storedSessions.push(...sessions);
	}

	async getRestoredSessions(): Promise<SerializedSessionMetadata[]> {
		return [...this._storedSessions];
	}

	getPreferredRuntime(languageId: string): ILanguageRuntimeMetadata {
		throw new Error('Method not implemented.');
	}

	hasAffiliatedRuntime(): boolean {
		return false;
	}

	getAffiliatedRuntimeMetadata(languageId: string): ILanguageRuntimeMetadata | undefined {
		return undefined;
	}

	getAffiliatedRuntimes(): Array<ILanguageRuntimeMetadata> {
		return [];
	}

	clearAffiliatedRuntime(_languageId: string): void {
		// No-op in test implementation
	}

	completeDiscovery(_id: number): void {
		// No-op in test implementation
	}

	registerRuntimeManager(_manager: IRuntimeManager): IDisposable {
		return Disposable.None;
	}

	startSession(_sessionId: string, _startupParams?: any): Promise<boolean> {
		return Promise.resolve(true);
	}

	reconnectSession(_sessionId: string): Promise<boolean> {
		return Promise.resolve(true);
	}

	setSessionStartupEvents(_sessionId: string, _languageId: string, _events: unknown[]): void {
		// No-op in test implementation
	}

	// Expose emitters for testing purposes
	get onWillAutoStartRuntimeEmitter() {
		return this._onWillAutoStartRuntime;
	}

	get onSessionRestoreFailureEmitter() {
		return this._onSessionRestoreFailure;
	}

	get onSessionStartupFinishedEmitter() {
		return this._onSessionStartupFinished;
	}

	get onWillStartSessionStartupEmitter() {
		return this._onWillStartSessionStartup;
	}
}

const TestLanguageRuntimeMetadata: ILanguageRuntimeMetadata = {
	base64EncodedIconSvg: '',
	extensionId: { value: 'test.extension' } as ExtensionIdentifier,
	extraRuntimeData: {},
	languageId: 'test',
	runtimeId: 'test.runtime',
	runtimeName: 'Test Runtime',
	languageName: 'Test Language',
	languageVersion: '1.0.0',
	runtimePath: '/path/to/runtime',
	runtimeShortName: 'Test',
	runtimeSource: 'test',
	runtimeVersion: '1.0.0',
	sessionLocation: LanguageRuntimeSessionLocation.Machine,
	startupBehavior: LanguageRuntimeStartupBehavior.Explicit
};

function createSessionMetadata(sessionId: string): IRuntimeSessionMetadata {
	return {
		sessionId,
		createdTimestamp: 0,
		sessionMode: LanguageRuntimeSessionMode.Console,
		notebookUri: undefined,
		sessionName: `Test Session ${sessionId}`,
		startReason: 'Unit Test'
	};
}

function createSerializedSessionMetadata(sessionId: string): SerializedSessionMetadata {
	return {
		lastUsed: 0,
		metadata: createSessionMetadata(sessionId),
		runtimeMetadata: TestLanguageRuntimeMetadata,
		sessionState: RuntimeState.Idle,
		workingDirectory: ''
	};
}

class TestLanguageRuntimeSession extends Disposable implements ILanguageRuntimeSession {
	readonly _serviceBrand: undefined;
	readonly sessionId: string;
	readonly metadata: IRuntimeSessionMetadata;
	readonly runtimeMetadata: ILanguageRuntimeMetadata;
	readonly dynState: ILanguageRuntimeSessionState;

	private readonly _onDidCompleteStartup = new Emitter<any>();
	readonly onDidCompleteStartup = this._onDidCompleteStartup.event;

	private readonly _onDidReceiveRuntimeMessageInput = new Emitter<any>();
	readonly onDidReceiveRuntimeMessageInput = this._onDidReceiveRuntimeMessageInput.event;

	private readonly _onDidReceiveRuntimeMessageOutput = new Emitter<any>();
	readonly onDidReceiveRuntimeMessageOutput = this._onDidReceiveRuntimeMessageOutput.event;

	private readonly _onDidReceiveRuntimeMessageResult = new Emitter<any>();
	readonly onDidReceiveRuntimeMessageResult = this._onDidReceiveRuntimeMessageResult.event;

	private readonly _onDidReceiveRuntimeMessageStream = new Emitter<any>();
	readonly onDidReceiveRuntimeMessageStream = this._onDidReceiveRuntimeMessageStream.event;

	private readonly _onDidReceiveRuntimeMessageError = new Emitter<any>();
	readonly onDidReceiveRuntimeMessageError = this._onDidReceiveRuntimeMessageError.event;

	private readonly _onDidReceiveRuntimeMessageState = new Emitter<any>();
	readonly onDidReceiveRuntimeMessageState = this._onDidReceiveRuntimeMessageState.event;

	private readonly _onDidEndSession = new Emitter<ILanguageRuntimeExit>();
	readonly onDidEndSession = this._onDidEndSession.event;

	// Additional required event handlers
	readonly onDidChangeRuntimeState = new Emitter<any>().event;
	readonly onDidEncounterStartupFailure = new Emitter<any>().event;
	readonly onDidCreateClientInstance = new Emitter<any>().event;
	readonly onDidReceiveRuntimeMessageClearOutput = new Emitter<any>().event;
	readonly onDidReceiveRuntimeMessagePrompt = new Emitter<any>().event;
	readonly onDidReceiveRuntimeClientEvent = new Emitter<any>().event;
	readonly onDidReceiveRuntimeMessagePromptConfig = new Emitter<void>().event;
	readonly onDidReceiveRuntimeMessageIPyWidget = new Emitter<any>().event;

	constructor(
		sessionId: string,
	) {
		super();
		this.sessionId = sessionId;
		this.dynState = {
			busy: false,
			continuationPrompt: '',
			currentWorkingDirectory: '',
			inputPrompt: '',
		};
		this.runtimeMetadata = TestLanguageRuntimeMetadata;
		this.metadata = createSessionMetadata(sessionId);
	}

	getLabel(): string {
		return this.metadata.sessionName;
	}

	isIdle(): boolean {
		throw new Error('Method not implemented.');
	}

	isVoid(): boolean {
		throw new Error('Method not implemented.');
	}

	getRuntimeState(): any {
		throw new Error('Method not implemented.');
	}

	get lastUsed(): number {
		return Date.now();
	}

	get clientInstances(): any[] {
		return [];
	}

	openResource(_resource: any): Promise<boolean> {
		throw new Error('Method not implemented.');
	}

	execute(_code: string, _id: string, _mode: any, _errorBehavior: any): void {
		throw new Error('Method not implemented.');
	}

	executeCode(_code: string, _options?: any): Promise<any> {
		throw new Error('Method not implemented.');
	}

	isCodeFragmentComplete(_code: string): Promise<any> {
		throw new Error('Method not implemented.');
	}

	createClient<T, U>(_type: any, _params: any, _metadata?: any, _id?: string): Promise<any> {
		throw new Error('Method not implemented.');
	}

	listClients(_type?: any): Promise<Array<any>> {
		throw new Error('Method not implemented.');
	}

	replyToPrompt(_id: string, _value: string): void {
		throw new Error('Method not implemented.');
	}

	setWorkingDirectory(_directory: string): Promise<void> {
		throw new Error('Method not implemented.');
	}

	start(_showBanner?: boolean): Promise<any> {
		throw new Error('Method not implemented.');
	}

	interrupt(): void {
		throw new Error('Method not implemented.');
	}

	restart(_workingDirectory?: string): Promise<void> {
		throw new Error('Method not implemented.');
	}

	restore(_checkSession?: boolean): Promise<void> {
		throw new Error('Method not implemented.');
	}

	shutdown(_exitReason?: RuntimeExitReason, _force?: boolean): Promise<void> {
		throw new Error('Method not implemented.');
	}

	forceQuit(): Promise<void> {
		throw new Error('Method not implemented.');
	}

	showOutput(_channel?: any): void {
		throw new Error('Method not implemented.');
	}

	listOutputChannels(): Promise<any[]> {
		throw new Error('Method not implemented.');
	}

	showProfile(): Promise<void> {
		throw new Error('Method not implemented.');
	}

	// Expose emitters for testing purposes
	get onDidCompleteStartupEmitter() {
		return this._onDidCompleteStartup;
	}

	get onDidReceiveRuntimeMessageInputEmitter() {
		return this._onDidReceiveRuntimeMessageInput;
	}

	get onDidReceiveRuntimeMessageOutputEmitter() {
		return this._onDidReceiveRuntimeMessageOutput;
	}

	get onDidReceiveRuntimeMessageResultEmitter() {
		return this._onDidReceiveRuntimeMessageResult;
	}

	get onDidReceiveRuntimeMessageStreamEmitter() {
		return this._onDidReceiveRuntimeMessageStream;
	}

	get onDidReceiveRuntimeMessageErrorEmitter() {
		return this._onDidReceiveRuntimeMessageError;
	}

	get onDidReceiveRuntimeMessageStateEmitter() {
		return this._onDidReceiveRuntimeMessageState;
	}

	get onDidEndSessionEmitter() {
		return this._onDidEndSession;
	}
}

suite('ExecutionHistoryService', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	let instantiationService: TestInstantiationService;
	let runtimeSessionService: TestRuntimeSessionService;
	let runtimeStartupService: TestRuntimeStartupService;
	let storageService: TestStorageService;
	let configurationService: TestConfigurationService;
	let executionHistoryService: IExecutionHistoryService;

	setup(() => {
		instantiationService = new TestInstantiationService();

		runtimeSessionService = new TestRuntimeSessionService();
		runtimeStartupService = new TestRuntimeStartupService();
		storageService = new TestStorageService();
		configurationService = new TestConfigurationService();

		instantiationService.stub(IRuntimeSessionService, runtimeSessionService);
		instantiationService.stub(IRuntimeStartupService, runtimeStartupService);
		instantiationService.stub(IStorageService, storageService);
		instantiationService.stub(ILogService, new NullLogService());
		instantiationService.stub(IConfigurationService, configurationService);
		instantiationService.stub(IWorkspaceContextService, new TestWorkspaceContextService());

		executionHistoryService = instantiationService.createInstance(ExecutionHistoryService);
		disposables.add(executionHistoryService);
		disposables.add(storageService);
	});

	teardown(() => {
		sinon.restore();
	});

	function createSession(sessionId: string): TestLanguageRuntimeSession {
		const session = new TestLanguageRuntimeSession(sessionId);
		runtimeSessionService.sessions.set(sessionId, session);
		runtimeSessionService.activeSessions.push(session);
		disposables.add(session);
		return session;
	}

	test('should create execution history for a session', () => {
		const session = createSession('test-session-1');

		// Simulate session start
		runtimeSessionService.onWillStartSessionEmitter.fire({
			session,
			startMode: RuntimeStartMode.Starting,
			activate: false
		});

		// Verify execution history exists
		const entries = executionHistoryService.getExecutionEntries('test-session-1');
		assert.strictEqual(entries.length, 0);
	});

	test('should record startup banner when session starts', () => {
		const session = createSession('test-session-2');

		// Simulate session start
		runtimeSessionService.onWillStartSessionEmitter.fire({
			session,
			startMode: RuntimeStartMode.Starting,
			activate: false
		});

		// Simulate startup completion
		const runtimeInfo = { version: '1.0.0' };
		session.onDidCompleteStartupEmitter.fire(runtimeInfo);

		// Verify startup banner was recorded
		const entries = executionHistoryService.getExecutionEntries('test-session-2');
		assert.strictEqual(entries.length, 1);
		assert.strictEqual(entries[0].outputType, ExecutionEntryType.Startup);
		assert.deepStrictEqual(entries[0].output, runtimeInfo);
	});

	test('should record code execution', () => {
		const session = createSession('test-session-3');

		// Simulate session start
		runtimeSessionService.onWillStartSessionEmitter.fire({
			session,
			startMode: RuntimeStartMode.Starting,
			activate: false
		});

		// Simulate code execution
		const executionId = 'exec-1';
		const code = 'print("Hello")';
		const now = new Date().toISOString();

		// Input message
		session.onDidReceiveRuntimeMessageInputEmitter.fire({
			parent_id: executionId,
			id: 'input-1',
			code,
			when: now
		});

		// Output message
		session.onDidReceiveRuntimeMessageOutputEmitter.fire({
			parent_id: executionId,
			id: 'output-1',
			when: now,
			data: {
				'text/plain': 'Hello'
			}
		});

		// Idle state message
		session.onDidReceiveRuntimeMessageStateEmitter.fire({
			parent_id: executionId,
			id: 'state-1',
			state: 'idle',
			when: now
		});

		// Verify execution was recorded
		const entries = executionHistoryService.getExecutionEntries('test-session-3');
		assert.strictEqual(entries.length, 1); // Input and output joined to a single message

		// Check execution entry
		const execEntry = entries.find(e => e.id === executionId)!;
		assert.strictEqual(execEntry.input, code);
		assert.strictEqual(execEntry.output, 'Hello');
	});

	test('should record error during execution', () => {
		const session = createSession('test-session-4');

		// Simulate session start
		runtimeSessionService.onWillStartSessionEmitter.fire({
			session,
			startMode: RuntimeStartMode.Starting,
			activate: false
		});

		// Simulate code execution with error
		const executionId = 'exec-err-1';
		const code = 'undefined_variable';
		const now = new Date().toISOString();

		// Input message
		session.onDidReceiveRuntimeMessageInputEmitter.fire({
			parent_id: executionId,
			id: 'input-1',
			code,
			when: now
		});

		// Error message
		session.onDidReceiveRuntimeMessageErrorEmitter.fire({
			parent_id: executionId,
			id: 'error-1',
			when: now,
			name: 'NameError',
			message: 'name \'undefined_variable\' is not defined',
			traceback: ['Traceback (most recent call last):', '  File "<stdin>", line 1', 'NameError: name \'undefined_variable\' is not defined']
		});

		// Idle state message
		session.onDidReceiveRuntimeMessageStateEmitter.fire({
			parent_id: executionId,
			id: 'state-1',
			state: 'idle',
			when: now
		});

		// Verify execution was recorded with error
		const entries = executionHistoryService.getExecutionEntries('test-session-4');

		// Check execution entry
		const execEntry = entries.find(e => e.id === executionId)!;
		assert.strictEqual(execEntry.input, code);
		assert.ok(execEntry.error);
		assert.strictEqual(execEntry.error?.name, 'NameError');
	});

	test('should store and retrieve input history for a session', () => {
		const session = createSession('test-session-5');

		// Simulate session start
		runtimeSessionService.onWillStartSessionEmitter.fire({
			session,
			startMode: RuntimeStartMode.Starting,
			activate: false
		});

		// Simulate code executions
		const executionId1 = 'exec-1';
		const executionId2 = 'exec-2';
		const code1 = 'print("First")';
		const code2 = 'print("Second")';
		const now = new Date().toISOString();

		// Input messages
		session.onDidReceiveRuntimeMessageInputEmitter.fire({
			parent_id: executionId1,
			id: 'input-1',
			code: code1,
			when: now
		});

		session.onDidReceiveRuntimeMessageInputEmitter.fire({
			parent_id: executionId2,
			id: 'input-2',
			code: code2,
			when: now
		});

		// Complete executions
		session.onDidReceiveRuntimeMessageStateEmitter.fire({
			parent_id: executionId1,
			id: 'state-1',
			state: 'idle',
			when: now
		});

		session.onDidReceiveRuntimeMessageStateEmitter.fire({
			parent_id: executionId2,
			id: 'state-2',
			state: 'idle',
			when: now
		});

		// Verify input history
		const inputEntries = executionHistoryService.getSessionInputEntries('test-session-5');
		assert.strictEqual(inputEntries.length, 2);
		assert.strictEqual(inputEntries[0].input, code1);
		assert.strictEqual(inputEntries[1].input, code2);
	});

	test('should clear execution history', () => {
		const session = createSession('test-session-6');

		// Simulate session start
		runtimeSessionService.onWillStartSessionEmitter.fire({
			session,
			startMode: RuntimeStartMode.Starting,
			activate: false
		});

		// Simulate code execution
		const executionId = 'exec-1';
		const code = 'print("Hello")';
		const now = new Date().toISOString();

		// Input message and complete execution
		session.onDidReceiveRuntimeMessageInputEmitter.fire({
			parent_id: executionId,
			id: 'input-1',
			code,
			when: now
		});

		session.onDidReceiveRuntimeMessageStateEmitter.fire({
			parent_id: executionId,
			id: 'state-1',
			state: 'idle',
			when: now
		});

		// Verify execution was recorded
		let entries = executionHistoryService.getExecutionEntries('test-session-6');
		assert.ok(entries.length > 0);

		// Clear history
		executionHistoryService.clearExecutionEntries('test-session-6');

		// Verify history was cleared
		entries = executionHistoryService.getExecutionEntries('test-session-6');
		assert.strictEqual(entries.length, 0);
	});

	test('should clear input history', () => {
		const session = createSession('test-session-7');

		// Simulate session start
		runtimeSessionService.onWillStartSessionEmitter.fire({
			session,
			startMode: RuntimeStartMode.Starting,
			activate: false
		});

		// Simulate code execution
		const executionId = 'exec-1';
		const code = 'print("Hello")';
		const now = new Date().toISOString();

		// Input message and complete execution
		session.onDidReceiveRuntimeMessageInputEmitter.fire({
			parent_id: executionId,
			id: 'input-1',
			code,
			when: now
		});

		session.onDidReceiveRuntimeMessageStateEmitter.fire({
			parent_id: executionId,
			id: 'state-1',
			state: 'idle',
			when: now
		});

		// Verify input was recorded
		let inputEntries = executionHistoryService.getSessionInputEntries('test-session-7');
		assert.strictEqual(inputEntries.length, 1);

		// Clear history
		executionHistoryService.clearInputEntries('test-session-7');

		// Verify history was cleared
		inputEntries = executionHistoryService.getSessionInputEntries('test-session-7');
		assert.strictEqual(inputEntries.length, 0);
	});

	test('should delete session history when session ends with shutdown reason', () => {
		const session = createSession('test-session-8');

		// Simulate session start
		runtimeSessionService.onWillStartSessionEmitter.fire({
			session,
			startMode: RuntimeStartMode.Starting,
			activate: false
		});

		// Simulate code execution
		const executionId = 'exec-1';
		const code = 'print("Hello")';
		const now = new Date().toISOString();

		// Input message and complete execution
		session.onDidReceiveRuntimeMessageInputEmitter.fire({
			parent_id: executionId,
			id: 'input-1',
			code,
			when: now
		});

		session.onDidReceiveRuntimeMessageStateEmitter.fire({
			parent_id: executionId,
			id: 'state-1',
			state: 'idle',
			when: now
		});

		// Verify history exists
		const storageSpy = sinon.spy(storageService, 'store');

		// End session with shutdown reason
		session.onDidEndSessionEmitter.fire({
			runtime_name: 'test-runtime',
			session_name: 'test-session',
			exit_code: 0,
			message: 'Session ended',
			reason: RuntimeExitReason.Shutdown
		});

		// Verify storage.store was called with null to delete the histories
		assert.ok(storageSpy.calledWith(sinon.match(/positron\.executionHistory\.test-session-8/), null));
		assert.ok(storageSpy.calledWith(sinon.match(/positron\.inputHistory\.test-session-8/), null));
	});

	test('should prune storage for inactive sessions', () => {
		// Setup restored sessions
		const activeSessionId = 'active-session';
		const inactiveSessionId = 'inactive-session';

		// Create a session that will be considered active
		createSession(activeSessionId);
		runtimeSessionService.onWillStartSessionEmitter.fire({
			session: runtimeSessionService.sessions.get(activeSessionId)!,
			startMode: RuntimeStartMode.Starting,
			activate: false
		});

		// Set up restored sessions (only active one)
		runtimeStartupService.setRestoredSessions([
			createSerializedSessionMetadata(activeSessionId),
		]);

		// Add some fake storage for both active and inactive sessions
		const activeKey = `positron.executionHistory.${activeSessionId}`;
		const inactiveKey = `positron.executionHistory.${inactiveSessionId}`;

		storageService.store(activeKey, '[]', StorageScope.WORKSPACE, StorageTarget.MACHINE);
		storageService.store(inactiveKey, '[]', StorageScope.WORKSPACE, StorageTarget.MACHINE);

		// Create a spy on remove
		const removeSpy = sinon.spy(storageService, 'remove');

		// Call prune storage
		(executionHistoryService as ExecutionHistoryService).pruneStorage([
			createSerializedSessionMetadata(activeSessionId),
		]);

		// Verify inactive session storage was removed but active was kept
		assert.ok(removeSpy.calledWith(inactiveKey, StorageScope.WORKSPACE));
		assert.ok(!removeSpy.calledWith(activeKey, StorageScope.WORKSPACE));
	});

	test('should delete session history on restore failure', () => {
		// Create session
		const sessionId = 'failed-session';
		createSession(sessionId);
		runtimeSessionService.onWillStartSessionEmitter.fire({
			session: runtimeSessionService.sessions.get(sessionId)!,
			startMode: RuntimeStartMode.Starting,
			activate: false
		});

		// Add some history
		const key = `positron.executionHistory.${sessionId}`;
		storageService.store(key, '[]', StorageScope.WORKSPACE, StorageTarget.MACHINE);

		// Create a spy on remove
		const removeSpy = sinon.spy(storageService, 'remove');

		// Simulate restore failure
		runtimeStartupService.onSessionRestoreFailureEmitter.fire({ sessionId, error: new Error('Restore failed') });

		// Verify storage was removed
		assert.ok(removeSpy.calledWith(sinon.match(new RegExp(`positron\\..*\\.${sessionId}`)), StorageScope.WORKSPACE));
	});
});
