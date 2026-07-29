/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { formatPositronVersion } from '../../extensionManagement/common/positronGalleryTelemetry.js';

/**
 * The only bundle layout this build understands. Bumped by the website
 * pipeline only when a reader written against the old layout would get a
 * wrong answer. Schema 1 is defined as including "llms.txt uses
 * bundle-relative paths".
 */
export const DOCS_BUNDLE_SCHEMA = 1;

/** Name of the persisted state file inside the cache root. */
export const DOCS_STATE_FILENAME = 'state.json';

/** Files a valid extracted bundle must contain. */
export const DOCS_MANIFEST_FILENAME = 'bundle.json';
export const DOCS_INDEX_FILENAME = 'llms.txt';

/** Refuse anything larger. The real bundle is about 150KB. */
export const DOCS_MAX_DOWNLOAD_BYTES = 5 * 1024 * 1024;

export type DocsProfile = 'positron' | 'workbench';

/**
 * How the cached bundle relates to the running build.
 * - `exact`: bundle version equals app version. Terminal; no further network.
 * - `fallback`: exact was not published (yet). Re-attempts exact every launch.
 * - `latest-by-policy`: dailies and dev builds, where latest is the target.
 */
export type DocsResolution = 'exact' | 'fallback' | 'latest-by-policy';

/** The shape of bundle.json, as produced by the website pipeline. */
export interface IDocsBundleManifest {
	readonly schema: number;
	readonly profile: string;
	readonly version: string;
	readonly generated: string;
	readonly docsBaseUrl: string;
	readonly fileCount: number;
}

/** Persisted cache state. Written atomically; never partially trusted. */
export interface IDocsCacheState {
	readonly schema: number;
	/** Version of the bundle actually on disk; also its directory name. */
	readonly version: string;
	/** Version the app asked for, which may differ while in `fallback`. */
	readonly requestedVersion: string;
	readonly resolution: DocsResolution;
	readonly profile: string;
	/**
	 * Digest verified before extraction. Diagnostic only: recorded once and
	 * never recomputed, since the zip is deleted after extracting.
	 */
	readonly sha256: string;
	readonly etag?: string;
	readonly sourceUrl: string;
	readonly fetchedAt: number;
	readonly lastAttemptAt: number;
	readonly lastFailureAt?: number;
	readonly lastError?: string;
}

export interface IDocsBundleRequest {
	/** `initData.quality`: 'releases', 'dailies', or undefined in dev builds. */
	readonly quality: string | undefined;
	readonly positronVersion: string;
	readonly positronBuildNumber: number;
	readonly profile: DocsProfile;
	readonly baseUrl: string;
}

export interface IResolvedBundle {
	/** `<version>` for the exact form, the literal 'latest' for the alias. */
	readonly version: string;
	readonly form: 'exact' | 'latest';
	readonly zipUrl: string;
	readonly sha256Url: string;
}

export interface IResolvedBundleRequest {
	readonly exact: IResolvedBundle;
	readonly latest: IResolvedBundle;
	/**
	 * True for release builds, which target their exact version and fall back
	 * to latest only until it publishes. False for dailies and dev builds,
	 * where latest is the intended target.
	 */
	readonly wantsExact: boolean;
}

function bundleBaseName(profile: DocsProfile): string {
	return profile === 'workbench' ? 'positron-workbench-llms' : 'positron-llms';
}

function bundleUrls(baseUrl: string, profile: DocsProfile, version: string, form: 'exact' | 'latest'): IResolvedBundle {
	const root = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
	const zipUrl = `${root}/${bundleBaseName(profile)}-${version}.zip`;
	return { version, form, zipUrl, sha256Url: `${zipUrl}.sha256sum` };
}

/**
 * Work out which bundle URLs this build should ask for.
 *
 * Release builds target their exact version so a shipped build reads the docs
 * it shipped with; everything else targets the mutable `latest` alias. Dev
 * builds landing on `latest` is deliberate - it makes the feature exercisable
 * locally and in PRs without waiting on a release.
 */
export function resolveBundleRequest(request: IDocsBundleRequest): IResolvedBundleRequest {
	const version = formatPositronVersion(request.positronVersion, request.positronBuildNumber);
	return {
		exact: bundleUrls(request.baseUrl, request.profile, version, 'exact'),
		latest: bundleUrls(request.baseUrl, request.profile, 'latest', 'latest'),
		wantsExact: request.quality === 'releases',
	};
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0;
}

/**
 * Parse bundle.json, rejecting anything this build cannot read.
 *
 * Rejecting is deliberate over guessing: dev and daily builds fetch the mutable
 * `latest` alias, so "an app from three months ago is handed a bundle from
 * today's pipeline" is a normal runtime state. A misparse surfaces later as
 * wrong docs content; a rejection surfaces immediately as web fallback.
 */
export function parseManifest(raw: string): IDocsBundleManifest | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return undefined;
	}
	if (typeof parsed !== 'object' || parsed === null) {
		return undefined;
	}
	const candidate = parsed as Partial<IDocsBundleManifest>;
	if (candidate.schema !== DOCS_BUNDLE_SCHEMA) {
		return undefined;
	}
	if (!isNonEmptyString(candidate.profile) || !isNonEmptyString(candidate.version)
		|| !isNonEmptyString(candidate.generated) || !isNonEmptyString(candidate.docsBaseUrl)) {
		return undefined;
	}
	if (typeof candidate.fileCount !== 'number' || !Number.isInteger(candidate.fileCount) || candidate.fileCount <= 0) {
		return undefined;
	}
	return {
		schema: candidate.schema,
		profile: candidate.profile,
		version: candidate.version,
		generated: candidate.generated,
		docsBaseUrl: candidate.docsBaseUrl,
		fileCount: candidate.fileCount,
	};
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * Read the hex digest out of a `.sha256sum` sidecar.
 *
 * Accepts both `shasum -a 256` output (`<hex>  <name>`) and a bare digest.
 * Returns undefined for anything else, including an HTML error page served in
 * place of a missing object - which the caller must treat as a hard failure.
 */
export function parseSha256Sidecar(raw: string): string | undefined {
	const first = raw.trim().split(/\s+/)[0]?.toLowerCase();
	return first && SHA256_HEX.test(first) ? first : undefined;
}

/**
 * How long a hard failure (network, DNS, connection, 5xx, disk) suppresses the
 * next attempt. This stops a persistent CDN or configuration problem turning
 * into a per-launch request from every install at once. Deliberately does NOT
 * apply to the 404 convergence check.
 */
export const DOCS_FAILURE_THROTTLE_MS = 60 * 60 * 1000;

/**
 * How long a transient `.tmp-*`, `.staging-*`, or `.stale-*` entry must have
 * been idle before pruning may remove it. Each window has its own extension
 * host sharing this cache directory, so anything younger may be another
 * window's in-flight work.
 */
export const DOCS_PRUNE_IDLE_MS = 10 * 60 * 1000;
