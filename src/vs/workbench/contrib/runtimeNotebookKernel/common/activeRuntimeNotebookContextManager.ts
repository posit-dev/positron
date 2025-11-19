/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableMap, DisposableStore, IDisposable } from '../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../base/common/network.js';
import { isEqual } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKey, IContextKeyService, RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IConfigurationResolverService } from '../../../services/configurationResolver/common/configurationResolver.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ILanguageRuntimeInfo, LanguageRuntimeSessionMode, RuntimeState } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { UiFrontendEvent } from '../../../services/languageRuntime/common/positronUiComm.js';
import { ILanguageRuntimeSession, IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { IPathService } from '../../../services/path/common/pathService.js';
import { isNotebookEditorInput as isVSCodeNotebookEditorInput } from '../../notebook/common/notebookEditorInput.js';
import { resolveNotebookWorkingDirectory, resolvePath } from '../../notebook/common/notebookWorkingDirectoryUtils.js';
import { POSITRON_NOTEBOOK_EDITOR_INPUT_ID } from '../../positronNotebook/common/positronNotebookCommon.js';

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

/**
 * Context key that is set when the notebook's working directory differs from the notebook file location.
 * This can happen when the notebook file is moved or an untitled notebook is saved for the first time.
 */
export const ActiveNotebookHasWorkingDirectoryMismatch = new RawContextKey<boolean>(
	'notebookWorkingDirectoryMismatch',
	false,
	localize('notebookWorkingDirectoryMismatch', 'Whether the active notebook has a working directory different from the notebook location.'),
);

/** Tag for language runtimes to indicate that they support debugging. */
export const DebuggerRuntimeSupportedFeature = 'debugger';

/** Manages contexts about the active notebook and its language runtime. */
export class ActiveRuntimeNotebookContextManager extends Disposable {

	/** The bound contexts. */
	public readonly activeNotebookHasRunningRuntime: IContextKey<boolean>;
	public readonly activeNotebookRuntimeSupportsDebugging: IContextKey<boolean>;
	public readonly activeNotebookHasWorkingDirectoryMismatch: IContextKey<boolean>;

	private readonly _disposablesBySessionId = this._register(new DisposableMap<string, IDisposable>());

	constructor(
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@IEditorService private readonly _editorService: IEditorService,
		@IRuntimeSessionService private readonly _runtimeSessionService: IRuntimeSessionService,
		@IFileService private readonly _fileService: IFileService,
		@IPathService private readonly _pathService: IPathService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IConfigurationResolverService private readonly _configurationResolverService: IConfigurationResolverService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();

		// Bind the contexts.
		this.activeNotebookHasRunningRuntime = ActiveNotebookHasRunningRuntime.bindTo(this._contextKeyService);
		this.activeNotebookRuntimeSupportsDebugging = ActiveNotebookRuntimeSupportsDebugging.bindTo(this._contextKeyService);
		this.activeNotebookHasWorkingDirectoryMismatch = ActiveNotebookHasWorkingDirectoryMismatch.bindTo(this._contextKeyService);

		// Attach to new sessions.
		this._register(this._runtimeSessionService.onDidStartRuntime(async session => {
			this.attachSession(session);
			await this.updateWorkingDirectoryMismatchContextKey();
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
		disposables.add(session.onDidChangeRuntimeState(async state => {
			if (!this.isActiveNotebook(notebookUri)) {
				// Not the active notebook's session, ignore.
				return;
			}

			if (state === RuntimeState.Ready) {
				// The session became ready.
				this.activeNotebookHasRunningRuntime.set(true);
				this.setActiveNotebookSupportsDebugging(session.runtimeInfo);
				await this.updateWorkingDirectoryMismatchContextKey();
			} else if (state === RuntimeState.Exited ||
				state === RuntimeState.Exiting ||
				state === RuntimeState.Restarting ||
				state === RuntimeState.Uninitialized) {
				// The session has entered an exiting/exited state.
				this.disableContexts();
			}
		}));

		// Update contexts when the session completes startup.
		disposables.add(session.onDidCompleteStartup(async (runtimeInfo) => {
			if (this.isActiveNotebook(notebookUri)) {
				this.setActiveNotebookSupportsDebugging(runtimeInfo);
			}
			await this.updateWorkingDirectoryMismatchContextKey();
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

		// Listen for working directory changes from the runtime
		disposables.add(session.onDidReceiveRuntimeClientEvent(async (event) => {
			// Check if this is a working directory change event
			if (event.name === UiFrontendEvent.WorkingDirectory) {
				await this.updateWorkingDirectoryMismatchContextKey();
			}
		}));

		// Listen for notebook URI changes to update working directory mismatch context key
		disposables.add(this._runtimeSessionService.onDidUpdateNotebookSessionUri(async (event) => {
			// Only respond to changes for this notebook's session
			if (event.sessionId === session.metadata.sessionId) {
				await this.updateWorkingDirectoryMismatchContextKey();
			}
		}));
	}

	private disableContexts(): void {
		this.activeNotebookHasRunningRuntime.set(false);
		this.activeNotebookRuntimeSupportsDebugging.set(false);
		this.activeNotebookHasWorkingDirectoryMismatch.set(false);
	}

	private async handleActiveEditorChange(): Promise<void> {
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
		await this.updateWorkingDirectoryMismatchContextKey();
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

	/**
	 * Checks if the notebook's working directory differs from its file location
	 * and updates the context key accordingly.
	 */
	async updateWorkingDirectoryMismatchContextKey(): Promise<void> {
		// Get the active editor
		const activeEditor = this._editorService.activeEditor;
		if (!isNotebookEditorInput(activeEditor)) {
			this.activeNotebookHasWorkingDirectoryMismatch.set(false);
			return;
		}

		const notebookUri = activeEditor.resource;

		// Skip untitled notebooks
		if (notebookUri.scheme === Schemas.untitled) {
			this.activeNotebookHasWorkingDirectoryMismatch.set(false);
			return;
		}

		// Get the runtime session for this notebook
		const session = this._runtimeSessionService.getNotebookSessionForNotebookUri(notebookUri);
		if (!session) {
			this.activeNotebookHasWorkingDirectoryMismatch.set(false);
			return;
		}

		// Get the current working directory from the session
		const currentWorkingDirectory = session.dynState.currentWorkingDirectory;
		if (!currentWorkingDirectory) {
			this.activeNotebookHasWorkingDirectoryMismatch.set(false);
			return;
		}

		// Get the expected working directory based on notebook location
		const newWorkingDirectory = await resolveNotebookWorkingDirectory(
			notebookUri,
			this._fileService,
			this._configurationService,
			this._configurationResolverService,
			this._workspaceContextService,
			this._pathService,
			this._logService
		);
		if (!newWorkingDirectory) {
			this.activeNotebookHasWorkingDirectoryMismatch.set(false);
			return;
		}

		// Resolve both paths for comparison (handles tildes and symlinks)
		const currentWorkingDirectoryResolved = await resolvePath(
			currentWorkingDirectory,
			this._fileService,
			this._pathService,
			this._logService
		);
		const newWorkingDirectoryResolved = await resolvePath(
			newWorkingDirectory,
			this._fileService,
			this._pathService,
			this._logService
		);

		// Update context key based on whether paths match
		const hasMismatch = currentWorkingDirectoryResolved !== newWorkingDirectoryResolved;
		this.activeNotebookHasWorkingDirectoryMismatch.set(hasMismatch);
	}
}

export function isNotebookEditorInput(editor: EditorInput | undefined): editor is EditorInput & { resource: URI } {
	return editor !== undefined && (
		isVSCodeNotebookEditorInput(editor) ||
		(editor.typeId === POSITRON_NOTEBOOK_EDITOR_INPUT_ID && editor.resource !== undefined)
	);
}
