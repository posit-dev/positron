/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ILanguageRuntimeMetadata } from '../../languageRuntime/common/languageRuntimeService.js';

export const IRuntimeDiscoveryCache =
	createDecorator<IRuntimeDiscoveryCache>('runtimeDiscoveryCache');

/**
 * The setting key consulted to enable/disable the cache. Listed under the
 * Positron configuration node in `languageRuntime.ts`. When `false`, all
 * reads return empty and all writes no-op, restoring pre-cache behavior.
 */
export const RUNTIME_DISCOVERY_CACHE_ENABLED_SETTING = 'interpreters.discoveryCache.enabled';

/**
 * Storage key under which all cache state is persisted. The trailing `.v1`
 * is the schema version: bumping it transparently wipes the prior cache.
 */
export const RUNTIME_DISCOVERY_CACHE_STORAGE_KEY = 'positron.discoveryCache.v1';

/**
 * Hard cap on cache entry age. Even on a healthy machine, an entry must be
 * re-validated by a real discovery pass at least once every 30 days so we
 * eventually pick up binary-identical replacements that preserve fingerprint.
 */
export const RUNTIME_DISCOVERY_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

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
}

/**
 * Counters reset at service-construction time, used by Phase 4 diagnostics.
 */
export interface IDiscoveryCacheSessionCounters {
	foregroundHits: number;
	revalidationsAttempted: number;
	revalidationsSucceeded: number;
	revalidationsFailed: number;
	evictions: number;
	fullDiscoveryRuns: ReadonlyArray<{ extensionId: string; languageId: string; reason: string; at: number }>;
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
	 * Wipe all entries and metadata. Drives the "Clear Interpreter Cache"
	 * command in Phase 4. Bumps in-session evictions counter for diagnostics.
	 */
	clear(): void;

	/**
	 * Note that a full discovery pass started for a (ext, lang) bucket.
	 * Surfaced in Phase 4 diagnostics.
	 */
	recordFullDiscoveryRun(extensionId: string, languageId: string, reason: string): void;

	/** Counters scoped to the current session (process lifetime). */
	readonly sessionCounters: IDiscoveryCacheSessionCounters;
}
