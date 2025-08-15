/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Emitter } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { MockContextKeyService } from '../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { TextResourceEditorInput } from '../../../../common/editor/textResourceEditorInput.js';
import { ILanguageRuntimeExit, ILanguageRuntimeInfo, LanguageRuntimeSessionMode, RuntimeExitReason, RuntimeState } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession, IRuntimeSessionMetadata, IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { TestEditorInput, TestEditorService } from '../../../../test/browser/workbenchTestServices.js';
import { NotebookEditorInput } from '../../../notebook/common/notebookEditorInput.js';
import { ActiveRuntimeNotebookContextManager, DebuggerRuntimeSupportedFeature } from '../../common/activeRuntimeNotebookContextManager.js';
import { isEqual } from '../../../../../base/common/resources.js';

/** A TestEditorService that fires the onDidActiveEditorChange event when changing the activeEditor. */
class TestEditorService2 extends TestEditorService {
	private readonly _onDidActiveEditorChange = this._register(new Emitter<void>());

	public override onDidActiveEditorChange = this._onDidActiveEditorChange.event;

	public override get activeEditor(): EditorInput | undefined {
		return super.activeEditor;
	}

	public override set activeEditor(value: EditorInput | undefined) {
		super.activeEditor = value;
		this._onDidActiveEditorChange.fire();
	}
}

class MockRuntimeSession extends Disposable implements Partial<ILanguageRuntimeSession> {
	private _runtimeInfo: ILanguageRuntimeInfo = {
		banner: 'Test Runtime',
		implementation_version: '1.0.0',
		language_version: '1.0.0',
		supported_features: [],
	};
	private _onDidChangeRuntimeState = this._register(new Emitter<RuntimeState>());
	private _onDidCompleteStartup = this._register(new Emitter<ILanguageRuntimeInfo>());
	private _onDidEndSession = this._register(new Emitter<ILanguageRuntimeExit>());
	metadata: IRuntimeSessionMetadata;
	onDidChangeRuntimeState = this._onDidChangeRuntimeState.event;
	onDidCompleteStartup = this._onDidCompleteStartup.event;
	onDidEndSession = this._onDidEndSession.event;

	constructor(notebookUri?: URI, sessionMode = LanguageRuntimeSessionMode.Notebook) {
		super();
		this.metadata = {
			sessionId: generateUuid(),
			notebookUri,
			sessionMode,
		} as any;
	}

	get runtimeInfo() { return this._runtimeInfo; }
	enableDebuggingSupport() { this._runtimeInfo.supported_features!.push(DebuggerRuntimeSupportedFeature); }

	setState(state: RuntimeState) {
		this._onDidChangeRuntimeState.fire(state);
	}

	async start() {
		this.setState(RuntimeState.Ready);
		this._onDidCompleteStartup.fire(this._runtimeInfo);
		return this._runtimeInfo;
	}

	async shutdown(exitReason: RuntimeExitReason): Promise<void> {
		this.setState(RuntimeState.Exited);
		this._onDidEndSession.fire({
			exit_code: 0,
			reason: exitReason,
			runtime_name: 'test-runtime',
			session_name: 'test-session',
			message: 'Session ended'
		});
	}
}

class MockRuntimeSessionService extends Disposable implements Partial<IRuntimeSessionService> {
	private _sessions: Map<string, ILanguageRuntimeSession> = new Map();
	_onDidStartRuntime = this._register(new Emitter<ILanguageRuntimeSession>());
	onDidStartRuntime = this._onDidStartRuntime.event;

	get activeSessions() { return Array.from(this._sessions.values()); }

	startSession(session: ILanguageRuntimeSession) {
		this._sessions.set(session.metadata.sessionId, session);
		this._onDidStartRuntime.fire(session);
	}

	getNotebookSessionForNotebookUri(notebookUri: URI) {
		return this.activeSessions.find(session => isEqual(session.metadata.notebookUri, notebookUri));
	}
}

suite('ActiveRuntimeNotebookContextManager', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	let editorService: TestEditorService2;
	let instantiationService: TestInstantiationService;
	let runtimeSessionService: MockRuntimeSessionService;

	setup(() => {
		editorService = disposables.add(new TestEditorService2());
		runtimeSessionService = disposables.add(new MockRuntimeSessionService());
		instantiationService = new TestInstantiationService();

		instantiationService.stub(IEditorService, editorService);
		instantiationService.stub(IRuntimeSessionService, runtimeSessionService as any);
		instantiationService.stub(IContextKeyService, new MockContextKeyService());
	});

	// === Initialization ===

	test('initializes with both contexts disabled', () => {
		const manager = disposables.add(instantiationService.createInstance(ActiveRuntimeNotebookContextManager));

		assert.strictEqual(manager.activeNotebookHasRunningRuntime.get(), false);
		assert.strictEqual(manager.activeNotebookRuntimeSupportsDebugging.get(), false);
	});

	// === Session Filtering ===

	test('ignores console and other non-notebook session types', async () => {
		const manager = disposables.add(instantiationService.createInstance(ActiveRuntimeNotebookContextManager));
		const session = disposables.add(new MockRuntimeSession(undefined, LanguageRuntimeSessionMode.Console));

		runtimeSessionService.startSession(session as any);

		assert.strictEqual(manager.activeNotebookHasRunningRuntime.get(), false);
		assert.strictEqual(manager.activeNotebookRuntimeSupportsDebugging.get(), false);
	});

	// === Editor Change Handling ===

	test('keeps contexts disabled when activating notebook without session', async () => {
		const manager = disposables.add(instantiationService.createInstance(ActiveRuntimeNotebookContextManager));
		const notebookUri = URI.file('notebook.ipynb');
		const notebookEditorInput = disposables.add(new TestEditorInput(notebookUri, NotebookEditorInput.ID));

		editorService.activeEditor = notebookEditorInput;

		assert.strictEqual(manager.activeNotebookHasRunningRuntime.get(), false);
		assert.strictEqual(manager.activeNotebookRuntimeSupportsDebugging.get(), false);
	});

	test('disables contexts when switching to non-notebook editor', async () => {
		const manager = disposables.add(instantiationService.createInstance(ActiveRuntimeNotebookContextManager));
		const notebookUri = URI.file('notebook.ipynb');
		const textEditorInput = disposables.add(new TestEditorInput(notebookUri, TextResourceEditorInput.ID));
		const session = disposables.add(new MockRuntimeSession(notebookUri));
		runtimeSessionService.startSession(session as any);

		editorService.activeEditor = textEditorInput;

		assert.strictEqual(manager.activeNotebookHasRunningRuntime.get(), false);
		assert.strictEqual(manager.activeNotebookRuntimeSupportsDebugging.get(), false);
	});

	test('enables hasRunningRuntime when notebook has active session', async () => {
		const manager = disposables.add(instantiationService.createInstance(ActiveRuntimeNotebookContextManager));
		const notebookUri = URI.file('notebook.ipynb');
		const notebookEditorInput = disposables.add(new TestEditorInput(notebookUri, NotebookEditorInput.ID));
		const session = disposables.add(new MockRuntimeSession(notebookUri));

		// Test both scenarios: session first, then editor, and vice versa
		runtimeSessionService.startSession(session as any);
		editorService.activeEditor = notebookEditorInput;
		assert.strictEqual(manager.activeNotebookHasRunningRuntime.get(), true);

		// Reset and test opposite order
		editorService.activeEditor = undefined;
		const notebookUri2 = URI.file('notebook2.ipynb');
		const notebookEditorInput2 = disposables.add(new TestEditorInput(notebookUri2, NotebookEditorInput.ID));
		editorService.activeEditor = notebookEditorInput2;
		const session2 = disposables.add(new MockRuntimeSession(notebookUri2));
		runtimeSessionService.startSession(session2 as any);
		assert.strictEqual(manager.activeNotebookHasRunningRuntime.get(), true);
	});

	// === Event Isolation (Inactive Notebooks) ===

	test('ignores runtime state changes from inactive notebook sessions', async () => {
		const manager = disposables.add(instantiationService.createInstance(ActiveRuntimeNotebookContextManager));
		const notebookUri1 = URI.file('notebook1.ipynb');
		const notebookUri2 = URI.file('notebook2.ipynb');
		const notebookEditorInput1 = disposables.add(new TestEditorInput(notebookUri1, NotebookEditorInput.ID));
		const session1 = disposables.add(new MockRuntimeSession(notebookUri1));
		const session2 = disposables.add(new MockRuntimeSession(notebookUri2));

		// Start both sessions
		runtimeSessionService.startSession(session1 as any);
		runtimeSessionService.startSession(session2 as any);

		// Make notebook1 active
		editorService.activeEditor = notebookEditorInput1;
		assert.strictEqual(manager.activeNotebookHasRunningRuntime.get(), true);

		// Change state of non-active notebook's session
		session2.setState(RuntimeState.Restarting);
		// Context should remain unchanged
		assert.strictEqual(manager.activeNotebookHasRunningRuntime.get(), true);

		// Change state of active notebook's session
		session1.setState(RuntimeState.Restarting);
		// Now context should change
		assert.strictEqual(manager.activeNotebookHasRunningRuntime.get(), false);
	});

	test('ignores onDidCompleteStartup events from inactive notebook sessions', async () => {
		const manager = disposables.add(instantiationService.createInstance(ActiveRuntimeNotebookContextManager));
		const notebookUri1 = URI.file('notebook1.ipynb');
		const notebookUri2 = URI.file('notebook2.ipynb');
		const notebookEditorInput1 = disposables.add(new TestEditorInput(notebookUri1, NotebookEditorInput.ID));
		const session1 = disposables.add(new MockRuntimeSession(notebookUri1));
		const session2 = disposables.add(new MockRuntimeSession(notebookUri2));

		// Start both sessions
		runtimeSessionService.startSession(session1 as any);
		runtimeSessionService.startSession(session2 as any);

		// Make notebook1 active
		editorService.activeEditor = notebookEditorInput1;

		// Complete startup for non-active notebook with debugging
		session2.enableDebuggingSupport();
		await session2.start();

		// Debugging context should remain false since it's not the active notebook
		assert.strictEqual(manager.activeNotebookRuntimeSupportsDebugging.get(), false);

		// Complete startup for active notebook with debugging
		session1.enableDebuggingSupport();
		await session1.start();

		// Now debugging should be enabled
		assert.strictEqual(manager.activeNotebookRuntimeSupportsDebugging.get(), true);
	});

	// === Runtime State Transitions ===

	test('disables contexts when session enters exiting or uninitialized states', async () => {
		const manager = disposables.add(instantiationService.createInstance(ActiveRuntimeNotebookContextManager));
		const notebookUri = URI.file('notebook.ipynb');
		const notebookEditorInput = disposables.add(new TestEditorInput(notebookUri, NotebookEditorInput.ID));
		const session = disposables.add(new MockRuntimeSession(notebookUri));
		runtimeSessionService.startSession(session as any);
		editorService.activeEditor = notebookEditorInput;

		session.setState(RuntimeState.Ready);
		assert.strictEqual(manager.activeNotebookHasRunningRuntime.get(), true);

		// Test Exiting state
		session.setState(RuntimeState.Exiting);
		assert.strictEqual(manager.activeNotebookHasRunningRuntime.get(), false);

		// Back to ready
		session.setState(RuntimeState.Ready);
		assert.strictEqual(manager.activeNotebookHasRunningRuntime.get(), true);

		// Test Uninitialized state
		session.setState(RuntimeState.Uninitialized);
		assert.strictEqual(manager.activeNotebookHasRunningRuntime.get(), false);

		// Test Restarting state
		session.setState(RuntimeState.Ready);
		assert.strictEqual(manager.activeNotebookHasRunningRuntime.get(), true);
		session.setState(RuntimeState.Restarting);
		assert.strictEqual(manager.activeNotebookHasRunningRuntime.get(), false);
	});

	// === Session Lifecycle & Debugging Support ===

	test('detects debugging support from pre-initialized session on attach', async () => {
		const manager = disposables.add(instantiationService.createInstance(ActiveRuntimeNotebookContextManager));
		const notebookUri = URI.file('notebook.ipynb');
		const notebookEditorInput = disposables.add(new TestEditorInput(notebookUri, NotebookEditorInput.ID));
		const session = disposables.add(new MockRuntimeSession(notebookUri));

		// Set debugging support and start session before attaching
		session.enableDebuggingSupport();
		await session.start();

		// Make notebook active first
		editorService.activeEditor = notebookEditorInput;

		// Now start the session (which triggers attach)
		runtimeSessionService.startSession(session as any);

		// Debugging support should be set immediately from existing runtimeInfo
		assert.strictEqual(manager.activeNotebookRuntimeSupportsDebugging.get(), true);
	});

	test('enables supportsDebugging when runtime completes startup with debugger feature', async () => {
		const manager = disposables.add(instantiationService.createInstance(ActiveRuntimeNotebookContextManager));
		const notebookUri = URI.file('notebook.ipynb');
		const notebookEditorInput = disposables.add(new TestEditorInput(notebookUri, NotebookEditorInput.ID));
		const session = disposables.add(new MockRuntimeSession(notebookUri));


		runtimeSessionService.startSession(session as any);
		editorService.activeEditor = notebookEditorInput;

		// Complete startup with debugging support
		session.enableDebuggingSupport();
		await session.start();

		assert.strictEqual(manager.activeNotebookHasRunningRuntime.get(), true);
		assert.strictEqual(manager.activeNotebookRuntimeSupportsDebugging.get(), true);
	});

	test('updates debugging context when switching between notebooks with different capabilities', async () => {
		const manager = disposables.add(instantiationService.createInstance(ActiveRuntimeNotebookContextManager));
		const notebookUri = URI.file('notebook.ipynb');
		const notebookEditorInput = disposables.add(new TestEditorInput(notebookUri, NotebookEditorInput.ID));
		const notebookUri2 = URI.file('notebook2.ipynb');
		const notebookEditorInput2 = disposables.add(new TestEditorInput(notebookUri2, NotebookEditorInput.ID));

		// Start first session with debugging support
		const session1 = disposables.add(new MockRuntimeSession(notebookUri));
		runtimeSessionService.startSession(session1 as any);
		editorService.activeEditor = notebookEditorInput;

		session1.enableDebuggingSupport();
		await session1.start();

		assert.strictEqual(manager.activeNotebookRuntimeSupportsDebugging.get(), true);

		// Start second session without debugging support
		const session2 = disposables.add(new MockRuntimeSession(notebookUri2));
		runtimeSessionService.startSession(session2 as any);

		// Switch to second notebook first
		editorService.activeEditor = notebookEditorInput2;

		// Then complete startup for second session without debugging
		await session2.start();

		// Second session has no debugging support
		assert.strictEqual(manager.activeNotebookHasRunningRuntime.get(), true);
		assert.strictEqual(manager.activeNotebookRuntimeSupportsDebugging.get(), false);

		// Switch back to first notebook
		editorService.activeEditor = notebookEditorInput;
		assert.strictEqual(manager.activeNotebookRuntimeSupportsDebugging.get(), true);
	});

	test('disables both contexts when active session ends', async () => {
		const manager = disposables.add(instantiationService.createInstance(ActiveRuntimeNotebookContextManager));
		const notebookUri = URI.file('notebook.ipynb');
		const notebookEditorInput = disposables.add(new TestEditorInput(notebookUri, NotebookEditorInput.ID));
		const session = disposables.add(new MockRuntimeSession(notebookUri));
		runtimeSessionService.startSession(session as any);
		editorService.activeEditor = notebookEditorInput;

		// Set session to ready state first
		session.setState(RuntimeState.Ready);

		// Set up debugging support
		session.enableDebuggingSupport();
		await session.start();

		assert.strictEqual(manager.activeNotebookHasRunningRuntime.get(), true);
		assert.strictEqual(manager.activeNotebookRuntimeSupportsDebugging.get(), true);

		// End the session
		await session.shutdown(RuntimeExitReason.Shutdown);

		// Both contexts should be disabled
		assert.strictEqual(manager.activeNotebookHasRunningRuntime.get(), false);
		assert.strictEqual(manager.activeNotebookRuntimeSupportsDebugging.get(), false);
	});

});
