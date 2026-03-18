/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { isEqual } from '../../../../base/common/resources.js';
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

/**
 * Contribution that coordinates foreground session changes from various UI interactions.
 *
 * This contribution tries to centralizes the foreground session switching logic by
 * listening to events from various UI components and determining which session should
 * be the foreground session.
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

	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IEditorService private readonly _editorService: IEditorService,
		@ILogService private readonly _logService: ILogService,
		@IPositronConsoleService private readonly _positronConsoleService: IPositronConsoleService,
		@IQuartoKernelManager private readonly _quartoKernelManager: IQuartoKernelManager,
		@IRuntimeSessionService private readonly _runtimeSessionService: IRuntimeSessionService,
		@ICodeEditorService private readonly _codeEditorService: ICodeEditorService,
	) {
		super();

		// Listen for active editor changes
		this._register(this._editorService.onDidActiveEditorChange(() => {
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
	}

	/**
	 * Handle console instance selection (e.g., clicking a console tab or focusing the console pane).
	 * Sets the console session as the foreground session.
	 */
	private _handleConsoleInstanceSelected(instance: IPositronConsoleInstance | undefined): void {
		if (!instance) {
			return;
		}

		const session = instance.attachedRuntimeSession;
		if (session) {
			this._logService.trace(`[ForegroundSessionContribution] Console instance selected, setting foreground session: ${session.sessionId}`);
			this._runtimeSessionService.foregroundSession = session;
		} else {
			// Console instance has no attached session yet - this can happen for provisional
			// instances while waiting for a session to connect
			this._logService.trace(`[ForegroundSessionContribution] Console instance selected but no session attached: ${instance.sessionId}`);
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
	 * - Regular files: Restore the console session for the file's language
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
			const session = this._runtimeSessionService.getNotebookSessionForNotebookUri(activeEditor.resource);
			if (session) {
				this._logService.trace(`[ForegroundSessionContribution] Notebook focused, setting foreground session: ${session.sessionId}`);
				this._runtimeSessionService.foregroundSession = session;
			} else {
				// Notebook has no session yet - don't change foreground
				this._logService.trace(`[ForegroundSessionContribution] Notebook focused but has no session yet`);
			}
			return;
		}

		// Let's check if the active editor is another type of editor
		const activeCodeEditor = this._codeEditorService.getActiveCodeEditor();
		if (!activeCodeEditor) {
			return; // The active editor isn't a code editor so there's nothing to do
		}

		const model = activeCodeEditor.getModel();
		if (!model) {
			return; // No model, so we can't determine language or path info - nothing to do
		}

		const uri = model.uri;
		const languageId = model.getLanguageId();

		// Let's check if this is a Quarto file with inline output enabled.
		// If so, we want to set the foreground session to the Quarto session for that file (if it exists).
		if (isQuartoDocument(uri.path, languageId) && usingQuartoInlineOutput(this._configurationService)) {
			const session = this._quartoKernelManager.getSessionForDocument(uri);
			if (session) {
				this._logService.trace(`[ForegroundSessionContribution] Quarto file focused, setting foreground session: ${session.sessionId}`);
				this._runtimeSessionService.foregroundSession = session;
			} else {
				// Quarto has no session yet - don't change foreground
				this._logService.trace(`[ForegroundSessionContribution] Quarto file focused but has no session yet`);
			}
			return;
		}

		// If we've reached this point, it means the file is a regular language file,
		// so we want to set the foreground session to a console session for that file's language (if it exists).
		const consoleSession = this._runtimeSessionService.getConsoleSessionForLanguage(languageId);
		if (consoleSession) {
			this._logService.trace(`[ForegroundSessionContribution] Regular file focused (${languageId}), restoring console session: ${consoleSession.sessionId}`);
			this._runtimeSessionService.foregroundSession = consoleSession;
		} else {
			this._logService.trace(`[ForegroundSessionContribution] Regular file focused (${languageId}) but no console session found`);
		}
	}
}

// Register the contribution
registerWorkbenchContribution2(
	ForegroundSessionContribution.ID,
	ForegroundSessionContribution,
	WorkbenchPhase.BlockRestore
);
