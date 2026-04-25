/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { URI } from '../../../../../base/common/uri.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { Event, Emitter } from '../../../../../base/common/event.js';
import { IDisposable } from '../../../../../base/common/lifecycle.js';
import { ExtensionIdentifier } from '../../../../../platform/extensions/common/extensions.js';
import { IConfigurationService, ConfigurationTarget } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { ChatRuntimeSessionContext, ChatRuntimeSessionContextContribution } from '../../browser/widget/input/editor/chatRuntimeSessionContext.js';
import { ChatInputPart } from '../../browser/widget/input/chatInputPart.js';
import { IChatViewModel } from '../../common/model/chatViewModel.js';
import { IRuntimeSessionService, ILanguageRuntimeSession, IRuntimeSessionMetadata, ILanguageRuntimeSessionState } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { IPositronVariablesService } from '../../../../services/positronVariables/common/interfaces/positronVariablesService.js';
import { IPositronVariablesInstance } from '../../../../services/positronVariables/common/interfaces/positronVariablesInstance.js';
import { IExecutionHistoryService, IExecutionHistoryEntry, ExecutionEntryType } from '../../../../services/positronHistory/common/executionHistoryService.js';
import { IChatWidgetService, IChatWidget } from '../../browser/chat.js';
import { IChatService } from '../../common/chatService/chatService.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { LanguageRuntimeSessionMode, RuntimeState, RuntimeCodeFragmentStatus, ILanguageRuntimeInfo, ILanguageRuntimeMetadata, LanguageRuntimeStartupBehavior, LanguageRuntimeSessionLocation } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { Variable, VariableKind } from '../../../../services/languageRuntime/common/positronVariablesComm.js';
import { IChatRequestRuntimeSessionEntry } from '../../common/attachments/chatVariableEntries.js';
import { IChatContextPickService, IChatContextValueItem, IChatContextPickerItem } from '../../browser/attachments/chatContextPickService.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IRuntimeClientInstance } from '../../../../services/languageRuntime/common/languageRuntimeClientInstance.js';

// Mock runtime session
class MockRuntimeSession extends mock<ILanguageRuntimeSession>() {

	metadata: IRuntimeSessionMetadata = stubInterface<IRuntimeSessionMetadata>({
		sessionId: 'test-session-1',
		sessionMode: LanguageRuntimeSessionMode.Console,
		createdTimestamp: Date.now(),
		notebookUri: undefined,
		startReason: 'test'
	});

	runtimeMetadata: ILanguageRuntimeMetadata = stubInterface<ILanguageRuntimeMetadata>({
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
		extensionId: new ExtensionIdentifier('test-extension'),
		extraRuntimeData: {}
	});

	runtimeInfo = undefined;

	sessionId = 'test-session-1';

	dynState: ILanguageRuntimeSessionState = stubInterface<ILanguageRuntimeSessionState>({
		sessionName: 'Test Python Session',
		currentWorkingDirectory: '/home/user',
		currentNotebookUri: undefined,
		busy: false,
		inputPrompt: '>>> ',
		continuationPrompt: '... '
	});

	onDidChangeRuntimeState = Event.None;
	onDidCompleteStartup = Event.None;
	onDidEncounterStartupFailure = Event.None;
	onDidEndSession = Event.None;
	onDidCreateClientInstance = Event.None;
	onDidReceiveRuntimeMessageClearOutput = Event.None;
	onDidReceiveRuntimeMessageOutput = Event.None;
	onDidReceiveRuntimeMessageResult = Event.None;
	onDidReceiveRuntimeMessageStream = Event.None;
	onDidReceiveRuntimeMessageInput = Event.None;
	onDidReceiveRuntimeMessageError = Event.None;
	onDidReceiveRuntimeMessagePrompt = Event.None;
	onDidReceiveRuntimeMessageState = Event.None;
	onDidReceiveRuntimeMessageUpdateOutput = Event.None;
	onDidReceiveRuntimeClientEvent = Event.None;
	onDidReceiveRuntimeMessagePromptConfig = Event.None;
	onDidReceiveRuntimeMessageIPyWidget = Event.None;
	onDidUpdateResourceUsage = Event.None;

	clientInstances: IRuntimeClientInstance<unknown, unknown>[] = [];
	lastUsed = Date.now();

	getRuntimeState() { return RuntimeState.Ready; }
	restart() { return Promise.resolve(); }
	forceQuit() { return Promise.resolve(); }
	start() { return Promise.resolve(stubInterface<ILanguageRuntimeInfo>({})); }
	execute() { return Promise.resolve(); }
	isCodeFragmentComplete() { return Promise.resolve(RuntimeCodeFragmentStatus.Complete); }
	createClient() { return Promise.resolve(null as never); }
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

	// eslint-disable-next-line local/code-must-use-super-dispose -- mock<T>() has no real super.dispose()
	override dispose() { }
}

// Mock notebook runtime session
class MockNotebookRuntimeSession extends MockRuntimeSession {
	override metadata: IRuntimeSessionMetadata = stubInterface<IRuntimeSessionMetadata>({
		sessionId: 'test-notebook-session-1',
		sessionMode: LanguageRuntimeSessionMode.Notebook,
		createdTimestamp: Date.now(),
		notebookUri: URI.file('/test/notebook.ipynb'),
		startReason: 'test-notebook'
	});
}

// Mock runtime session service
class MockRuntimeSessionService extends mock<IRuntimeSessionService>() {
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

	// eslint-disable-next-line local/code-must-use-super-dispose -- mock<T>() has no real super.dispose()
	override dispose() {
		this._onDidChangeForegroundSession.dispose();
		this._onDidStartRuntime.dispose();
	}
}

// Mock variables service
class MockPositronVariablesService extends mock<IPositronVariablesService>() {
	private _instances: IPositronVariablesInstance[] = [];

	get positronVariablesInstances() { return this._instances; }

	onDidStartPositronVariablesInstance = Event.None;
	onDidStopPositronVariablesInstance = Event.None;
	onDidChangeActivePositronVariablesInstance = Event.None;

	addVariablesInstance(session: ILanguageRuntimeSession, variables: Variable[] = []) {
		const instance = stubInterface<IPositronVariablesInstance>({
			session,
			variableItems: variables.map(variable => ({ variable }))
		});
		this._instances.push(instance);
	}
}

// Mock execution history service
class MockExecutionHistoryService extends mock<IExecutionHistoryService>() {
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

// Mock chat widget -- only the fields production code accesses
class MockChatWidget extends mock<IChatWidget>() {
	override location: IChatWidget['location'] = 'panel' as IChatWidget['location'];
	override input = stubInterface<ChatInputPart>({ runtimeContext: undefined });
	override viewModel = stubInterface<IChatViewModel>({ getItems: () => [] });
}

// Mock chat widget service
class MockChatWidgetService extends mock<IChatWidgetService>() {
	private _widgets: MockChatWidget[] = [];
	private _onDidAddWidget = new Emitter<IChatWidget>();
	private _contextDisposables: ChatRuntimeSessionContext[] = [];

	onDidAddWidget = this._onDidAddWidget.event;

	getAllWidgets(): ReadonlyArray<IChatWidget> { return this._widgets; }
	getWidgetBySessionId() { return this._widgets[0]; }
	getWidgetBySessionResource() { return this._widgets[0]; }

	addWidget() {
		const widget = new MockChatWidget();
		widget.input = stubInterface<ChatInputPart>({ runtimeContext: new ChatRuntimeSessionContext() });
		this._contextDisposables.push(widget.input.runtimeContext!);
		this._widgets.push(widget);
		this._onDidAddWidget.fire(widget);
		return widget;
	}

	// eslint-disable-next-line local/code-must-use-super-dispose -- mock<T>() has no real super.dispose()
	override dispose() {
		this._contextDisposables.forEach(d => d.dispose());
		this._contextDisposables = [];
		this._widgets = [];
		this._onDidAddWidget.dispose();
	}
}

// Mock chat service
class MockChatService extends mock<IChatService>() {
	private _onDidSubmitRequest = new Emitter<{ readonly chatSessionResource: URI }>();
	onDidSubmitRequest = this._onDidSubmitRequest.event;

	submitRequest(chatSessionId: string) {
		this._onDidSubmitRequest.fire({ chatSessionResource: URI.parse(chatSessionId) });
	}

	// eslint-disable-next-line local/code-must-use-super-dispose -- mock<T>() has no real super.dispose()
	override dispose() { this._onDidSubmitRequest.dispose(); }
}

// Mock editor service
class MockEditorService extends mock<IEditorService>() {
	private _activeEditor: IEditorService['activeEditor'];
	private _onDidActiveEditorChange = new Emitter<void>();

	onDidActiveEditorChange = this._onDidActiveEditorChange.event;
	get activeEditor() { return this._activeEditor; }

	setActiveEditor(editor: IEditorService['activeEditor']) {
		this._activeEditor = editor;
		this._onDidActiveEditorChange.fire();
	}

	// eslint-disable-next-line local/code-must-use-super-dispose -- mock<T>() has no real super.dispose()
	override dispose() { this._onDidActiveEditorChange.dispose(); }
}

class MockContextPickService extends mock<IChatContextPickService>() {
	registerChatContextItem(_item: IChatContextValueItem | IChatContextPickerItem): IDisposable {
		return { dispose: () => { /* no-op */ } };
	}
}


describe('ChatRuntimeSessionContext', () => {
	const ctx = createTestContainer()
		.withWorkbenchServices()
		.build();

	let configurationService: TestConfigurationService;
	let runtimeSessionService: MockRuntimeSessionService;
	let variablesService: MockPositronVariablesService;
	let executionHistoryService: MockExecutionHistoryService;
	let chatWidgetService: MockChatWidgetService;
	let chatService: MockChatService;
	let editorService: MockEditorService;
	let contextPickService: MockContextPickService;

	beforeEach(() => {
		configurationService = new TestConfigurationService();
		runtimeSessionService = new MockRuntimeSessionService();
		variablesService = new MockPositronVariablesService();
		executionHistoryService = new MockExecutionHistoryService();
		chatWidgetService = new MockChatWidgetService();
		ctx.disposables.add({ dispose: () => chatWidgetService.dispose() });
		chatService = new MockChatService();
		editorService = new MockEditorService();
		contextPickService = new MockContextPickService();

		ctx.instantiationService.stub(IConfigurationService, configurationService);
		ctx.instantiationService.stub(IRuntimeSessionService, runtimeSessionService);
		ctx.instantiationService.stub(IPositronVariablesService, variablesService);
		ctx.instantiationService.stub(IExecutionHistoryService, executionHistoryService);
		ctx.instantiationService.stub(IChatWidgetService, chatWidgetService);
		ctx.instantiationService.stub(IChatService, chatService);
		ctx.instantiationService.stub(IEditorService, editorService);
		ctx.instantiationService.stub(IChatContextPickService, contextPickService);
	});

	describe('ChatRuntimeSessionContext class', () => {
		it('should update name and description when session is set', () => {
			const context = ctx.disposables.add(new ChatRuntimeSessionContext());
			const session = new MockRuntimeSession();

			context.setValue(session);

			expect(context.name).toBe('Test Python Session');
			// eslint-disable-next-line local/code-no-unexternalized-strings -- test assertion, not a user-facing string
			expect(context.modelDescription).toBe("User's active runtime session");
		});

		it('should fire change event when value changes', () => {
			const context = ctx.disposables.add(new ChatRuntimeSessionContext());
			const session = new MockRuntimeSession();
			let changeFired = false;

			const listener = context.onDidChangeValue(() => {
				changeFired = true;
			});
			ctx.disposables.add(listener);

			context.setValue(session);
			expect(changeFired).toBe(true);
			expect(context.value).toBe(session);
		});

		it('should generate runtime session entries when session is set', async () => {
			const context = ctx.disposables.add(new ChatRuntimeSessionContext());
			const session = new MockRuntimeSession();

			// Set up services
			context.setServices(variablesService, executionHistoryService, configurationService);

			// Add some execution history
			executionHistoryService.addExecutionEntry('test-session-1', {
				id: 'exec-1',
				prompt: '>>> ',
				input: 'print("hello")',
				output: 'hello',
				debug: 'inactive',
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
			variablesService.addVariablesInstance(session, [testVariable]);

			context.setValue(session);

			const entries = await context.toBaseEntries();
			expect(entries.length).toBe(1);

			const entry = entries[0] as IChatRequestRuntimeSessionEntry;
			expect(entry.kind).toBe('runtimeSession');
			expect(entry.id).toBe('positron.implicit.runtimeSession');
			expect(entry.name).toBe('Test Python Session');
			expect(entry.value.activeSession).toBeTruthy();
			expect(entry.value.activeSession!.identifier).toBe('test-session-1');
			expect(entry.value.activeSession!.language).toBe('Python');
			expect(entry.value.activeSession!.version).toBe('3.9.0');
			expect(entry.value.activeSession!.mode).toBe('console');
			expect(entry.value.activeSession!.executions.length).toBe(1);
			expect(entry.value.activeSession!.executions[0].input).toBe('print("hello")');
			expect(entry.value.activeSession!.executions[0].output).toBe('hello');
			expect(entry.value.variables.length).toBe(1);
			expect(entry.value.variables[0].access_key).toBe('x');
		});

		it('should handle notebook sessions', async () => {
			const context = ctx.disposables.add(new ChatRuntimeSessionContext());
			const session = new MockNotebookRuntimeSession();

			context.setServices(variablesService, executionHistoryService, configurationService);
			context.setValue(session);

			const entries = await context.toBaseEntries();
			const entry = entries[0] as IChatRequestRuntimeSessionEntry;

			expect(entry.value.activeSession!.mode).toBe('notebook');
			expect(entry.value.activeSession!.notebookUri).toBeTruthy();
		});

		it('should handle execution history with errors', async () => {
			const context = ctx.disposables.add(new ChatRuntimeSessionContext());
			const session = new MockRuntimeSession();

			context.setServices(variablesService, executionHistoryService, configurationService);

			// Add execution with error
			executionHistoryService.addExecutionEntry('test-session-1', {
				id: 'exec-error',
				prompt: '>>> ',
				input: 'undefined_variable',
				output: '',
				debug: 'inactive',
				error: { name: 'NameError', message: 'name "undefined_variable" is not defined', traceback: ['Traceback: ...'] },
				outputType: ExecutionEntryType.Execution,
				when: Date.now(),
				durationMs: 25
			});

			context.setValue(session);

			const entries = await context.toBaseEntries();
			const entry = entries[0] as IChatRequestRuntimeSessionEntry;

			expect(entry.value.activeSession!.executions.length).toBe(1);
			expect(entry.value.activeSession!.executions[0].error).toBeTruthy();
			expect((entry.value.activeSession!.executions[0].error as { name: string }).name).toBe('NameError');
		});
	});

	describe('ChatRuntimeSessionContextContribution', () => {
		it('should initialize with configuration', () => {
			configurationService.setUserConfiguration('chat.implicitSessionContext.enabled', {
				panel: 'always'
			});

			const contribution = ctx.disposables.add(ctx.instantiationService.createInstance(
				ChatRuntimeSessionContextContribution
			));

			expect(contribution).toBeTruthy();
		});

		it('should respect "never" configuration setting', async () => {
			configurationService.setUserConfiguration('chat.implicitSessionContext.enabled', {
				panel: 'never'
			});

			const widget = chatWidgetService.addWidget();
			ctx.disposables.add(ctx.instantiationService.createInstance(
				ChatRuntimeSessionContextContribution
			));

			const session = new MockRuntimeSession();
			runtimeSessionService.addSession(session);

			// Set services on the widget's runtime context
			widget.input.runtimeContext!.setServices(variablesService, executionHistoryService, configurationService);

			// Change foreground session
			runtimeSessionService.setForegroundSession(session);

			// Allow async updates to complete
			await new Promise(resolve => setTimeout(resolve, 10));

			expect(widget.input.runtimeContext!.enabled).toBe(false);
		});

		it('should update context when configuration changes', async () => {
			configurationService.setUserConfiguration('chat.implicitSessionContext.enabled', {
				panel: 'never'
			});

			const widget = chatWidgetService.addWidget();
			ctx.disposables.add(ctx.instantiationService.createInstance(
				ChatRuntimeSessionContextContribution
			));

			const session = new MockRuntimeSession();
			runtimeSessionService.addSession(session);
			runtimeSessionService.setForegroundSession(session);

			// Set services on the widget's runtime context
			widget.input.runtimeContext!.setServices(variablesService, executionHistoryService, configurationService);

			// Allow async updates to complete
			await new Promise(resolve => setTimeout(resolve, 10));

			expect(widget.input.runtimeContext!.enabled).toBe(false);

			// Change configuration to always
			configurationService.setUserConfiguration('chat.implicitSessionContext.enabled', {
				panel: 'always'
			});

			// Trigger configuration change event
			configurationService.onDidChangeConfigurationEmitter.fire({
				affectsConfiguration: (key: string) => key === 'chat.implicitSessionContext.enabled',
				affectedKeys: new Set(['chat.implicitSessionContext.enabled']),
				source: ConfigurationTarget.User,
				change: { keys: ['chat.implicitSessionContext.enabled'], overrides: [] }
			});

			// Allow async updates to complete
			await new Promise(resolve => setTimeout(resolve, 10));

			expect(widget.input.runtimeContext!.enabled).toBe(true);
		});
	});
});
