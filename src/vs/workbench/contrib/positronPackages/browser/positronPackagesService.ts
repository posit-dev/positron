/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { timeout } from '../../../../base/common/async.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable, DisposableMap, DisposableStore } from '../../../../base/common/lifecycle.js';
import { IContextKey, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { LanguageRuntimeSessionMode } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimePackage, ILanguageRuntimeSession, IPackageSpec, IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { IPositronPackagesService } from './interfaces/positronPackagesService.js';
import { POSITRON_PACKAGES_HAS_ACTIVE_SESSION, POSITRON_PACKAGES_IS_BUSY, POSITRON_PACKAGES_SELECTED_PACKAGE } from './positronPackagesContextKeys.js';
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

	// Context keys
	private readonly _hasActiveSessionContextKey: IContextKey<boolean>;
	private readonly _isBusyContextKey: IContextKey<boolean>;
	private readonly _selectedPackageContextKey: IContextKey<string>;

	// Disposables for tracking busy state of the active instance
	private readonly _activeInstanceDisposables = this._register(new DisposableStore());

	//#endregion Private Properties

	//#region Constructor & Dispose

	/**
	 * Constructor.
	 * @param _runtimeSessionService The language runtime service.
	 * @param _logService The log service.
	 * @param _contextKeyService The context key service.
	 */
	constructor(
		@IRuntimeSessionService private readonly _runtimeSessionService: IRuntimeSessionService,
		@ILogService private readonly _logService: ILogService,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
	) {
		// Call the disposable constructor.
		super();

		// Initialize context keys
		this._hasActiveSessionContextKey = POSITRON_PACKAGES_HAS_ACTIVE_SESSION.bindTo(this._contextKeyService);
		this._isBusyContextKey = POSITRON_PACKAGES_IS_BUSY.bindTo(this._contextKeyService);
		this._selectedPackageContextKey = POSITRON_PACKAGES_SELECTED_PACKAGE.bindTo(this._contextKeyService);

		// Create new instances
		this._register(this._runtimeSessionService.onWillStartSession((e) => {
			this.createOrAssignInstance(e.session, e.activate);
		}));

		// Register the onDidChangeActiveRuntime event handler.
		this._register(this._runtimeSessionService.onDidChangeForegroundSession(session => {
			this.setActiveInstance(session?.sessionId);
		}));

		// Initialize with the current foreground session if one exists.
		const foregroundSession = this._runtimeSessionService.foregroundSession;
		if (foregroundSession) {
			this.createOrAssignInstance(foregroundSession, true);
		}
	}

	private createOrAssignInstance(session: ILanguageRuntimeSession, activate: boolean) {
		// Ignore background sessions
		if (session.metadata.sessionMode === LanguageRuntimeSessionMode.Background) {
			return;
		}

		let instance = this._instancesBySessionId.get(session.sessionId);
		if (instance) {
			instance.setRuntimeSession(session);
		} else {
			instance = new PositronPackagesInstance(session, this._logService);
			this._instancesBySessionId.set(session.sessionId, instance);
		}

		if (activate) {
			this.setActiveInstance(session.sessionId);
		}

		return instance;
	}

	private setActiveInstance(sessionId?: string) {
		const instance = sessionId ? this._instancesBySessionId.get(sessionId) : undefined;
		this._activeInstance = instance;

		// Update context keys
		this._hasActiveSessionContextKey.set(Boolean(instance));

		// Clear previous instance's busy state tracking
		this._activeInstanceDisposables.clear();
		this._isBusyContextKey.set(false);

		// Set up busy state tracking for the new instance
		if (instance) {
			// Track all loading states to determine if the instance is busy
			let refreshLoading = false;
			let installLoading = false;
			let updateLoading = false;
			let updateAllLoading = false;
			let uninstallLoading = false;

			const updateBusy = () => {
				this._isBusyContextKey.set(
					refreshLoading || installLoading || updateLoading || updateAllLoading || uninstallLoading
				);
			};

			this._activeInstanceDisposables.add(instance.onDidChangeRefreshState((isLoading) => {
				refreshLoading = isLoading;
				updateBusy();
			}));
			this._activeInstanceDisposables.add(instance.onDidChangeInstallState((isLoading) => {
				installLoading = isLoading;
				updateBusy();
			}));
			this._activeInstanceDisposables.add(instance.onDidChangeUpdateState((isLoading) => {
				updateLoading = isLoading;
				updateBusy();
			}));
			this._activeInstanceDisposables.add(instance.onDidChangeUpdateAllState((isLoading) => {
				updateAllLoading = isLoading;
				updateBusy();
			}));
			this._activeInstanceDisposables.add(instance.onDidChangeUninstallState((isLoading) => {
				uninstallLoading = isLoading;
				updateBusy();
			}));
		}

		this._onDidChangeActivePackagesInstance.fire(instance);
	}

	//#endregion Constructor & Dispose

	//#region IPositronPackagesService Implementation

	// Needed for service branding in dependency injector.
	declare readonly _serviceBrand: undefined;

	readonly onDidChangeActivePackagesInstance = this._onDidChangeActivePackagesInstance.event;

	readonly onDidStopPackagesInstance = this._onDidStopPositronPackagesInstanceEmitter.event;

	get activeSession(): ILanguageRuntimeSession | undefined {
		return this._activeInstance?.session;
	}

	get activePackagesInstance(): IPositronPackagesInstance | undefined {
		return this._activeInstance;
	}

	get selectedPackage(): string | undefined {
		return this._selectedPackageContextKey.get() || undefined;
	}

	setSelectedPackage(packageName: string | undefined): void {
		this._selectedPackageContextKey.set(packageName ?? '');
	}

	async refreshPackages(token?: CancellationToken): Promise<ILanguageRuntimePackage[]> {
		const instance = this._activeInstance;
		if (instance) {
			return await Promise.race([
				instance.refreshPackages(token),
				timeout(TIMEOUT_REFRESH_MS).then(() => { throw new Error('Package refresh timed out'); })
			]);
		}

		throw new Error('No active session found.');
	}

	async installPackages(packages: IPackageSpec[], token?: CancellationToken): Promise<void> {
		const instance = this._activeInstance;
		if (instance) {
			return await instance.installPackages(packages, token);
		}

		throw new Error('No active session found.');
	}

	async uninstallPackages(packageNames: string[], token?: CancellationToken): Promise<void> {
		const instance = this._activeInstance;
		if (instance) {
			return await instance.uninstallPackages(packageNames, token);
		}

		throw new Error('No active session found.');
	}

	async updatePackages(packages: IPackageSpec[], token?: CancellationToken): Promise<void> {
		const instance = this._activeInstance;
		if (instance) {
			return await instance.updatePackages(packages, token);
		}

		throw new Error('No active session found.');
	}

	async updateAllPackages(token?: CancellationToken): Promise<void> {
		const instance = this._activeInstance;
		if (instance) {
			return await instance.updateAllPackages(token);
		}

		throw new Error('No active session found.');
	}

	async searchPackages(name: string, token?: CancellationToken): Promise<ILanguageRuntimePackage[]> {
		const instance = this._activeInstance;
		if (instance) {
			return await instance.searchPackages(name, token);
		}

		throw new Error('No active session found.');
	}

	async searchPackageVersions(name: string, token?: CancellationToken): Promise<string[]> {
		const instance = this._activeInstance;
		if (instance) {
			return await instance.searchPackageVersions(name, token);
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
