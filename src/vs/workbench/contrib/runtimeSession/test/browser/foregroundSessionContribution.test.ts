/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
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
import { createTestContainer } from '../../../../test/browser/positronTestContainer.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IPositronNotebookInstance } from '../../../positronNotebook/browser/IPositronNotebookInstance.js';
import { IPositronNotebookService } from '../../../positronNotebook/browser/positronNotebookService.js';
import { IQuartoKernelManager } from '../../../positronQuarto/browser/quartoKernelManager.js';
import { ForegroundSessionContribution } from '../../browser/foregroundSessionContribution.js';
import { POSITRON_NOTEBOOK_EDITOR_INPUT_ID } from '../../../positronNotebook/common/positronNotebookCommon.js';
import { POSITRON_QUARTO_INLINE_OUTPUT_KEY } from '../../../positronQuarto/common/positronQuartoConfig.js';

suite('Positron - ForegroundSessionContribution', () => {

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

	suiteTeardown(() => {
		onDidActiveEditorChange.dispose();
		onDidAddNotebookInstance.dispose();
		onDidRemoveNotebookInstance.dispose();
	});

	setup(() => {
		runtimeSessionService = ctx.instantiationService.get(IRuntimeSessionService);
		configService = ctx.instantiationService.get(IConfigurationService) as TestConfigurationService;

		// Reset mutable state
		activeEditor = undefined;
		activeCodeEditor = undefined;
		notebookInstances = [];
		quartoSessionForDocument = undefined;

		// Reset Quarto config to avoid leakage between tests
		configService.setUserConfiguration(POSITRON_QUARTO_INLINE_OUTPUT_KEY, undefined);

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
		const runtime = createTestLanguageRuntimeMetadata(ctx.instantiationService, ctx.disposables);
		const session = await startTestLanguageRuntimeSession(
			ctx.instantiationService, ctx.disposables, {
			runtime,
			sessionName: runtime.runtimeName,
			startReason: 'test',
			sessionMode: LanguageRuntimeSessionMode.Console,
		});
		runtimeSessionService.foregroundSession = session;
		return session;
	}

	/** Start a notebook session for the given URI. */
	async function startNotebookSession(uri: URI = notebookUri) {
		const runtime = createTestLanguageRuntimeMetadata(ctx.instantiationService, ctx.disposables);
		const session = await startTestLanguageRuntimeSession(
			ctx.instantiationService, ctx.disposables, {
			runtime,
			sessionName: runtime.runtimeName,
			startReason: 'test',
			sessionMode: LanguageRuntimeSessionMode.Notebook,
			notebookUri: uri,
		});
		return session;
	}

	suite('active editor change to notebook', () => {
		test('sets notebook session as foreground when notebook becomes active', async () => {
			const session = await startNotebookSession();

			activeEditor = createNotebookEditorInput(notebookUri);
			onDidActiveEditorChange.fire();

			assert.strictEqual(
				runtimeSessionService.foregroundSession?.sessionId,
				session.sessionId
			);
		});

		test('no-op when notebook editor is already the foreground session', async () => {
			const session = await startNotebookSession();
			runtimeSessionService.foregroundSession = session;

			activeEditor = createNotebookEditorInput(notebookUri);
			onDidActiveEditorChange.fire();

			assert.strictEqual(
				runtimeSessionService.foregroundSession?.sessionId,
				session.sessionId
			);
		});

		test('uses cached session info when notebook has no active session', async () => {
			// Start and exit a notebook session to create cached display info
			const session = await startNotebookSession();
			const exitedPromise = waitForRuntimeState(session, RuntimeState.Exited);
			session.setRuntimeState(RuntimeState.Exited);
			await exitedPromise;
			await runtimeSessionService.deleteSession(session.sessionId);

			// Set the notebook as active editor
			activeEditor = createNotebookEditorInput(notebookUri);
			onDidActiveEditorChange.fire();

			// No live session, foreground should be cleared
			assert.strictEqual(runtimeSessionService.foregroundSession, undefined);
			// Cached display info should be set so the interpreter picker shows what was last used
			assert.ok(
				runtimeSessionService.foregroundSessionDisplayInfo,
				'Expected foregroundSessionDisplayInfo to be set from cached info'
			);
		});
	});

	suite('active editor change to regular file', () => {
		test('restores last active console session', async () => {
			await startConsoleSession();

			// Switch to notebook first
			const notebookSession = await startNotebookSession();
			runtimeSessionService.foregroundSession = notebookSession;

			// Now switch to a regular file
			const codeEditor = createMockCodeEditor(URI.file('/path/to/file.py'), 'python');
			activeEditor = { typeId: 'text', resource: URI.file('/path/to/file.py') } as unknown as EditorInput;
			activeCodeEditor = codeEditor;
			onDidActiveEditorChange.fire();

			assert.strictEqual(
				runtimeSessionService.foregroundSession?.sessionId,
				runtimeSessionService.getLastActiveConsoleSession()?.sessionId
			);
		});

		test('clears notebook foreground when no console session exists', async () => {
			const notebookSession = await startNotebookSession();
			runtimeSessionService.foregroundSession = notebookSession;

			const codeEditor = createMockCodeEditor(URI.file('/path/to/file.py'), 'python');
			activeEditor = { typeId: 'text', resource: URI.file('/path/to/file.py') } as unknown as EditorInput;
			activeCodeEditor = codeEditor;
			onDidActiveEditorChange.fire();

			assert.strictEqual(runtimeSessionService.foregroundSession, undefined);
		});
	});

	suite('active editor change to no editor', () => {
		test('falls back to console session when notebook was foreground', async () => {
			const consoleSession = await startConsoleSession();
			const notebookSession = await startNotebookSession();
			runtimeSessionService.foregroundSession = notebookSession;

			activeEditor = undefined;
			onDidActiveEditorChange.fire();

			assert.strictEqual(
				runtimeSessionService.foregroundSession?.sessionId,
				consoleSession.sessionId
			);
		});

		test('no-op when foreground is already a console session', async () => {
			const consoleSession = await startConsoleSession();

			activeEditor = undefined;
			onDidActiveEditorChange.fire();

			assert.strictEqual(
				runtimeSessionService.foregroundSession?.sessionId,
				consoleSession.sessionId
			);
		});

		test('clears foreground when notebook was foreground and no console exists', async () => {
			const notebookSession = await startNotebookSession();
			runtimeSessionService.foregroundSession = notebookSession;

			activeEditor = undefined;
			onDidActiveEditorChange.fire();

			assert.strictEqual(runtimeSessionService.foregroundSession, undefined);
		});
	});

	suite('Quarto editor focus', () => {
		test('sets Quarto session as foreground when Quarto file is active and inline output enabled', async () => {
			configService.setUserConfiguration(POSITRON_QUARTO_INLINE_OUTPUT_KEY, true);

			const quartoUri = URI.file('/path/to/doc.qmd');
			const quartoSession = await startNotebookSession(quartoUri);
			quartoSessionForDocument = quartoSession;

			const codeEditor = createMockCodeEditor(quartoUri, 'quarto');
			activeEditor = { typeId: 'text', resource: quartoUri } as unknown as EditorInput;
			activeCodeEditor = codeEditor;
			onDidActiveEditorChange.fire();

			assert.strictEqual(
				runtimeSessionService.foregroundSession?.sessionId,
				quartoSession.sessionId
			);
		});

		test('does not set Quarto session when inline output is disabled', async () => {
			configService.setUserConfiguration(POSITRON_QUARTO_INLINE_OUTPUT_KEY, false);

			const quartoUri = URI.file('/path/to/doc.qmd');
			const quartoSession = await startNotebookSession(quartoUri);
			quartoSessionForDocument = quartoSession;

			const codeEditor = createMockCodeEditor(quartoUri, 'quarto');
			activeEditor = { typeId: 'text', resource: quartoUri } as unknown as EditorInput;
			activeCodeEditor = codeEditor;
			onDidActiveEditorChange.fire();

			// With inline output disabled, should not set Quarto session as foreground
			assert.notStrictEqual(
				runtimeSessionService.foregroundSession?.sessionId,
				quartoSession.sessionId
			);
		});
	});

	suite('notebook session lifecycle', () => {
		test('notebook session start sets foreground when notebook is active editor', async () => {
			// Set notebook as active editor before the session starts
			activeEditor = createNotebookEditorInput(notebookUri);
			onDidActiveEditorChange.fire();

			// Start the notebook session - the onDidStartRuntime event will fire
			const session = await startNotebookSession();

			assert.strictEqual(
				runtimeSessionService.foregroundSession?.sessionId,
				session.sessionId
			);
		});

		test('notebook session start does not steal foreground when different notebook is active', async () => {
			// notebook.ipynb has a running session and is the active editor
			const session = await startNotebookSession(notebookUri);
			activeEditor = createNotebookEditorInput(notebookUri);
			onDidActiveEditorChange.fire();

			assert.strictEqual(
				runtimeSessionService.foregroundSession?.sessionId,
				session.sessionId
			);

			// A different notebook starts its session in the background (e.g. auto-start)
			const otherNotebookUri = URI.file('/path/to/other.ipynb');
			await startNotebookSession(otherNotebookUri);

			// The foreground session should not have changed since it is not the active editor
			assert.strictEqual(
				runtimeSessionService.foregroundSession?.sessionId,
				session.sessionId
			);
		});

		test('notebook session becoming ready sets foreground when notebook is active', async () => {
			activeEditor = createNotebookEditorInput(notebookUri);
			onDidActiveEditorChange.fire();

			const session = await startNotebookSession();
			runtimeSessionService.foregroundSession = undefined;

			// Simulate the session becoming ready
			session.setRuntimeState(RuntimeState.Ready);

			assert.strictEqual(getForegroundSessionId(), session.sessionId);
		});
	});

	suite('notebook instance removed', () => {
		test('falls back to console session when last notebook is removed', async () => {
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

			assert.strictEqual(
				runtimeSessionService.foregroundSession?.sessionId,
				consoleSession.sessionId
			);
		});

		test('no-op when foreground is a console session', async () => {
			const consoleSession = await startConsoleSession();

			const mockInstance = {
				getId: () => 'instance-1',
				uri: notebookUri,
				onDidFocusWidget: Event.None,
			} as unknown as IPositronNotebookInstance;
			notebookInstances = [];

			onDidRemoveNotebookInstance.fire(mockInstance);

			assert.strictEqual(
				runtimeSessionService.foregroundSession?.sessionId,
				consoleSession.sessionId
			);
		});
	});

	suite('notebook session deleted', () => {
		test('cached display info and clears foreground when deleted session was the foreground notebook session', async () => {
			const session = await startNotebookSession();
			runtimeSessionService.foregroundSession = session;

			// Exit the session first (required before deletion)
			assert.ok(session instanceof TestLanguageRuntimeSession);
			const exitedPromise = waitForRuntimeState(session, RuntimeState.Exited);
			session.setRuntimeState(RuntimeState.Exited);
			await exitedPromise;

			// Delete the session through the service
			await runtimeSessionService.deleteSession(session.sessionId);

			// The foreground should be cleared
			assert.strictEqual(runtimeSessionService.foregroundSession, undefined);
			// Cached display info should be set so the interpreter picker shows last used runtime
			assert.ok(
				runtimeSessionService.foregroundSessionDisplayInfo,
				'Expected foregroundSessionDisplayInfo to be set from cached info after deletion'
			);
		});

		test('does not clear foreground when a console session is deleted', async () => {
			const consoleSession = await startConsoleSession();
			const notebookSession = await startNotebookSession();
			runtimeSessionService.foregroundSession = notebookSession;

			// Exit and delete the console session
			const exitedPromise = waitForRuntimeState(consoleSession, RuntimeState.Exited);
			(consoleSession as TestLanguageRuntimeSession).setRuntimeState(RuntimeState.Exited);
			await exitedPromise;
			await runtimeSessionService.deleteSession(consoleSession.sessionId);

			// Notebook session should still be foreground
			assert.strictEqual(
				runtimeSessionService.foregroundSession?.sessionId,
				notebookSession.sessionId
			);
		});
	});

	suite('Quarto session started/ready sets foreground', () => {
		const quartoUri = URI.file('/path/to/doc.qmd');

		test('sets foreground when Quarto session starts and Quarto file is active code editor', async () => {
			configService.setUserConfiguration(POSITRON_QUARTO_INLINE_OUTPUT_KEY, true);

			// Set Quarto file as active code editor
			const codeEditor = createMockCodeEditor(quartoUri, 'quarto');
			activeEditor = { typeId: 'text', resource: quartoUri } as unknown as EditorInput;
			activeCodeEditor = codeEditor;

			// Start a notebook session for the Quarto URI -- the onDidStartRuntime event fires
			const session = await startNotebookSession(quartoUri);

			assert.strictEqual(
				runtimeSessionService.foregroundSession?.sessionId,
				session.sessionId
			);
		});

		test('does not set foreground when Quarto inline output is disabled', async () => {
			configService.setUserConfiguration(POSITRON_QUARTO_INLINE_OUTPUT_KEY, false);
			const consoleSession = await startConsoleSession();

			const codeEditor = createMockCodeEditor(quartoUri, 'quarto');
			activeEditor = { typeId: 'text', resource: quartoUri } as unknown as EditorInput;
			activeCodeEditor = codeEditor;

			await startNotebookSession(quartoUri);

			// Should not have changed from the console session
			assert.strictEqual(
				runtimeSessionService.foregroundSession?.sessionId,
				consoleSession.sessionId
			);
		});

		test('sets foreground when Quarto session becomes ready and Quarto file is active', async () => {
			configService.setUserConfiguration(POSITRON_QUARTO_INLINE_OUTPUT_KEY, true);

			const codeEditor = createMockCodeEditor(quartoUri, 'quarto');
			activeEditor = { typeId: 'text', resource: quartoUri } as unknown as EditorInput;
			activeCodeEditor = codeEditor;

			const session = await startNotebookSession(quartoUri);
			runtimeSessionService.foregroundSession = undefined;

			// Simulate the session becoming ready (e.g. after restart)
			session.setRuntimeState(RuntimeState.Ready);

			assert.strictEqual(getForegroundSessionId(), session.sessionId);
		});

		test('does not set foreground when a different file is the active editor', async () => {
			configService.setUserConfiguration(POSITRON_QUARTO_INLINE_OUTPUT_KEY, true);
			const consoleSession = await startConsoleSession();

			// Active editor is a regular file, not the Quarto file
			const codeEditor = createMockCodeEditor(URI.file('/path/to/other.py'), 'python');
			activeEditor = { typeId: 'text', resource: URI.file('/path/to/other.py') } as unknown as EditorInput;
			activeCodeEditor = codeEditor;

			await startNotebookSession(quartoUri);

			assert.strictEqual(
				runtimeSessionService.foregroundSession?.sessionId,
				consoleSession.sessionId
			);
		});
	});

	suite('Quarto editor cached session info', () => {
		test('uses cached session info when Quarto file has no active session', async () => {
			configService.setUserConfiguration(POSITRON_QUARTO_INLINE_OUTPUT_KEY, true);

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

			// No live session, foreground should be cleared
			assert.strictEqual(runtimeSessionService.foregroundSession, undefined);
			// Cached display info should be set
			assert.ok(
				runtimeSessionService.foregroundSessionDisplayInfo,
				'Expected foregroundSessionDisplayInfo to be set from cached Quarto session info'
			);
		});
	});

	suite('dispose', () => {
		test('cleans up disposable maps without errors', () => {
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
