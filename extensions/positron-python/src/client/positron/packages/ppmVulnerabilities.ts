/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { traceInfo, traceWarn } from '../../logging';

/**
 * Vulnerability lookups against Posit Package Manager (PPM).
 *
 * PPM reports known security vulnerabilities for PyPI (and CRAN/Bioconductor)
 * packages from the OSV database (`vulns` in its `/__api__/filter/packages`
 * response). This module resolves the PPM instance the Python environment's
 * package index points at (if any), confirms it is a PPM new enough to serve
 * vulnerability data, and fetches per-installed-version advisories for the
 * Packages pane.
 *
 * The advisories are the same OSV data wherever they are served from, so the
 * environment's own index only decides *which* PPM answers, not whether the
 * lookup happens: an index pointing at a PPM is used as-is, and anything else
 * (pypi.org, an index we can't resolve, nothing configured at all) falls back
 * to Posit's public instance. Either way the lookup sends the installed
 * package inventory (names and versions) to that instance.
 *
 * Mirrors extensions/positron-r/src/ppmVulnerabilities.ts (the twin-module
 * pattern the p3mSearch clients already follow).
 */

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
    /** Repository name within the instance, e.g. 'pypi'. */
    readonly repoName: string;
}

/**
 * Posit's public Package Manager, queried when the environment's index isn't
 * a PPM. Known-good, so it needs no `/__api__/status` probe.
 */
const PUBLIC_P3M: PpmRepo = { apiBase: 'https://packagemanager.posit.co', repoName: 'pypi' };

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
 * Discovery results per candidate index URL. PPM instances don't change
 * mid-session, so a URL is only probed once (including negative results).
 */
const discoveryCache = new Map<string, Promise<PpmRepo | undefined>>();

/** Test hook: clear the per-URL discovery cache. */
export function clearPpmDiscoveryCache(): void {
    discoveryCache.clear();
}

/**
 * Resolve the package index URL the environment's installer would use, from
 * the sources available without kernel involvement: the pip/uv environment
 * variables, then `pip config get global.index-url` (which reads pip's own
 * config-file precedence) via the caller-supplied lookup.
 *
 * @param getPipConfigIndexUrl Optional callback that runs
 *   `pip config get global.index-url` in the environment and returns its
 *   output, or undefined when unset. Injectable so uv (which doesn't read
 *   pip config) can omit it and tests can fake it.
 * @returns The index URL, or undefined when only the default (pypi.org,
 *   not a PPM) applies.
 */
export async function resolvePythonIndexUrl(
    getPipConfigIndexUrl?: () => Promise<string | undefined>,
): Promise<string | undefined> {
    // pip precedence is command line > environment > config files; the
    // command line isn't visible here, so the environment comes first.
    const fromEnv =
        process.env.PIP_INDEX_URL?.trim() || process.env.UV_DEFAULT_INDEX?.trim() || process.env.UV_INDEX_URL?.trim();
    if (fromEnv) {
        return fromEnv;
    }

    if (getPipConfigIndexUrl) {
        try {
            const fromConfig = (await getPipConfigIndexUrl())?.trim();
            if (fromConfig) {
                return fromConfig;
            }
        } catch {
            // `pip config get` exits non-zero when the key is unset; treat any
            // failure as "no configured index".
        }
    }

    return undefined;
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
 * Discover the PPM API base for an index URL by walking its path segments and
 * probing `/__api__/status`. A PPM index URL has the form
 * `<base>/<repo-name>/<snapshot...>/simple` (e.g.
 * `https://host/pypi/latest/simple`, or behind a path prefix), so the probe
 * tries each ancestor as the base and takes the first that answers like a
 * PPM; the next path segment is the repository name.
 *
 * Results (including "not a PPM") are cached per URL for the extension
 * host's lifetime.
 *
 * @param indexUrl The index URL to probe.
 * @param fetchImpl Fetch implementation, injectable for tests.
 * @returns The discovered instance, or undefined when the URL doesn't belong
 *   to a PPM instance that reports vulnerability data.
 */
export function discoverPpmApi(indexUrl: string, fetchImpl: typeof fetch = fetch): Promise<PpmRepo | undefined> {
    let cached = discoveryCache.get(indexUrl);
    if (!cached) {
        cached = doDiscoverPpmApi(indexUrl, fetchImpl);
        discoveryCache.set(indexUrl, cached);
    }
    return cached;
}

async function doDiscoverPpmApi(indexUrl: string, fetchImpl: typeof fetch): Promise<PpmRepo | undefined> {
    let parsed: URL;
    try {
        parsed = new URL(indexUrl);
    } catch {
        return undefined;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return undefined;
    }

    const segments = parsed.pathname.split('/').filter((segment) => segment.length > 0);

    // Longest prefix first, so a PPM hosted behind a path prefix wins over a
    // same-host service that happens to answer at the origin.
    for (let i = segments.length - 1; i >= 0; i -= 1) {
        const base = [parsed.origin, ...segments.slice(0, i)].join('/');
        const repoName = segments[i];
        try {
            // eslint-disable-next-line no-await-in-loop
            const response = await fetchImpl(`${base}/__api__/status`, {
                headers: { Accept: 'application/json' },
                signal: AbortSignal.timeout(STATUS_PROBE_TIMEOUT_MS),
            });
            if (!response.ok) {
                continue;
            }
            // eslint-disable-next-line no-await-in-loop
            const status = (await response.json()) as { version?: string };
            if (!ppmSupportsVulnerabilities(status.version)) {
                traceInfo(`[PPM] ${base} is a PPM instance (${status.version}) without vulnerability support`);
                return undefined;
            }
            traceInfo(`[PPM] Using ${base} (version ${status.version}), repo '${repoName}' for vulnerability data`);
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
 * a package the repository doesn't know at that version (VCS installs, local
 * builds, other indexes) is absent from the map entirely.
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
    const pinned = packages.filter((pkg) => !!pkg.version).map((pkg) => `${pkg.name}==${pkg.version}`);
    if (pinned.length === 0) {
        return result;
    }

    for (let start = 0; start < pinned.length; start += CHUNK_SIZE) {
        if (token?.isCancellationRequested) {
            throw new vscode.CancellationError();
        }
        const chunk = pinned.slice(start, start + CHUNK_SIZE);
        // eslint-disable-next-line no-await-in-loop
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

    const advisories = groups.filter((group) => group.length > 0).map((group) => normalizeGroup(group));

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
    const cve = [...allIds].filter((id) => id.startsWith('CVE-')).sort()[0];

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
    let scoreVersion: 'v3' | 'v4' | undefined;
    if (scoreV4 !== undefined) {
        scoreVersion = 'v4';
    } else if (scoreV3 !== undefined) {
        scoreVersion = 'v3';
    }

    // Lead with the record that carried the score (its summary is usually the
    // cleaner one), then any record that has a summary at all. The OSV id
    // follows the same preference so the advisory URL points at the record
    // the user actually sees quoted.
    const leadRecord = scoredRecord ?? group.find((record) => !!record.summary) ?? group[0];
    const summary = leadRecord.summary ?? group.find((record) => !!record.summary)?.summary;
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
        url: cve ? `https://nvd.nist.gov/vuln/detail/${cve}` : `https://osv.dev/vulnerability/${osvId}`,
    };
}

/**
 * Fetch vulnerabilities for the installed packages, gated on the
 * `packages.vulnerabilities.enabled` setting.
 *
 * Prefers the PPM the environment's own index points at, so a managed
 * environment gets advisories from the instance its admin configured, and
 * falls back to the public instance otherwise. The fallback is what makes the
 * feature work with no configuration at all, and what covers the environments
 * whose index we can't see -- notably uv, which takes its index from uv.toml
 * or pyproject.toml as well as from the environment variables read here.
 *
 * Resolves undefined (no data for any package) when the feature is disabled or
 * the lookup fails -- vulnerability data is optional and must never break the
 * metadata fetch.
 *
 * Shared by the pip and uv managers.
 */
export async function getPpmVulnerabilities(
    packages: readonly positron.PackageSpec[],
    token?: vscode.CancellationToken,
    getPipConfigIndexUrl?: () => Promise<string | undefined>,
    fetchImpl: typeof fetch = fetch,
): Promise<Map<string, positron.PackageVulnerability[]> | undefined> {
    const enabled = vscode.workspace.getConfiguration('packages').get<boolean>('vulnerabilities.enabled');
    if (enabled === false) {
        return undefined;
    }

    try {
        const indexUrl = await resolvePythonIndexUrl(getPipConfigIndexUrl);
        const configured = indexUrl ? await discoverPpmApi(indexUrl, fetchImpl) : undefined;
        return await fetchPpmVulnerabilities(configured ?? PUBLIC_P3M, packages, token, fetchImpl);
    } catch (err) {
        if (err instanceof vscode.CancellationError) {
            throw err;
        }
        traceWarn(`[PPM] Failed to fetch package vulnerabilities: ${err}`);
        return undefined;
    }
}
