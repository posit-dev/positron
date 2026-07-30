/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	DOCS_BUNDLE_SCHEMA, DOCS_FAILURE_THROTTLE_MS, DOCS_MAX_DOWNLOAD_BYTES, DOCS_PRUNE_IDLE_MS,
	DOCS_STATE_FILENAME, DocsResolution,
	IDocsBundleManifest, IDocsBundleRequest, IDocsCacheState, IResolvedBundle, IResolvedBundleRequest,
	parseDigestFile, resolveBundleRequest,
} from './positronDocsBundle.js';
import { IDocsArchive, IDocsFileStore, IDocsHttpClient, IDocsLogger, ILocalDocs, joinDocsPath } from './positronDocsIO.js';
import { guardEntryNames, validateExtractedBundle } from './positronDocsValidate.js';

const LOG_PREFIX = '[positron-docs]';

export interface IPositronDocsCacheOptions {
	/** Cache root, e.g. `<userdata>/User/positron-docs`. */
	readonly rootPath: string;
	readonly http: IDocsHttpClient;
	readonly files: IDocsFileStore;
	readonly archive: IDocsArchive;
	readonly logger: IDocsLogger;
	/** Injected so tests control time without faking timers. */
	readonly now: () => number;
	/** Injected so temp and staging names are deterministic in tests. */
	readonly newId: () => string;
}

/** Outcome of one download attempt. */
type InstallOutcome =
	| { readonly kind: 'installed'; readonly docs: ILocalDocs; readonly manifest: IDocsBundleManifest; readonly digest: string; readonly etag?: string }
	| { readonly kind: 'not-modified' }
	| { readonly kind: 'not-found' }
	/** Verification or validation refused the payload. Never throttled. */
	| { readonly kind: 'rejected'; readonly reason: string }
	/** Network, 5xx, or disk. Throttled across sessions (Task 7). */
	| { readonly kind: 'failed'; readonly reason: string };

function toLocalDocs(path: string, manifest: IDocsBundleManifest, isExactMatch: boolean): ILocalDocs {
	return {
		path,
		schema: manifest.schema,
		version: manifest.version,
		profile: manifest.profile,
		docsBaseUrl: manifest.docsBaseUrl,
		isExactMatch,
	};
}

/**
 * Downloads, verifies, caches, and serves the slim docs bundle.
 *
 * The governing rule is that **a valid cached bundle is always served,
 * whatever the current fetch attempt does**. A fetch can replace the served
 * bundle on success but never withdraws one on failure, so `ensure()` returns
 * undefined only when no valid cache exists.
 */
export class PositronDocsCache {

	private _inFlight: Promise<ILocalDocs | undefined> | undefined;
	private _attempted = false;
	private _result: ILocalDocs | undefined;
	/** Bumped by `invalidate()` so a mid-flight call is not overwritten. */
	private _generation = 0;

	constructor(private readonly _options: IPositronDocsCacheOptions) { }

	/**
	 * Resolve local docs, running at most one fetch at a time and at most one
	 * attempt per session. Concurrent callers join the in-flight operation
	 * rather than racing it.
	 */
	async ensure(request: IDocsBundleRequest): Promise<ILocalDocs | undefined> {
		if (this._attempted) {
			return this._result;
		}
		if (this._inFlight) {
			return await this._inFlight;
		}
		const generation = this._generation;
		this._inFlight = this._ensureOnce(request);
		try {
			const result = await this._inFlight;
			// Only close the session gate if no invalidate() landed while this
			// attempt was in flight. Without the check, an `ai.enabled` flip
			// during a download would be swallowed by the completing attempt and
			// the caller would get no retry until the next launch.
			if (generation === this._generation) {
				this._result = result;
				this._attempted = true;
			}
			return result;
		} finally {
			this._inFlight = undefined;
		}
	}

	/**
	 * Permit one more attempt this session. The only caller is the
	 * `ai.enabled` false-to-true transition, which is the single case the
	 * design allows to re-attempt without a relaunch.
	 *
	 * Safe to call while a fetch is in flight: that attempt still resolves for
	 * its own callers, but it no longer closes the gate.
	 */
	invalidate(): void {
		this._attempted = false;
		this._result = undefined;
		this._generation++;
	}

	private async _ensureOnce(request: IDocsBundleRequest): Promise<ILocalDocs | undefined> {
		const resolved = resolveBundleRequest(request);
		const state = await this._readState();
		const cached = await this._readCached(state, resolved.exact.version);

		// Terminal: a release build already holding its own version never
		// touches the network again. Both halves matter - `resolution` alone
		// would keep an updated app pinned to its predecessor's docs.
		if (cached && state?.resolution === 'exact' && state.version === resolved.exact.version) {
			this._options.logger.info(`${LOG_PREFIX} exact cache hit for ${state.version}; no network`);
			return cached;
		}

		const lastFailureAt = state?.lastFailureAt;
		if (lastFailureAt !== undefined && this._options.now() - lastFailureAt < DOCS_FAILURE_THROTTLE_MS) {
			this._options.logger.info(`${LOG_PREFIX} skipping fetch; a hard failure is still inside the throttle window`);
			return cached;
		}

		return resolved.wantsExact
			? await this._ensureRelease(request, resolved, state, cached)
			: await this._ensureLatest(request, resolved, state, cached);
	}

	/**
	 * Release channel: target the exact version, fall back to latest until it
	 * publishes, and keep converging on every launch.
	 */
	private async _ensureRelease(
		request: IDocsBundleRequest,
		resolved: IResolvedBundleRequest,
		state: IDocsCacheState | undefined,
		cached: ILocalDocs | undefined,
	): Promise<ILocalDocs | undefined> {
		const { http, logger } = this._options;

		// This convergence check is never throttled. A HEAD is a few hundred
		// bytes, and throttling it would let an install sit on a known-wrong
		// docs version longer than the fallback policy intends.
		let exactExists = false;
		try {
			const status = (await http.head(resolved.exact.zipUrl)).status;
			exactExists = status === 200;
			// 404 is the expected "not published yet" answer and stays quiet.
			// Anything else means the CDN is unhealthy rather than not ready, and
			// would otherwise fall through to the latest alias with no trace.
			if (!exactExists && status !== 404) {
				logger.info(`${LOG_PREFIX} unexpected HTTP ${status} from HEAD ${resolved.exact.zipUrl}`);
			}
		} catch (error) {
			logger.info(`${LOG_PREFIX} exact HEAD failed for ${resolved.exact.zipUrl}: ${errorMessage(error)}`);
		}

		if (exactExists) {
			const outcome = await this._downloadAndInstall(resolved.exact, resolved.exact.version, undefined);
			if (outcome.kind === 'installed') {
				await this._recordInstall(outcome, request, resolved.exact.version, 'exact', resolved.exact);
				return outcome.docs;
			}
			this._logOutcome(outcome, resolved.exact);
		}

		return await this._fetchLatest(request, resolved, state, cached, 'fallback');
	}

	/** Dailies and dev builds: latest is the intended target, not a fallback. */
	private async _ensureLatest(
		request: IDocsBundleRequest,
		resolved: IResolvedBundleRequest,
		state: IDocsCacheState | undefined,
		cached: ILocalDocs | undefined,
	): Promise<ILocalDocs | undefined> {
		return await this._fetchLatest(request, resolved, state, cached, 'latest-by-policy');
	}

	private async _fetchLatest(
		request: IDocsBundleRequest,
		resolved: IResolvedBundleRequest,
		state: IDocsCacheState | undefined,
		cached: ILocalDocs | undefined,
		resolution: DocsResolution,
	): Promise<ILocalDocs | undefined> {
		// Conditional on the stored ETag. Using the `latest` alias rather than
		// comparing versions keeps this monotonic without a version comparator.
		const outcome = await this._downloadAndInstall(resolved.latest, resolved.exact.version, state?.etag);
		if (outcome.kind === 'installed') {
			await this._recordInstall(outcome, request, resolved.exact.version, resolution, resolved.latest);
			return outcome.docs;
		}
		this._logOutcome(outcome, resolved.latest);
		if (outcome.kind === 'failed') {
			await this._recordFailure(state, request, resolved.exact.version, resolution, outcome.reason);
		}
		if (outcome.kind === 'not-modified' && state) {
			await this._touchState(state, resolution, resolved.exact.version);
		}

		// Cache-present rule: a failed attempt never withdraws a served bundle.
		return cached;
	}

	private async _touchState(state: IDocsCacheState, resolution: DocsResolution, requestedVersion: string): Promise<void> {
		const now = this._options.now();
		await this._writeState({ ...state, resolution, requestedVersion, fetchedAt: now, lastAttemptAt: now });
	}

	private _logOutcome(outcome: InstallOutcome, target: IResolvedBundle): void {
		const { logger } = this._options;
		switch (outcome.kind) {
			case 'rejected':
				logger.warn(`${LOG_PREFIX} rejected bundle from ${target.zipUrl}: ${outcome.reason}`);
				break;
			case 'failed':
				logger.info(`${LOG_PREFIX} fetch failed for ${target.zipUrl}: ${outcome.reason}`);
				break;
			case 'not-found':
				logger.info(`${LOG_PREFIX} no bundle published at ${target.zipUrl}`);
				break;
			case 'not-modified':
				logger.info(`${LOG_PREFIX} ${target.zipUrl} unchanged (304)`);
				break;
		}
	}

	private async _recordInstall(
		outcome: InstallOutcome & { kind: 'installed' },
		request: IDocsBundleRequest,
		requestedVersion: string,
		resolution: DocsResolution,
		target: IResolvedBundle,
	): Promise<void> {
		const now = this._options.now();
		await this._writeState({
			schema: DOCS_BUNDLE_SCHEMA,
			version: outcome.manifest.version,
			requestedVersion,
			resolution,
			profile: request.profile,
			sha256: outcome.digest,
			etag: outcome.etag,
			sourceUrl: target.zipUrl,
			fetchedAt: now,
			lastAttemptAt: now,
		});
		this._options.logger.info(`${LOG_PREFIX} installed ${outcome.manifest.version} from ${target.zipUrl}`);
		// Best-effort, for the same reason as _writeState: the bundle is already
		// on disk and must be served. A readdir or unlink failure here would
		// otherwise throw out of ensure() and discard a successful install.
		// Awaited rather than fire-and-forget so the next launch (and the tests)
		// observe a settled cache directory instead of racing the sweep.
		try {
			await this._prune(outcome.manifest.version);
		} catch (error) {
			this._options.logger.warn(`${LOG_PREFIX} could not prune the cache directory: ${errorMessage(error)}`);
		}
	}

	/**
	 * Fetch, verify, extract, and swap in one bundle.
	 *
	 * Order matters: the zip is fetched first so a 404 reads as "not published
	 * yet" rather than as a verification failure, and the digest is checked
	 * before anything is extracted so a bad payload can never write to disk
	 * outside the staging directory.
	 */
	private async _downloadAndInstall(target: IResolvedBundle, exactVersion: string, etag: string | undefined): Promise<InstallOutcome> {
		const { archive, files, http, newId } = this._options;
		const id = newId();
		const tmpZip = joinDocsPath(this._options.rootPath, `.tmp-${id}.zip`);
		const staging = joinDocsPath(this._options.rootPath, `.staging-${id}`);

		try {
			await files.mkdir(this._options.rootPath);

			const zip = await http.get(target.zipUrl, { etag, maxBytes: DOCS_MAX_DOWNLOAD_BYTES });
			if (zip.status === 304) {
				return { kind: 'not-modified' };
			}
			if (zip.status === 404) {
				return { kind: 'not-found' };
			}
			if (zip.status !== 200 || !zip.body) {
				return { kind: 'failed', reason: `HTTP ${zip.status}` };
			}

			// A zip that cannot be verified is never extracted, even though
			// that means a cold cache gets no local docs until the checksum file
			// appears. Proceeding unverified would make the digest decorative.
			const checksum = await http.get(target.sha256Url);
			if (checksum.status !== 200 || !checksum.body) {
				return { kind: 'rejected', reason: `checksum file unavailable (HTTP ${checksum.status})` };
			}
			const expected = parseDigestFile(new TextDecoder().decode(checksum.body));
			if (!expected) {
				return { kind: 'rejected', reason: 'checksum file does not hold a sha256 digest' };
			}

			await files.writeFile(tmpZip, zip.body);
			const actual = await files.sha256(tmpZip);
			if (actual !== expected) {
				return { kind: 'rejected', reason: `digest mismatch (expected ${expected}, got ${actual})` };
			}

			try {
				const offending = guardEntryNames(await archive.entryNames(tmpZip));
				if (offending) {
					return { kind: 'rejected', reason: `archive entry escapes the target: ${offending}` };
				}
				await archive.extract(tmpZip, staging);
			} catch (error) {
				return { kind: 'rejected', reason: `corrupt archive: ${errorMessage(error)}` };
			}

			const validation = await validateExtractedBundle(files, staging);
			if (!validation.ok) {
				return { kind: 'rejected', reason: `extracted bundle invalid (${validation.reason})` };
			}

			const docs = await this._swapIn(staging, validation.manifest, exactVersion, id);
			return { kind: 'installed', docs, manifest: validation.manifest, digest: actual, etag: zip.etag };
		} catch (error) {
			return { kind: 'failed', reason: errorMessage(error) };
		} finally {
			await this._safeDelete(tmpZip);
			await this._safeDelete(staging);
		}
	}

	/**
	 * Atomic swap. The rename means a killed process can never leave a
	 * half-populated version directory that later looks like a cache hit.
	 */
	private async _swapIn(staging: string, manifest: IDocsBundleManifest, exactVersion: string, id: string): Promise<ILocalDocs> {
		const { files } = this._options;
		const target = joinDocsPath(this._options.rootPath, manifest.version);
		if (await files.exists(target)) {
			// Same version is already on disk but was not usable, or we would
			// not have downloaded. Move it aside first so the recorded path
			// never points at a directory that does not exist.
			const stale = joinDocsPath(this._options.rootPath, `.stale-${id}`);
			await files.rename(target, stale);
			await files.rename(staging, target);
			await this._safeDelete(stale);
		} else {
			await files.rename(staging, target);
		}
		return toLocalDocs(target, manifest, manifest.version === exactVersion);
	}

	private async _readState(): Promise<IDocsCacheState | undefined> {
		const path = joinDocsPath(this._options.rootPath, DOCS_STATE_FILENAME);
		if (!await this._options.files.exists(path)) {
			return undefined;
		}
		try {
			const parsed = JSON.parse(await this._options.files.readFile(path)) as IDocsCacheState;
			return typeof parsed?.version === 'string' ? parsed : undefined;
		} catch {
			return undefined;
		}
	}

	/**
	 * Persist cache state, best-effort.
	 *
	 * Swallowing the error is deliberate. State is bookkeeping, not the served
	 * artefact: losing it costs one redundant fetch next launch. Letting it
	 * throw would be strictly worse, because the disk errors that break this
	 * write are the same ones that break a download - so the throw would
	 * propagate out of `ensure()` and withdraw a perfectly good cached bundle,
	 * violating the cache-present rule.
	 */
	private async _writeState(state: IDocsCacheState): Promise<void> {
		const { files, logger, newId, rootPath } = this._options;
		const tmp = joinDocsPath(rootPath, `.state-${newId()}.json`);
		try {
			await files.writeFile(tmp, JSON.stringify(state, undefined, '\t'));
			await files.rename(tmp, joinDocsPath(rootPath, DOCS_STATE_FILENAME));
		} catch (error) {
			logger.warn(`${LOG_PREFIX} could not persist cache state: ${errorMessage(error)}`);
			await this._safeDelete(tmp);
		}
	}

	/**
	 * Whether the bundle `state` names is usable.
	 *
	 * Note this never re-hashes: `state.sha256` is a diagnostic record of what
	 * was verified before extraction, not a live checksum. The structural
	 * checks here are the proportionate ones for Markdown the assistant reads
	 * as text.
	 */
	private async _readCached(state: IDocsCacheState | undefined, exactVersion: string): Promise<ILocalDocs | undefined> {
		// An empty version means `_recordFailure` wrote state with no bundle ever
		// installed. `joinDocsPath` drops empty segments, so computing the path
		// anyway would validate rootPath itself and warn that a cache which never
		// existed is now unusable.
		if (!state || !state.version) {
			return undefined;
		}
		const dir = joinDocsPath(this._options.rootPath, state.version);
		const validation = await validateExtractedBundle(this._options.files, dir);
		if (!validation.ok) {
			this._options.logger.warn(`${LOG_PREFIX} cached bundle at ${dir} is unusable (${validation.reason})`);
			return undefined;
		}
		// Derived from the running build, not from state.resolution: after an
		// app update a bundle recorded as `exact` no longer is one.
		return toLocalDocs(dir, validation.manifest, validation.manifest.version === exactVersion);
	}

	/**
	 * Persist a hard failure so the next session honours the throttle.
	 *
	 * `lastAttemptAt` records every attempt for diagnostics; `lastFailureAt` is
	 * the field the throttle reads. Keeping them separate avoids a bug where a
	 * successful 304 silently suppresses the next convergence check.
	 */
	private async _recordFailure(
		state: IDocsCacheState | undefined,
		request: IDocsBundleRequest,
		requestedVersion: string,
		resolution: DocsResolution,
		reason: string,
	): Promise<void> {
		const now = this._options.now();
		await this._writeState({
			schema: DOCS_BUNDLE_SCHEMA,
			version: state?.version ?? '',
			requestedVersion,
			resolution: state?.resolution ?? resolution,
			profile: request.profile,
			sha256: state?.sha256 ?? '',
			etag: state?.etag,
			sourceUrl: state?.sourceUrl ?? '',
			fetchedAt: state?.fetchedAt ?? 0,
			lastAttemptAt: now,
			lastFailureAt: now,
			lastError: reason,
		});
	}

	/**
	 * Drop superseded version directories and abandoned transient entries.
	 *
	 * The mtime guard is what makes this safe across windows: each window has
	 * its own extension host, so window A must not delete window B's in-flight
	 * `.tmp-*` or `.staging-*`. Only entries idle for ten minutes are touched,
	 * which are by definition leftovers. No lock file needed.
	 */
	private async _prune(keepVersion: string): Promise<void> {
		const { files, now, rootPath } = this._options;
		const cutoff = now() - DOCS_PRUNE_IDLE_MS;
		for (const name of await files.readdir(rootPath)) {
			if (name === DOCS_STATE_FILENAME || name === keepVersion) {
				continue;
			}
			const path = joinDocsPath(rootPath, name);
			if (name.startsWith('.')) {
				const mtime = await files.mtime(path);
				if (mtime === undefined || mtime > cutoff) {
					continue;
				}
			}
			await this._safeDelete(path);
		}
	}

	private async _safeDelete(path: string): Promise<void> {
		try {
			await this._options.files.delete(path);
		} catch {
			// Cleanup is best-effort; the prune pass collects anything left.
		}
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
