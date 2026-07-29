/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	DOCS_BUNDLE_SCHEMA, DOCS_MAX_DOWNLOAD_BYTES, DOCS_STATE_FILENAME, DocsResolution,
	IDocsBundleManifest, IDocsBundleRequest, IDocsCacheState, IResolvedBundle,
	parseSha256Sidecar, resolveBundleRequest,
} from './positronDocsBundle.js';
import { IDocsArchive, IDocsFileStore, IDocsHttpClient, IDocsLogger, ILocalDocs, joinDocsPath } from './positronDocsPorts.js';
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

	constructor(private readonly _options: IPositronDocsCacheOptions) { }

	async ensure(request: IDocsBundleRequest): Promise<ILocalDocs | undefined> {
		const { logger } = this._options;
		const resolved = resolveBundleRequest(request);
		const state = await this._readState();
		const cached = await this._readCached(state);

		// Terminal: a release build holding its own version never touches the
		// network again.
		if (cached && state?.resolution === 'exact') {
			logger.info(`${LOG_PREFIX} exact cache hit for ${state.version}; no network`);
			return cached;
		}

		const target = resolved.wantsExact ? resolved.exact : resolved.latest;
		const resolution: DocsResolution = resolved.wantsExact ? 'exact' : 'latest-by-policy';
		logger.info(`${LOG_PREFIX} fetching ${target.zipUrl} (${resolution})`);

		const outcome = await this._downloadAndInstall(target, resolution, state?.etag);
		if (outcome.kind === 'installed') {
			await this._recordInstall(outcome, request, resolved.exact.version, resolution, target);
			return outcome.docs;
		}
		this._logOutcome(outcome, target);

		// Cache-present rule: a failed attempt never withdraws a served bundle.
		return cached;
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
	}

	/**
	 * Fetch, verify, extract, and swap in one bundle.
	 *
	 * Order matters: the zip is fetched first so a 404 reads as "not published
	 * yet" rather than as a verification failure, and the digest is checked
	 * before anything is extracted so a bad payload can never write to disk
	 * outside the staging directory.
	 */
	private async _downloadAndInstall(target: IResolvedBundle, resolution: DocsResolution, etag: string | undefined): Promise<InstallOutcome> {
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
			// that means a cold cache gets no local docs until the sidecar
			// appears. Proceeding unverified would make the digest decorative.
			const sidecar = await http.get(target.sha256Url);
			if (sidecar.status !== 200 || !sidecar.body) {
				return { kind: 'rejected', reason: `digest sidecar unavailable (HTTP ${sidecar.status})` };
			}
			const expected = parseSha256Sidecar(new TextDecoder().decode(sidecar.body));
			if (!expected) {
				return { kind: 'rejected', reason: 'digest sidecar is not a sha256 digest' };
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

			const docs = await this._swapIn(staging, validation.manifest, resolution, id);
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
	private async _swapIn(staging: string, manifest: IDocsBundleManifest, resolution: DocsResolution, id: string): Promise<ILocalDocs> {
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
		return toLocalDocs(target, manifest, resolution === 'exact');
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

	private async _writeState(state: IDocsCacheState): Promise<void> {
		const { files, newId, rootPath } = this._options;
		const tmp = joinDocsPath(rootPath, `.state-${newId()}.json`);
		await files.writeFile(tmp, JSON.stringify(state, undefined, '\t'));
		await files.rename(tmp, joinDocsPath(rootPath, DOCS_STATE_FILENAME));
	}

	/**
	 * Whether the bundle `state` names is usable.
	 *
	 * Note this never re-hashes: `state.sha256` is a diagnostic record of what
	 * was verified before extraction, not a live checksum. The structural
	 * checks here are the proportionate ones for Markdown the assistant reads
	 * as text.
	 */
	private async _readCached(state: IDocsCacheState | undefined): Promise<ILocalDocs | undefined> {
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
		return toLocalDocs(dir, validation.manifest, state.resolution === 'exact');
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
