/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { ICodeEditor } from '../../../../../editor/browser/editorBrowser.js';
import { ICodeEditorService } from '../../../../../editor/browser/services/codeEditorService.js';
import { ITextModel } from '../../../../../editor/common/model.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { LanguageRuntimeSessionMode, RuntimeState } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession, IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { TestLanguageRuntimeSession, waitForRuntimeState } from '../../../../services/runtimeSession/test/common/testLanguageRuntimeSession.js';
import { createTestLanguageRuntimeMetadata, startTestLanguageRuntimeSession } from '../../../../services/runtimeSession/test/common/testRuntimeSessionService.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IPositronNotebookInstance } from '../../../positronNotebook/browser/IPositronNotebookInstance.js';
import { IPositronNotebookService } from '../../../positronNotebook/browser/positronNotebookService.js';
import { IQuartoKernelManager } from '../../../positronQuarto/browser/quartoKernelManager.js';
import { ForegroundSessionContribution } from '../../browser/foregroundSessionContribution.js';
import { POSITRON_NOTEBOOK_EDITOR_INPUT_ID } from '../../../positronNotebook/common/positronNotebookCommon.js';
import { QUARTO_INLINE_OUTPUT_ENABLED_KEY } from '../../../positronQuarto/common/positronQuartoConfig.js';

describe('Positron - ForegroundSessionContribution', () => {

	// --- Emitters for controllable service stubs (override preset defaults) ---
	const onDidActiveEditorChange = new Emitter<void>();
	const onDidAddNotebookInstance = new Emitter<IPositronNotebookInstance>();
	const onDidRemoveNotebookInstance = new Emitter<IPositronNotebookInstance>();

	// --- Mutable state set in tests ---
	let activeEditor: EditorInput | undefined;
	let activeCodeEditor: ICodeEditor | undefined;
	let notebookInstances: IPositronNotebookInstance[] = [];
	let quartoSessionForDocument: ILanguageRuntimeSession | undefined;

	// Use withContributionServices() for Event.None defaults, then override
	// the specific services this test needs to control via emitters/getters.
	const ctx = createTestContainer()
		.withContributionServices()
		.stub(IEditorService, {
			get activeEditor() { return activeEditor; },
			onDidActiveEditorChange: onDidActiveEditorChange.event,
		} as IEditorService)
		.stub(IPositronNotebookService, {
			onDidAddNotebookInstance: onDidAddNotebookInstance.event,
			onDidRemoveNotebookInstance: onDidRemoveNotebookInstance.event,
			listInstances: () => notebookInstances,
		} as IPositronNotebookService)
		.stub(IQuartoKernelManager, {
			getSessionForDocument: () => quartoSessionForDocument,
		} as unknown as IQuartoKernelManager)
		.stub(ICodeEditorService, {
			onCodeEditorAdd: Event.None,
			onCodeEditorRemove: Event.None,
			listCodeEditors: () => [],
			getActiveCodeEditor: () => activeCodeEditor,
		} as unknown as ICodeEditorService)
		.build();

	let runtimeSessionService: IRuntimeSessionService;
	let configService: TestConfigurationService;
	const notebookUri = URI.file('/path/to/notebook.ipynb');

	/** Read foregroundSession through a helper to avoid TS control-flow narrowing after assignment. */
	function getForegroundSessionId(): string | undefined {
		return runtimeSessionService.foregroundSession?.sessionId;
	}

	afterAll(() => {
		onDidActiveEditorChange.dispose();
		onDidAddNotebookInstance.dispose();
		onDidRemoveNotebookInstance.dispose();
	});

	beforeEach(() => {
		runtimeSessionService = ctx.instantiationService.get(IRuntimeSessionService);
		configService = ctx.instantiationService.get(IConfigurationService) as TestConfigurationService;

		// Reset mutable state
		activeEditor = undefined;
		activeCodeEditor = undefined;
		notebookInstances = [];
		quartoSessionForDocument = undefined;

		// Reset Quarto config to avoid leakage between tests
		configService.setUserConfiguration(QUARTO_INLINE_OUTPUT_ENABLED_KEY, undefined);

		// Create the contribution -- the constructor wires up event listeners that
		// the tests exercise by firing events, so we don't need a reference to it.
		ctx.disposables.add(
			ctx.instantiationService.createInstance(ForegroundSessionContribution)
		);
	});

	/** Create a mock notebook EditorInput that passes isNotebookEditorInput(). */
	function createNotebookEditorInput(uri: URI): EditorInput {
		return { typeId: POSITRON_NOTEBOOK_EDITOR_INPUT_ID, resource: uri } as unknown as EditorInput;
	}

	/** Create a mock ICodeEditor with a model for the given URI and language. */
	function createMockCodeEditor(uri: URI, languageId: string): ICodeEditor {
		const model = {
			uri,
			getLanguageId: () => languageId,
		} as ITextModel;
		return {
			getId: () => `editor-${uri.toString()}`,
			getModel: () => model,
			onDidFocusEditorWidget: Event.None,
		} as unknown as ICodeEditor;
	}

	/** Start a console session and set it as foreground. */
	async function startConsoleSession() {
		const runtime = await createTestLanguageRuntimeMetadata(ctx.instantiationService, ctx.disposables);
		const session = await startTestLanguageRuntimeSession(
			ctx.instantiationService, ctx.disposables, {
			runtime,
			sessionName: runtime.runtimeName,
			sessionMode: LanguageRuntimeSessionMode.Console,
		});
		runtimeSessionService.foregroundSession = session;
		return session;
	}

	/** Start a notebook session for the given URI. */
	async function startNotebookSession(uri: URI = notebookUri) {
		const runtime = await createTestLanguageRuntimeMetadata(ctx.instantiationService, ctx.disposables);
		const session = await startTestLanguageRuntimeSession(
			ctx.instantiationService, ctx.disposables, {
			runtime,
			sessionName: runtime.runtimeName,
			sessionMode: LanguageRuntimeSessionMode.Notebook,
			notebookUri: uri,
		});
		return session;
	}

	describe('active editor change to notebook', () => {
		it('sets notebook session as foreground when notebook becomes active', async () => {
			const session = await startNotebookSession();

			activeEditor = createNotebookEditorInput(notebookUri);
			onDidActiveEditorChange.fire();

			expect(runtimeSessionService.foregroundSession?.sessionId).toBe(session.sessionId);
		});

		it('no-op when notebook editor is already the foreground session', async () => {
			const session = await startNotebookSession();
			runtimeSessionService.foregroundSession = session;

			activeEditor = createNotebookEditorInput(notebookUri);
			onDidActiveEditorChange.fire();

			expect(runtimeSessionService.foregroundSession?.sessionId).toBe(session.sessionId);
		});

		// With no console running, a notebook in a preview tab has no session to
		// show, so the interpreter picker stays on "Start Session".
		it('leaves no foreground session when no sessions exist and a sessionless notebook is active', () => {
			activeEditor = createNotebookEditorInput(notebookUri);
			onDidActiveEditorChange.fire();

			expect(runtimeSessionService.foregroundSession).toBe(undefined);
			expect(runtimeSessionService.foregroundSessionDisplayInfo).toBe(undefined);
		});

		it('keeps the console as foreground when a sessionless notebook is active', async () => {
			const consoleSession = await startConsoleSession();
			await waitForRuntimeState(consoleSession, RuntimeState.Ready);

			activeEditor = createNotebookEditorInput(notebookUri);
			onDidActiveEditorChange.fire();

			expect(getForegroundSessionId()).toBe(consoleSession.sessionId);
		});

		// A notebook whose earlier session ended has no session now, so the
		// foreground stays where it was.
		it('keeps the console as foreground when a notebook whose session ended becomes active', async () => {
			const consoleSession = await startConsoleSession();
			await waitForRuntimeState(consoleSession, RuntimeState.Ready);

			// Start and exit a notebook session, so the service remembers it
			const session = await startNotebookSession();
			const exitedPromise = waitForRuntimeState(session, RuntimeState.Exited);
			session.setRuntimeState(RuntimeState.Exited);
			await exitedPromise;
			await runtimeSessionService.deleteSession(session.sessionId);

			// Set the notebook as active editor
			activeEditor = createNotebookEditorInput(notebookUri);
			onDidActiveEditorChange.fire();

			expect(getForegroundSessionId()).toBe(consoleSession.sessionId);
			expect(runtimeSessionService.foregroundSessionDisplayInfo?.sessionMode).toBe(LanguageRuntimeSessionMode.Console);
		});
	});

	describe('active editor change to regular file', () => {
		it('restores last active console session', async () => {
			await startConsoleSession();

			// Switch to notebook first
			const notebookSession = await startNotebookSession();
			runtimeSessionService.foregroundSession = notebookSession;

			// Now switch to a regular file
			const codeEditor = createMockCodeEditor(URI.file('/path/to/file.py'), 'python');
			activeEditor = { typeId: 'text', resource: URI.file('/path/to/file.py') } as unknown as EditorInput;
			activeCodeEditor = codeEditor;
			onDidActiveEditorChange.fire();

			expect(runtimeSessionService.foregroundSession?.sessionId).toBe(
				runtimeSessionService.getLastActiveConsoleSession()?.sessionId
			);
		});

		it('clears notebook foreground when no console session exists', async () => {
			const notebookSession = await startNotebookSession();
			runtimeSessionService.foregroundSession = notebookSession;

			const codeEditor = createMockCodeEditor(URI.file('/path/to/file.py'), 'python');
			activeEditor = { typeId: 'text', resource: URI.file('/path/to/file.py') } as unknown as EditorInput;
			activeCodeEditor = codeEditor;
			onDidActiveEditorChange.fire();

			expect(runtimeSessionService.foregroundSession).toBe(undefined);
		});
	});

	describe('active editor change to no editor', () => {
		it('falls back to console session when notebook was foreground', async () => {
			const consoleSession = await startConsoleSession();
			const notebookSession = await startNotebookSession();
			runtimeSessionService.foregroundSession = notebookSession;

			activeEditor = undefined;
			onDidActiveEditorChange.fire();

			expect(runtimeSessionService.foregroundSession?.sessionId).toBe(consoleSession.sessionId);
		});

		it('no-op when foreground is already a console session', async () => {
			const consoleSession = await startConsoleSession();

			activeEditor = undefined;
			onDidActiveEditorChange.fire();

			expect(runtimeSessionService.foregroundSession?.sessionId).toBe(consoleSession.sessionId);
		});

		it('clears foreground when notebook was foreground and no console exists', async () => {
			const notebookSession = await startNotebookSession();
			runtimeSessionService.foregroundSession = notebookSession;

			activeEditor = undefined;
			onDidActiveEditorChange.fire();

			expect(runtimeSessionService.foregroundSession).toBe(undefined);
		});
	});

	describe('Quarto editor focus', () => {
		it('sets Quarto session as foreground when Quarto file is active and inline output enabled', async () => {
			configService.setUserConfiguration(QUARTO_INLINE_OUTPUT_ENABLED_KEY, true);

			const quartoUri = URI.file('/path/to/doc.qmd');
			const quartoSession = await startNotebookSession(quartoUri);
			quartoSessionForDocument = quartoSession;

			const codeEditor = createMockCodeEditor(quartoUri, 'quarto');
			activeEditor = { typeId: 'text', resource: quartoUri } as unknown as EditorInput;
			activeCodeEditor = codeEditor;
			onDidActiveEditorChange.fire();

			expect(runtimeSessionService.foregroundSession?.sessionId).toBe(quartoSession.sessionId);
		});

		it('does not set Quarto session when inline output is disabled', async () => {
			configService.setUserConfiguration(QUARTO_INLINE_OUTPUT_ENABLED_KEY, false);

			const quartoUri = URI.file('/path/to/doc.qmd');
			const quartoSession = await startNotebookSession(quartoUri);
			quartoSessionForDocument = quartoSession;

			const codeEditor = createMockCodeEditor(quartoUri, 'quarto');
			activeEditor = { typeId: 'text', resource: quartoUri } as unknown as EditorInput;
			activeCodeEditor = codeEditor;
			onDidActiveEditorChange.fire();

			// With inline output disabled, should not set Quarto session as foreground
			expect(runtimeSessionService.foregroundSession?.sessionId).not.toBe(quartoSession.sessionId);
		});
	});

	describe('notebook session lifecycle', () => {
		it('notebook session start sets foreground when notebook is active editor', async () => {
			// Set notebook as active editor before the session starts
			activeEditor = createNotebookEditorInput(notebookUri);
			onDidActiveEditorChange.fire();

			// Start the notebook session - the onDidStartRuntime event will fire
			const session = await startNotebookSession();

			expect(runtimeSessionService.foregroundSession?.sessionId).toBe(session.sessionId);
		});

		it('notebook session start does not steal foreground when different notebook is active', async () => {
			// notebook.ipynb has a running session and is the active editor
			const session = await startNotebookSession(notebookUri);
			activeEditor = createNotebookEditorInput(notebookUri);
			onDidActiveEditorChange.fire();

			expect(runtimeSessionService.foregroundSession?.sessionId).toBe(session.sessionId);

			// A different notebook starts its session in the background (e.g. auto-start)
			const otherNotebookUri = URI.file('/path/to/other.ipynb');
			await startNotebookSession(otherNotebookUri);

			// The foreground session should not have changed since it is not the active editor
			expect(runtimeSessionService.foregroundSession?.sessionId).toBe(session.sessionId);
		});

		it('notebook session becoming ready sets foreground when notebook is active', async () => {
			activeEditor = createNotebookEditorInput(notebookUri);
			onDidActiveEditorChange.fire();

			const session = await startNotebookSession();
			runtimeSessionService.foregroundSession = undefined;

			// Simulate the session becoming ready
			session.setRuntimeState(RuntimeState.Ready);

			expect(getForegroundSessionId()).toBe(session.sessionId);
		});

		/**
		 * Starts a notebook session whose start stays pending until the returned
		 * `finish` is called. Resolves once the session reports Starting.
		 */
		async function startHeldNotebookSession(uri: URI = notebookUri) {
			let finish!: () => void;
			const finished = new Promise<void>(resolve => finish = resolve);
			let reportStarting!: (session: TestLanguageRuntimeSession) => void;
			const startingReported = new Promise<TestLanguageRuntimeSession>(resolve => reportStarting = resolve);
			const originalStart = TestLanguageRuntimeSession.prototype.start;
			vi.spyOn(TestLanguageRuntimeSession.prototype, 'start').mockImplementationOnce(async function (this: TestLanguageRuntimeSession) {
				this.setRuntimeState(RuntimeState.Starting);
				reportStarting(this);
				await finished;
				return originalStart.call(this);
			});
			const started = startNotebookSession(uri);
			const session = await startingReported;
			return { session, finish: async () => { finish(); await started; } };
		}

		it('a starting notebook session becomes foreground when its notebook is active', async () => {
			const consoleSession = await startConsoleSession();
			await waitForRuntimeState(consoleSession, RuntimeState.Ready);
			activeEditor = createNotebookEditorInput(notebookUri);
			onDidActiveEditorChange.fire();

			const { session, finish } = await startHeldNotebookSession();

			// It is foreground while it starts, so the picker shows it starting.
			expect(getForegroundSessionId()).toBe(session.sessionId);
			await finish();
			expect(getForegroundSessionId()).toBe(session.sessionId);
		});

		it('a starting notebook session does not take foreground when its notebook is not active', async () => {
			const consoleSession = await startConsoleSession();
			await waitForRuntimeState(consoleSession, RuntimeState.Ready);
			activeEditor = createNotebookEditorInput(URI.file('/path/to/other.ipynb'));
			onDidActiveEditorChange.fire();

			const { finish } = await startHeldNotebookSession();

			expect(getForegroundSessionId()).toBe(consoleSession.sessionId);
			await finish();
		});

		it('a focus event while a previously run notebook starts does not clear the foreground', async () => {
			// Run and end a session, so the service remembers the notebook
			const oldSession = await startNotebookSession();
			const exitedPromise = waitForRuntimeState(oldSession, RuntimeState.Exited);
			oldSession.setRuntimeState(RuntimeState.Exited);
			await exitedPromise;
			await runtimeSessionService.deleteSession(oldSession.sessionId);

			const onDidFocusWidget = ctx.disposables.add(new Emitter<void>());
			const instance = {
				getId: () => 'instance-1',
				uri: notebookUri,
				onDidFocusWidget: onDidFocusWidget.event,
			} as unknown as IPositronNotebookInstance;
			notebookInstances = [instance];
			onDidAddNotebookInstance.fire(instance);
			activeEditor = createNotebookEditorInput(notebookUri);
			onDidActiveEditorChange.fire();

			const { session, finish } = await startHeldNotebookSession();
			// The new session is not in the notebook session map until it has started.
			onDidFocusWidget.fire();

			expect(getForegroundSessionId()).toBe(session.sessionId);
			await finish();
		});
	});

	describe('notebook instance removed', () => {
		it('falls back to console session when last notebook is removed', async () => {
			const consoleSession = await startConsoleSession();
			const notebookSession = await startNotebookSession();
			runtimeSessionService.foregroundSession = notebookSession;

			const mockInstance = {
				getId: () => 'instance-1',
				uri: notebookUri,
				onDidFocusWidget: Event.None,
			} as unknown as IPositronNotebookInstance;
			notebookInstances = [];

			onDidRemoveNotebookInstance.fire(mockInstance);

			expect(runtimeSessionService.foregroundSession?.sessionId).toBe(consoleSession.sessionId);
		});

		it('no-op when foreground is a console session', async () => {
			const consoleSession = await startConsoleSession();

			const mockInstance = {
				getId: () => 'instance-1',
				uri: notebookUri,
				onDidFocusWidget: Event.None,
			} as unknown as IPositronNotebookInstance;
			notebookInstances = [];

			onDidRemoveNotebookInstance.fire(mockInstance);

			expect(runtimeSessionService.foregroundSession?.sessionId).toBe(consoleSession.sessionId);
		});
	});

	describe('notebook session deleted', () => {
		it('shows a snapshot of the deleted session when it was the foreground notebook session', async () => {
			const session = await startNotebookSession();
			runtimeSessionService.foregroundSession = session;

			// Exit the session first (required before deletion)
			expect(session).toBeInstanceOf(TestLanguageRuntimeSession);
			const exitedPromise = waitForRuntimeState(session, RuntimeState.Exited);
			session.setRuntimeState(RuntimeState.Exited);
			await exitedPromise;

			// Delete the session through the service
			await runtimeSessionService.deleteSession(session.sessionId);

			// The foreground is cleared, and the picker shows the notebook as exited.
			expect(runtimeSessionService.foregroundSession).toBe(undefined);
			const info = runtimeSessionService.foregroundSessionDisplayInfo;
			expect([info?.notebookUri?.toString(), info?.sessionState]).toEqual([notebookUri.toString(), RuntimeState.Exited]);
		});

		/** Starts a notebook session for `notebookUri`, makes it foreground, then exits and deletes it. */
		async function shutDownForegroundNotebook() {
			const session = await startNotebookSession();
			runtimeSessionService.foregroundSession = session;
			const exitedPromise = waitForRuntimeState(session, RuntimeState.Exited);
			session.setRuntimeState(RuntimeState.Exited);
			await exitedPromise;
			await runtimeSessionService.deleteSession(session.sessionId);
		}

		it('drops the snapshot for the console when a different sessionless notebook becomes active', async () => {
			const consoleSession = await startConsoleSession();
			await waitForRuntimeState(consoleSession, RuntimeState.Ready);
			activeEditor = createNotebookEditorInput(notebookUri);
			onDidActiveEditorChange.fire();
			await shutDownForegroundNotebook();

			activeEditor = createNotebookEditorInput(URI.file('/path/to/other.ipynb'));
			onDidActiveEditorChange.fire();

			expect(getForegroundSessionId()).toBe(consoleSession.sessionId);
		});

		it('drops the snapshot when a file becomes active and no console exists', async () => {
			activeEditor = createNotebookEditorInput(notebookUri);
			onDidActiveEditorChange.fire();
			await shutDownForegroundNotebook();

			activeEditor = { typeId: 'text', resource: URI.file('/path/to/file.py') } as unknown as EditorInput;
			activeCodeEditor = createMockCodeEditor(URI.file('/path/to/file.py'), 'python');
			onDidActiveEditorChange.fire();

			expect(runtimeSessionService.foregroundSessionDisplayInfo).toBe(undefined);
		});

		it('keeps the snapshot while its notebook stays active', async () => {
			activeEditor = createNotebookEditorInput(notebookUri);
			onDidActiveEditorChange.fire();
			await shutDownForegroundNotebook();

			onDidActiveEditorChange.fire();

			expect(runtimeSessionService.foregroundSessionDisplayInfo?.notebookUri?.toString()).toBe(notebookUri.toString());
		});

		it('does not clear foreground when a console session is deleted', async () => {
			const consoleSession = await startConsoleSession();
			const notebookSession = await startNotebookSession();
			runtimeSessionService.foregroundSession = notebookSession;

			// Exit and delete the console session
			const exitedPromise = waitForRuntimeState(consoleSession, RuntimeState.Exited);
			(consoleSession as TestLanguageRuntimeSession).setRuntimeState(RuntimeState.Exited);
			await exitedPromise;
			await runtimeSessionService.deleteSession(consoleSession.sessionId);

			// Notebook session should still be foreground
			expect(runtimeSessionService.foregroundSession?.sessionId).toBe(notebookSession.sessionId);
		});
	});

	describe('Quarto session started/ready sets foreground', () => {
		const quartoUri = URI.file('/path/to/doc.qmd');

		it('sets foreground when Quarto session starts and Quarto file is active code editor', async () => {
			configService.setUserConfiguration(QUARTO_INLINE_OUTPUT_ENABLED_KEY, true);

			// Set Quarto file as active code editor
			const codeEditor = createMockCodeEditor(quartoUri, 'quarto');
			activeEditor = { typeId: 'text', resource: quartoUri } as unknown as EditorInput;
			activeCodeEditor = codeEditor;

			// Start a notebook session for the Quarto URI -- the onDidStartRuntime event fires
			const session = await startNotebookSession(quartoUri);

			expect(runtimeSessionService.foregroundSession?.sessionId).toBe(session.sessionId);
		});

		it('does not set foreground when Quarto inline output is disabled', async () => {
			configService.setUserConfiguration(QUARTO_INLINE_OUTPUT_ENABLED_KEY, false);
			const consoleSession = await startConsoleSession();

			const codeEditor = createMockCodeEditor(quartoUri, 'quarto');
			activeEditor = { typeId: 'text', resource: quartoUri } as unknown as EditorInput;
			activeCodeEditor = codeEditor;

			await startNotebookSession(quartoUri);

			// Should not have changed from the console session
			expect(runtimeSessionService.foregroundSession?.sessionId).toBe(consoleSession.sessionId);
		});

		it('sets foreground when Quarto session becomes ready and Quarto file is active', async () => {
			configService.setUserConfiguration(QUARTO_INLINE_OUTPUT_ENABLED_KEY, true);

			const codeEditor = createMockCodeEditor(quartoUri, 'quarto');
			activeEditor = { typeId: 'text', resource: quartoUri } as unknown as EditorInput;
			activeCodeEditor = codeEditor;

			const session = await startNotebookSession(quartoUri);
			runtimeSessionService.foregroundSession = undefined;

			// Simulate the session becoming ready (e.g. after restart)
			session.setRuntimeState(RuntimeState.Ready);

			expect(getForegroundSessionId()).toBe(session.sessionId);
		});

		it('does not set foreground when a different file is the active editor', async () => {
			configService.setUserConfiguration(QUARTO_INLINE_OUTPUT_ENABLED_KEY, true);
			const consoleSession = await startConsoleSession();

			// Active editor is a regular file, not the Quarto file
			const codeEditor = createMockCodeEditor(URI.file('/path/to/other.py'), 'python');
			activeEditor = { typeId: 'text', resource: URI.file('/path/to/other.py') } as unknown as EditorInput;
			activeCodeEditor = codeEditor;

			await startNotebookSession(quartoUri);

			expect(runtimeSessionService.foregroundSession?.sessionId).toBe(consoleSession.sessionId);
		});
	});

	describe('Quarto editor whose session ended', () => {
		it('keeps the console as foreground when a Quarto file whose session ended becomes active', async () => {
			configService.setUserConfiguration(QUARTO_INLINE_OUTPUT_ENABLED_KEY, true);
			const consoleSession = await startConsoleSession();
			await waitForRuntimeState(consoleSession, RuntimeState.Ready);

			const quartoUri = URI.file('/path/to/doc.qmd');

			// Start and exit a Quarto session to create cached info
			const session = await startNotebookSession(quartoUri);
			const exitedPromise = waitForRuntimeState(session, RuntimeState.Exited);
			session.setRuntimeState(RuntimeState.Exited);
			await exitedPromise;
			await runtimeSessionService.deleteSession(session.sessionId);

			// Set Quarto file as active editor
			const codeEditor = createMockCodeEditor(quartoUri, 'quarto');
			activeEditor = { typeId: 'text', resource: quartoUri } as unknown as EditorInput;
			activeCodeEditor = codeEditor;
			onDidActiveEditorChange.fire();

			expect(getForegroundSessionId()).toBe(consoleSession.sessionId);
			expect(runtimeSessionService.foregroundSessionDisplayInfo?.sessionMode).toBe(LanguageRuntimeSessionMode.Console);
		});
	});

	describe('dispose', () => {
		it('cleans up disposable maps without errors', () => {
			// Create a standalone instance so we can dispose it without double-dispose
			const disposableContribution = ctx.instantiationService.createInstance(ForegroundSessionContribution);

			// Register a mock notebook instance to create disposables
			const mockInstance = {
				getId: () => 'instance-1',
				uri: notebookUri,
				onDidFocusWidget: Event.None,
			} as unknown as IPositronNotebookInstance;
			onDidAddNotebookInstance.fire(mockInstance);

			// Disposing should not throw
			disposableContribution.dispose();
		});
	});
});
