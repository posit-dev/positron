/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';

/**
 * Setting key: when `false`, all reads return empty and all writes no-op,
 * restoring the pre-cache behavior (metadata only appears once the live fetch
 * completes). Bare key per Positron configuration conventions.
 */
export const PACKAGE_METADATA_CACHE_ENABLED_SETTING = 'packages.metadataCache.enabled';

/**
 * Setting key: how long (in hours) a persisted entry is considered fresh. A
 * warm start renders from the cache immediately and only triggers a background
 * refresh once the entry is older than this.
 */
export const PACKAGE_METADATA_CACHE_MAX_AGE_HOURS_SETTING = 'packages.metadataCache.maxAgeHours';

/** Default for {@link PACKAGE_METADATA_CACHE_MAX_AGE_HOURS_SETTING}. */
export const PACKAGE_METADATA_CACHE_MAX_AGE_HOURS_DEFAULT = 24;

/**
 * On-disk schema version. Bumped when {@link ICachedPackageMetadata} or the
 * surrounding shape changes; a mismatch on load discards the persisted blob
 * and re-seeds it fresh.
 */
export const PACKAGE_METADATA_CACHE_SCHEMA_VERSION = 1;

/** Storage key for the persisted cache blob. */
export const PACKAGE_METADATA_CACHE_STORAGE_KEY = 'positron.packages.metadataCache';

const MS_PER_HOUR = 60 * 60 * 1000;

/**
 * Outdated state for a single package, as computed by the language runtime
 * against the environment's configured repositories. The installed `version`
 * is stored alongside so a reader can apply the cached state only when the
 * currently-installed version still matches -- guarding against a different
 * library context (e.g. two renv projects sharing one system R binary) or a
 * package that changed out-of-band between sessions.
 */
export interface ICachedPackageMetadata {
	/** Installed version at the time the metadata was fetched. */
	version: string;

	/** Whether the installed version is strictly older than the latest available. */
	outdated?: boolean;

	/** Latest available version from the environment's configured repository. */
	latestVersion?: string;
}

/**
 * One environment's worth of cached outdated state, keyed by lowercase package
 * name. `lastFetched` is the epoch-ms timestamp of the last successful fetch
 * and drives the freshness check.
 */
export interface ICachedEnvironment {
	lastFetched: number;
	packages: Record<string, ICachedPackageMetadata>;
}

/** On-disk JSON shape. Keyed by `runtimeId` (stable per interpreter). */
interface IPersistedCache {
	schemaVersion: number;
	environments: Record<string, ICachedEnvironment>;
}

/**
 * Persists the Packages pane's outdated state to disk so update indicators can
 * render immediately on a new session instead of waiting for the live outdated
 * fetch (`pip/uv list --outdated`, R's `pkg_outdated`), which can take 10-30s+
 * on a cold start because it hits a network index for every installed package.
 *
 * Within a workspace, entries are keyed by `runtimeId` -- a stable hash of the
 * interpreter path and version -- so restarting an interpreter's session reuses
 * its cache, while different interpreters stay isolated. The cache lives in
 * `WORKSPACE`/`MACHINE`-scoped storage so each project keeps its own view:
 * `runtimeId` encodes the interpreter binary but not the active library
 * (`.libPaths()` / renv / venv) or the configured repositories, so two projects
 * sharing one binary must not share outdated state (e.g. renv projects pinned to
 * different CRAN snapshots, where the same installed version has a different
 * "latest"). Workspace scope also keeps concurrent windows from clobbering a
 * single shared blob. The cache is never synced across machines.
 *
 * This is a plain class rather than a registered service: the packages service
 * owns a single instance and threads it into each per-session packages
 * instance.
 */
export class PackageMetadataCache {

	constructor(
		private readonly _storageService: IStorageService,
		private readonly _logService: ILogService,
		private readonly _configurationService: IConfigurationService,
	) { }

	/**
	 * Returns the cached environment for `runtimeId`, or `undefined` if the
	 * cache is disabled or has no entry for it.
	 */
	get(runtimeId: string): ICachedEnvironment | undefined {
		if (!this._enabled) {
			return undefined;
		}
		return this._read().environments[runtimeId];
	}

	/**
	 * Whether `runtimeId` has a cached entry younger than the configured max
	 * age. A fresh entry lets a warm start skip the live outdated fetch.
	 */
	isFresh(runtimeId: string, now: number = Date.now()): boolean {
		const entry = this.get(runtimeId);
		if (!entry) {
			return false;
		}
		return now - entry.lastFetched < this._maxAgeMs;
	}

	/**
	 * Replace the cached entry for `runtimeId` with a fresh snapshot, stamping
	 * `lastFetched` with the current time. Call this only after a *successful*
	 * fetch so a failed or cancelled fetch leaves the previous entry intact.
	 */
	upsert(runtimeId: string, packages: Record<string, ICachedPackageMetadata>, now: number = Date.now()): void {
		if (!this._enabled) {
			return;
		}
		const cache = this._read();
		cache.environments[runtimeId] = { lastFetched: now, packages };
		this._write(cache);
	}

	/**
	 * Drop the named packages from `runtimeId`'s entry. Used after
	 * install/uninstall/update so a stale on-disk entry can't outlive the
	 * change if the app closes before the follow-up fetch persists. Leaves
	 * `lastFetched` untouched so the entry still ages out normally.
	 */
	evict(runtimeId: string, packageNames: readonly string[]): void {
		if (!this._enabled || packageNames.length === 0) {
			return;
		}
		const cache = this._read();
		const entry = cache.environments[runtimeId];
		if (!entry) {
			return;
		}
		for (const name of packageNames) {
			delete entry.packages[name.toLowerCase()];
		}
		this._write(cache);
	}

	/** Remove `runtimeId`'s entry entirely. */
	clear(runtimeId: string): void {
		if (!this._enabled) {
			return;
		}
		const cache = this._read();
		if (cache.environments[runtimeId]) {
			delete cache.environments[runtimeId];
			this._write(cache);
		}
	}

	private get _enabled(): boolean {
		return this._configurationService.getValue<boolean>(PACKAGE_METADATA_CACHE_ENABLED_SETTING) !== false;
	}

	private get _maxAgeMs(): number {
		const hours = this._configurationService.getValue<number>(PACKAGE_METADATA_CACHE_MAX_AGE_HOURS_SETTING);
		const effective = typeof hours === 'number' && hours > 0 ? hours : PACKAGE_METADATA_CACHE_MAX_AGE_HOURS_DEFAULT;
		return effective * MS_PER_HOUR;
	}

	private _read(): IPersistedCache {
		const raw = this._storageService.get(PACKAGE_METADATA_CACHE_STORAGE_KEY, StorageScope.WORKSPACE);
		if (!raw) {
			return { schemaVersion: PACKAGE_METADATA_CACHE_SCHEMA_VERSION, environments: {} };
		}
		try {
			const parsed = JSON.parse(raw) as IPersistedCache;
			if (parsed.schemaVersion !== PACKAGE_METADATA_CACHE_SCHEMA_VERSION || !parsed.environments) {
				return { schemaVersion: PACKAGE_METADATA_CACHE_SCHEMA_VERSION, environments: {} };
			}
			return parsed;
		} catch (err) {
			this._logService.warn(`[Packages] Failed to parse persisted outdated cache, discarding: ${err}`);
			return { schemaVersion: PACKAGE_METADATA_CACHE_SCHEMA_VERSION, environments: {} };
		}
	}

	private _write(cache: IPersistedCache): void {
		this._storageService.store(
			PACKAGE_METADATA_CACHE_STORAGE_KEY,
			JSON.stringify(cache),
			StorageScope.WORKSPACE,
			StorageTarget.MACHINE,
		);
	}
}
