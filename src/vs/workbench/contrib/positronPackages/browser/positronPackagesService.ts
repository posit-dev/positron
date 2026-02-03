/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { timeout } from '../../../../base/common/async.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable, DisposableMap } from '../../../../base/common/lifecycle.js';
import { isEqual } from '../../../../base/common/resources.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { LanguageRuntimeSessionMode, RuntimeState } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimePackage, ILanguageRuntimeSession, IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { NotebookEditorInput } from '../../notebook/common/notebookEditorInput.js';
import { PositronNotebookEditorInput } from '../../positronNotebook/browser/PositronNotebookEditorInput.js';
import { IPositronPackagesService } from './interfaces/positronPackagesService.js';
import { IPositronPackagesInstance, PositronPackagesInstance } from './positronPackagesInstance.js';

const TIMEOUT_REFRESH_MS = 5_000; // 5 seconds

/**
 * PositronPackagesService class.
 */
export class PositronPackagesService extends Disposable implements IPositronPackagesService {
	//#region Private Properties

	private readonly _onDidChangeActivePackagesInstance = this._register(new Emitter<IPositronPackagesInstance | undefined>());

	private readonly _onDidStopPositronPackagesInstanceEmitter = this._register(new Emitter<IPositronPackagesInstance>());

	private readonly _instancesBySessionId = this._register(new DisposableMap<string, PositronPackagesInstance>());

	private _activeInstance: PositronPackagesInstance | undefined;

	//#endregion Private Properties

	//#region Constructor & Dispose

	/**
	 * Constructor.
	 * @param _runtimeSessionService The language runtime service.
	 * @param _editorService The editor service.
	 */
	constructor(
		@IRuntimeSessionService private readonly _runtimeSessionService: IRuntimeSessionService,
		@IEditorService private readonly _editorService: IEditorService,
	) {
		// Call the disposable constructor.
		super();

		// Create new instances
		this._register(this._runtimeSessionService.onWillStartSession((e) => {
			this.createOrAssignInstance(e.session, e.activate);
		}));

		// Register session cleanup handler
		this._register(this._runtimeSessionService.onDidChangeRuntimeState(e => {
			if (e.new_state === RuntimeState.Exited) {
				this.cleanupSession(e.session_id);
			}
		}));

		// Register the onDidChangeActiveRuntime event handler.
		this._register(this._runtimeSessionService.onDidChangeForegroundSession(session => {
			this.setActiveInstance(session?.sessionId);
		}));

		this._register(this._editorService.onDidActiveEditorChange(() => {
			this._syncToActiveEditor();
		}));
	}

	private createOrAssignInstance(session: ILanguageRuntimeSession, activate: boolean) {
		// Ignore background sessions
		if (session.metadata.sessionMode === LanguageRuntimeSessionMode.Background) {
			return;
		}

		let instance = this._instancesBySessionId.get(session.sessionId);

		if (!instance) {
			instance = new PositronPackagesInstance(session);
			this._instancesBySessionId.set(session.sessionId, instance);
		}

		if (activate) {
			this.setActiveInstance(session.sessionId);
		}

		return instance;
	}

	/**
	 * Cleans up resources associated with a session.
	 * @param session The session to clean up.
	 */
	private cleanupSession(sessionId: string): void {
		const instance = this._instancesBySessionId.get(sessionId);
		if (instance) {
			// If this was the active instance, clear it
			if (this._activeInstance === instance) {
				this.setActiveInstance(undefined);
			}

			// Dispose the instance and remove it from our map
			this._instancesBySessionId.deleteAndDispose(sessionId);
			this._onDidStopPositronPackagesInstanceEmitter.fire(instance);
		}
	}

	private setActiveInstance(sessionId?: string) {
		const instance = sessionId ? this._instancesBySessionId.get(sessionId) : undefined;
		this._activeInstance = instance;
		this._onDidChangeActivePackagesInstance.fire(instance);
	}

	/**
	 * Syncs the active packages instance to the active editor.
	 * This is called when the active editor changes or the service is initialized.
	 */
	private _syncToActiveEditor() {
		const editorInput = this._editorService.activeEditor;
		if (editorInput instanceof NotebookEditorInput || editorInput instanceof PositronNotebookEditorInput) {
			// If this is a notebook editor try and set the active packages session to the one
			// that corresponds with it.
			const notebookSession = this._runtimeSessionService.activeSessions.find(
				s => s.metadata.notebookUri && isEqual(s.metadata.notebookUri, editorInput.resource)
			);
			// If the editor is not for a jupyter notebook, just leave packages session as is.
			if (!notebookSession) { return; }
			this.setActiveInstance(notebookSession.sessionId);
		} else if (this._runtimeSessionService.foregroundSession) {
			// Revert to the most recent console session if we're not in a notebook editor
			this.setActiveInstance(
				this._runtimeSessionService.foregroundSession.sessionId);
		} else {
			// All else fails, just reset to the default
			this.setActiveInstance(undefined);
		}
	}

	//#endregion Constructor & Dispose

	//#region IPositronPackagesService Implementation

	// Needed for service branding in dependency injector.
	declare readonly _serviceBrand: undefined;

	installState: boolean = false;

	readonly onDidChangeActivePackagesInstance = this._onDidChangeActivePackagesInstance.event;

	readonly onDidStopPackagesInstance = this._onDidStopPositronPackagesInstanceEmitter.event;

	get activeSession(): ILanguageRuntimeSession | undefined {
		return this._activeInstance?.session;
	}

	async refreshPackages(): Promise<ILanguageRuntimePackage[]> {
		const instance = this._activeInstance;
		if (instance) {
			return await Promise.race([
				instance.refreshPackages(),
				timeout(TIMEOUT_REFRESH_MS).then(() => { throw new Error('Package refresh timed out'); })
			]);
		}

		throw new Error('No active session found.');
	}

	async installPackages(packages: string[]): Promise<void> {
		const instance = this._activeInstance;
		if (instance) {
			return await instance.installPackages(packages);
		}

		throw new Error('No active session found.');
	}

	async uninstallPackages(packages: string[]): Promise<void> {
		const instance = this._activeInstance;
		if (instance) {
			return await instance.uninstallPackages(packages);
		}

		throw new Error('No active session found.');
	}

	async updatePackages(packages: string[]): Promise<void> {
		const instance = this._activeInstance;
		if (instance) {
			return await instance.updatePackages(packages);
		}

		throw new Error('No active session found.');
	}

	async updateAllPackages(): Promise<void> {
		const instance = this._activeInstance;
		if (instance) {
			return await instance.updateAllPackages();
		}

		throw new Error('No active session found.');
	}

	async searchPackages(name: string): Promise<ILanguageRuntimePackage[]> {
		const instance = this._activeInstance;
		if (instance) {
			return await instance.searchPackages(name);
		}

		throw new Error('No active session found.');
	}

	async searchPackageVersions(name: string): Promise<string[]> {
		const instance = this._activeInstance;
		if (instance) {
			return await instance.searchPackageVersions(name);
		}

		throw new Error('No active session found.');
	}

	setActivePositronPackagesSession(session: ILanguageRuntimeSession): void {
		const instance = this._instancesBySessionId.get(session.sessionId);
		if (instance) {
			this.setActiveInstance(instance.session.sessionId);
		}
	}


	//#endregion IPositronPackagesService Implementation

	//#region Private Methods

	getInstances(): IPositronPackagesInstance[] {
		return Array.from(this._instancesBySessionId.values());
	}

	getActiveSession(): ILanguageRuntimeSession | undefined {
		return this._runtimeSessionService.foregroundSession;
	}

	//#endregion Private Methods
}
