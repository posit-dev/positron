/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFile } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import { EXTENSION_ROOT_DIR } from './constants';
import { LOGGER } from './extension';
import { RSession } from './session';

/** How long to wait for the helper process to download repository indexes. */
const HELPER_TIMEOUT_MS = 5 * 60 * 1000;

/** How long to wait before retrying after the helper finds no usable repositories. */
const FAILURE_RETRY_MS = 5 * 60 * 1000;

const HELPER_SCRIPT = path.join(EXTENSION_ROOT_DIR, 'resources', 'scripts', 'warm-repos-cache.R');

/** R expression for the directory available.packages() caches repository indexes in. */
const CACHE_DIR_CODE = `(if ("cache_user_dir" %in% names(formals(utils::available.packages)) &&
	tolower(Sys.getenv("R_PACKAGES_CACHE_USER_DIR", "false")) %in% c("true", "t", "yes", "1"))
	tools::R_user_dir("base", "cache") else tempdir())`;

/**
 * Network-free: reports what the helper needs to warm this session's
 * available.packages() cache.
 */
const SESSION_CONFIG_CODE = `local({
	max_age <- as.numeric(Sys.getenv("R_AVAILABLE_PACKAGES_CACHE_CONTROL_MAX_AGE", "3600"))
	cache_dir <- ${CACHE_DIR_CODE}
	list(
		rscript = file.path(R.home("bin"), "Rscript"),
		maxAge = max_age,
		cacheDir = cache_dir,
		config = paste(deparse(list(
			repos = getOption("repos"),
			lib = .libPaths(),
			type = getOption("pkgType"),
			cache_dir = cache_dir,
			max_age = max_age,
			options = options()[c("download.file.method", "download.file.extra", "HTTPUserAgent", "timeout", "BioC_mirror")]
		)), collapse = "\\n")
	)
})`;

interface SessionConfig {
	rscript: string;
	maxAge: number;
	cacheDir: string;
	config: string;
}

interface IndexState {
	usePak: boolean;
	expires: number;
	/** Resolves with the session's cache directory and the contrib URLs cached in it. */
	ready: Promise<{ cacheDir: string; urls: string[] }>;
}

/**
 * Answers whether packages can be installed from an R session's repositories
 * without making the session wait on the network.
 *
 * A helper R process downloads the repository indexes into the session's
 * available.packages() cache. The session then answers from that cache alone.
 * Results are remembered until the cache would expire, or until the cache
 * directory changes because R restarted.
 */
export class RRepositoryIndex {
	private _state: IndexState | undefined;
	private readonly _available = new Map<string, boolean>();

	constructor(private readonly _session: RSession) { }

	/**
	 * Returns the subset of `names` available from the repositories the
	 * installer would use (pak's repositories when `usePak`, otherwise
	 * `getOption("repos")`).
	 */
	async filterAvailable(names: string[], usePak: boolean): Promise<string[]> {
		try {
			let ready = await this._ready(usePak);
			let unknown = names.filter(name => !this._available.has(name));
			if (unknown.length > 0) {
				let result = await this._lookup(ready.urls, unknown);
				if (result.cacheDir !== ready.cacheDir) {
					this._state = undefined;
					ready = await this._ready(usePak);
					unknown = names;
					result = await this._lookup(ready.urls, unknown);
				}
				for (const name of unknown) {
					this._available.set(name, result.found.has(name));
				}
			}
		} catch (err) {
			LOGGER.warn(`Failed to look up R packages in repositories: ${err}`);
			return [];
		}
		return names.filter(name => this._available.get(name));
	}

	private _isStale(usePak: boolean): boolean {
		return !this._state || this._state.usePak !== usePak || Date.now() >= this._state.expires;
	}

	/** Warms the session's cache when stale, then resolves with what is cached. */
	private _ready(usePak: boolean): IndexState['ready'] {
		if (this._isStale(usePak)) {
			this._available.clear();
			const state: IndexState = { usePak, expires: Infinity, ready: Promise.resolve({ cacheDir: '', urls: [] }) };
			state.ready = this._warmCache(usePak).then(({ cacheDir, urls, ttlMs }) => {
				state.expires = Date.now() + ttlMs;
				return { cacheDir, urls };
			});
			this._state = state;
		}
		return this._state!.ready;
	}

	/** Runs the helper and resolves with the contrib URLs whose index is now cached. */
	private async _warmCache(usePak: boolean): Promise<{ cacheDir: string; urls: string[]; ttlMs: number }> {
		let cacheDir = '';
		try {
			const config = (await this._session.evaluate(SESSION_CONFIG_CODE)).result as SessionConfig;
			cacheDir = config.cacheDir;
			const stdout = await runHelper(config.rscript, `c(${config.config}, list(pak = ${usePak ? 'TRUE' : 'FALSE'}))`);
			const urls = stdout.split(/\r?\n/).filter(url => url.length > 0);
			LOGGER.info(`Cached the package indexes of ${urls.length} R repositories`);
			if (urls.length > 0) {
				return { cacheDir, urls, ttlMs: config.maxAge * 1000 };
			}
		} catch (err) {
			LOGGER.warn(`Failed to fetch R repository indexes: ${err}`);
		}
		return { cacheDir, urls: [], ttlMs: FAILURE_RETRY_MS };
	}

	/**
	 * Looks up `names` in the session's cached indexes. Repositories whose
	 * cached index is missing are skipped, so this never touches the network.
	 */
	private async _lookup(urls: string[], names: string[]): Promise<{ cacheDir: string; found: Set<string> }> {
		const code = `local({
			dir <- ${CACHE_DIR_CODE}
			urls <- as.character(${rVector(urls)})
			cached <- vapply(urls, function(url) startsWith(url, "file:") ||
				file.exists(file.path(dir, paste0("repos_", utils::URLencode(url, TRUE), ".rds"))), TRUE)
			found <- character()
			if (any(cached)) {
				ap <- utils::available.packages
				args <- list(contriburl = urls[cached])
				if ("max_repo_cache_age" %in% names(formals(ap))) args$max_repo_cache_age <- Inf
				found <- intersect(${rVector(names)}, rownames(do.call(ap, args)))
			}
			list(dir = dir, found = as.list(found))
		})`;
		const result = (await this._session.evaluate(code)).result as { dir: string; found: string[] };
		return { cacheDir: result.dir, found: new Set(Array.isArray(result.found) ? result.found : []) };
	}
}

function runHelper(rscript: string, config: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = execFile(
			rscript,
			['--no-init-file', HELPER_SCRIPT],
			{ cwd: os.tmpdir(), timeout: HELPER_TIMEOUT_MS, windowsHide: true },
			(err, stdout) => err ? reject(err) : resolve(stdout),
		);
		child.stdin?.end(config);
	});
}

function rVector(items: string[]): string {
	return `c(${items.map(item => JSON.stringify(item)).join(', ')})`;
}
