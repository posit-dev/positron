/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IPathService } from '../../path/common/pathService.js';
import { ILanguageRuntimeMetadata } from '../../languageRuntime/common/languageRuntimeService.js';
import {
	ICachedRuntime,
	IDiscoveryCacheBucket,
	IDiscoveryCacheSessionCounters,
	IFullDiscoveryRunEntry,
	IRuntimeDiscoveryCache,
	IRuntimeFingerprint,
	IRuntimeRootSignature,
	RUNTIME_DISCOVERY_CACHE_ENABLED_SETTING,
	RUNTIME_DISCOVERY_CACHE_MAX_AGE_DAYS_DEFAULT,
	RUNTIME_DISCOVERY_CACHE_MAX_AGE_DAYS_SETTING,
	RUNTIME_DISCOVERY_CACHE_SCHEMA_VERSION,
	RUNTIME_DISCOVERY_CACHE_STORAGE_KEY,
} from './runtimeDiscoveryCacheService.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * On-disk JSON shape. The `schemaVersion` is checked on load; any mismatch
 * causes the persisted cache to be discarded and re-seeded fresh.
 */
interface IPersistedCache {
	schemaVersion: number;
	buckets: Record<string, IPersistedBucket>;
}

interface IPersistedBucket {
	entries: ICachedRuntime[];
	lastFullDiscovery: number;
	discoveryRootSignature?: IRuntimeRootSignature;
}

const BUCKET_SEPARATOR = '::';

function bucketKey(extensionId: string, languageId: string): string {
	return `${extensionId}${BUCKET_SEPARATOR}${languageId}`;
}

function unpackBucketKey(key: string): { extensionId: string; languageId: string } | undefined {
	// Split on the first separator: extension IDs are `publisher.name` and
	// cannot contain `::`, but language IDs are unconstrained and may.
	const idx = key.indexOf(BUCKET_SEPARATOR);
	if (idx <= 0 || idx === key.length - BUCKET_SEPARATOR.length) {
		return undefined;
	}
	return {
		extensionId: key.substring(0, idx),
		languageId: key.substring(idx + BUCKET_SEPARATOR.length),
	};
}

/**
 * Internal bucket state. Mirrors `IPersistedBucket` but uses a Map keyed by
 * `runtimePath` for O(1) lookup and to dedupe by path on upsert.
 */
interface IInternalBucket {
	entries: Map<string, ICachedRuntime>;
	lastFullDiscovery: number;
	discoveryRootSignature?: IRuntimeRootSignature;
}

/**
 * Persistent, cross-window cache of runtime discovery results.
 *
 * Discovering interpreters is expensive: each runtime manager (Python, R, ...)
 * shells out to `pyenv`/`conda`/`rig`, walks `PATH` and system locations, and
 * probes binaries for version metadata. In a configuration with many
 * environments this can take several minutes per language on every cold
 * start. This cache stores the result so that the *next* window can skip the
 * work entirely when nothing on disk has changed.
 *
 * The model is "remembered facts about the host machine, not the workspace":
 * the cache lives in `APPLICATION`/`MACHINE`-scoped storage so every Positron
 * window sees the same view, and entries are partitioned into buckets keyed
 * by `(extensionId, languageId)`. Each cached runtime carries a cheap
 * fingerprint of its on-disk binary (size + mtime + ctime); a fingerprint
 * match means "same binary as before" and lets us trust the cached metadata
 * without re-probing. A mismatch evicts the entry and forces the owning
 * extension to re-discover.
 *
 * The cache only *short-circuits* discovery -- it never replaces it. Every
 * cached entry is revalidated in the background by the runtime startup
 * service, and a separate root-signature mechanism (snapshots of the
 * directories the manager scans) detects new installs that would otherwise
 * be invisible to fingerprint checks. Hard caps on entry age and bucket
 * freshness guarantee a real discovery pass runs periodically regardless.
 *
 * Two implementation notes worth knowing about:
 *
 * - **Cross-window writes.** The persisted blob is one JSON document under a
 *   single storage key, so concurrent windows would silently clobber each
 *   other. We subscribe to external storage changes and reload wholesale on
 *   sibling writes; the resulting last-writer-wins behavior can drop an
 *   in-flight entry but never serves a wrong runtime, and any loss is
 *   recovered on the next discovery or revalidation pass.
 *
 * - **Disable switch.** {@link RUNTIME_DISCOVERY_CACHE_ENABLED_SETTING} gates
 *   everything: when off, reads return empty and writes no-op, restoring
 *   pre-cache cold-start behavior with no other code paths to touch.
 */
export class RuntimeDiscoveryCache extends Disposable implements IRuntimeDiscoveryCache {

	declare readonly _serviceBrand: undefined;

	private readonly _buckets = new Map<string, IInternalBucket>();

	// Mutable backing array; sessionCounters exposes the same reference typed as
	// ReadonlyArray so external consumers can't push.
	private readonly _fullDiscoveryRuns: IFullDiscoveryRunEntry[] = [];

	public readonly sessionCounters: IDiscoveryCacheSessionCounters = {
		foregroundHits: 0,
		revalidationsAttempted: 0,
		revalidationsSucceeded: 0,
		revalidationsFailed: 0,
		evictions: 0,
		rootsChangedFullDiscoveries: 0,
		fullDiscoveryRuns: this._fullDiscoveryRuns,
	};

	constructor(
		@IStorageService private readonly _storageService: IStorageService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IFileService private readonly _fileService: IFileService,
		@ILogService private readonly _logService: ILogService,
		@IPathService private readonly _pathService: IPathService,
	) {
		super();
		this._reloadFromStorage();

		// Pick up writes from sibling Positron windows. The cache lives in
		// APPLICATION-scope storage, which is shared across all windows on the
		// machine, so without this listener two windows would silently clobber
		// each other on every persist (last-writer-wins on the full JSON blob).
		// `external: true` filters out our own in-process writes.
		this._register(this._storageService.onDidChangeValue(
			StorageScope.APPLICATION,
			RUNTIME_DISCOVERY_CACHE_STORAGE_KEY,
			this._store,
		)(e => {
			if (!e.external) {
				return;
			}
			this._reloadFromStorage();
		}));
	}

	// --- Public API ---------------------------------------------------------

	public isEnabled(): boolean {
		const value = this._configurationService.getValue<boolean>(RUNTIME_DISCOVERY_CACHE_ENABLED_SETTING);
		// Default-true if unset or non-boolean.
		return value !== false;
	}

	public async statRuntimePath(runtimePath: string): Promise<{ resolvedPath: string; fingerprint: IRuntimeFingerprint } | undefined> {
		const expanded = this._expandUserHome(runtimePath);
		if (!expanded) {
			return undefined;
		}
		try {
			const uri = URI.file(expanded);
			const real = await this._fileService.realpath(uri);
			const target = real ?? uri;
			const stat = await this._fileService.stat(target);
			// We only cache binaries that resolve to a regular file (a symlink
			// pointing at a file is fine -- realpath() above followed it).
			if (!stat.isFile || stat.isDirectory) {
				return undefined;
			}
			return {
				resolvedPath: target.fsPath,
				fingerprint: {
					size: stat.size,
					mtimeMs: stat.mtime,
					ctimeMs: stat.ctime,
				},
			};
		} catch (err) {
			this._logService.trace(`[Runtime cache] stat failed for ${runtimePath}: ${err}`);
			return undefined;
		}
	}

	public getEntries(extensionId: string, languageId: string): readonly ICachedRuntime[] {
		if (!this.isEnabled()) {
			return [];
		}
		const bucket = this._buckets.get(bucketKey(extensionId, languageId));
		if (!bucket) {
			return [];
		}
		return this._freshEntries(bucket);
	}

	public getAllBuckets(): readonly IDiscoveryCacheBucket[] {
		if (!this.isEnabled()) {
			return [];
		}
		const out: IDiscoveryCacheBucket[] = [];
		for (const [key, bucket] of this._buckets) {
			const parsed = unpackBucketKey(key);
			if (!parsed) { continue; }
			out.push({
				extensionId: parsed.extensionId,
				languageId: parsed.languageId,
				entries: this._freshEntries(bucket),
				lastFullDiscovery: bucket.lastFullDiscovery,
				discoveryRootSignature: bucket.discoveryRootSignature,
			});
		}
		return out;
	}

	public async upsert(metadata: ILanguageRuntimeMetadata): Promise<ICachedRuntime | undefined> {
		if (!this.isEnabled()) {
			return undefined;
		}
		// Refuse to cache opt-outs. The runtime metadata schema treats
		// `cacheable` as default-false when omitted.
		if (metadata.cacheable !== true) {
			return undefined;
		}
		// Defensive: even if the extension claimed cacheable, don't write
		// without a real binary to fingerprint. This protects against buggy
		// extensions that flip the flag on a proxy/no-path runtime.
		const probed = await this.statRuntimePath(metadata.runtimePath);
		if (!probed) {
			this._logService.debug(
				`[Runtime cache] refusing to cache ${metadata.runtimeId} (${metadata.runtimePath}): not a stat-able file.`,
			);
			return undefined;
		}

		const now = Date.now();
		const key = bucketKey(metadata.extensionId.value, metadata.languageId);
		let bucket = this._buckets.get(key);
		if (!bucket) {
			bucket = { entries: new Map(), lastFullDiscovery: 0, discoveryRootSignature: undefined };
			this._buckets.set(key, bucket);
		}
		const existing = bucket.entries.get(metadata.runtimePath);
		const entry: ICachedRuntime = {
			metadata,
			fingerprint: probed.fingerprint,
			resolvedPath: probed.resolvedPath,
			firstSeen: existing?.firstSeen ?? now,
			lastValidated: now,
		};
		bucket.entries.set(metadata.runtimePath, entry);
		this._persist();
		return entry;
	}

	public invalidate(extensionId: string, languageId: string, runtimePath: string): void {
		if (!this.isEnabled()) {
			return;
		}
		const key = bucketKey(extensionId, languageId);
		const bucket = this._buckets.get(key);
		if (!bucket) {
			return;
		}
		if (bucket.entries.delete(runtimePath)) {
			this.sessionCounters.evictions++;
			if (bucket.entries.size === 0
				&& bucket.lastFullDiscovery === 0
				&& !bucket.discoveryRootSignature) {
				this._buckets.delete(key);
			}
			this._persist();
		}
	}

	public markValidated(extensionId: string, languageId: string, runtimePath: string, fingerprint: IRuntimeFingerprint): boolean {
		if (!this.isEnabled()) {
			return false;
		}
		const bucket = this._buckets.get(bucketKey(extensionId, languageId));
		if (!bucket) {
			return false;
		}
		const existing = bucket.entries.get(runtimePath);
		if (!existing) {
			return false;
		}
		bucket.entries.set(runtimePath, {
			...existing,
			fingerprint,
			lastValidated: Date.now(),
		});
		this._persist();
		return true;
	}

	public getLastFullDiscovery(extensionId: string, languageId: string): number | undefined {
		const bucket = this._buckets.get(bucketKey(extensionId, languageId));
		if (!bucket || bucket.lastFullDiscovery === 0) {
			return undefined;
		}
		return bucket.lastFullDiscovery;
	}

	public setLastFullDiscovery(extensionId: string, languageId: string, timestamp: number = Date.now()): void {
		if (!this.isEnabled()) {
			return;
		}
		const key = bucketKey(extensionId, languageId);
		let bucket = this._buckets.get(key);
		if (!bucket) {
			bucket = { entries: new Map(), lastFullDiscovery: 0, discoveryRootSignature: undefined };
			this._buckets.set(key, bucket);
		}
		bucket.lastFullDiscovery = timestamp;
		this._persist();
	}

	public getDiscoveryRootSignature(extensionId: string, languageId: string): IRuntimeRootSignature | undefined {
		const bucket = this._buckets.get(bucketKey(extensionId, languageId));
		return bucket?.discoveryRootSignature;
	}

	public setDiscoveryRootSignature(extensionId: string, languageId: string, signature: IRuntimeRootSignature): void {
		if (!this.isEnabled()) {
			return;
		}
		const key = bucketKey(extensionId, languageId);
		let bucket = this._buckets.get(key);
		if (!bucket) {
			bucket = { entries: new Map(), lastFullDiscovery: 0, discoveryRootSignature: undefined };
			this._buckets.set(key, bucket);
		}
		bucket.discoveryRootSignature = signature;
		this._persist();
	}

	public recordFullDiscoveryRun(extensionId: string, languageId: string, reason: string): void {
		this._fullDiscoveryRuns.push({ extensionId, languageId, reason, at: Date.now() });
		if (reason === 'roots-changed') {
			this.sessionCounters.rootsChangedFullDiscoveries++;
		}
	}

	public clear(): void {
		this.sessionCounters.evictions += this._countAllEntries();
		this._buckets.clear();
		this._storageService.remove(RUNTIME_DISCOVERY_CACHE_STORAGE_KEY, StorageScope.APPLICATION);
	}

	// --- Internals ----------------------------------------------------------

	private _freshEntries(bucket: IInternalBucket): ICachedRuntime[] {
		const days = this._configurationService.getValue<number>(RUNTIME_DISCOVERY_CACHE_MAX_AGE_DAYS_SETTING)
			?? RUNTIME_DISCOVERY_CACHE_MAX_AGE_DAYS_DEFAULT;
		const cutoff = Date.now() - days * MS_PER_DAY;
		const out: ICachedRuntime[] = [];
		for (const entry of bucket.entries.values()) {
			if (entry.firstSeen >= cutoff) {
				out.push(entry);
			}
		}
		return out;
	}

	private _countAllEntries(): number {
		let n = 0;
		for (const bucket of this._buckets.values()) {
			n += bucket.entries.size;
		}
		return n;
	}

	private _expandUserHome(p: string): string | undefined {
		if (!p) { return undefined; }
		if (p === '~' || p.startsWith('~/')) {
			// preferLocal: true returns a synchronous URI for the local home
			// directory, which is what we want for cache fingerprints (the
			// cache is APPLICATION/MACHINE-scoped -- always local).
			const home = this._pathService.userHome({ preferLocal: true }).fsPath;
			return p === '~' ? home : `${home}${p.substring(1)}`;
		}
		return p;
	}

	private _reloadFromStorage(): void {
		// Replace in-memory state wholesale: this is called on initial load
		// AND whenever a sibling window writes the cache, so we can't append.
		this._buckets.clear();
		const raw = this._storageService.get(RUNTIME_DISCOVERY_CACHE_STORAGE_KEY, StorageScope.APPLICATION);
		if (!raw) {
			return;
		}
		let parsed: IPersistedCache;
		try {
			parsed = JSON.parse(raw) as IPersistedCache;
		} catch (err) {
			this._logService.warn(`[Runtime cache] failed to parse persisted cache; discarding: ${err}`);
			this._storageService.remove(RUNTIME_DISCOVERY_CACHE_STORAGE_KEY, StorageScope.APPLICATION);
			return;
		}
		if (!parsed || parsed.schemaVersion !== RUNTIME_DISCOVERY_CACHE_SCHEMA_VERSION || !parsed.buckets) {
			this._logService.info(
				`[Runtime cache] schema mismatch (got ${parsed?.schemaVersion}, expected ${RUNTIME_DISCOVERY_CACHE_SCHEMA_VERSION}); wiping cache.`,
			);
			this._storageService.remove(RUNTIME_DISCOVERY_CACHE_STORAGE_KEY, StorageScope.APPLICATION);
			return;
		}
		for (const [key, bucket] of Object.entries(parsed.buckets)) {
			const entries = new Map<string, ICachedRuntime>();
			for (const entry of bucket.entries ?? []) {
				if (entry?.metadata?.runtimePath) {
					entries.set(entry.metadata.runtimePath, entry);
				}
			}
			this._buckets.set(key, {
				entries,
				lastFullDiscovery: bucket.lastFullDiscovery ?? 0,
				discoveryRootSignature: bucket.discoveryRootSignature,
			});
		}
	}

	private _persist(): void {
		const buckets: Record<string, IPersistedBucket> = {};
		for (const [key, bucket] of this._buckets) {
			if (bucket.entries.size === 0
				&& bucket.lastFullDiscovery === 0
				&& !bucket.discoveryRootSignature) {
				continue;
			}
			buckets[key] = {
				entries: Array.from(bucket.entries.values()),
				lastFullDiscovery: bucket.lastFullDiscovery,
				discoveryRootSignature: bucket.discoveryRootSignature,
			};
		}
		const payload: IPersistedCache = {
			schemaVersion: RUNTIME_DISCOVERY_CACHE_SCHEMA_VERSION,
			buckets,
		};
		this._storageService.store(
			RUNTIME_DISCOVERY_CACHE_STORAGE_KEY,
			JSON.stringify(payload),
			StorageScope.APPLICATION,
			StorageTarget.MACHINE,
		);
	}
}

registerSingleton(IRuntimeDiscoveryCache, RuntimeDiscoveryCache, InstantiationType.Delayed);
