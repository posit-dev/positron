/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { basename, isEqual } from '../../../../base/common/resources.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { LanguageRuntimeSessionMode, RuntimeState } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession, IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import {
	isQuartoDocument,
	usingQuartoInlineOutput,
} from '../../positronQuarto/common/positronQuartoConfig.js';
import { IQuartoKernelManager } from '../../positronQuarto/browser/quartoKernelManager.js';
import { isNotebookEditorInput } from '../../runtimeNotebookKernel/common/activeRuntimeNotebookContextManager.js';
import { IPositronConsoleInstance, IPositronConsoleService } from '../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { IPositronNotebookInstance } from '../../positronNotebook/browser/IPositronNotebookInstance.js';
import { IPositronNotebookService } from '../../positronNotebook/browser/positronNotebookService.js';
import { INotebookEditor } from '../../notebook/browser/notebookBrowser.js';
import { INotebookEditorService } from '../../notebook/browser/services/notebookEditorService.js';

/**
 * Contribution that coordinates foreground session changes from various UI gestures.
 * This contribution tries to centralizes the foreground session switching logic by
 * listening to events from various UI components and determining which session should
 * be the foreground session.
 *
 * For runtime startup, the logic to set the foreground session is handled elsewhere.
 * This contribution is focused on user-driven context changes (for now).
 *
 * Events handled:
 *
 * Editor Focus Changes (onDidActiveEditorChange):
 * - Notebook editor focused -> notebook session becomes foreground (if session exists)
 * - Quarto file focused (with inline output enabled) -> Quarto session becomes foreground
 * - Regular file focused -> console session for that language becomes foreground
 *
 * Notebook Session Lifecycle (onDidStartRuntime, onDidChangeRuntimeState):
 * - Notebook session starts -> becomes foreground if its notebook is the active editor
 * - Notebook session becomes ready (e.g., after restart) -> becomes foreground if its notebook is the active editor
 *
 * Console Session Selection (onDidChangeActivePositronConsoleInstance):
 * - Console tab clicked -> that console session becomes foreground
 * - Console pane focused -> active console session becomes foreground
 *
 * The foreground session is used by:
 * - Variables pane (shows variables for foreground session)
 * - Packages pane (shows packages for foreground session)
 * - Interpreter picker (shows foreground session name)
 * - Language Runtime Actions (restart, interrupt, etc.)
 */
class ForegroundSessionContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.foregroundSessionContribution';

	/** Tracks disposables for each Positron notebook instance's focus listener */
	private readonly _positronNotebookDisposables = new Map<string, DisposableStore>();

	/** Tracks disposables for each legacy notebook editor's focus listener */
	private readonly _legacyNotebookDisposables = new Map<string, DisposableStore>();

	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IEditorService private readonly _editorService: IEditorService,
		@ILogService private readonly _logService: ILogService,
		@INotebookEditorService private readonly _notebookEditorService: INotebookEditorService,
		@IPositronConsoleService private readonly _positronConsoleService: IPositronConsoleService,
		@IPositronNotebookService private readonly _positronNotebookService: IPositronNotebookService,
		@IQuartoKernelManager private readonly _quartoKernelManager: IQuartoKernelManager,
		@IRuntimeSessionService private readonly _runtimeSessionService: IRuntimeSessionService,
		@ICodeEditorService private readonly _codeEditorService: ICodeEditorService,
	) {
		super();

		// Listen for active editor changes
		this._register(this._editorService.onDidActiveEditorChange(() => {
			this._logService.trace(`[ForegroundSessionContribution] onDidActiveEditorChange fired`);
			this._handleActiveEditorChange();
		}));

		// Listen for new notebook sessions starting
		this._register(this._runtimeSessionService.onDidStartRuntime((session) => {
			this._handleNotebookSessionStartedOrReady(session);
		}));

		// Listen for notebook sessions becoming ready (e.g., after a restart)
		this._register(this._runtimeSessionService.onDidChangeRuntimeState((event) => {
			if (event.new_state === RuntimeState.Ready) {
				const session = this._runtimeSessionService.getSession(event.session_id);
				if (session) {
					this._handleNotebookSessionStartedOrReady(session);
				}
			}
		}));

		// Listen for console instance selection (e.g., clicking a console tab or focusing the console pane)
		this._register(this._positronConsoleService.onDidChangeActivePositronConsoleInstance((instance) => {
			this._handleConsoleInstanceSelected(instance);
		}));

		// --- Start Positron Noteboook Editor Focus Handling ---

		// Listen for Positron notebook instance additions to track their focus events
		this._register(this._positronNotebookService.onDidAddNotebookInstance((instance) => {
			this._logService.trace(`[ForegroundSessionContribution] onDidAddNotebookInstance fired: ${instance.getId()}`);
			this._registerPositronNotebookFocusListener(instance);
		}));

		// Clean up when Positron notebook instances are removed
		this._register(this._positronNotebookService.onDidRemoveNotebookInstance((instance) => {
			this._unregisterPositronNotebookFocusListener(instance);
		}));

		// Register focus listeners for any existing Positron notebook instances that were open before this contribution was initialized
		const existingInstances = this._positronNotebookService.listInstances();
		this._logService.trace(`[ForegroundSessionContribution] Initializing with ${existingInstances.length} existing Positron notebook instances`);
		for (const instance of existingInstances) {
			this._registerPositronNotebookFocusListener(instance);
		}

		// --- End Positron Noteboook Editor Focus Handling ---

		// --- Start Legacy Noteboook Editor Focus Handling ---

		// Listen for legacy notebook editor additions to track their focus events
		this._register(this._notebookEditorService.onDidAddNotebookEditor((editor) => {
			this._logService.trace(`[ForegroundSessionContribution] onDidAddNotebookEditor fired: ${editor.getId()}`);
			this._registerLegacyNotebookFocusListener(editor);
		}));

		// Clean up when legacy notebook editors are removed
		this._register(this._notebookEditorService.onDidRemoveNotebookEditor((editor) => {
			this._unregisterLegacyNotebookFocusListener(editor);
		}));

		// Register focus listeners for any existing legacy notebook editors that were open before this contribution was initialized
		const existingEditors = this._notebookEditorService.listNotebookEditors();
		this._logService.trace(`[ForegroundSessionContribution] Initializing with ${existingEditors.length} existing legacy notebook editors`);
		for (const editor of existingEditors) {
			this._registerLegacyNotebookFocusListener(editor);
		}

		// --- End Legacy Noteboook Editor Focus Handling ---

		// After setting up all the listeners, we should check the active editor and set the correct foreground session on startup.
		// This is important for the case where the active editor is a notebook, so that the notebook session is set as foreground on startup.
		// Without this, the foreground session would only be set after the user focuses a different editor and then comes back to the notebook.
		this._handleActiveEditorChange();
	}

	override dispose(): void {
		// Clean up all Positron notebook instance disposables
		for (const disposables of this._positronNotebookDisposables.values()) {
			disposables.dispose();
		}
		this._positronNotebookDisposables.clear();

		// Clean up all legacy notebook editor disposables
		for (const disposables of this._legacyNotebookDisposables.values()) {
			disposables.dispose();
		}
		this._legacyNotebookDisposables.clear();

		super.dispose();
	}

	/**
	 * Register a focus listener for a Positron notebook instance.
	 * When the notebook instance gains focus, we check if it should become the foreground session.
	 */
	private _registerPositronNotebookFocusListener(instance: IPositronNotebookInstance): void {
		const instanceId = instance.getId();
		if (this._positronNotebookDisposables.has(instanceId)) {
			this._logService.trace(`[ForegroundSessionContribution] Positron notebook instance ${instanceId} already registered`);
			return;
		}

		this._logService.trace(`[ForegroundSessionContribution] Registering focus listener for Positron notebook instance: ${instanceId}`);
		const disposables = new DisposableStore();
		disposables.add(instance.onDidFocusWidget(() => {
			this._logService.trace(`[ForegroundSessionContribution] onDidFocusWidget fired for Positron notebook instance: ${instanceId}`);
			this._handlePositronNotebookFocus(instance);
		}));
		this._positronNotebookDisposables.set(instanceId, disposables);
	}

	/**
	 * Unregister the focus listener for a Positron notebook instance.
	 */
	private _unregisterPositronNotebookFocusListener(instance: IPositronNotebookInstance): void {
		const instanceId = instance.getId();
		const disposables = this._positronNotebookDisposables.get(instanceId);
		if (disposables) {
			disposables.dispose();
			this._positronNotebookDisposables.delete(instanceId);
		}
	}

	/**
	 * Handle Positron notebook instance focus.
	 * Sets the notebook's session as the foreground session if it exists.
	 */
	private _handlePositronNotebookFocus(instance: IPositronNotebookInstance): void {
		const notebookUri = instance.uri;
		const notebookName = basename(notebookUri);
		const session = this._runtimeSessionService.getNotebookSessionForNotebookUri(notebookUri);
		if (session) {
			this._logService.trace(`[ForegroundSessionContribution] Positron notebook instance focused (${notebookName}), setting foreground session: ${session.sessionId}`);
			this._runtimeSessionService.foregroundSession = session;
		} else {
			this._logService.trace(`[ForegroundSessionContribution] Positron notebook instance focused (${notebookName}) but no session found for URI`);
		}
	}

	/**
	 * Register a focus listener for a legacy notebook editor.
	 * When the notebook editor gains focus, we check if it should become the foreground session.
	 */
	private _registerLegacyNotebookFocusListener(editor: INotebookEditor): void {
		const editorId = editor.getId();
		if (this._legacyNotebookDisposables.has(editorId)) {
			this._logService.trace(`[ForegroundSessionContribution] Legacy notebook editor ${editorId} already registered`);
			return; // Already registered
		}

		this._logService.trace(`[ForegroundSessionContribution] Registering focus listener for legacy notebook editor: ${editorId}`);
		const disposables = new DisposableStore();
		disposables.add(editor.onDidFocusWidget(() => {
			this._logService.trace(`[ForegroundSessionContribution] onDidFocusWidget fired for legacy notebook editor: ${editorId}`);
			this._handleLegacyNotebookFocus(editor);
		}));
		this._legacyNotebookDisposables.set(editorId, disposables);
	}

	/**
	 * Unregister the focus listener for a legacy notebook editor.
	 */
	private _unregisterLegacyNotebookFocusListener(editor: INotebookEditor): void {
		const editorId = editor.getId();
		const disposables = this._legacyNotebookDisposables.get(editorId);
		if (disposables) {
			disposables.dispose();
			this._legacyNotebookDisposables.delete(editorId);
		}
	}

	/**
	 * Handle legacy notebook editor focus.
	 * Sets the notebook's session as the foreground session if it exists.
	 */
	private _handleLegacyNotebookFocus(editor: INotebookEditor): void {
		const notebookUri = editor.textModel?.uri;
		if (!notebookUri) {
			this._logService.trace(`[ForegroundSessionContribution] Legacy notebook editor focus handler: no URI available`);
			return;
		}

		const notebookName = basename(notebookUri);
		const session = this._runtimeSessionService.getNotebookSessionForNotebookUri(notebookUri);
		if (session) {
			this._logService.trace(`[ForegroundSessionContribution] Legacy notebook editor focused (${notebookName}), setting foreground session: ${session.sessionId}`);
			this._runtimeSessionService.foregroundSession = session;
		} else {
			this._logService.trace(`[ForegroundSessionContribution] Legacy notebook editor focused (${notebookName}) but no session found for URI`);
		}
	}

	/**
	 * Handle console instance selection (e.g., clicking a console tab or focusing the console pane).
	 * Sets the console instance's session as the foreground session.
	 */
	private _handleConsoleInstanceSelected(instance: IPositronConsoleInstance | undefined): void {
		if (!instance) {
			return;
		}

		// Use `session` instead of `attachedRuntimeSession` to get the session even if it is "exited".
		// This allows the foreground session to stay in sync with the console instance when a user clicks on a console tab.
		const session = instance.session;
		if (session) {
			this._logService.trace(`[ForegroundSessionContribution] Console instance selected, setting foreground session: ${session.sessionId}`);
			this._runtimeSessionService.foregroundSession = session;
		} else {
			// Console instance has no session yet - this can happen for provisional
			// instances while waiting for a session to connect
			this._logService.trace(`[ForegroundSessionContribution] Console instance selected but no session: ${instance.sessionId}`);
		}
	}

	/**
	 * Handle notebook session started or became ready.
	 * Sets the notebook session as foreground if its notebook is the active editor.
	 */
	private _handleNotebookSessionStartedOrReady(session: ILanguageRuntimeSession): void {
		// Only handle notebook sessions - console sessions are handled elsewhere
		if (session.metadata.sessionMode !== LanguageRuntimeSessionMode.Notebook) {
			return;
		}

		const notebookUri = session.metadata.notebookUri;
		if (!notebookUri) {
			return;
		}

		// Check if the notebook is the active editor
		const activeEditor = this._editorService.activeEditor;
		if (isNotebookEditorInput(activeEditor) && isEqual(activeEditor.resource, notebookUri)) {
			this._logService.trace(`[ForegroundSessionContribution] Notebook session started/ready, setting foreground session: ${session.sessionId}`);
			this._runtimeSessionService.foregroundSession = session;
		}
	}

	/**
	 * Handle active editor changes to set the appropriate foreground session.
	 *
	 * When the active editor changes, we determine the correct foreground session:
	 * - Notebook editors: Set the notebook's session as foreground
	 * - Quarto files (with inline output): Set the Quarto session as foreground
	 * - Regular files: Restore the last active console session (regardless of language)
	 *
	 * TODO:
	 * - Plots: cause the session the plot was generated from to become the foreground session
	 */
	private _handleActiveEditorChange(): void {
		const activeEditor = this._editorService.activeEditor;

		// No editors are open, so there is nothing to do.
		if (!activeEditor) {
			return;
		}

		// Check if the active editor is a notebook first (Legacy Notebook Editor or Positron Notebook Editor).
		if (isNotebookEditorInput(activeEditor)) {
			// For notebooks, get the session from the notebook URI
			const notebookName = activeEditor.resource ? basename(activeEditor.resource) : 'unknown';
			const session = this._runtimeSessionService.getNotebookSessionForNotebookUri(activeEditor.resource);
			if (session) {
				this._logService.trace(`[ForegroundSessionContribution] Notebook editor focused (${notebookName}), setting foreground session: ${session.sessionId}`);
				this._runtimeSessionService.foregroundSession = session;
			} else {
				// Notebook has no session yet - don't change foreground
				this._logService.trace(`[ForegroundSessionContribution] Notebook editor focused (${notebookName}) but has no session yet`);
			}
			return;
		}

		// If the active editor is another type of editor (e.g. data viewer, plot viewer, etc.) - nothing to do
		const activeCodeEditor = this._codeEditorService.getActiveCodeEditor();
		if (!activeCodeEditor) {
			return;
		}

		// If the active editor doesn't have a model, we can't determine language or path info - nothing to do
		const model = activeCodeEditor.getModel();
		if (!model) {
			return;
		}

		const uri = model.uri;
		const languageId = model.getLanguageId();

		// Let's check if this is a Quarto file with inline output enabled.
		// If so, we want to set the foreground session to the Quarto session for that file (if it exists).
		const fileName = basename(uri);
		if (isQuartoDocument(uri.path, languageId) && usingQuartoInlineOutput(this._configurationService)) {
			const session = this._quartoKernelManager.getSessionForDocument(uri);
			if (session) {
				this._logService.trace(`[ForegroundSessionContribution] Quarto file focused (${fileName}), setting foreground session: ${session.sessionId}`);
				this._runtimeSessionService.foregroundSession = session;
			} else {
				// Quarto has no session yet - don't change foreground
				this._logService.trace(`[ForegroundSessionContribution] Quarto file focused (${fileName}) but has no session yet`);
			}
			return;
		}

		// If we've reached this point, it means the file is a regular language file,
		// so we want to set the foreground session to the last active console session.
		const consoleSession = this._runtimeSessionService.getLastActiveConsoleSession();
		if (consoleSession) {
			this._logService.trace(`[ForegroundSessionContribution] File focused (${fileName}), restoring console session: ${consoleSession.sessionId}`);
			this._runtimeSessionService.foregroundSession = consoleSession;
		} else {
			this._logService.trace(`[ForegroundSessionContribution] File focused (${fileName}) but no console session found`);
		}
	}
}

// Register the contribution
registerWorkbenchContribution2(
	ForegroundSessionContribution.ID,
	ForegroundSessionContribution,
	WorkbenchPhase.BlockRestore
);
