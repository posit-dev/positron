/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
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
import { isNotebookLanguageRuntimeSession } from '../../../../services/runtimeSession/common/runtimeSession.js';
import { createTestContainer } from '../../../../test/browser/positronTestContainer.js';

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

	constructor(notebookUri: URI | undefined, sessionMode: LanguageRuntimeSessionMode) {
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
		return this.activeSessions.filter(isNotebookLanguageRuntimeSession).find(session => isEqual(session.metadata.notebookUri, notebookUri));
	}
}

describe('ActiveRuntimeNotebookContextManager', () => {
	const ctx = createTestContainer().build();
	const disposables = ctx.disposables;

	const textUri = URI.file('script.py');
	const notebookUri = URI.file('notebook.ipynb');
	const notebookUri2 = URI.file('notebook2.ipynb');

	let editorService: TestEditorService2;
	let instantiationService: TestInstantiationService;
	let runtimeSessionService: MockRuntimeSessionService;
	let notebookEditorInput: TestEditorInput;
	let notebookEditorInput2: TestEditorInput;
	let textEditorInput: TestEditorInput;
	let notebookSession: MockRuntimeSession;
	let notebookSession2: MockRuntimeSession;
	let consoleSession: MockRuntimeSession;
	let manager: ActiveRuntimeNotebookContextManager;
	beforeEach(() => {
		editorService = disposables.add(new TestEditorService2());
		runtimeSessionService = disposables.add(new MockRuntimeSessionService());
		instantiationService = new TestInstantiationService();
		notebookEditorInput = disposables.add(new TestEditorInput(notebookUri, NotebookEditorInput.ID));
		notebookEditorInput2 = disposables.add(new TestEditorInput(notebookUri2, NotebookEditorInput.ID));
		textEditorInput = disposables.add(new TestEditorInput(textUri, TextResourceEditorInput.ID));
		notebookSession = disposables.add(new MockRuntimeSession(notebookUri, LanguageRuntimeSessionMode.Notebook));
		notebookSession2 = disposables.add(new MockRuntimeSession(notebookUri2, LanguageRuntimeSessionMode.Notebook));
		consoleSession = disposables.add(new MockRuntimeSession(undefined, LanguageRuntimeSessionMode.Console));

		instantiationService.stub(IEditorService, editorService);
		instantiationService.stub(IRuntimeSessionService, runtimeSessionService as any);
		instantiationService.stub(IContextKeyService, new MockContextKeyService());

		manager = disposables.add(instantiationService.createInstance(ActiveRuntimeNotebookContextManager));
	});

	it('start session without active notebook', () => {
		runtimeSessionService.startSession(notebookSession as any);

		expect(manager.activeNotebookHasRunningRuntime.get()).toBe(false);
		expect(manager.activeNotebookRuntimeSupportsDebugging.get()).toBe(false);
	});

	it('open notebook without active session', () => {
		editorService.activeEditor = notebookEditorInput;

		expect(manager.activeNotebookHasRunningRuntime.get()).toBe(false);
		expect(manager.activeNotebookRuntimeSupportsDebugging.get()).toBe(false);
	});

	it("session enters 'ready' state with active notebook, no debugger", () => {
		runtimeSessionService.startSession(notebookSession as any);
		editorService.activeEditor = notebookEditorInput;

		notebookSession.setState(RuntimeState.Ready);

		expect(manager.activeNotebookHasRunningRuntime.get()).toBe(true);
		expect(manager.activeNotebookRuntimeSupportsDebugging.get()).toBe(false);
	});

	it("session enters 'ready' state with active notebook, with debugger", () => {
		runtimeSessionService.startSession(notebookSession as any);
		editorService.activeEditor = notebookEditorInput;
		notebookSession.enableDebuggingSupport();

		notebookSession.setState(RuntimeState.Ready);

		expect(manager.activeNotebookHasRunningRuntime.get()).toBe(true);
		expect(manager.activeNotebookRuntimeSupportsDebugging.get()).toBe(true);
	});

	it('open notebook with active session, no debugger', () => {
		runtimeSessionService.startSession(notebookSession as any);

		editorService.activeEditor = notebookEditorInput;

		expect(manager.activeNotebookHasRunningRuntime.get()).toBe(true);
		expect(manager.activeNotebookRuntimeSupportsDebugging.get()).toBe(false);
	});

	it('open notebook with active session, with debugger', () => {
		runtimeSessionService.startSession(notebookSession as any);
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

				runtimeSessionService.startSession(notebookSession as any);
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

		runtimeSessionService.startSession(notebookSession as any);
		expect(manager.activeNotebookHasRunningRuntime.get()).toBe(true);
		expect(manager.activeNotebookRuntimeSupportsDebugging.get()).toBe(true);

		notebookSession.endSession();
		expect(manager.activeNotebookHasRunningRuntime.get()).toBe(false);
		expect(manager.activeNotebookRuntimeSupportsDebugging.get()).toBe(false);
	});

	it('switch editors, with debugger', () => {
		editorService.activeEditor = notebookEditorInput;
		notebookSession.enableDebuggingSupport();
		runtimeSessionService.startSession(notebookSession as any);

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

		runtimeSessionService.startSession(notebookSession2 as any);
		expect(manager.activeNotebookHasRunningRuntime.get()).toBe(false);
		expect(manager.activeNotebookRuntimeSupportsDebugging.get()).toBe(false);
	});

	it('ignores console sessions', () => {
		consoleSession.enableDebuggingSupport();
		editorService.activeEditor = notebookEditorInput;

		runtimeSessionService.startSession(consoleSession as any);
		expect(manager.activeNotebookHasRunningRuntime.get()).toBe(false);
		expect(manager.activeNotebookRuntimeSupportsDebugging.get()).toBe(false);
	});
});
