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
import { ICachedPackageMetadata, PackageMetadataCache } from './packageMetadataCache.js';

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
	searchPackages(name: string, token?: CancellationToken): Promise<ILanguageRuntimePackage[]>;
	searchPackageVersions(name: string, token?: CancellationToken): Promise<string[]>;

	readonly onDidRefreshPackagesInstance: Event<ILanguageRuntimePackage[]>;

	/**
	 * Fires after a successful install or update with the names of the packages
	 * the operation added or changed, so the view can scroll to and highlight
	 * them. For install/update these are the requested packages; for update-all
	 * they are the packages whose version actually changed.
	 */
	readonly onDidChangePackages: Event<string[]>;

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

	/**
	 * Cached outdated state keyed by lowercase package name. Each entry carries
	 * the installed version it was computed against so the getter can ignore a
	 * stale entry (different library context, or a since-changed install).
	 * Seeded from disk in the constructor so indicators render immediately.
	 */
	private readonly _metadataCache = new Map<string, ICachedPackageMetadata>();

	/** Handle to the in-flight metadata fetch so re-entrance can supersede it */
	private _metadataFetch?: CancelablePromise<void>;

	/** Stable per-interpreter key for the persisted cache. */
	private readonly _runtimeId: string;

	private readonly _runtimeDisposableStore = this._register(new DisposableStore());

	private readonly _logService: ILogService;

	private readonly _onDidRefreshPackagesInstance = this._register(new Emitter<ILanguageRuntimePackage[]>());

	private readonly _onDidChangePackages = this._register(new Emitter<string[]>());

	private readonly _onDidChangeRefreshState = this._register(new Emitter<boolean>());

	private readonly _onDidChangeInstallState = this._register(new Emitter<boolean>());

	private readonly _onDidChangeUninstallState = this._register(new Emitter<boolean>());

	private readonly _onDidChangeUpdateState = this._register(new Emitter<boolean>());

	private readonly _onDidChangeUpdateAllState = this._register(new Emitter<boolean>());

	constructor(
		session: ILanguageRuntimeSession,
		logService: ILogService,
		private readonly _cache: PackageMetadataCache,
	) {
		super();

		this._session = session;
		this._logService = logService;
		this._runtimeId = session.runtimeMetadata.runtimeId;

		// Seed from the persisted cache so the first refresh can render update
		// indicators immediately, before the live outdated fetch completes.
		const persisted = this._cache.get(this._runtimeId);
		if (persisted) {
			for (const [name, metadata] of Object.entries(persisted.packages)) {
				this._metadataCache.set(name, metadata);
			}
		}
	}

	readonly onDidRefreshPackagesInstance = this._onDidRefreshPackagesInstance.event;

	readonly onDidChangePackages = this._onDidChangePackages.event;

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
			// Apply cached outdated state only when it was computed against the
			// version that is installed now. A mismatch means the entry is from
			// a different library context or a since-changed install, so we
			// drop it rather than risk a misleading indicator.
			if (metadata && metadata.version === pkg.version) {
				return { ...pkg, outdated: metadata.outdated, latestVersion: metadata.latestVersion };
			}
			return pkg;
		});
	}

	/** Whether the cache holds outdated state for the package's current version. */
	private _hasFreshMetadata(pkg: ILanguageRuntimePackage): boolean {
		const metadata = this._metadataCache.get(pkg.name.toLowerCase());
		return metadata !== undefined && metadata.version === pkg.version;
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

		await this._fetchAndMergeMetadata(packageManager, effectiveToken, true /* fetchAll */);
	}

	/**
	 * Internal helper to refresh packages with two-stage metadata fetch.
	 * Stage 1: Get basic packages and fire event immediately (with cached metadata).
	 * Stage 2: Fetch outdated metadata asynchronously.
	 */
	private async _refreshPackagesInternal(
		packageManager: ReturnType<typeof this.getPackageManagerOrThrow>,
		token: CancellationToken,
	): Promise<void> {
		// Stage 1: Get basic package list and fire event (getter merges cached metadata)
		this._packages = await packageManager.getPackages(token);
		this._onDidRefreshPackagesInstance.fire(this.packages);

		// Stage 2: Fetch metadata asynchronously (don't block). When the
		// persisted entry has aged past its freshness window, refetch every
		// package so a new upstream release surfaces even though nothing
		// installed locally changed; otherwise only the packages without a
		// fresh cache hit are fetched (and a fully-fresh warm start makes no
		// network call at all). Use CancellationToken.None since this runs
		// after the main operation completes.
		if (packageManager.getPackageMetadata && this._packages.length > 0) {
			const fetchAll = !this._cache.isFresh(this._runtimeId);
			this._fetchAndMergeMetadata(packageManager, CancellationToken.None, fetchAll);
		}
	}

	/**
	 * Fetch package outdated metadata and store it in the cache, persisting the
	 * result to disk on success. When `fetchAll` is false, only packages
	 * lacking a fresh (version-matching) cache hit are fetched.
	 * This runs asynchronously after the initial package list is returned.
	 */
	private async _fetchAndMergeMetadata(
		packageManager: { getPackageMetadata?: (names: string[], token?: CancellationToken) => Promise<Map<string, Partial<ILanguageRuntimePackage>> | undefined> },
		externalToken: CancellationToken,
		fetchAll: boolean,
	): Promise<void> {
		// Cancel any prior in-flight fetch so re-entrance supersedes rather than no-ops
		this._metadataFetch?.cancel();

		const packagesToFetch = fetchAll
			? this._packages
			: this._packages.filter((pkg) => !this._hasFreshMetadata(pkg));

		if (packagesToFetch.length === 0) {
			// Every package already has fresh cached metadata, just fire the event
			this._onDidRefreshPackagesInstance.fire(this.packages);
			return;
		}

		// Look up installed versions so each cached entry records the version
		// its outdated state was computed against.
		const versionByName = new Map(this._packages.map((pkg) => [pkg.name.toLowerCase(), pkg.version]));

		const fetch = createCancelablePromise<void>(async (token) => {
			const packageNames = packagesToFetch.map((pkg) => pkg.name);
			const metadataMap = await packageManager.getPackageMetadata!(packageNames, token);

			// Re-check cancellation before writing so a cancelled fetch
			// can't pollute the cache after a caller has cleared it.
			if (token.isCancellationRequested || !metadataMap || metadataMap.size === 0) {
				return;
			}

			for (const [name, metadata] of metadataMap) {
				const key = name.toLowerCase();
				const version = versionByName.get(key);
				if (version === undefined) {
					// Not currently installed; nothing to anchor the entry to.
					continue;
				}
				this._metadataCache.set(key, {
					version,
					outdated: metadata.outdated,
					latestVersion: metadata.latestVersion,
				});
			}

			// Persist only after a successful fetch so a failed or cancelled
			// fetch leaves the previous on-disk entry intact.
			this._cache.upsert(this._runtimeId, this._snapshotForPersist());

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

			// Evict the affected packages so Stage 2 refetches their metadata
			// (latestVersion / outdated may have shifted relative to the install).
			this._evictPackagesFromCache(packages.map((pkg) => pkg.name));

			// Refresh packages with two-stage metadata fetch
			await this._refreshPackagesInternal(packageManager, effectiveToken);

			// Highlight the requested packages in the view. Dependencies the
			// package manager pulled in are not in `packages`, so they are
			// intentionally excluded.
			this._onDidChangePackages.fire(packages.map((pkg) => pkg.name));
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

			// Drop cached entries for the now-removed packages.
			this._evictPackagesFromCache(packageNames);

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

			this._evictPackagesFromCache(packages.map((pkg) => pkg.name));

			// Refresh packages with two-stage metadata fetch
			await this._refreshPackagesInternal(packageManager, effectiveToken);

			// Highlight the updated packages in the view.
			this._onDidChangePackages.fire(packages.map((pkg) => pkg.name));
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

		// Snapshot installed versions before the update so we can report which
		// packages actually changed once the refresh completes.
		const versionsBefore = new Map(this._packages.map((pkg) => [pkg.name, pkg.version]));

		try {
			await packageManager.updateAllPackages(effectiveToken);
			if (effectiveToken.isCancellationRequested) {
				return;
			}

			// Update-all potentially touched every installed package; evict
			// every cached entry so Stage 2 refetches them all.
			this._evictPackagesFromCache(Array.from(this._metadataCache.keys()));

			// Refresh packages with two-stage metadata fetch
			await this._refreshPackagesInternal(packageManager, effectiveToken);

			// Highlight every package whose version changed. Update-all may
			// leave many packages untouched (already current), so diffing
			// against the pre-update snapshot avoids flashing the whole list.
			const changed = this._packages
				.filter((pkg) => versionsBefore.get(pkg.name) !== pkg.version)
				.map((pkg) => pkg.name);
			this._onDidChangePackages.fire(changed);
		} finally {
			// Completed
			this._onDidChangeUpdateAllState.fire(false);
		}
	}

	/**
	 * Evict the named packages from the in-memory cache. Used after
	 * install/uninstall/update operations so the upcoming Stage 2 refetches
	 * their metadata. Other packages' cached metadata is preserved.
	 *
	 * Cancels any in-flight metadata fetch so a stale write can't repopulate
	 * the slots we just cleared.
	 */
	private _evictPackagesFromCache(packageNames: readonly string[]): void {
		if (packageNames.length === 0) {
			return;
		}
		this._metadataFetch?.cancel();
		for (const name of packageNames) {
			this._metadataCache.delete(name.toLowerCase());
		}
		// Drop the on-disk entries too so a stale indicator can't outlive the
		// change if the window closes before the follow-up fetch persists.
		this._cache.evict(this._runtimeId, packageNames);
	}

	/**
	 * Build the snapshot to persist: every currently-installed package whose
	 * cached metadata matches its installed version. Excludes uninstalled
	 * packages and stale entries so the on-disk cache stays lean and trusted.
	 */
	private _snapshotForPersist(): Record<string, ICachedPackageMetadata> {
		const snapshot: Record<string, ICachedPackageMetadata> = {};
		for (const pkg of this._packages) {
			const key = pkg.name.toLowerCase();
			const metadata = this._metadataCache.get(key);
			if (metadata && metadata.version === pkg.version) {
				snapshot[key] = metadata;
			}
		}
		return snapshot;
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
