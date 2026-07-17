/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import {
	ILanguageRuntimeMetadata,
	IRuntimeRootEntry,
	IRuntimeRootSignature,
	signaturesEqual,
} from '../../languageRuntime/common/languageRuntimeService.js';

// Re-export the root-signature types so consumers of the cache API can pull
// everything they need from a single import. The types themselves live next
// to `IRuntimeManager` to avoid a cycle between the cache service and the
// runtime service. `export type` is required for the interfaces so the
// compiled JS doesn't emit a runtime re-export of names that only exist at
// the type level (which fails the ESM loader at module evaluation time).
export type {
	IRuntimeRootEntry,
	IRuntimeRootSignature,
};
export { signaturesEqual };

export const IRuntimeDiscoveryCache =
	createDecorator<IRuntimeDiscoveryCache>('runtimeDiscoveryCache');

/**
 * The setting key consulted to enable/disable the cache. Listed under the
 * Positron configuration node in `languageRuntime.ts`. When `false`, all
 * reads return empty and all writes no-op, restoring pre-cache behavior.
 */
export const RUNTIME_DISCOVERY_CACHE_ENABLED_SETTING = 'interpreters.discoveryCache.enabled';

/**
 * Setting key for the hard cap on cache entry age (in days). Even on a healthy
 * machine, an entry must be re-validated by a real discovery pass at least
 * once every {@link RUNTIME_DISCOVERY_CACHE_MAX_AGE_DAYS_DEFAULT} days so we
 * eventually pick up binary-identical replacements that preserve fingerprint.
 */
export const RUNTIME_DISCOVERY_CACHE_MAX_AGE_DAYS_SETTING = 'interpreters.discoveryCache.maxAgeDays';

/**
 * Setting key for the soft cap on bucket-level full-discovery age (in days).
 * After this, a warm start treats an otherwise-cached bucket as needing a
 * fresh full pass. This is the "periodic refresh" trigger.
 */
export const RUNTIME_DISCOVERY_CACHE_REFRESH_INTERVAL_DAYS_SETTING = 'interpreters.discoveryCache.refreshIntervalDays';

/** Default for {@link RUNTIME_DISCOVERY_CACHE_MAX_AGE_DAYS_SETTING}. */
export const RUNTIME_DISCOVERY_CACHE_MAX_AGE_DAYS_DEFAULT = 30;

/** Default for {@link RUNTIME_DISCOVERY_CACHE_REFRESH_INTERVAL_DAYS_SETTING}. */
export const RUNTIME_DISCOVERY_CACHE_REFRESH_INTERVAL_DAYS_DEFAULT = 1;

/**
 * On-disk schema version. Bumped when the persisted entry shape changes;
 * a mismatch on load causes the persisted blob to be discarded and re-seeded.
 *
 * v2 added per-bucket `discoveryRootSignature` so warm starts can detect newly
 * installed interpreters by re-statting the directories the extension scans.
 *
 * v3: `runtimePath` is now always the fully-expanded absolute path, with the
 * `~` shorthand moved to the separate `runtimeDisplayPath` field. Entries
 * written by older builds may still carry a `~`-shortened `runtimePath` and
 * no `runtimeDisplayPath`; bumping the version forces those entries to be
 * discarded and rediscovered rather than replayed as-is.
 */
export const RUNTIME_DISCOVERY_CACHE_SCHEMA_VERSION = 3;

/**
 * Storage key under which all cache state is persisted. Embeds the schema
 * version (e.g. `.v1`) so a schema bump is also a transparent key bump.
 */
export const RUNTIME_DISCOVERY_CACHE_STORAGE_KEY =
	`positron.discoveryCache.v${RUNTIME_DISCOVERY_CACHE_SCHEMA_VERSION}`;

/**
 * Cheap fingerprint of an on-disk binary. Together (size, mtimeMs, ctimeMs)
 * catch the common modify/replace cases. ctime is included because some
 * package managers (pipx/rye/uv) preserve mtime when replacing binaries.
 */
export interface IRuntimeFingerprint {
	readonly size: number;
	readonly mtimeMs: number;
	readonly ctimeMs: number;
}


/**
 * One cached runtime entry. Keyed (within a bucket) by `metadata.runtimePath`.
 */
export interface ICachedRuntime {
	/** The full metadata as registered by the providing extension. */
	readonly metadata: ILanguageRuntimeMetadata;
	/** Fingerprint of the resolved binary at write/last-validation time. */
	readonly fingerprint: IRuntimeFingerprint;
	/** Symlink-followed absolute path of the binary. */
	readonly resolvedPath: string;
	/** Wall-clock time the entry was first added (ms since epoch). */
	readonly firstSeen: number;
	/** Wall-clock time the entry was last successfully validated. */
	readonly lastValidated: number;
}

/**
 * A bucket holds all cached runtimes for one (extensionId, languageId).
 */
export interface IDiscoveryCacheBucket {
	readonly extensionId: string;
	readonly languageId: string;
	readonly entries: readonly ICachedRuntime[];
	/** Wall-clock time of the last successful full discovery for this bucket. */
	readonly lastFullDiscovery: number;
	/**
	 * Snapshot of the manager's discovery roots taken at the start of the most
	 * recent full discovery pass. Compared against a freshly-computed signature
	 * on warm start; a delta triggers another full pass for this bucket.
	 */
	readonly discoveryRootSignature?: IRuntimeRootSignature;
}

/**
 * One full-discovery invocation recorded for diagnostics. `'*'` in either id
 * field denotes an all-providers run.
 */
export interface IFullDiscoveryRunEntry {
	readonly extensionId: string;
	readonly languageId: string;
	readonly reason: string;
	readonly at: number;
}

/**
 * Counters scoped to the lifetime of the cache service instance. Surfaced via
 * the startup-diagnostics editor.
 */
export interface IDiscoveryCacheSessionCounters {
	foregroundHits: number;
	revalidationsAttempted: number;
	revalidationsSucceeded: number;
	revalidationsFailed: number;
	evictions: number;
	/**
	 * Number of full-discovery runs this session that were triggered by a
	 * change in the manager's root signature (i.e. a new interpreter appeared
	 * in a known scan root). Distinct from cold-start and periodic-refresh
	 * triggers; useful for diagnostics to confirm warm-start root checks are
	 * doing their job.
	 */
	rootsChangedFullDiscoveries: number;
	fullDiscoveryRuns: ReadonlyArray<IFullDiscoveryRunEntry>;
}

/**
 * Cross-window cache of system-scoped runtime discoveries. Backed by
 * `IStorageService` at `APPLICATION`/`MACHINE` scope so binaries discovered in
 * one Positron window are immediately available in the next without rerunning
 * full discovery.
 *
 * Entries are written only for `metadata.cacheable === true` runtimes, and a
 * defensive `fs.stat` check rejects anything whose `runtimePath` doesn't
 * resolve to a regular file or symlink-to-file.
 */
export interface IRuntimeDiscoveryCache {
	readonly _serviceBrand: undefined;

	/**
	 * Whether caching is currently enabled (per the user setting). When
	 * disabled, `getEntries`/`getAllBuckets` return empty and write operations
	 * are no-ops.
	 */
	isEnabled(): boolean;

	/**
	 * Resolve an interpreter path: expand a leading `~`, follow symlinks,
	 * and stat the result. Returns `undefined` if the path is empty, the
	 * stat fails, or the target is not a regular file or symlink-to-file.
	 */
	statRuntimePath(runtimePath: string): Promise<{ resolvedPath: string; fingerprint: IRuntimeFingerprint } | undefined>;

	/**
	 * Get cached entries for a (extensionId, languageId) pair. Returns an
	 * empty array if the cache is disabled, the bucket is empty, or all
	 * entries in it have exceeded the max-age cap.
	 */
	getEntries(extensionId: string, languageId: string): readonly ICachedRuntime[];

	/**
	 * Get all populated buckets. Returns an empty array if the cache is
	 * disabled. Buckets containing only stale entries are still returned,
	 * but each bucket's `entries` array filters out stale ones.
	 */
	getAllBuckets(): readonly IDiscoveryCacheBucket[];

	/**
	 * Insert or refresh an entry. Performs the defensive stat check; if the
	 * metadata's `runtimePath` doesn't point at a regular file/symlink-to-file,
	 * the entry is rejected and the method returns `undefined`. Also rejects
	 * runtimes that have not opted in (`metadata.cacheable !== true`).
	 *
	 * Updates `firstSeen` to now if no prior entry exists for the same
	 * `runtimePath`; otherwise preserves the existing `firstSeen` and refreshes
	 * `lastValidated` and the fingerprint.
	 */
	upsert(metadata: ILanguageRuntimeMetadata): Promise<ICachedRuntime | undefined>;

	/**
	 * Remove an entry. Increments the in-session evictions counter when an
	 * entry actually existed.
	 */
	invalidate(extensionId: string, languageId: string, runtimePath: string): void;

	/**
	 * Refresh `lastValidated` (and the fingerprint) on an existing entry
	 * after a fingerprint match. No-op if the entry has been evicted.
	 * Returns `true` if an entry was updated.
	 */
	markValidated(extensionId: string, languageId: string, runtimePath: string, fingerprint: IRuntimeFingerprint): boolean;

	/** Wall-clock time of the last full discovery for this bucket. */
	getLastFullDiscovery(extensionId: string, languageId: string): number | undefined;

	/** Record that a full discovery just completed for this bucket. */
	setLastFullDiscovery(extensionId: string, languageId: string, timestamp?: number): void;

	/**
	 * The root signature stored from the most recent full discovery for this
	 * bucket. Returns `undefined` if the bucket has no signature on file
	 * (e.g. cold cache, or a manager that does not implement the API yet).
	 */
	getDiscoveryRootSignature(extensionId: string, languageId: string): IRuntimeRootSignature | undefined;

	/**
	 * Persist a fresh root signature for this bucket. Should be called at the
	 * start of a full discovery pass (so a new install during the pass shows
	 * up as a delta on the next warm start, rather than being baked into the
	 * post-discovery signature and missed forever).
	 */
	setDiscoveryRootSignature(extensionId: string, languageId: string, signature: IRuntimeRootSignature): void;

	/**
	 * Wipe all entries and metadata. Backs the "Clear Interpreter Cache"
	 * command. Bumps the in-session evictions counter for diagnostics.
	 */
	clear(): void;

	/**
	 * Note that a full discovery pass started for a (ext, lang) bucket. Visible
	 * in the startup-diagnostics editor.
	 */
	recordFullDiscoveryRun(extensionId: string, languageId: string, reason: string): void;

	/** Counters scoped to the current session (process lifetime). */
	readonly sessionCounters: IDiscoveryCacheSessionCounters;
}
