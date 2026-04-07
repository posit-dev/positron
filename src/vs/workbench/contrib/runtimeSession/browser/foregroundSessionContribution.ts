/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { basename, isEqual } from '../../../../base/common/resources.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { LanguageRuntimeSessionMode, RuntimeState } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession, IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import {
	isQuartoDocument,
	usingQuartoInlineOutput,
} from '../../positronQuarto/common/positronQuartoConfig.js';
import { IQuartoKernelManager } from '../../positronQuarto/browser/quartoKernelManager.js';
import { isNotebookEditorInput } from '../../runtimeNotebookKernel/common/activeRuntimeNotebookContextManager.js';
import { IPositronNotebookInstance } from '../../positronNotebook/browser/IPositronNotebookInstance.js';
import { IPositronNotebookService } from '../../positronNotebook/browser/positronNotebookService.js';
import { INotebookEditor } from '../../notebook/browser/notebookBrowser.js';
import { INotebookEditorService } from '../../notebook/browser/services/notebookEditorService.js';

/**
 * Service interface for the foreground session contribution.
 * Allows other components to set the foreground session through the contribution
 * rather than directly via the runtime session service.
 */
export interface IForegroundSessionContribution {
	readonly _serviceBrand: undefined;

	/**
	 * Sets the foreground session. No-op if the session is already the foreground session.
	 */
	setForegroundSession(session: ILanguageRuntimeSession): void;
}

export const IForegroundSessionContribution = createDecorator<IForegroundSessionContribution>('foregroundSessionContribution');

/**
 * Contribution that coordinates foreground session changes due to editor tab changes.
 * This contribution tries to centralize the foreground session switching logic by
 * listening to events from various UI components and determining which session should
 * be the foreground session.
 *
 * For runtime startup, the logic to set the foreground session is handled elsewhere.
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
 * Console session foreground changes are handled directly by:
 * - consoleTabList.tsx: Sets foreground when user clicks a tab
 * - positronConsoleView.tsx: Sets foreground when console pane gains focus
 * - runtimeSession.ts: Sets foreground when console session starts or becomes ready
 *
 * The foreground session is used by:
 * - Variables pane (shows variables for foreground session)
 * - Packages pane (shows packages for foreground session)
 * - Interpreter picker (shows foreground session name)
 * - Language Runtime Actions (restart, interrupt, etc.)
 */
class ForegroundSessionContribution extends Disposable implements IWorkbenchContribution, IForegroundSessionContribution {
	static readonly ID = 'workbench.contrib.foregroundSessionContribution';

	readonly _serviceBrand: undefined;

	/** Tracks disposables for each Positron notebook instance's focus listener */
	private readonly _positronNotebookDisposables = new Map<string, DisposableStore>();

	/** Tracks disposables for each legacy notebook editor's focus listener */
	private readonly _legacyNotebookDisposables = new Map<string, DisposableStore>();

	/** Tracks disposables for each code editor's focus listener (for Quarto files) */
	private readonly _quartoCodeEditorDisposables = new Map<string, DisposableStore>();

	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IEditorService private readonly _editorService: IEditorService,
		@ILogService private readonly _logService: ILogService,
		@INotebookEditorService private readonly _notebookEditorService: INotebookEditorService,
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

		// When a notebook session is deleted (e.g. after kernel shutdown) and it
		// was the foreground session, clear the foreground and show the cached display
		// info so the interpreter picker continues showing the exited notebook info.
		// Console session deletion is handled by positronConsoleService.deletePositronConsoleSession.
		this._register(this._runtimeSessionService.onDidDeleteRuntimeSession((sessionId) => {
			const foregroundSession = this._runtimeSessionService.foregroundSession;
			if (foregroundSession?.sessionId === sessionId
				&& foregroundSession.metadata.sessionMode === LanguageRuntimeSessionMode.Notebook
				&& foregroundSession.metadata.notebookUri
			) {
				const sessionInfo = this._runtimeSessionService.getLastNotebookSessionInfo(foregroundSession.metadata.notebookUri);
				this._runtimeSessionService.foregroundSession = undefined;
				if (sessionInfo) {
					this._runtimeSessionService.foregroundSessionDisplayInfo = sessionInfo;
				}
			}
		}));

		// --- Start Positron Notebook Editor Focus Handling ---

		// Listen for Positron notebook instance additions to track their focus events
		this._register(this._positronNotebookService.onDidAddNotebookInstance((instance) => {
			const notebookName = basename(instance.uri);
			this._logService.trace(`[ForegroundSessionContribution] (${notebookName}) onDidAddNotebookInstance fired: ${instance.getId()}`);
			this._registerPositronNotebookFocusListener(instance);
		}));

		// Clean up when Positron notebook instances are removed
		this._register(this._positronNotebookService.onDidRemoveNotebookInstance((instance) => {
			const notebookName = basename(instance.uri);
			this._logService.trace(`[ForegroundSessionContribution] (${notebookName}) onDidRemoveNotebookInstance fired: ${instance.getId()}`);
			this._unregisterPositronNotebookFocusListener(instance);

			// When the last notebook instance is closed and the foreground is any notebook
			// session, switch to the last active console session if there is one, or undefined.
			const foregroundSession = this._runtimeSessionService.foregroundSession;
			if (foregroundSession?.metadata.notebookUri && this._positronNotebookService.listInstances().length === 0) {
				const consoleSession = this._runtimeSessionService.getLastActiveConsoleSession();
				this._logService.trace(`[ForegroundSessionContribution] (${notebookName}) last notebook closed, switching foreground session to: ${consoleSession?.sessionId ?? 'none'}`);
				this._runtimeSessionService.foregroundSession = consoleSession;
			}
		}));

		// Register focus listeners for any existing Positron notebook instances that were open before this contribution was initialized
		const existingInstances = this._positronNotebookService.listInstances();
		this._logService.trace(`[ForegroundSessionContribution] Initializing with ${existingInstances.length} existing Positron notebook instances`);
		for (const instance of existingInstances) {
			this._registerPositronNotebookFocusListener(instance);
		}

		// --- End Positron Notebook Editor Focus Handling ---

		// --- Start Legacy Notebook Editor Focus Handling ---

		// Listen for legacy notebook editor additions to track their focus events
		this._register(this._notebookEditorService.onDidAddNotebookEditor((editor) => {
			this._logService.trace(`[ForegroundSessionContribution] onDidAddNotebookEditor fired: ${editor.getId()}`);
			this._registerLegacyNotebookFocusListener(editor);
		}));

		// Clean up when legacy notebook editors are removed
		this._register(this._notebookEditorService.onDidRemoveNotebookEditor((editor) => {
			this._logService.trace(`[ForegroundSessionContribution] onDidRemoveNotebookEditor fired: ${editor.getId()}`);
			this._unregisterLegacyNotebookFocusListener(editor);
		}));

		// Register focus listeners for any existing legacy notebook editors that were open before this contribution was initialized
		const existingEditors = this._notebookEditorService.listNotebookEditors();
		this._logService.trace(`[ForegroundSessionContribution] Initializing with ${existingEditors.length} existing legacy notebook editors`);
		for (const editor of existingEditors) {
			this._registerLegacyNotebookFocusListener(editor);
		}

		// --- End Legacy Notebook Editor Focus Handling ---

		// --- Start Quarto Editor Focus Handling ---

		// Listen for code editor additions so we can track focus events for Quarto files
		this._register(this._codeEditorService.onCodeEditorAdd((editor) => {
			this._registerQuartoEditorFocusListener(editor);
		}));

		// Listen for code editor removals so we can unregister focus listeners for Quarto files
		this._register(this._codeEditorService.onCodeEditorRemove((editor) => {
			this._unregisterQuartoEditorFocusListener(editor);
		}));

		// Register focus listeners for any code editors that already exist
		for (const editor of this._codeEditorService.listCodeEditors()) {
			this._registerQuartoEditorFocusListener(editor);
		}

		// --- End Quarto Editor Focus Handling ---

		// After setting up all the listeners, we should check the active editor and set the correct foreground session on startup.
		// This is important for the case where the active editor is a notebook, so that the notebook session is set as foreground on startup.
		// Without this, the foreground session would only be set after the user focuses a different editor and then comes back to the notebook.
		this._handleActiveEditorChange();
	}

	setForegroundSession(session: ILanguageRuntimeSession): void {
		if (this._runtimeSessionService.foregroundSession?.sessionId !== session.sessionId) {
			this._logService.trace(`[ForegroundSessionContribution] setForegroundSession called, setting foreground session: ${session.sessionId}`);
			this._runtimeSessionService.foregroundSession = session;
		}
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
		const notebookName = basename(instance.uri);
		if (this._positronNotebookDisposables.has(instanceId)) {
			this._logService.trace(`[ForegroundSessionContribution] Positron notebook (${notebookName}) instance already registered: ${instanceId}`);
			return;
		}

		this._logService.trace(`[ForegroundSessionContribution] Registering focus listener for Positron notebook (${notebookName}) instance: ${instanceId}`);
		const disposables = new DisposableStore();
		disposables.add(instance.onDidFocusWidget(() => {
			this._logService.trace(`[ForegroundSessionContribution] onDidFocusWidget fired for Positron notebook (${notebookName}) instance: ${instanceId}`);
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

		// Guard against stale focus events. onDidFocusWidget can fire for a notebook that is
		// no longer the active editor because of a deferred setTimeout focus callback
		// that runs after the user has already clicked a different tab. onDidActiveEditorChange
		// handles legitimate tab switches, so we only need to act here when the notebook is
		// already confirmed as the active editor.
		const activeEditor = this._editorService.activeEditor;
		if (!isNotebookEditorInput(activeEditor) || !isEqual(activeEditor.resource, notebookUri)) {
			this._logService.trace(`[ForegroundSessionContribution] Positron notebook instance focused (${notebookName}) but it is not the active editor, ignoring stale focus event`);
			return;
		}

		const session = this._runtimeSessionService.getNotebookSessionForNotebookUri(notebookUri);
		if (session) {
			if (this._runtimeSessionService.foregroundSession?.sessionId !== session.sessionId) {
				this._logService.trace(`[ForegroundSessionContribution] Positron notebook instance focused (${notebookName}), setting foreground session: ${session.sessionId}`);
				this._runtimeSessionService.foregroundSession = session;
			} else {
				this._logService.trace(`[ForegroundSessionContribution] Positron notebook instance focused (${notebookName}), but it is already the foreground session: ${session.sessionId}`);
			}
		} else {
			// No active session. Check if there's saved info from a previous session
			// so the interpreter picker can still show what runtime was last used.
			const sessionInfo = this._runtimeSessionService.getLastNotebookSessionInfo(notebookUri);
			if (sessionInfo) {
				this._logService.trace(`[ForegroundSessionContribution] Positron notebook instance focused (${notebookName}), using cached session info`);
				this._runtimeSessionService.foregroundSession = undefined;
				this._runtimeSessionService.foregroundSessionDisplayInfo = sessionInfo;
			} else {
				this._logService.trace(`[ForegroundSessionContribution] Positron notebook instance focused (${notebookName}) but no session found for URI`);
			}
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
			return;
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

		// Guard against stale focus events. onDidFocusWidget can fire for a notebook that is
		// no longer the active editor because of a deferred setTimeout focus callback
		// that runs after the user has already clicked a different tab. onDidActiveEditorChange
		// handles legitimate tab switches, so we only need to act here when the notebook is
		// already confirmed as the active editor.
		const notebookName = basename(notebookUri);
		const activeEditor = this._editorService.activeEditor;
		if (!isNotebookEditorInput(activeEditor) || !isEqual(activeEditor.resource, notebookUri)) {
			this._logService.trace(`[ForegroundSessionContribution] Legacy notebook editor focused (${notebookName}) but it is not the active editor, ignoring stale focus event`);
			return;
		}

		const session = this._runtimeSessionService.getNotebookSessionForNotebookUri(notebookUri);
		if (session) {
			if (this._runtimeSessionService.foregroundSession?.sessionId !== session.sessionId) {
				this._logService.trace(`[ForegroundSessionContribution] Legacy notebook editor focused (${notebookName}), setting foreground session: ${session.sessionId}`);
				this._runtimeSessionService.foregroundSession = session;
			} else {
				this._logService.trace(`[ForegroundSessionContribution] Legacy notebook editor focused (${notebookName}), but it is already the foreground session: ${session.sessionId}`);
			}
		} else {
			// No active session. Check if there's saved info from a previous session
			// so the interpreter picker can still show what runtime was last used.
			const sessionInfo = this._runtimeSessionService.getLastNotebookSessionInfo(notebookUri);
			if (sessionInfo) {
				this._logService.trace(`[ForegroundSessionContribution] Legacy notebook editor focused (${notebookName}), using cached session info`);
				this._runtimeSessionService.foregroundSession = undefined;
				this._runtimeSessionService.foregroundSessionDisplayInfo = sessionInfo;
			} else {
				this._logService.trace(`[ForegroundSessionContribution] Legacy notebook editor focused (${notebookName}) but no session found for URI`);
			}
		}
	}

	/**
	 * Register a focus listener for a code editor.
	 * When the editor gains focus, we check if it is a Quarto file and set the foreground session.
	 */
	private _registerQuartoEditorFocusListener(editor: ICodeEditor): void {
		const editorId = editor.getId();
		if (this._quartoCodeEditorDisposables.has(editorId)) {
			return;
		}

		const disposables = new DisposableStore();
		disposables.add(editor.onDidFocusEditorWidget(() => {
			this._handleQuartoEditorFocus(editor);
		}));
		this._quartoCodeEditorDisposables.set(editorId, disposables);
	}

	/**
	 * Unregister the focus listener for a code editor.
	 */
	private _unregisterQuartoEditorFocusListener(editor: ICodeEditor): void {
		const editorId = editor.getId();
		const disposables = this._quartoCodeEditorDisposables.get(editorId);
		if (disposables) {
			disposables.dispose();
			this._quartoCodeEditorDisposables.delete(editorId);
		}
	}

	/**
	 * Handle Quarto code editor focus.
	 * Sets the Quarto session as the foreground session if the editor's file is a Quarto document.
	 */
	private _handleQuartoEditorFocus(editor: ICodeEditor): void {
		if (!usingQuartoInlineOutput(this._configurationService)) {
			return;
		}

		const model = editor.getModel();
		if (!model || !isQuartoDocument(model.uri.path, model.getLanguageId())) {
			return;
		}

		const uri = model.uri;
		const fileName = basename(uri);

		// Guard against stale focus events, same as the notebook focus handlers.
		const activeEditor = this._editorService.activeEditor;
		if (!activeEditor || !isEqual(activeEditor.resource, uri)) {
			this._logService.trace(`[ForegroundSessionContribution] Quarto editor focused (${fileName}) but not the active editor, ignoring stale focus event`);
			return;
		}

		const session = this._quartoKernelManager.getSessionForDocument(uri);
		if (session) {
			if (this._runtimeSessionService.foregroundSession?.sessionId !== session.sessionId) {
				this._logService.trace(`[ForegroundSessionContribution] Quarto editor focused (${fileName}), setting foreground session: ${session.sessionId}`);
				this._runtimeSessionService.foregroundSession = session;
			} else {
				this._logService.trace(`[ForegroundSessionContribution] Quarto editor focused (${fileName}), already the foreground session: ${session.sessionId}`);
			}
		} else {
			// No active session. Check if there's saved info from a previous session.
			const sessionInfo = this._runtimeSessionService.getLastNotebookSessionInfo(uri);
			if (sessionInfo) {
				this._logService.trace(`[ForegroundSessionContribution] Quarto editor focused (${fileName}), using session info`);
				this._runtimeSessionService.foregroundSession = undefined;
				this._runtimeSessionService.foregroundSessionDisplayInfo = sessionInfo;
			} else {
				this._logService.trace(`[ForegroundSessionContribution] Quarto editor focused (${fileName}) but no session found`);
			}
		}
	}

	/**
	 * Handle notebook session started or became ready.
	 * Sets the notebook session as foreground if its notebook is the active editor.
	 * We only want to make the active notebook editor's session the foreground
	 * session. By doing this, we ensure other notebooks that are starting up
	 * don't steal focus and cause the foreground session to switch around.
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

		// Avoid unnecessary work if the session is already the foreground session.
		if (this._runtimeSessionService.foregroundSession?.sessionId === session.sessionId) {
			return;
		}

		const notebookName = basename(notebookUri);
		const activeEditor = this._editorService.activeEditor;

		// Check if a Positron/legacy notebook editor for this URI is the active editor.
		if (isNotebookEditorInput(activeEditor) && isEqual(activeEditor.resource, notebookUri)) {
			this._logService.trace(`[ForegroundSessionContribution] Notebook session started/ready for (${notebookName}), setting foreground session: ${session.sessionId}`);
			this._runtimeSessionService.foregroundSession = session;
			return;
		}

		// Check if a Quarto code editor for this URI is the active editor.
		// Quarto files are not notebook editor inputs, so we need to check separately.
		if (usingQuartoInlineOutput(this._configurationService)) {
			const activeCodeEditor = this._codeEditorService.getActiveCodeEditor();
			const model = activeCodeEditor?.getModel();
			if (model && isEqual(model.uri, notebookUri) && isQuartoDocument(model.uri.path, model.getLanguageId())) {
				this._logService.trace(`[ForegroundSessionContribution] Quarto session started/ready for (${notebookName}), setting foreground session: ${session.sessionId}`);
				this._runtimeSessionService.foregroundSession = session;
			}
		}
	}

	/**
	 * Handle active editor changes to set the appropriate foreground session.
	 *
	 * When the active editor changes, we determine the correct foreground session:
	 * - Notebook editors: Set the notebook's session as foreground
	 * - Quarto files (with inline output): Set the Quarto session as foreground
	 * - Regular files: Restore the last active console session (regardless of language)
	 * - No editors: Fallback to the last active console session if there is one, otherwise clear the foreground session
	 */
	private _handleActiveEditorChange(): void {
		const activeEditor = this._editorService.activeEditor;

		// If there are no editors, we need to make sure the foreground session is not
		// set to a notebook session for a closed notebook file. We fallback to the last
		// active console session if there is one, otherwise it will be undefined.
		if (!activeEditor) {
			const foregroundSession = this._runtimeSessionService.foregroundSession;
			if (foregroundSession?.metadata.notebookUri) {
				const consoleSession = this._runtimeSessionService.getLastActiveConsoleSession();
				this._logService.trace(`[ForegroundSessionContribution] No active editor, switching foreground session from notebook to: ${consoleSession?.sessionId ?? 'none'}`);
				this._runtimeSessionService.foregroundSession = consoleSession;
			}
			return;
		}

		// Check if the active editor is a notebook first (Legacy Notebook Editor or Positron Notebook Editor).
		if (isNotebookEditorInput(activeEditor)) {
			// For notebooks, get the session from the notebook URI
			const notebookName = activeEditor.resource ? basename(activeEditor.resource) : 'unknown';
			const session = this._runtimeSessionService.getNotebookSessionForNotebookUri(activeEditor.resource);
			if (session) {
				if (this._runtimeSessionService.foregroundSession?.sessionId !== session.sessionId) {
					this._logService.trace(`[ForegroundSessionContribution] Notebook editor focused (${notebookName}), setting foreground session: ${session.sessionId}`);
					this._runtimeSessionService.foregroundSession = session;
				} else {
					this._logService.trace(`[ForegroundSessionContribution] Notebook editor focused (${notebookName}), but it is already the foreground session: ${session.sessionId}`);
				}
			} else {
				// No active session. Check if there's saved info from a previous session
				// so the interpreter picker can still show what runtime was last used.
				const sessionInfo = activeEditor.resource
					? this._runtimeSessionService.getLastNotebookSessionInfo(activeEditor.resource)
					: undefined;
				if (sessionInfo) {
					this._logService.trace(`[ForegroundSessionContribution] Notebook editor focused (${notebookName}), using session info`);
					this._runtimeSessionService.foregroundSession = undefined;
					this._runtimeSessionService.foregroundSessionDisplayInfo = sessionInfo;
				} else {
					this._logService.trace(`[ForegroundSessionContribution] Notebook editor focused (${notebookName}) but has no session yet`);
				}
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
				if (this._runtimeSessionService.foregroundSession?.sessionId !== session.sessionId) {
					this._logService.trace(`[ForegroundSessionContribution] Quarto file focused (${fileName}), setting foreground session: ${session.sessionId}`);
					this._runtimeSessionService.foregroundSession = session;
				} else {
					this._logService.trace(`[ForegroundSessionContribution] Quarto file focused (${fileName}), but it is already the foreground session: ${session.sessionId}`);
				}
			} else {
				// No active session. Check if there's saved info from a previous session.
				const sessionInfo = this._runtimeSessionService.getLastNotebookSessionInfo(uri);
				if (sessionInfo) {
					this._logService.trace(`[ForegroundSessionContribution] Quarto file focused (${fileName}), using session info`);
					this._runtimeSessionService.foregroundSession = undefined;
					this._runtimeSessionService.foregroundSessionDisplayInfo = sessionInfo;
				} else {
					this._logService.trace(`[ForegroundSessionContribution] Quarto file focused (${fileName}) but has no session yet`);
				}
			}
			return;
		}

		// If we've reached this point, it means the file is a regular language file,
		// so we want to set the foreground session to the last active console session.
		const consoleSession = this._runtimeSessionService.getLastActiveConsoleSession();
		if (consoleSession) {
			if (this._runtimeSessionService.foregroundSession?.sessionId !== consoleSession.sessionId) {
				this._logService.trace(`[ForegroundSessionContribution] File focused (${fileName}), restoring console session: ${consoleSession.sessionId}`);
				this._runtimeSessionService.foregroundSession = consoleSession;
			} else {
				this._logService.trace(`[ForegroundSessionContribution] File focused (${fileName}), but it is already the foreground session: ${consoleSession.sessionId}`);
			}
		} else {
			// If we've reached this point, it means there is no console session to set as the
			// foreground session. In this case, we just need to make sure that we don't show
			// a notebook session as the foreground for a non-notebook file.
			this._logService.trace(`[ForegroundSessionContribution] File focused (${fileName}) but no console session found`);
			if (this._runtimeSessionService.foregroundSession?.metadata.notebookUri) {
				this._runtimeSessionService.foregroundSession = undefined;
			}
		}
	}
}

// Register as an eager singleton service so it is instantiated at startup
// and can be injected by other components.
registerSingleton(IForegroundSessionContribution, ForegroundSessionContribution, InstantiationType.Eager);
