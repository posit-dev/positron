/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancelablePromise, createCancelablePromise, raceTimeout } from '../../../../base/common/async.js';
import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { isCancellationError } from '../../../../base/common/errors.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { RuntimeState } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimePackage, ILanguageRuntimeSession, IPackageSpec } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { ICachedPackageMetadata, PackageMetadataCache } from './packageMetadataCache.js';

/**
 * How the `outdated` / `latestVersion` state in a packages snapshot was
 * obtained. A caller that can't see the log has no other way to tell "nothing
 * is outdated" apart from "we never found out".
 *
 * - `fresh`: the session's repositories were queried during this call.
 * - `cached`: the persisted metadata was still inside its freshness window, so
 *   the state is as of the last full fetch; only packages missing an entry
 *   were looked up.
 * - `unsupported`: the session's package manager reports no metadata at all,
 *   so no package carries outdated state.
 * - `timed-out`: the fetch outran its budget. The package list is complete;
 *   outdated state is whatever the cache could supply, which may be nothing.
 * - `fetch-failed`: the fetch errored -- repository unreachable, kernel
 *   error. The package list is complete; outdated state is whatever the
 *   cache could supply, which may be nothing.
 */
export type PackagesMetadataStatus = 'fresh' | 'cached' | 'unsupported' | 'timed-out' | 'fetch-failed';

/**
 * A point-in-time read of a session's installed packages, with how far its
 * outdated state can be trusted.
 */
export interface IPackagesSnapshot {
	packages: ILanguageRuntimePackage[];
	metadataStatus: PackagesMetadataStatus;
}

/**
 * How long {@link IPositronPackagesInstance.getPackagesSnapshot} waits for each
 * of its two stages. Both default to the constants below; tests override them
 * to keep a timeout case fast.
 */
export interface IPackagesSnapshotOptions {
	/** How long to wait for the installed package list. */
	listTimeoutMs?: number;
	/**
	 * Budget for the outdated/latestVersion stage. Joining a fetch already in
	 * flight and issuing our own share it.
	 */
	metadataTimeoutMs?: number;
}

/**
 * How long to wait for the package list. Matches the bound the packages
 * service puts on a refresh: past it, the kernel is not answering.
 */
export const PACKAGES_SNAPSHOT_LIST_TIMEOUT_MS = 5_000;

/**
 * How long to wait for outdated state. Longer than the list bound because this
 * stage leaves the machine -- it queries CRAN/P3M/PyPI -- and a slow answer is
 * still worth having.
 */
export const PACKAGES_SNAPSHOT_METADATA_TIMEOUT_MS = 10_000;

export interface IPositronPackagesInstance {
	packages: ILanguageRuntimePackage[];
	session: ILanguageRuntimeSession;
	attachRuntime(): void;
	detachRuntime(): void;
	refreshPackages(token?: CancellationToken, forceMetadata?: boolean): Promise<ILanguageRuntimePackage[]>;
	installPackages(packages: IPackageSpec[], token?: CancellationToken): Promise<void>;
	uninstallPackages(packageNames: string[], token?: CancellationToken): Promise<void>;
	updatePackages(packages: IPackageSpec[], token?: CancellationToken): Promise<void>;
	/**
	 * Updates all outdated packages.
	 *
	 * @returns The names of the packages whose installed version actually
	 * changed, sorted alphabetically. Empty when nothing was updated.
	 */
	updateAllPackages(token?: CancellationToken): Promise<string[]>;
	searchPackages(name: string, token?: CancellationToken): Promise<ILanguageRuntimePackage[]>;
	searchPackageVersions(name: string, token?: CancellationToken): Promise<string[]>;

	/**
	 * Fetch detail metadata for a single package from the session's package
	 * manager. Resolves undefined when the manager doesn't support it.
	 */
	getPackageDetail(name: string, token?: CancellationToken): Promise<Partial<ILanguageRuntimePackage> | undefined>;

	/**
	 * Reads the installed packages together with their outdated state, for a
	 * caller that needs an answer rather than a rendered pane -- notably the
	 * positronPackages.getPackages command.
	 *
	 * Differs from {@link refreshPackages} in the two ways that matter to such
	 * a caller: it reads the installed list live on every call (an agent can
	 * arrive before the pane was ever opened, or be verifying an install it
	 * just ran in the console), and it *awaits* the outdated/latestVersion
	 * fetch that a refresh deliberately leaves running in the background.
	 * Both stages are bounded, the result says which of them produced the
	 * metadata, and it is read-only toward other callers: a metadata fetch
	 * already in flight (a user's refresh) is joined, never cancelled.
	 */
	getPackagesSnapshot(token?: CancellationToken, options?: IPackagesSnapshotOptions): Promise<IPackagesSnapshot>;

	/**
	 * The newest version of an installed package available to this session.
	 *
	 * Resolves undefined when the session offers nothing newer than what is
	 * installed, when the package isn't installed, or when the package manager
	 * doesn't report metadata. Callers can't tell those apart, which matches
	 * what the packages list shows: no update affordance in any of the three.
	 */
	resolveLatestVersion(name: string, token?: CancellationToken): Promise<string | undefined>;

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

	async refreshPackages(token?: CancellationToken, forceMetadata: boolean = false): Promise<ILanguageRuntimePackage[]> {
		const packageManager = this.getPackageManagerOrThrow();
		const effectiveToken = token ?? CancellationToken.None;

		// Loading
		this._onDidChangeRefreshState.fire(true);
		try {
			await this._refreshPackagesInternal(packageManager, effectiveToken, forceMetadata);
			return this.packages;
		} finally {
			this._onDidChangeRefreshState.fire(false);
		}
	}

	/**
	 * Internal helper to refresh packages with two-stage metadata fetch.
	 * Stage 1: Get basic packages and fire event immediately (with cached metadata).
	 * Stage 2: Fetch outdated metadata asynchronously.
	 */
	private async _refreshPackagesInternal(
		packageManager: ReturnType<typeof this.getPackageManagerOrThrow>,
		token: CancellationToken,
		forceMetadata: boolean = false,
	): Promise<void> {
		// Stage 1: Get basic package list and fire event (getter merges cached metadata)
		this._packages = await packageManager.getPackages(token);
		this._onDidRefreshPackagesInstance.fire(this.packages);

		// Stage 2: Fetch metadata asynchronously (don't block). Refetch every
		// package when `forceMetadata` is set (a user-initiated refresh, which
		// must be authoritative even inside the freshness window) or when the
		// persisted entry has aged past its freshness window (so a new upstream
		// release surfaces even though nothing installed locally changed);
		// otherwise only the packages without a fresh cache hit are fetched
		// (and a fully-fresh warm start makes no network call at all). Use
		// CancellationToken.None since this runs after the main operation
		// completes.
		if (packageManager.getPackageMetadata && this._packages.length > 0) {
			const fetchAll = forceMetadata || !this._cache.isFresh(this._runtimeId);
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

			this._mergeAndPersistMetadata(metadataMap, versionByName);
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

	/**
	 * Write fetched metadata into the in-memory cache, persist it to disk, and
	 * notify listeners. `versionByName` is the installed versions as of when
	 * the fetch was issued, so each entry stays anchored to the version its
	 * outdated state was computed against even if an install lands mid-fetch
	 * (the `packages` getter drops mismatched entries).
	 */
	private _mergeAndPersistMetadata(
		metadataMap: Map<string, Partial<ILanguageRuntimePackage>>,
		versionByName: Map<string, string>,
	): void {
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

	async updateAllPackages(token?: CancellationToken): Promise<string[]> {
		const packageManager = this.getPackageManagerOrThrow();
		const effectiveToken = token ?? CancellationToken.None;

		// Snapshot installed versions before the update. The backend's
		// updateAllPackages returns void and base R / conda don't report which
		// packages they touched, so a before/after version diff is the only
		// backend-agnostic way to know what actually changed.
		const versionsBefore = new Map(this._packages.map((pkg) => [pkg.name, pkg.version]));

		// Loading
		this._onDidChangeUpdateAllState.fire(true);

		try {
			await packageManager.updateAllPackages(effectiveToken);
			if (effectiveToken.isCancellationRequested) {
				return [];
			}

			// Update-all potentially touched every installed package; evict
			// every cached entry so Stage 2 refetches them all.
			this._evictPackagesFromCache(Array.from(this._metadataCache.keys()));

			// Refresh packages with two-stage metadata fetch. Stage 1 repopulates
			// this._packages with fresh versions synchronously before returning.
			await this._refreshPackagesInternal(packageManager, effectiveToken);

			// A package was updated if its installed version changed from the
			// snapshot. Sort for a stable, predictable message.
			const updated = this._packages
				.filter((pkg) => {
					const previousVersion = versionsBefore.get(pkg.name);
					return previousVersion !== undefined && previousVersion !== pkg.version;
				})
				.map((pkg) => pkg.name)
				.sort((a, b) => a.localeCompare(b));

			// Highlight every package whose version changed. Update-all may
			// leave many packages untouched (already current), so diffing
			// against the pre-update snapshot avoids flashing the whole list.
			this._onDidChangePackages.fire(updated);

			return updated;
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

	async getPackageDetail(name: string, token?: CancellationToken): Promise<Partial<ILanguageRuntimePackage> | undefined> {
		const packageManager = this.getPackageManagerOrThrow();
		if (!packageManager.getPackageDetail) {
			return undefined;
		}
		return packageManager.getPackageDetail(name, token);
	}

	async resolveLatestVersion(name: string, token?: CancellationToken): Promise<string | undefined> {
		const packageManager = this.getPackageManagerOrThrow();
		const effectiveToken = token ?? CancellationToken.None;
		if (!packageManager.getPackageMetadata) {
			return undefined;
		}

		// A metadata entry is only recorded for a package whose installed version
		// is known, so the installed list has to be populated first. It usually
		// already is, but a caller that never opened the pane (an agent) can get
		// here first.
		if (this._packages.length === 0) {
			this._packages = await packageManager.getPackages(effectiveToken);
		}

		// Force the fetch rather than trusting the freshness window: "the latest
		// version" has to be answered against the repositories as they are now,
		// not as they were when the cache was last written. Awaited, unlike the
		// background fetch a refresh kicks off, because the answer is the point.
		await this._fetchAndMergeMetadata(packageManager, effectiveToken, true);
		if (effectiveToken.isCancellationRequested) {
			return undefined;
		}

		const target = name.toLowerCase();
		return this.packages.find((pkg) => pkg.name.toLowerCase() === target)?.latestVersion;
	}

	async getPackagesSnapshot(
		token: CancellationToken = CancellationToken.None,
		options: IPackagesSnapshotOptions = {},
	): Promise<IPackagesSnapshot> {
		// Unlike every other method here, a missing package manager is not an
		// error: the caller asked what this session has, and "this runtime
		// doesn't do packages" is a real answer.
		const packageManager = this._session.getPackageManager?.();
		if (!packageManager) {
			return { packages: [], metadataStatus: 'unsupported' };
		}

		const cts = new CancellationTokenSource(token);
		try {
			// Read the list live on every call rather than trusting
			// this._packages: the command's contract is "what is installed
			// now", and a package installed outside Positron (pip install in
			// the console) would otherwise never appear. Kernel-local and
			// bounded, so a dead kernel can't hang the caller.
			const packages = await raceTimeout(
				packageManager.getPackages(cts.token),
				options.listTimeoutMs ?? PACKAGES_SNAPSHOT_LIST_TIMEOUT_MS,
				() => cts.cancel(),
			);
			if (packages === undefined) {
				throw new Error('Timed out reading the installed packages.');
			}
			this._packages = packages;
			// Mirror refreshPackages' stage 1: the pane should show the list
			// this caller was just told about.
			this._onDidRefreshPackagesInstance.fire(this.packages);

			if (!packageManager.getPackageMetadata) {
				return { packages: this.packages, metadataStatus: 'unsupported' };
			}
			if (this._packages.length === 0) {
				// Nothing installed, so there is no outdated state to be had
				// and nothing to fetch: the empty list is already current.
				return { packages: [], metadataStatus: 'fresh' };
			}

			// The two waits below share one budget: joining someone else's
			// fetch must not buy the fetch after it a second full timeout.
			const metadataDeadline = Date.now() +
				(options.metadataTimeoutMs ?? PACKAGES_SNAPSHOT_METADATA_TIMEOUT_MS);

			// A metadata fetch already in flight belongs to the pane --
			// possibly a user-forced refresh, whose recompute must not be
			// dropped. Join it instead of preempting it (or duplicating its
			// repository query); whatever it caches serves this caller too.
			const inflight = this._metadataFetch;
			if (inflight) {
				const joined = await raceTimeout(
					// Failure is fine here: the fetch below is the fallback.
					inflight.then(() => true, () => true),
					metadataDeadline - Date.now(),
				);
				if (joined === undefined) {
					// Not ours to cancel; report what the cache has.
					return { packages: this.packages, metadataStatus: 'timed-out' };
				}
			}

			// A cache still inside its freshness window is exactly what the
			// pane shows, so only refetch every package once it has aged out.
			// Gap-filling for packages with no entry happens either way.
			const fetchAll = !this._cache.isFresh(this._runtimeId);
			const packagesToFetch = fetchAll
				? this._packages
				: this._packages.filter((pkg) => !this._hasFreshMetadata(pkg));
			if (packagesToFetch.length === 0) {
				return { packages: this.packages, metadataStatus: 'cached' };
			}

			// Anchor entries to the versions installed when the fetch was
			// issued, as _fetchAndMergeMetadata does, so an install landing
			// mid-fetch can't mis-anchor them.
			const versionByName = new Map(this._packages.map((pkg) => [pkg.name.toLowerCase(), pkg.version]));

			// Fetched directly rather than through _fetchAndMergeMetadata:
			// that helper preempts whatever fetch is in flight and swallows
			// failures -- both wrong for a read-only foreground caller that
			// has to label its answer. Bounded because this stage leaves the
			// machine (CRAN/P3M/PyPI). The .then wrapper keeps a timeout
			// (raceTimeout's undefined) distinguishable from the manager
			// itself answering undefined (no metadata support at runtime).
			let outcome: { map: Map<string, Partial<ILanguageRuntimePackage>> | undefined } | undefined;
			try {
				outcome = await raceTimeout(
					packageManager.getPackageMetadata(packagesToFetch.map((pkg) => pkg.name), cts.token)
						.then((map) => ({ map })),
					metadataDeadline - Date.now(),
					() => cts.cancel(),
				);
			} catch (err) {
				// Our own timeout resolves the race with undefined before it
				// cancels, so a cancellation landing here is the caller's.
				if (isCancellationError(err) && token.isCancellationRequested) {
					throw err;
				}
				this._logService.warn(`[Packages] Snapshot metadata fetch failed: ${err}`);
				return { packages: this.packages, metadataStatus: 'fetch-failed' };
			}
			if (outcome === undefined) {
				// On expiry the packages getter still merges whatever cached
				// metadata is valid, which is a better answer than none --
				// the status says so.
				return { packages: this.packages, metadataStatus: 'timed-out' };
			}
			if (outcome.map === undefined) {
				return { packages: this.packages, metadataStatus: 'unsupported' };
			}
			if (outcome.map.size > 0) {
				this._mergeAndPersistMetadata(outcome.map, versionByName);
			}
			return {
				packages: this.packages,
				metadataStatus: fetchAll ? 'fresh' : 'cached',
			};
		} finally {
			cts.dispose();
		}
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
