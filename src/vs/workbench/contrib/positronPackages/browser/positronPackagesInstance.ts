/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { ILanguageRuntimePackage, ILanguageRuntimeSession } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { RuntimeState } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILogService } from '../../../../platform/log/common/log.js';

export interface IPositronPackagesInstance {
	packages: ILanguageRuntimePackage[];
	session: ILanguageRuntimeSession;
	attachRuntime(): void;
	detachRuntime(): void;
	refreshPackages(): Promise<ILanguageRuntimePackage[]>;
	installPackages(packages: string[]): Promise<void>;
	uninstallPackages(packages: string[]): Promise<void>;
	updatePackages(packages: string[]): Promise<void>;
	updateAllPackages(): Promise<void>;
	searchPackages(name: string): Promise<ILanguageRuntimePackage[]>;
	searchPackageVersions(name: string): Promise<string[]>;

	readonly onDidRefreshPackagesInstance: Event<ILanguageRuntimePackage[]>;

	readonly onDidChangeRefreshState: Event<boolean>;

	readonly onDidChangeInstallState: Event<boolean>;

	readonly onDidChangeUninstallState: Event<boolean>;

	readonly onDidChangeUpdateState: Event<boolean>;

	readonly onDidChangeUpdateAllState: Event<boolean>;
}

export class PositronPackagesInstance extends Disposable implements IPositronPackagesInstance {

	private _session: ILanguageRuntimeSession;

	private _packages: ILanguageRuntimePackage[] = [];

	private readonly _runtimeDisposableStore = this._register(new DisposableStore());

	private readonly _logService: ILogService;

	private readonly _onDidRefreshPackagesInstance = this._register(new Emitter<ILanguageRuntimePackage[]>());

	private readonly _onDidChangeRefreshState = this._register(new Emitter<boolean>());

	private readonly _onDidChangeInstallState = this._register(new Emitter<boolean>());

	private readonly _onDidChangeUninstallState = this._register(new Emitter<boolean>());

	private readonly _onDidChangeUpdateState = this._register(new Emitter<boolean>());

	private readonly _onDidChangeUpdateAllState = this._register(new Emitter<boolean>());

	constructor(
		session: ILanguageRuntimeSession,
		logService: ILogService,
	) {
		super();

		this._session = session;
		this._logService = logService;
	}

	readonly onDidRefreshPackagesInstance = this._onDidRefreshPackagesInstance.event;

	readonly onDidChangeRefreshState = this._onDidChangeRefreshState.event;

	readonly onDidChangeInstallState = this._onDidChangeInstallState.event;

	readonly onDidChangeUninstallState = this._onDidChangeUninstallState.event;

	readonly onDidChangeUpdateState = this._onDidChangeUpdateState.event;

	readonly onDidChangeUpdateAllState = this._onDidChangeUpdateAllState.event;

	/**
	 * Gets the packages.
	 */
	get packages(): ILanguageRuntimePackage[] {
		return Array.from(this._packages);
	}

	/**
	 * Gets the session.
	 */
	get session(): ILanguageRuntimeSession {
		return this._session;
	}

	setRuntimeSession(session: ILanguageRuntimeSession): void {
		this._session = session;
	}

	async refreshPackages(): Promise<ILanguageRuntimePackage[]> {
		const session = this._session;
		if (!session.getPackages) {
			throw new Error('Method not implemented.');
		}

		// Loading
		this._onDidChangeRefreshState.fire(true);
		try {
			const packages = await session.getPackages();
			this._onDidRefreshPackagesInstance.fire(packages);
			return packages;
		} finally {
			this._onDidChangeRefreshState.fire(false);
		}
	}

	async installPackages(packages: string[]): Promise<void> {
		const session = this._session;
		if (!session.installPackages) {
			throw new Error('Method not implemented.');
		}

		// Loading
		this._onDidChangeInstallState.fire(true);

		try {
			await session.installPackages(packages);

			// Fire refresh event.
			const pkgs = await session.getPackages?.();
			if (pkgs) {
				this._onDidRefreshPackagesInstance.fire(pkgs);
			}
		} finally {
			// Completed
			this._onDidChangeInstallState.fire(false);
		}
	}

	async uninstallPackages(packages: string[]): Promise<void> {
		const session = this._session;
		if (!session.uninstallPackages) {
			throw new Error('Method not implemented.');
		}

		// Loading
		this._onDidChangeUninstallState.fire(true);

		try {
			await session.uninstallPackages(packages);

			// Fire refresh event.
			const newPackages = await session.getPackages?.();
			if (newPackages) {
				this._onDidRefreshPackagesInstance.fire(newPackages);
			}
		} finally {
			// Completed
			this._onDidChangeUninstallState.fire(false);
		}
	}

	async updatePackages(packages: string[]): Promise<void> {
		const session = this._session;
		if (!session.updatePackages) {
			throw new Error('Method not implemented.');
		}

		// Loading
		this._onDidChangeUpdateState.fire(true);

		try {
			await session.updatePackages(packages);

			// Fire refresh event.
			const newPackages = await session.getPackages?.();
			if (newPackages) {
				this._onDidRefreshPackagesInstance.fire(newPackages);
			}
		} finally {
			// Completed
			this._onDidChangeUpdateState.fire(false);
		}
	}

	async updateAllPackages(): Promise<void> {
		const session = this._session;
		if (!session.updateAllPackages) {
			throw new Error('Method not implemented.');
		}

		// Loading
		this._onDidChangeUpdateAllState.fire(true);

		try {
			await session.updateAllPackages();

			// Fire refresh event.
			const newPackages = await session.getPackages?.();
			if (newPackages) {
				this._onDidRefreshPackagesInstance.fire(newPackages);
			}
		} finally {
			// Completed
			this._onDidChangeUpdateAllState.fire(false);
		}
	}

	async searchPackages(name: string): Promise<ILanguageRuntimePackage[]> {
		const session = this._session;
		if (!session.searchPackages) {
			throw new Error('Method not implemented.');
		}

		return await session.searchPackages(name);
	}

	async searchPackageVersions(name: string): Promise<string[]> {
		const session = this._session;
		if (!session.searchPackageVersions) {
			throw new Error('Method not implemented.');
		}

		return await session.searchPackageVersions(name);
	}

	/**
	 * Attaches to the runtime to listen for state changes and trigger initial refresh.
	 */
	attachRuntime(): void {
		// Add the onDidChangeRuntimeState event handler to refresh packages when ready
		this._runtimeDisposableStore.add(
			this._session.onDidChangeRuntimeState(async runtimeState => {
				if (runtimeState === RuntimeState.Ready) {
					// Refresh packages when the runtime becomes ready (once at startup)
					try {
						await this.refreshPackages();
					} catch (err) {
						this._logService.warn(`[Packages] Failed to refresh packages on state change: ${err}`);
					}
				} else if (runtimeState === RuntimeState.Exited) {
					this.detachRuntime();
				}
			})
		);

		// If the runtime is already ready, refresh packages immediately
		const currentState = this._session.getRuntimeState();
		if (currentState === RuntimeState.Ready ||
			currentState === RuntimeState.Idle ||
			currentState === RuntimeState.Busy) {
			this.refreshPackages().catch(err => {
				this._logService.warn(`[Packages] Failed to refresh packages on attach: ${err}`);
			});
		}
	}

	/**
	 * Detaches from the runtime and cleans up disposables.
	 */
	detachRuntime(): void {
		// Clear all disposables associated with the attached runtime.
		// We use clear() instead of dispose() to not mark the store as disposed.
		this._runtimeDisposableStore.clear();
	}

}
