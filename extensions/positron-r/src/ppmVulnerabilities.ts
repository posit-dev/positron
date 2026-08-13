/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as positron from 'positron';
import * as vscode from 'vscode';
import { LOGGER } from './extension';
import { findReposConf } from './kernel-spec';

/**
 * Vulnerability lookups against Posit Package Manager (PPM).
 *
 * PPM reports known security vulnerabilities for CRAN, Bioconductor, and PyPI
 * packages from the OSV database (`vulns` in its `/__api__/filter/packages`
 * response). This module resolves the PPM instance the R session's repositories
 * point at (if any), confirms it is a PPM new enough to serve vulnerability
 * data, and fetches per-installed-version advisories for the Packages pane.
 *
 * The advisories are the same OSV data wherever they are served from, so the
 * session's repositories only decide *which* PPM answers, not whether the
 * lookup happens: a repository pointing at a PPM is used as-is, and anything
 * else (cran.rstudio.com, a mirror, no repo configuration) falls back to
 * Posit's public instance. Either way the lookup sends the installed package
 * inventory (names and versions) to that instance.
 */

/** The public Posit Package Manager CRAN repo, matching ark's default. */
const PUBLIC_PPM_CRAN_REPO = 'https://packagemanager.posit.co/cran/latest';

/**
 * The same public instance as an already-resolved repo, queried when the
 * session's repositories aren't a PPM. Known-good, so it needs no
 * `/__api__/status` probe.
 */
export const PUBLIC_P3M: PpmRepo = { apiBase: 'https://packagemanager.posit.co', repoName: 'cran' };

/** Max package specs per filter/packages request, to bound payload sizes. */
const CHUNK_SIZE = 100;

/** Timeout for the one-time /__api__/status discovery probe. */
const STATUS_PROBE_TIMEOUT_MS = 5000;

/** Timeout for each filter/packages request. */
const FETCH_TIMEOUT_MS = 30000;

/** A discovered PPM instance: API base URL plus the repository name. */
export interface PpmRepo {
	/** Base URL the `/__api__/...` endpoints hang off, without trailing slash. */
	readonly apiBase: string;
	/** Repository name within the instance, e.g. 'cran'. */
	readonly repoName: string;
}

/** OSV-format severity entry as served by PPM. */
interface OsvSeverity {
	readonly type?: string;
	readonly score?: string;
	readonly calculated_score?: { readonly base_score?: number };
}

/** OSV-format vulnerability record as served by PPM (relevant fields only). */
export interface OsvVulnerability {
	readonly id: string;
	readonly aliases?: readonly string[];
	readonly summary?: string;
	readonly published?: string;
	readonly severity?: readonly OsvSeverity[];
	readonly ranges?: ReadonlyArray<{
		readonly type?: string;
		readonly events?: ReadonlyArray<{ readonly introduced?: string; readonly fixed?: string }>;
	}>;
}

/** One NDJSON row of the filter/packages response (relevant fields only). */
interface PpmFilterRow {
	readonly name?: string;
	readonly version?: string;
	readonly vulns?: readonly OsvVulnerability[];
}

/**
 * Discovery results per candidate repo URL. PPM instances don't change
 * mid-session, so a URL is only probed once (including negative results).
 */
const discoveryCache = new Map<string, Promise<PpmRepo | undefined>>();

/** Test hook: clear the per-URL discovery cache. */
export function clearPpmDiscoveryCache(): void {
	discoveryCache.clear();
}

/**
 * Resolve the repository URL the R session's package operations would use,
 * mirroring the precedence in kernel-spec.ts (repos.conf, then the Package
 * Manager Repository setting, then the public PPM default in web mode).
 *
 * This reads the same launch-time configuration ark received rather than the
 * session's live `getOption("repos")`, so an in-session `options(repos = ...)`
 * override is not seen. Reading the live option needs an ark RPC and is
 * tracked as a follow-up; the launch-time sources cover the managed
 * (Workbench/admin) configurations this feature targets.
 *
 * @param findReposConfImpl repos.conf locator, injectable so tests aren't
 *   hostage to the machine's real XDG configuration directories.
 * @param uiKind The UI kind, injectable for tests.
 * @returns The repo URL, or undefined when the session isn't repo-configured
 *   in a way that could point at a PPM instance.
 */
export function resolveRRepoUrl(
	findReposConfImpl: () => string | undefined = findReposConf,
	uiKind: vscode.UIKind = vscode.env.uiKind,
): string | undefined {
	const config = vscode.workspace.getConfiguration('positron.r');
	const defaultRepos = config.get<string>('defaultRepositories') ?? 'auto';

	if (defaultRepos === 'posit-ppm') {
		return PUBLIC_PPM_CRAN_REPO;
	}
	if (defaultRepos !== 'auto') {
		// 'rstudio' (cran.rstudio.com) and 'none' can't be PPM instances.
		return undefined;
	}

	// 'auto': same precedence as getArkKernelSpec.
	const reposConf = findReposConfImpl();
	if (reposConf) {
		return parseReposConf(reposConf);
	}

	const ppmRepo = config.get<string>('packageManagerRepository');
	if (ppmRepo) {
		return ppmRepo.endsWith('/') ? ppmRepo.slice(0, -1) : ppmRepo;
	}

	if (uiKind === vscode.UIKind.Web) {
		// Web mode defaults to Posit's Public Package Manager (see kernel-spec).
		return PUBLIC_PPM_CRAN_REPO;
	}

	// Ark falls back to cran.rstudio.com, which is not a PPM instance.
	return undefined;
}

/**
 * Parse a `repos.conf` file (`NAME = URL` lines, `#` comments -- see ark's
 * repos.rs) and return the CRAN repository URL, falling back to the first
 * entry when no CRAN key is present.
 */
function parseReposConf(path: string): string | undefined {
	let contents: string;
	try {
		contents = fs.readFileSync(path, 'utf8');
	} catch (err) {
		LOGGER.warn(`[PPM] Failed to read repos.conf at ${path}: ${err}`);
		return undefined;
	}

	let firstUrl: string | undefined;
	for (const line of contents.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) {
			continue;
		}
		const eq = trimmed.indexOf('=');
		if (eq < 0) {
			continue;
		}
		const name = trimmed.slice(0, eq).trim();
		const url = trimmed.slice(eq + 1).trim();
		if (!url.startsWith('http://') && !url.startsWith('https://')) {
			continue;
		}
		if (name.toUpperCase() === 'CRAN') {
			return url;
		}
		firstUrl = firstUrl ?? url;
	}
	return firstUrl;
}

/**
 * Whether a PPM version string ("2026.06.0", "2025.04.2-8") is at least
 * 2023.12, the release that introduced OSV vulnerability reporting. Older
 * instances silently ignore the `vulns` machinery, which would make every
 * package look clean, so they're treated as not supporting the feature.
 */
export function ppmSupportsVulnerabilities(version: string | undefined): boolean {
	if (!version) {
		return false;
	}
	const match = /^(?<year>\d{4})\.(?<month>\d{1,2})/.exec(version);
	if (!match?.groups) {
		return false;
	}
	const year = Number(match.groups.year);
	const month = Number(match.groups.month);
	return year > 2023 || (year === 2023 && month >= 12);
}

/**
 * Discover the PPM API base for a repository URL by walking its path segments
 * and probing `/__api__/status`. A PPM repo URL has the form
 * `<base>/<repo-name>/<snapshot...>` (e.g. `https://host/cran/latest`, or
 * `https://host/prefix/cran/__linux__/jammy/latest` behind a path prefix), so
 * the probe tries each ancestor as the base and takes the first that answers
 * like a PPM; the next path segment is the repository name.
 *
 * Results (including "not a PPM") are cached per URL for the extension host's
 * lifetime.
 *
 * @param repoUrl The repository URL to probe.
 * @param fetchImpl Fetch implementation, injectable for tests.
 * @returns The discovered instance, or undefined when the URL doesn't belong
 *   to a PPM instance that reports vulnerability data.
 */
export function discoverPpmApi(
	repoUrl: string,
	fetchImpl: typeof fetch = fetch,
): Promise<PpmRepo | undefined> {
	let cached = discoveryCache.get(repoUrl);
	if (!cached) {
		cached = doDiscoverPpmApi(repoUrl, fetchImpl);
		discoveryCache.set(repoUrl, cached);
	}
	return cached;
}

async function doDiscoverPpmApi(
	repoUrl: string,
	fetchImpl: typeof fetch,
): Promise<PpmRepo | undefined> {
	let parsed: URL;
	try {
		parsed = new URL(repoUrl);
	} catch {
		return undefined;
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		return undefined;
	}

	const segments = parsed.pathname.split('/').filter(segment => segment.length > 0);

	// Longest prefix first, so a PPM hosted behind a path prefix wins over a
	// same-host service that happens to answer at the origin.
	for (let i = segments.length - 1; i >= 0; i--) {
		const base = [parsed.origin, ...segments.slice(0, i)].join('/');
		const repoName = segments[i];
		try {
			const response = await fetchImpl(`${base}/__api__/status`, {
				headers: { Accept: 'application/json' },
				signal: AbortSignal.timeout(STATUS_PROBE_TIMEOUT_MS),
			});
			if (!response.ok) {
				continue;
			}
			const status = await response.json() as { version?: string };
			if (!ppmSupportsVulnerabilities(status.version)) {
				LOGGER.info(`[PPM] ${base} is a PPM instance (${status.version}) without vulnerability support`);
				return undefined;
			}
			LOGGER.info(`[PPM] Using ${base} (version ${status.version}), repo '${repoName}' for vulnerability data`);
			return { apiBase: base, repoName };
		} catch {
			// Not a PPM base (or unreachable); try the next ancestor.
			continue;
		}
	}
	return undefined;
}

/**
 * Fetch known vulnerabilities for the given installed packages from a PPM
 * instance.
 *
 * The result distinguishes "known clean" from "unknown": a package present in
 * the repository at its installed version maps to an array (possibly empty);
 * a package the repository doesn't know at that version (GitHub installs,
 * local builds, other repos) is absent from the map entirely.
 *
 * @param ppm The PPM instance and repository to query.
 * @param packages Installed packages, each queried at its installed version.
 * @param token Optional cancellation token.
 * @param fetchImpl Fetch implementation, injectable for tests.
 * @returns Map of lowercase package name to normalized advisories.
 */
export async function fetchPpmVulnerabilities(
	ppm: PpmRepo,
	packages: readonly positron.PackageSpec[],
	token?: vscode.CancellationToken,
	fetchImpl: typeof fetch = fetch,
): Promise<Map<string, positron.PackageVulnerability[]>> {
	const result = new Map<string, positron.PackageVulnerability[]>();

	// Only version-pinned names answer for the installed release; an unpinned
	// name reports the latest version's advisories, which is the wrong
	// question for an installed-packages pane.
	const pinned = packages
		.filter(pkg => !!pkg.version)
		.map(pkg => `${pkg.name}==${pkg.version}`);
	if (pinned.length === 0) {
		return result;
	}

	for (let start = 0; start < pinned.length; start += CHUNK_SIZE) {
		if (token?.isCancellationRequested) {
			throw new vscode.CancellationError();
		}
		const chunk = pinned.slice(start, start + CHUNK_SIZE);
		const rows = await fetchFilterRows(ppm, chunk, token, fetchImpl);
		for (const row of rows) {
			if (!row.name) {
				continue;
			}
			const key = row.name.toLowerCase();
			// `omit_package_details` makes PPM return one row per binary build
			// of the same version; the rows carry identical vulns, keep the first.
			if (result.has(key)) {
				continue;
			}
			result.set(key, normalizeOsvVulnerabilities(row.vulns ?? []));
		}
	}

	return result;
}

/** POST one filter/packages request and parse the NDJSON rows. */
async function fetchFilterRows(
	ppm: PpmRepo,
	names: readonly string[],
	token: vscode.CancellationToken | undefined,
	fetchImpl: typeof fetch,
): Promise<PpmFilterRow[]> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	const cancelSubscription = token?.onCancellationRequested(() => controller.abort());

	try {
		const response = await fetchImpl(`${ppm.apiBase}/__api__/filter/packages`, {
			method: 'POST',
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				names,
				repo: ppm.repoName,
				omit_downloads: true,
				omit_dependencies: true,
				// Also drops the (large) available-versions lists. Costs
				// duplicate rows for packages with multiple binary builds,
				// which the caller deduplicates.
				omit_package_details: true,
			}),
			signal: controller.signal,
		});
		if (!response.ok) {
			throw new Error(`PPM filter/packages returned status ${response.status}`);
		}
		const text = await response.text();
		const rows: PpmFilterRow[] = [];
		for (const line of text.split('\n')) {
			if (!line.trim()) {
				continue;
			}
			try {
				rows.push(JSON.parse(line) as PpmFilterRow);
			} catch {
				// Skip malformed lines
			}
		}
		return rows;
	} catch (err) {
		if (token?.isCancellationRequested) {
			throw new vscode.CancellationError();
		}
		throw err;
	} finally {
		clearTimeout(timeout);
		cancelSubscription?.dispose();
	}
}

/**
 * Normalize raw OSV records into display-ready advisories.
 *
 * PPM serves one record per source database, so a single CVE typically
 * arrives two or three times (PYSEC + GHSA + CVE aliases), with the CVSS
 * score often present on only one of the twins. Records are grouped by their
 * alias graph, and each group becomes one advisory carrying the best score
 * found anywhere in the group.
 *
 * Exported for unit tests.
 */
export function normalizeOsvVulnerabilities(raw: readonly OsvVulnerability[]): positron.PackageVulnerability[] {
	// Group records whose id/alias sets overlap (union-find over the alias
	// graph, merging groups when a record bridges two of them).
	const groups: OsvVulnerability[][] = [];
	const keyToGroup = new Map<string, OsvVulnerability[]>();
	for (const record of raw) {
		const ids = [record.id, ...(record.aliases ?? [])];
		const touched = new Set<OsvVulnerability[]>();
		for (const id of ids) {
			const group = keyToGroup.get(id);
			if (group) {
				touched.add(group);
			}
		}
		let group: OsvVulnerability[];
		if (touched.size === 0) {
			group = [];
			groups.push(group);
		} else {
			const [first, ...rest] = [...touched];
			group = first;
			for (const other of rest) {
				group.push(...other);
				other.length = 0;
				for (const [key, mapped] of keyToGroup) {
					if (mapped === other) {
						keyToGroup.set(key, group);
					}
				}
			}
		}
		group.push(record);
		for (const id of ids) {
			keyToGroup.set(id, group);
		}
	}

	const advisories = groups
		.filter(group => group.length > 0)
		.map(group => normalizeGroup(group));

	// Highest severity first; unscored advisories after scored ones.
	advisories.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
	return advisories;
}

/** Collapse one alias group into a single advisory. */
function normalizeGroup(group: OsvVulnerability[]): positron.PackageVulnerability {
	// All ids and aliases in the group, for CVE extraction.
	const allIds = new Set<string>();
	for (const record of group) {
		allIds.add(record.id);
		for (const alias of record.aliases ?? []) {
			allIds.add(alias);
		}
	}
	const cve = [...allIds].filter(id => id.startsWith('CVE-')).sort()[0];

	// Best score across the group: prefer the newest CVSS revision present.
	let scoreV3: number | undefined;
	let scoreV4: number | undefined;
	let scoredRecord: OsvVulnerability | undefined;
	for (const record of group) {
		for (const severity of record.severity ?? []) {
			const base = severity.calculated_score?.base_score;
			if (typeof base !== 'number') {
				continue;
			}
			if (severity.type === 'CVSS_V4' && (scoreV4 === undefined || base > scoreV4)) {
				scoreV4 = base;
				scoredRecord = scoredRecord ?? record;
			} else if (severity.type === 'CVSS_V3' && (scoreV3 === undefined || base > scoreV3)) {
				scoreV3 = base;
				scoredRecord = scoredRecord ?? record;
			}
		}
	}
	const score = scoreV4 ?? scoreV3;
	const scoreVersion = scoreV4 !== undefined ? 'v4' as const : (scoreV3 !== undefined ? 'v3' as const : undefined);

	// Lead with the record that carried the score (its summary is usually the
	// cleaner one), then any record that has a summary at all. The OSV id
	// follows the same preference so the advisory URL points at the record
	// the user actually sees quoted.
	const leadRecord = scoredRecord ?? group.find(record => !!record.summary) ?? group[0];
	const summary = leadRecord.summary ?? group.find(record => !!record.summary)?.summary;
	const osvId = leadRecord.id;

	// Distinct fixed versions across all ranges, in order of appearance --
	// multiple values mean fixes on multiple release branches. Joined for
	// display; version comparison stays out of TypeScript.
	const fixedVersions: string[] = [];
	for (const record of group) {
		for (const range of record.ranges ?? []) {
			for (const event of range.events ?? []) {
				if (event.fixed && !fixedVersions.includes(event.fixed)) {
					fixedVersions.push(event.fixed);
				}
			}
		}
	}

	// Earliest publication across the group (ISO 8601 sorts lexicographically).
	let published: string | undefined;
	for (const record of group) {
		if (record.published && (!published || record.published < published)) {
			published = record.published;
		}
	}

	return {
		id: cve ?? leadRecord.id,
		osvId,
		score,
		scoreVersion,
		summary,
		fixedIn: fixedVersions.length > 0 ? fixedVersions.join(', ') : undefined,
		published,
		url: cve
			? `https://nvd.nist.gov/vuln/detail/${cve}`
			: `https://osv.dev/vulnerability/${osvId}`,
	};
}

/**
 * Fetch vulnerabilities for the installed packages, gated on the
 * `packages.vulnerabilities.enabled` setting.
 *
 * Prefers the PPM the session's repositories point at, so a managed session
 * gets advisories from the instance its admin configured, and falls back to
 * the public instance so the feature works without repo configuration.
 *
 * Resolves undefined (no data for any package) when the feature is disabled or
 * the lookup fails -- vulnerability data is optional and must never break the
 * metadata fetch.
 *
 * @param packages Installed packages, each queried at its installed version.
 * @param token Optional cancellation token.
 * @param fetchImpl Fetch implementation, injectable for tests.
 */
export async function getPpmVulnerabilities(
	packages: readonly positron.PackageSpec[],
	token?: vscode.CancellationToken,
	fetchImpl: typeof fetch = fetch,
): Promise<Map<string, positron.PackageVulnerability[]> | undefined> {
	const enabled = vscode.workspace.getConfiguration('packages')
		.get<boolean>('vulnerabilities.enabled');
	if (enabled === false) {
		return undefined;
	}

	try {
		const repoUrl = resolveRRepoUrl();
		const configured = repoUrl ? await discoverPpmApi(repoUrl, fetchImpl) : undefined;
		return await fetchPpmVulnerabilities(configured ?? PUBLIC_P3M, packages, token, fetchImpl);
	} catch (err) {
		if (err instanceof vscode.CancellationError) {
			throw err;
		}
		LOGGER.warn(`[PPM] Failed to fetch package vulnerabilities: ${err}`);
		return undefined;
	}
}
