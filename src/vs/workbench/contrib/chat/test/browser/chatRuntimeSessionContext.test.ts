/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { ChatRuntimeSessionContext, ChatRuntimeSessionContextContribution } from '../../browser/contrib/chatRuntimeSessionContext.js';
import { IRuntimeSessionService, ILanguageRuntimeSession } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { IPositronVariablesService } from '../../../../services/positronVariables/common/interfaces/positronVariablesService.js';
import { IExecutionHistoryService, IExecutionHistoryEntry, ExecutionEntryType } from '../../../../services/positronHistory/common/executionHistoryService.js';
import { IChatWidgetService } from '../../browser/chat.js';
import { IChatService } from '../../common/chatService.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { LanguageRuntimeSessionMode, RuntimeState, RuntimeCodeFragmentStatus, ILanguageRuntimeInfo, ILanguageRuntimeMetadata, ILanguageRuntimeSessionState, LanguageRuntimeStartupBehavior, LanguageRuntimeSessionLocation } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { Emitter } from '../../../../../base/common/event.js';
import { PositronVariablesInstance } from '../../../../services/positronVariables/common/positronVariablesInstance.js';
import { Variable, VariableKind } from '../../../../services/languageRuntime/common/positronVariablesComm.js';
import { IChatRequestRuntimeSessionEntry } from '../../common/chatVariableEntries.js';
import { IChatContextPickerItem, IChatContextPickService, IChatContextValueItem } from '../../browser/chatContextPickService.js';

// Mock runtime session
class MockRuntimeSession implements ILanguageRuntimeSession {
	metadata = {
		sessionId: 'test-session-1',
		sessionMode: LanguageRuntimeSessionMode.Console,
		createdTimestamp: Date.now(),
		notebookUri: undefined as URI | undefined,
		startReason: 'test'
	};

	runtimeMetadata = {
		runtimeId: 'python-test',
		runtimeName: 'Python Test',
		runtimeShortName: 'Python',
		languageName: 'Python',
		languageId: 'python',
		languageVersion: '3.9.0',
		runtimePath: '/usr/bin/python3',
		runtimeVersion: '3.9.0',
		runtimeSource: 'Automatic',
		startupBehavior: LanguageRuntimeStartupBehavior.Explicit,
		sessionLocation: LanguageRuntimeSessionLocation.Workspace,
		base64EncodedIconSvg: '',
		extensionId: { value: 'test-extension' } as any,
		extraRuntimeData: {}
	} as ILanguageRuntimeMetadata;

	sessionId = 'test-session-1';

	dynState = {
		sessionName: 'Test Python Session',
		currentExecution: undefined,
		currentWorkingDirectory: '/home/user',
		busy: false,
		inputPrompt: '>>> ',
		continuationPrompt: '... '
	} as ILanguageRuntimeSessionState;

	onDidChangeRuntimeState = new Emitter<RuntimeState>().event;
	onDidCompleteStartup = new Emitter<ILanguageRuntimeInfo>().event;
	onDidEncounterStartupFailure = new Emitter<any>().event;
	onDidEndSession = new Emitter<any>().event;
	onDidCreateClientInstance = new Emitter<any>().event;
	onDidReceiveRuntimeMessageClearOutput = new Emitter<any>().event;
	onDidReceiveRuntimeMessageOutput = new Emitter<any>().event;
	onDidReceiveRuntimeMessageResult = new Emitter<any>().event;
	onDidReceiveRuntimeMessageStream = new Emitter<any>().event;
	onDidReceiveRuntimeMessageInput = new Emitter<any>().event;
	onDidReceiveRuntimeMessageError = new Emitter<any>().event;
	onDidReceiveRuntimeMessagePrompt = new Emitter<any>().event;
	onDidReceiveRuntimeMessageState = new Emitter<any>().event;
	onDidReceiveRuntimeMessageUpdateOutput = new Emitter<any>().event;
	onDidReceiveRuntimeClientEvent = new Emitter<any>().event;
	onDidReceiveRuntimeMessagePromptConfig = new Emitter<void>().event;
	onDidReceiveRuntimeMessageIPyWidget = new Emitter<any>().event;

	clientInstances: any[] = [];
	lastUsed = Date.now();

	getLabel() { return 'Test Python Session'; }
	getRuntimeState() { return RuntimeState.Ready; }
	restart() { return Promise.resolve(); }
	forceQuit() { return Promise.resolve(); }
	start() { return Promise.resolve({} as ILanguageRuntimeInfo); }
	dispose() { }
	execute() { return Promise.resolve(); }
	isCodeFragmentComplete() { return Promise.resolve(RuntimeCodeFragmentStatus.Complete); }
	createClient() { return Promise.resolve(null as any); }
	listClients() { return Promise.resolve([]); }
	replyToPrompt() { }
	setWorkingDirectory() { return Promise.resolve(); }
	interrupt() { }
	shutdown() { return Promise.resolve(); }
	showOutput() { }
	listOutputChannels() { return Promise.resolve([]); }
	showProfile() { return Promise.resolve(); }
	updateSessionName() { }
	openResource() { return Promise.resolve(false); }
}

// Mock notebook runtime session
class MockNotebookRuntimeSession extends MockRuntimeSession {
	override metadata = {
		sessionId: 'test-notebook-session-1',
		sessionMode: LanguageRuntimeSessionMode.Notebook,
		createdTimestamp: Date.now(),
		notebookUri: URI.file('/test/notebook.ipynb'),
		startReason: 'test-notebook'
	};
}

// Mock runtime session service
class MockRuntimeSessionService implements Partial<IRuntimeSessionService> {
	private _sessions: Map<string, ILanguageRuntimeSession> = new Map();
	private _foregroundSession: ILanguageRuntimeSession | undefined;
	private _onDidChangeForegroundSession = new Emitter<ILanguageRuntimeSession | undefined>();
	private _onDidStartRuntime = new Emitter<ILanguageRuntimeSession>();

	onDidChangeForegroundSession = this._onDidChangeForegroundSession.event;
	onDidStartRuntime = this._onDidStartRuntime.event;

	get foregroundSession() { return this._foregroundSession; }
	get activeSessions() { return Array.from(this._sessions.values()); }

	setForegroundSession(session: ILanguageRuntimeSession | undefined) {
		this._foregroundSession = session;
		this._onDidChangeForegroundSession.fire(session);
	}

	addSession(session: ILanguageRuntimeSession) {
		this._sessions.set(session.metadata.sessionId, session);
	}

	getSession(sessionId: string) {
		return this._sessions.get(sessionId);
	}
}

// Mock variables service
class MockPositronVariablesService implements Partial<IPositronVariablesService> {
	private _instances: PositronVariablesInstance[] = [];

	get positronVariablesInstances() { return this._instances; }

	addVariablesInstance(session: ILanguageRuntimeSession, variables: Variable[] = []) {
		const instance = {
			session,
			variableItems: variables.map(variable => ({ variable }))
		} as PositronVariablesInstance;
		this._instances.push(instance);
	}
}

// Mock execution history service
class MockExecutionHistoryService implements Partial<IExecutionHistoryService> {
	private _entries: Map<string, IExecutionHistoryEntry<string>[]> = new Map();

	getExecutionEntries(sessionId: string) {
		return this._entries.get(sessionId) || [];
	}

	addExecutionEntry(sessionId: string, entry: IExecutionHistoryEntry<string>) {
		if (!this._entries.has(sessionId)) {
			this._entries.set(sessionId, []);
		}
		this._entries.get(sessionId)!.push(entry);
	}
}

// Mock chat widget
class MockChatWidget {
	location = 'panel';
	input = { runtimeContext: undefined as ChatRuntimeSessionContext | undefined };
	viewModel = { getItems: () => [] };
}

// Mock chat widget service
class MockChatWidgetService implements Partial<IChatWidgetService> {
	private _widgets: MockChatWidget[] = [];
	private _onDidAddWidget = new Emitter<any>();
	private _disposables: ChatRuntimeSessionContext[] = [];

	onDidAddWidget = this._onDidAddWidget.event;

	getAllWidgets() { return this._widgets as any; }
	getWidgetBySessionId() { return this._widgets[0] as any; }

	addWidget() {
		const widget = new MockChatWidget();
		widget.input.runtimeContext = new ChatRuntimeSessionContext();
		this._disposables.push(widget.input.runtimeContext);
		this._widgets.push(widget);
		this._onDidAddWidget.fire(widget);
		return widget;
	}

	dispose() {
		this._disposables.forEach(d => d.dispose());
		this._disposables = [];
		this._widgets = [];
	}
}

// Mock chat service
class MockChatService implements Partial<IChatService> {
	private _onDidSubmitRequest = new Emitter<any>();
	onDidSubmitRequest = this._onDidSubmitRequest.event;

	submitRequest(chatSessionId: string) {
		this._onDidSubmitRequest.fire({ chatSessionId });
	}
}

// Mock editor service
class MockEditorService implements Partial<IEditorService> {
	private _activeEditor: any;
	private _onDidActiveEditorChange = new Emitter<any>();

	onDidActiveEditorChange = this._onDidActiveEditorChange.event;
	get activeEditor() { return this._activeEditor; }

	setActiveEditor(editor: any) {
		this._activeEditor = editor;
		this._onDidActiveEditorChange.fire({} as any);
	}
}

class MockContextPickService implements Partial<IChatContextPickService> {
	registerChatContextItem(item: IChatContextValueItem | IChatContextPickerItem) {
		// Mock implementation, no-op
		return {
			dispose: () => { /* no-op */ }
		};
	}
}


suite('ChatRuntimeSessionContext', () => {
	const testDisposables = ensureNoDisposablesAreLeakedInTestSuite();

	let instantiationService: TestInstantiationService;
	let configurationService: TestConfigurationService;
	let runtimeSessionService: MockRuntimeSessionService;
	let variablesService: MockPositronVariablesService;
	let executionHistoryService: MockExecutionHistoryService;
	let chatWidgetService: MockChatWidgetService;
	let chatService: MockChatService;
	let editorService: MockEditorService;
	let contextPickService: MockContextPickService;

	setup(() => {
		instantiationService = testDisposables.add(new TestInstantiationService());
		configurationService = new TestConfigurationService();
		runtimeSessionService = new MockRuntimeSessionService();
		variablesService = new MockPositronVariablesService();
		executionHistoryService = new MockExecutionHistoryService();
		chatWidgetService = new MockChatWidgetService();
		testDisposables.add({ dispose: () => chatWidgetService.dispose() }); // Dispose chat widget service
		chatService = new MockChatService();
		editorService = new MockEditorService();
		contextPickService = new MockContextPickService();

		instantiationService.stub(IConfigurationService, configurationService);
		instantiationService.stub(IRuntimeSessionService, runtimeSessionService as any);
		instantiationService.stub(IPositronVariablesService, variablesService as any);
		instantiationService.stub(IExecutionHistoryService, executionHistoryService as any);
		instantiationService.stub(IChatWidgetService, chatWidgetService as any);
		instantiationService.stub(IChatService, chatService as any);
		instantiationService.stub(IEditorService, editorService as any);
		instantiationService.stub(IChatContextPickService, contextPickService as any);
	});

	suite('ChatRuntimeSessionContext class', () => {
		test('should update name and description when session is set', () => {
			const context = testDisposables.add(new ChatRuntimeSessionContext());
			const session = new MockRuntimeSession();

			context.setValue(session as any);

			assert.strictEqual(context.name, 'Test Python Session');
			assert.strictEqual(context.modelDescription, "User's active runtime session");
		});

		test('should fire change event when value changes', () => {
			const context = testDisposables.add(new ChatRuntimeSessionContext());
			const session = new MockRuntimeSession();
			let changeFired = false;

			const listener = context.onDidChangeValue(() => {
				changeFired = true;
			});
			testDisposables.add(listener);

			context.setValue(session as any);
			assert.strictEqual(changeFired, true);
			assert.strictEqual(context.value, session);
		});

		test('should generate runtime session entries when session is set', async () => {
			const context = testDisposables.add(new ChatRuntimeSessionContext());
			const session = new MockRuntimeSession();

			// Set up services
			context.setServices(variablesService as any, executionHistoryService as any, configurationService as any);

			// Add some execution history
			executionHistoryService.addExecutionEntry('test-session-1', {
				id: 'exec-1',
				prompt: '>>> ',
				input: 'print("hello")',
				output: 'hello',
				outputType: ExecutionEntryType.Execution,
				when: Date.now(),
				durationMs: 50
			});

			// Add some variables
			const testVariable: Variable = {
				access_key: 'x',
				display_name: 'x',
				display_type: 'int',
				display_value: '42',
				has_children: false,
				length: 1,
				size: 1,
				type_info: 'int',
				kind: VariableKind.Number,
				has_viewer: false,
				is_truncated: false,
				updated_time: Date.now()
			};
			variablesService.addVariablesInstance(session as any, [testVariable]);

			context.setValue(session as any);

			const entries = await context.toBaseEntries();
			assert.strictEqual(entries.length, 1);

			const entry = entries[0] as IChatRequestRuntimeSessionEntry;
			assert.strictEqual(entry.kind, 'runtimeSession');
			assert.strictEqual(entry.id, 'positron.implicit.runtimeSession');
			assert.strictEqual(entry.name, 'Test Python Session');
			assert.ok(entry.value.activeSession);
			assert.strictEqual(entry.value.activeSession.identifier, 'test-session-1');
			assert.strictEqual(entry.value.activeSession.language, 'Python');
			assert.strictEqual(entry.value.activeSession.version, '3.9.0');
			assert.strictEqual(entry.value.activeSession.mode, 'console');
			assert.strictEqual(entry.value.activeSession.executions.length, 1);
			assert.strictEqual(entry.value.activeSession.executions[0].input, 'print("hello")');
			assert.strictEqual(entry.value.activeSession.executions[0].output, 'hello');
			assert.strictEqual(entry.value.variables.length, 1);
			assert.strictEqual(entry.value.variables[0].access_key, 'x');
		});

		test('should handle notebook sessions', async () => {
			const context = testDisposables.add(new ChatRuntimeSessionContext());
			const session = new MockNotebookRuntimeSession();

			context.setServices(variablesService as any, executionHistoryService as any, configurationService as any);
			context.setValue(session as any);

			const entries = await context.toBaseEntries();
			const entry = entries[0] as IChatRequestRuntimeSessionEntry;

			assert.strictEqual(entry.value.activeSession!.mode, 'notebook');
			assert.ok(entry.value.activeSession!.notebookUri);
		});

		test('should handle execution history with errors', async () => {
			const context = testDisposables.add(new ChatRuntimeSessionContext());
			const session = new MockRuntimeSession();

			context.setServices(variablesService as any, executionHistoryService as any, configurationService as any);

			// Add execution with error
			executionHistoryService.addExecutionEntry('test-session-1', {
				id: 'exec-error',
				prompt: '>>> ',
				input: 'undefined_variable',
				output: '',
				error: { name: 'NameError', message: 'name "undefined_variable" is not defined', traceback: ['Traceback: ...'] },
				outputType: ExecutionEntryType.Execution,
				when: Date.now(),
				durationMs: 25
			});

			context.setValue(session as any);

			const entries = await context.toBaseEntries();
			const entry = entries[0] as IChatRequestRuntimeSessionEntry;

			assert.strictEqual(entry.value.activeSession!.executions.length, 1);
			assert.ok(entry.value.activeSession!.executions[0].error);
			assert.strictEqual(entry.value.activeSession!.executions[0].error.name, 'NameError');
		});
	});

	suite('ChatRuntimeSessionContextContribution', () => {
		test('should initialize with configuration', () => {
			configurationService.setUserConfiguration('chat.implicitSessionContext.enabled', {
				panel: 'always'
			});

			const contribution = testDisposables.add(instantiationService.createInstance(
				ChatRuntimeSessionContextContribution
			));

			assert.ok(contribution);
		});

		test('should respect "never" configuration setting', async () => {
			configurationService.setUserConfiguration('chat.implicitSessionContext.enabled', {
				panel: 'never'
			});

			const widget = chatWidgetService.addWidget();
			testDisposables.add(instantiationService.createInstance(
				ChatRuntimeSessionContextContribution
			));

			const session = new MockRuntimeSession();
			runtimeSessionService.addSession(session);

			// Set services on the widget's runtime context
			widget.input.runtimeContext!.setServices(variablesService as any, executionHistoryService as any, configurationService as any);

			// Change foreground session
			runtimeSessionService.setForegroundSession(session);

			// Allow async updates to complete
			await new Promise(resolve => setTimeout(resolve, 10));

			assert.strictEqual(widget.input.runtimeContext!.enabled, false);
		});

		test('should update context when configuration changes', async () => {
			configurationService.setUserConfiguration('chat.implicitSessionContext.enabled', {
				panel: 'never'
			});

			const widget = chatWidgetService.addWidget();
			testDisposables.add(instantiationService.createInstance(
				ChatRuntimeSessionContextContribution
			));

			const session = new MockRuntimeSession();
			runtimeSessionService.addSession(session);
			runtimeSessionService.setForegroundSession(session);

			// Set services on the widget's runtime context
			widget.input.runtimeContext!.setServices(variablesService as any, executionHistoryService as any, configurationService as any);

			// Allow async updates to complete
			await new Promise(resolve => setTimeout(resolve, 10));

			assert.strictEqual(widget.input.runtimeContext!.enabled, false);

			// Change configuration to always
			configurationService.setUserConfiguration('chat.implicitSessionContext.enabled', {
				panel: 'always'
			});

			// Trigger configuration change event
			configurationService.onDidChangeConfigurationEmitter.fire({
				affectsConfiguration: (key: string) => key === 'chat.implicitSessionContext.enabled',
				affectedKeys: new Set(['chat.implicitSessionContext.enabled']),
				source: 1 as any,
				change: {} as any
			});

			// Allow async updates to complete
			await new Promise(resolve => setTimeout(resolve, 10));

			assert.strictEqual(widget.input.runtimeContext!.enabled, true);
		});
	});
});
