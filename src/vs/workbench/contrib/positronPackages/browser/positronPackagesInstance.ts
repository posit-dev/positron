/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancelablePromise, createCancelablePromise } from '../../../../base/common/async.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { isCancellationError } from '../../../../base/common/errors.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { RuntimeState } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimePackage, ILanguageRuntimeSession, IPackageSpec } from '../../../services/runtimeSession/common/runtimeSessionService.js';

export interface IPositronPackagesInstance {
	packages: ILanguageRuntimePackage[];
	session: ILanguageRuntimeSession;
	attachRuntime(): void;
	detachRuntime(): void;
	refreshPackages(token?: CancellationToken): Promise<ILanguageRuntimePackage[]>;
	refreshMetadata(token?: CancellationToken): Promise<void>;
	installPackages(packages: IPackageSpec[], token?: CancellationToken): Promise<void>;
	uninstallPackages(packageNames: string[], token?: CancellationToken): Promise<void>;
	updatePackages(packages: IPackageSpec[], token?: CancellationToken): Promise<void>;
	updateAllPackages(token?: CancellationToken): Promise<void>;
	loadPackage(packageName: string, token?: CancellationToken): Promise<void>;
	unloadPackage(packageName: string, token?: CancellationToken): Promise<void>;
	searchPackages(name: string, token?: CancellationToken): Promise<ILanguageRuntimePackage[]>;
	searchPackageVersions(name: string, token?: CancellationToken): Promise<string[]>;

	readonly onDidRefreshPackagesInstance: Event<ILanguageRuntimePackage[]>;

	readonly onDidChangeRefreshState: Event<boolean>;

	readonly onDidChangeInstallState: Event<boolean>;

	readonly onDidChangeUninstallState: Event<boolean>;

	readonly onDidChangeUpdateState: Event<boolean>;

	readonly onDidChangeUpdateAllState: Event<boolean>;
}

export class PositronPackagesInstance extends Disposable implements IPositronPackagesInstance {

	private _session: ILanguageRuntimeSession;

	/** Raw package list from the kernel (no metadata) */
	private _packages: ILanguageRuntimePackage[] = [];

	/** Cached metadata from P3M, keyed by lowercase package name */
	private readonly _metadataCache = new Map<string, Partial<ILanguageRuntimePackage>>();

	/** Handle to the in-flight metadata fetch so re-entrance can supersede it */
	private _metadataFetch?: CancelablePromise<void>;

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
	 * Gets the packages with metadata merged from the cache.
	 */
	get packages(): ILanguageRuntimePackage[] {
		return this._packages.map((pkg) => {
			const metadata = this._metadataCache.get(pkg.name.toLowerCase());
			if (metadata) {
				return { ...pkg, ...metadata };
			}
			return pkg;
		});
	}

	/**
	 * Gets the session.
	 */
	get session(): ILanguageRuntimeSession {
		return this._session;
	}

	/**
	 * Sets the runtime session and re-attaches the runtime.
	 *
	 * @param session The runtime session.
	 */
	setRuntimeSession(session: ILanguageRuntimeSession): void {
		this._session = session;
		this.attachRuntime();
	}

	private getPackageManagerOrThrow() {
		const packageManager = this._session.getPackageManager?.();
		if (!packageManager) {
			throw new Error('Package management not implemented for this session.');
		}
		return packageManager;
	}

	async refreshPackages(token?: CancellationToken): Promise<ILanguageRuntimePackage[]> {
		const packageManager = this.getPackageManagerOrThrow();
		const effectiveToken = token ?? CancellationToken.None;

		// Loading
		this._onDidChangeRefreshState.fire(true);
		try {
			await this._refreshPackagesInternal(packageManager, effectiveToken);
			return this.packages;
		} finally {
			this._onDidChangeRefreshState.fire(false);
		}
	}

	/**
	 * Force refresh metadata for all packages, clearing the cache first.
	 */
	async refreshMetadata(token?: CancellationToken): Promise<void> {
		const packageManager = this.getPackageManagerOrThrow();
		const effectiveToken = token ?? CancellationToken.None;

		if (!packageManager.getPackageMetadata || this._packages.length === 0) {
			return;
		}

		// Cancel any in-flight fetch before clearing the cache so a stale
		// fetch from refreshPackages can't repopulate it after the clear.
		this._metadataFetch?.cancel();
		this._metadataCache.clear();

		await this._fetchAndMergeMetadata(packageManager, effectiveToken);
	}

	/**
	 * Internal helper to refresh packages with two-stage metadata fetch.
	 * Stage 1: Get basic packages and fire event immediately (with cached metadata).
	 * Stage 2: Fetch metadata asynchronously for uncached packages.
	 */
	private async _refreshPackagesInternal(
		packageManager: ReturnType<typeof this.getPackageManagerOrThrow>,
		token: CancellationToken,
	): Promise<void> {
		// Stage 1: Get basic package list and fire event (getter merges cached metadata)
		this._packages = await packageManager.getPackages(token);
		this._onDidRefreshPackagesInstance.fire(this.packages);

		// Stage 2: Fetch metadata asynchronously for uncached packages (don't block)
		// Use CancellationToken.None since this runs after the main operation completes
		if (packageManager.getPackageMetadata && this._packages.length > 0) {
			this._fetchAndMergeMetadata(packageManager, CancellationToken.None);
		}
	}

	/**
	 * Fetch package metadata and store it in the cache.
	 * Only fetches metadata for packages not already in the cache.
	 * This runs asynchronously after the initial package list is returned.
	 */
	private async _fetchAndMergeMetadata(
		packageManager: { getPackageMetadata?: (names: string[], token?: CancellationToken) => Promise<Map<string, Partial<ILanguageRuntimePackage>> | undefined> },
		externalToken: CancellationToken,
	): Promise<void> {
		// Cancel any prior in-flight fetch so re-entrance supersedes rather than no-ops
		this._metadataFetch?.cancel();

		const uncachedPackages = this._packages.filter(
			(pkg) => !this._metadataCache.has(pkg.name.toLowerCase())
		);

		if (uncachedPackages.length === 0) {
			// All packages already have cached metadata, just fire the event
			this._onDidRefreshPackagesInstance.fire(this.packages);
			return;
		}

		const fetch = createCancelablePromise<void>(async (token) => {
			const packageNames = uncachedPackages.map((pkg) => pkg.name);
			const metadataMap = await packageManager.getPackageMetadata!(packageNames, token);

			// Re-check cancellation before writing so a cancelled fetch
			// can't pollute the cache after a caller has cleared it.
			if (token.isCancellationRequested || !metadataMap || metadataMap.size === 0) {
				return;
			}

			for (const [name, metadata] of metadataMap) {
				this._metadataCache.set(name.toLowerCase(), metadata);
			}

			this._onDidRefreshPackagesInstance.fire(this.packages);
		});

		this._metadataFetch = fetch;

		const cancelSubscription = externalToken.onCancellationRequested(() => fetch.cancel());

		try {
			await fetch;
		} catch (err) {
			if (!isCancellationError(err)) {
				this._logService.warn(`[Packages] Failed to fetch package metadata: ${err}`);
			}
		} finally {
			cancelSubscription.dispose();
			if (this._metadataFetch === fetch) {
				this._metadataFetch = undefined;
			}
		}
	}

	async installPackages(packages: IPackageSpec[], token?: CancellationToken): Promise<void> {
		const packageManager = this.getPackageManagerOrThrow();
		const effectiveToken = token ?? CancellationToken.None;

		// Loading
		this._onDidChangeInstallState.fire(true);

		try {
			await packageManager.installPackages(packages, effectiveToken);

			// Refresh packages with two-stage metadata fetch
			await this._refreshPackagesInternal(packageManager, effectiveToken);
		} finally {
			// Completed
			this._onDidChangeInstallState.fire(false);
		}
	}

	async uninstallPackages(packageNames: string[], token?: CancellationToken): Promise<void> {
		const packageManager = this.getPackageManagerOrThrow();
		const effectiveToken = token ?? CancellationToken.None;

		// Loading
		this._onDidChangeUninstallState.fire(true);

		try {
			await packageManager.uninstallPackages(packageNames, effectiveToken);

			// Refresh packages with two-stage metadata fetch
			await this._refreshPackagesInternal(packageManager, effectiveToken);
		} finally {
			// Completed
			this._onDidChangeUninstallState.fire(false);
		}
	}

	async updatePackages(packages: IPackageSpec[], token?: CancellationToken): Promise<void> {
		const packageManager = this.getPackageManagerOrThrow();
		const effectiveToken = token ?? CancellationToken.None;

		// Loading
		this._onDidChangeUpdateState.fire(true);

		try {
			await packageManager.updatePackages(packages, effectiveToken);
			if (effectiveToken.isCancellationRequested) {
				return;
			}

			// Refresh packages with two-stage metadata fetch
			await this._refreshPackagesInternal(packageManager, effectiveToken);
		} finally {
			// Completed
			this._onDidChangeUpdateState.fire(false);
		}
	}

	async updateAllPackages(token?: CancellationToken): Promise<void> {
		const packageManager = this.getPackageManagerOrThrow();
		const effectiveToken = token ?? CancellationToken.None;

		// Loading
		this._onDidChangeUpdateAllState.fire(true);

		try {
			await packageManager.updateAllPackages(effectiveToken);
			if (effectiveToken.isCancellationRequested) {
				return;
			}

			// Refresh packages with two-stage metadata fetch
			await this._refreshPackagesInternal(packageManager, effectiveToken);
		} finally {
			// Completed
			this._onDidChangeUpdateAllState.fire(false);
		}
	}

	async loadPackage(packageName: string, token?: CancellationToken): Promise<void> {
		const packageManager = this.getPackageManagerOrThrow();
		const effectiveToken = token ?? CancellationToken.None;

		if (!packageManager.loadPackage) {
			throw new Error('Package loading is not supported by this runtime.');
		}

		try {
			await packageManager.loadPackage(packageName, effectiveToken);
		} finally {
			// Refresh after either success or failure so the indicator reflects truth.
			await this._refreshPackagesInternal(packageManager, effectiveToken);
		}
	}

	async unloadPackage(packageName: string, token?: CancellationToken): Promise<void> {
		const packageManager = this.getPackageManagerOrThrow();
		const effectiveToken = token ?? CancellationToken.None;

		if (!packageManager.unloadPackage) {
			throw new Error('Package unloading is not supported by this runtime.');
		}

		try {
			await packageManager.unloadPackage(packageName, effectiveToken);
		} finally {
			await this._refreshPackagesInternal(packageManager, effectiveToken);
		}
	}

	async searchPackages(name: string, token?: CancellationToken): Promise<ILanguageRuntimePackage[]> {
		const packageManager = this.getPackageManagerOrThrow();
		const effectiveToken = token ?? CancellationToken.None;
		const results = await packageManager.searchPackages(name, effectiveToken);
		if (effectiveToken.isCancellationRequested) {
			return [];
		}
		return results;
	}

	async searchPackageVersions(name: string, token?: CancellationToken): Promise<string[]> {
		const packageManager = this.getPackageManagerOrThrow();
		const effectiveToken = token ?? CancellationToken.None;
		const results = await packageManager.searchPackageVersions(name, effectiveToken);
		if (effectiveToken.isCancellationRequested) {
			return [];
		}
		return results;
	}

	/**
	 * Attaches to the runtime to listen for state changes and trigger initial refresh.
	 */
	attachRuntime(): void {
		// Clear any existing disposables to avoid duplicate handlers if re-attaching.
		this._runtimeDisposableStore.clear();

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

	override dispose(): void {
		this._metadataFetch?.cancel();
		super.dispose();
	}

}
