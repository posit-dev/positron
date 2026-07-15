/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Emitter, Event } from '../../../../../base/common/event.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { MockContextKeyService } from '../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { TextResourceEditorInput } from '../../../../common/editor/textResourceEditorInput.js';
import { ILanguageRuntimeExit, ILanguageRuntimeInfo, ILanguageRuntimeSessionState, LanguageRuntimeSessionMode, RuntimeExitReason, RuntimeState } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession, IRuntimeSessionMetadata, IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { TestEditorInput, TestEditorService } from '../../../../test/browser/workbenchTestServices.js';
import { NotebookEditorInput } from '../../../notebook/common/notebookEditorInput.js';
import { ActiveRuntimeNotebookContextManager, DebuggerRuntimeSupportedFeature } from '../../common/activeRuntimeNotebookContextManager.js';
import { isEqual } from '../../../../../base/common/resources.js';
import { isNotebookLanguageRuntimeSession } from '../../../../services/runtimeSession/common/runtimeSession.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';

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

class MockRuntimeSession extends mock<ILanguageRuntimeSession>() {
	private readonly _disposables = new DisposableStore();
	private _runtimeInfo: ILanguageRuntimeInfo = {
		banner: 'Test Runtime',
		implementation_version: '1.0.0',
		language_version: '1.0.0',
		supported_features: [],
	};
	private _onDidChangeRuntimeState = this._disposables.add(new Emitter<RuntimeState>());
	private _onDidCompleteStartup = this._disposables.add(new Emitter<ILanguageRuntimeInfo>());
	private _onDidEndSession = this._disposables.add(new Emitter<ILanguageRuntimeExit>());
	override metadata: IRuntimeSessionMetadata;
	override dynState: ILanguageRuntimeSessionState = stubInterface<ILanguageRuntimeSessionState>({ currentWorkingDirectory: '' });
	override onDidChangeRuntimeState = this._onDidChangeRuntimeState.event;
	override onDidCompleteStartup = this._onDidCompleteStartup.event;
	override onDidEndSession = this._onDidEndSession.event;
	override onDidReceiveRuntimeClientEvent = Event.None;

	constructor(notebookUri: URI | undefined, sessionMode: LanguageRuntimeSessionMode) {
		super();
		this.metadata = stubInterface<IRuntimeSessionMetadata>({
			sessionId: generateUuid(),
			notebookUri,
			sessionMode,
		});
	}

	override get runtimeInfo() { return this._runtimeInfo; }
	enableDebuggingSupport() { this._runtimeInfo.supported_features!.push(DebuggerRuntimeSupportedFeature); }

	setState(state: RuntimeState) {
		this._onDidChangeRuntimeState.fire(state);
	}

	override async start() {
		this.setState(RuntimeState.Ready);
		this._onDidCompleteStartup.fire(this._runtimeInfo);
		return this._runtimeInfo;
	}

	endSession(): void {
		this.setState(RuntimeState.Exited);
		this._onDidEndSession.fire({
			exit_code: 0,
			reason: RuntimeExitReason.Shutdown,
			runtime_name: 'test-runtime',
			session_name: 'test-session',
			message: 'Session ended'
		});
	}

	// eslint-disable-next-line local/code-must-use-super-dispose
	override dispose() { this._disposables.dispose(); }
}

class MockRuntimeSessionService extends mock<IRuntimeSessionService>() {
	private _sessions: Map<string, ILanguageRuntimeSession> = new Map();
	private _onDidStartRuntime = new Emitter<ILanguageRuntimeSession>();
	override onDidStartRuntime = this._onDidStartRuntime.event;
	override onDidUpdateNotebookSessionUri = Event.None;

	override get activeSessions() { return Array.from(this._sessions.values()); }

	startSession(session: ILanguageRuntimeSession) {
		this._sessions.set(session.metadata.sessionId, session);
		this._onDidStartRuntime.fire(session);
	}

	override getNotebookSessionForNotebookUri(notebookUri: URI) {
		return this.activeSessions.filter(isNotebookLanguageRuntimeSession).find(session => isEqual(session.metadata.notebookUri, notebookUri));
	}

	// eslint-disable-next-line local/code-must-use-super-dispose
	dispose() { this._onDidStartRuntime.dispose(); }
}

describe('ActiveRuntimeNotebookContextManager', () => {
	const textUri = URI.file('script.py');
	const notebookUri = URI.file('notebook.ipynb');
	const notebookUri2 = URI.file('notebook2.ipynb');

	const ctx = createTestContainer()
		.withRuntimeServices()
		.stub(IContextKeyService, new MockContextKeyService())
		.build();

	let editorService: TestEditorService2;
	let runtimeSessionService: MockRuntimeSessionService;
	let notebookEditorInput: TestEditorInput;
	let notebookEditorInput2: TestEditorInput;
	let textEditorInput: TestEditorInput;
	let notebookSession: MockRuntimeSession;
	let notebookSession2: MockRuntimeSession;
	let consoleSession: MockRuntimeSession;
	let manager: ActiveRuntimeNotebookContextManager;

	beforeEach(() => {
		editorService = ctx.disposables.add(new TestEditorService2());
		runtimeSessionService = ctx.disposables.add(new MockRuntimeSessionService());
		notebookEditorInput = ctx.disposables.add(new TestEditorInput(notebookUri, NotebookEditorInput.ID));
		notebookEditorInput2 = ctx.disposables.add(new TestEditorInput(notebookUri2, NotebookEditorInput.ID));
		textEditorInput = ctx.disposables.add(new TestEditorInput(textUri, TextResourceEditorInput.ID));
		notebookSession = ctx.disposables.add(new MockRuntimeSession(notebookUri, LanguageRuntimeSessionMode.Notebook));
		notebookSession2 = ctx.disposables.add(new MockRuntimeSession(notebookUri2, LanguageRuntimeSessionMode.Notebook));
		consoleSession = ctx.disposables.add(new MockRuntimeSession(undefined, LanguageRuntimeSessionMode.Console));

		ctx.instantiationService.stub(IEditorService, editorService);
		ctx.instantiationService.stub(IRuntimeSessionService, runtimeSessionService);

		manager = ctx.disposables.add(ctx.instantiationService.createInstance(ActiveRuntimeNotebookContextManager));
	});

	it('start session without active notebook', () => {
		runtimeSessionService.startSession(notebookSession);

		expect(manager.activeNotebookHasRunningRuntime.get()).toBe(false);
		expect(manager.activeNotebookRuntimeSupportsDebugging.get()).toBe(false);
	});

	it('open notebook without active session', () => {
		editorService.activeEditor = notebookEditorInput;

		expect(manager.activeNotebookHasRunningRuntime.get()).toBe(false);
		expect(manager.activeNotebookRuntimeSupportsDebugging.get()).toBe(false);
	});

	it(`session enters 'ready' state with active notebook, no debugger`, () => {
		runtimeSessionService.startSession(notebookSession);
		editorService.activeEditor = notebookEditorInput;

		notebookSession.setState(RuntimeState.Ready);

		expect(manager.activeNotebookHasRunningRuntime.get()).toBe(true);
		expect(manager.activeNotebookRuntimeSupportsDebugging.get()).toBe(false);
	});

	it(`session enters 'ready' state with active notebook, with debugger`, () => {
		runtimeSessionService.startSession(notebookSession);
		editorService.activeEditor = notebookEditorInput;
		notebookSession.enableDebuggingSupport();

		notebookSession.setState(RuntimeState.Ready);

		expect(manager.activeNotebookHasRunningRuntime.get()).toBe(true);
		expect(manager.activeNotebookRuntimeSupportsDebugging.get()).toBe(true);
	});

	it('open notebook with active session, no debugger', () => {
		runtimeSessionService.startSession(notebookSession);

		editorService.activeEditor = notebookEditorInput;

		expect(manager.activeNotebookHasRunningRuntime.get()).toBe(true);
		expect(manager.activeNotebookRuntimeSupportsDebugging.get()).toBe(false);
	});

	it('open notebook with active session, with debugger', () => {
		runtimeSessionService.startSession(notebookSession);
		notebookSession.enableDebuggingSupport();

		editorService.activeEditor = notebookEditorInput;

		expect(manager.activeNotebookHasRunningRuntime.get()).toBe(true);
		expect(manager.activeNotebookRuntimeSupportsDebugging.get()).toBe(true);
	});

	describe('session enters exiting state', () => {
		for (const state of [RuntimeState.Uninitialized, RuntimeState.Exiting, RuntimeState.Restarting]) {
			it(`state: ${state}, with active notebook, with debugger`, () => {
				editorService.activeEditor = notebookEditorInput;
				notebookSession.enableDebuggingSupport();

				runtimeSessionService.startSession(notebookSession);
				expect(manager.activeNotebookHasRunningRuntime.get()).toBe(true);
				expect(manager.activeNotebookRuntimeSupportsDebugging.get()).toBe(true);

				notebookSession.setState(RuntimeState.Exiting);
				expect(manager.activeNotebookHasRunningRuntime.get()).toBe(false);
				expect(manager.activeNotebookRuntimeSupportsDebugging.get()).toBe(false);
			});
		}
	});

	it('session ends with active notebook, with debugger', () => {
		editorService.activeEditor = notebookEditorInput;
		notebookSession.enableDebuggingSupport();

		runtimeSessionService.startSession(notebookSession);
		expect(manager.activeNotebookHasRunningRuntime.get()).toBe(true);
		expect(manager.activeNotebookRuntimeSupportsDebugging.get()).toBe(true);

		notebookSession.endSession();
		expect(manager.activeNotebookHasRunningRuntime.get()).toBe(false);
		expect(manager.activeNotebookRuntimeSupportsDebugging.get()).toBe(false);
	});

	it('switch editors, with debugger', () => {
		editorService.activeEditor = notebookEditorInput;
		notebookSession.enableDebuggingSupport();
		runtimeSessionService.startSession(notebookSession);

		editorService.activeEditor = textEditorInput;
		expect(manager.activeNotebookHasRunningRuntime.get()).toBe(false);
		expect(manager.activeNotebookRuntimeSupportsDebugging.get()).toBe(false);

		editorService.activeEditor = notebookEditorInput;
		expect(manager.activeNotebookHasRunningRuntime.get()).toBe(true);
		expect(manager.activeNotebookRuntimeSupportsDebugging.get()).toBe(true);

		editorService.activeEditor = notebookEditorInput2;
		expect(manager.activeNotebookHasRunningRuntime.get()).toBe(false);
		expect(manager.activeNotebookRuntimeSupportsDebugging.get()).toBe(false);
	});

	it('ignores inactive notebook session', () => {
		notebookSession2.enableDebuggingSupport();
		editorService.activeEditor = notebookEditorInput;

		runtimeSessionService.startSession(notebookSession2);
		expect(manager.activeNotebookHasRunningRuntime.get()).toBe(false);
		expect(manager.activeNotebookRuntimeSupportsDebugging.get()).toBe(false);
	});

	it('ignores console sessions', () => {
		consoleSession.enableDebuggingSupport();
		editorService.activeEditor = notebookEditorInput;

		runtimeSessionService.startSession(consoleSession);
		expect(manager.activeNotebookHasRunningRuntime.get()).toBe(false);
		expect(manager.activeNotebookRuntimeSupportsDebugging.get()).toBe(false);
	});
});
