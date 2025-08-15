/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableMap, DisposableStore, IDisposable } from '../../../../base/common/lifecycle.js';
import { isEqual } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IContextKey, IContextKeyService, RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ILanguageRuntimeInfo, LanguageRuntimeSessionMode, RuntimeState } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession, IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { isNotebookEditorInput } from '../../notebook/common/notebookEditorInput.js';

/** Whether the active notebook has a running runtime. */
export const ActiveNotebookHasRunningRuntime = new RawContextKey<boolean>(
	'notebookHasRunningInterpreter',
	false,
	localize('notebookHasRunningInterpreter', 'Whether the active notebook has a running interpreter.'),
);

/** Whether the active notebook's runtime supports debugging. */
export const ActiveNotebookRuntimeSupportsDebugging = new RawContextKey<boolean>(
	'notebookInterpreterSupportsDebugging',
	false,
	localize('notebookInterpreterSupportsDebugging', 'Whether the active notebook interpreter supports debugging.'),
);

/** Tag for language runtimes to indicate that they support debugging. */
export const DebuggerRuntimeSupportedFeature = 'debugger';

/** Manages contexts about the active notebook and its language runtime. */
export class ActiveRuntimeNotebookContextManager extends Disposable {

	/** The bound contexts. */
	public readonly activeNotebookHasRunningRuntime: IContextKey<boolean>;
	public readonly activeNotebookRuntimeSupportsDebugging: IContextKey<boolean>;

	private readonly _disposablesBySessionId = this._register(new DisposableMap<string, IDisposable>());

	constructor(
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@IEditorService private readonly _editorService: IEditorService,
		@IRuntimeSessionService private readonly _runtimeSessionService: IRuntimeSessionService,
	) {
		super();

		// Bind the contexts.
		this.activeNotebookHasRunningRuntime = ActiveNotebookHasRunningRuntime.bindTo(this._contextKeyService);
		this.activeNotebookRuntimeSupportsDebugging = ActiveNotebookRuntimeSupportsDebugging.bindTo(this._contextKeyService);

		// Attach to new sessions.
		this._register(this._runtimeSessionService.onDidStartRuntime(session => {
			this.attachSession(session);
		}));

		// Attach to existing sessions.
		for (const session of this._runtimeSessionService.activeSessions) {
			this.attachSession(session);
		}

		// Update the context when the active editor changes.
		this._register(this._editorService.onDidActiveEditorChange(() => {
			this.handleActiveEditorChange();
		}));

		// Update the context given the current active editor.
		this.handleActiveEditorChange();
	}

	/** Attach to a language runtime session. */
	private attachSession(session: ILanguageRuntimeSession): void {
		const { notebookUri, sessionMode } = session.metadata;
		if (sessionMode !== LanguageRuntimeSessionMode.Notebook || !notebookUri) {
			// Ignore non-notebook sessions.
			return;
		}

		const disposables = new DisposableStore();
		this._disposablesBySessionId.set(session.metadata.sessionId, disposables);

		// Update contexts when the session state changes.
		// We watch for states like 'exiting' since they update before onDidEndSession fires
		// so updates faster.
		disposables.add(session.onDidChangeRuntimeState(state => {
			if (!this.isActiveNotebook(notebookUri)) {
				// Not the active notebook's session, ignore.
				return;
			}

			if (state === RuntimeState.Ready) {
				// The session became ready.
				this.activeNotebookHasRunningRuntime.set(true);
			} else if (state === RuntimeState.Exited ||
				state === RuntimeState.Exiting ||
				state === RuntimeState.Restarting ||
				state === RuntimeState.Uninitialized) {
				// The session has entered an exiting/exited state.
				this.disableContexts();
			}
		}));

		// Update contexts when the session completes startup.
		disposables.add(session.onDidCompleteStartup((runtimeInfo) => {
			if (this.isActiveNotebook(notebookUri)) {
				this.setActiveNotebookSupportsDebugging(runtimeInfo);
			}
		}));

		// Disable contexts when the session ends.
		disposables.add(session.onDidEndSession(() => {
			if (this.isActiveNotebook(notebookUri)) {
				this.disableContexts();
			}
		}));

		// The session has just started, initially enable contexts.
		if (this.isActiveNotebook(notebookUri)) {
			this.activeNotebookHasRunningRuntime.set(true);
			if (session.runtimeInfo) {
				this.setActiveNotebookSupportsDebugging(session.runtimeInfo);
			}
		}
	}

	private disableContexts(): void {
		this.activeNotebookHasRunningRuntime.set(false);
		this.activeNotebookRuntimeSupportsDebugging.set(false);
	}

	private handleActiveEditorChange(): void {
		const activeEditor = this._editorService.activeEditor;
		if (!isNotebookEditorInput(activeEditor)) {
			// Changed to a non-notebook editor.
			this.disableContexts();
			return;
		}

		// Changed to a notebook editor, check if it has a running session.
		const session = this._runtimeSessionService.getNotebookSessionForNotebookUri(activeEditor.resource);
		if (!session) {
			// No session for this notebook.
			this.disableContexts();
			return;
		}

		this.activeNotebookHasRunningRuntime.set(true);
		this.setActiveNotebookSupportsDebugging(session.runtimeInfo);
	}

	private isActiveNotebook(notebookUri: URI): boolean {
		const activeEditor = this._editorService.activeEditor;
		return isNotebookEditorInput(activeEditor) &&
			isEqual(activeEditor.resource, notebookUri);
	}

	private setActiveNotebookSupportsDebugging(runtimeInfo: ILanguageRuntimeInfo | undefined): void {
		const supportedFeatures = runtimeInfo?.supported_features || [];
		this.activeNotebookRuntimeSupportsDebugging.set(
			supportedFeatures.includes(DebuggerRuntimeSupportedFeature)
		);
	}
}
