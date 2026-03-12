/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import {
	isQuartoDocument,
	usingQuartoInlineOutput,
} from '../../positronQuarto/common/positronQuartoConfig.js';
import { IQuartoKernelManager } from '../../positronQuarto/browser/quartoKernelManager.js';
import { IPositronConsoleService } from '../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { isNotebookEditorInput } from '../../runtimeNotebookKernel/common/activeRuntimeNotebookContextManager.js';

/**
 * Contribution that coordinates foreground session changes between user interactions
 * and programmatic session changes.
 *
 * This contribution consolidates the logic for determining which runtime session
 * should be the "foreground" session, based on the following user gestures:
 *
 * Editor Gestures:
 * - When a notebook editor is focused -> notebook session becomes foreground
 * - When a Quarto file (with inline output enabled) is focused -> quarto "notebook" session becomes foreground
 * - When a language file or Quarto file (without inline output enabled) is focused -> console session for that language becomes foreground
 * - When a notebook session is restarted -> that notebook session remains foreground or becomes foreground if it wasn't already?????
 *
 * Console Gestures:
 * - When a console instance is selected (tab click or pane focus) -> that console session becomes foreground
 * - When a new console session is started -> that console session becomes foreground
 * - When a console session is restarted -> that console session remains foreground or becomes foreground if it wasn't already
 *
 * Plots Pane Gestures:
 * - When the session button in the plots pane is selected -> the session associated with the plot becomes foreground
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

		// Listen for console instance selection (e.g., clicking a console tab or focusing the console pane)
		this._register(this._positronConsoleService.onDidSelectConsoleInstance((sessionId) => {
			this._handleConsoleInstanceSelected(sessionId);
		}));
	}

	/**
	 * Handle console instance selection (e.g., clicking a console tab or focusing the console pane).
	 */
	private _handleConsoleInstanceSelected(sessionId: string): void {
		const session = this._runtimeSessionService.getSession(sessionId);
		if (session) {
			this._logService.trace(`[ForegroundSessionContribution] Console instance selected, setting foreground session: ${sessionId}`);
			this._runtimeSessionService.foregroundSession = session;
		} else {
			// It's possible for a console instance to exist without a session.
			// This typically happens when we create a provisional instance while
			// waiting for a session to be connected, but the session never connects.
			// In this case we can't set the foreground session, but we can still
			// set the console instance as the active console instance.
			this._logService.trace(`[ForegroundSessionContribution] Console instance selected but no session found, setting active console instance: ${sessionId}`);
			this._positronConsoleService.setActivePositronConsoleSession(sessionId);
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
