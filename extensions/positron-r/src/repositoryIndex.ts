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
		env = as.list(Sys.getenv()),
		maxAge = max_age,
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
	env: Record<string, string>;
	maxAge: number;
	config: string;
}

interface IndexState {
	usePak: boolean;
	expires: number;
	/** Resolves with the contrib URLs cached in the session's cache directory. */
	ready: Promise<string[]>;
}

/**
 * Answers whether packages can be installed from an R session's repositories
 * without making the session wait on the network.
 *
 * A helper R process downloads the repository indexes into the session's
 * available.packages() cache. The session then answers from that cache alone.
 * Results are remembered until the cache would expire, or until `reset()`.
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
			const state = this._ready(usePak);
			const urls = await state.ready;
			const unknown = names.filter(name => !this._available.has(name));
			if (unknown.length > 0) {
				const found = await this._lookup(urls, unknown);
				// Answers from before a reset describe a cache that no longer exists.
				if (this._state === state) {
					for (const name of unknown) {
						this._available.set(name, found.has(name));
					}
				}
			}
		} catch (err) {
			LOGGER.warn(`Failed to look up R packages in repositories: ${err}`);
			return [];
		}
		return names.filter(name => this._available.get(name));
	}

	/** Forgets all results; call when R restarts and its cache directory is replaced. */
	reset(): void {
		this._state = undefined;
		this._available.clear();
	}

	private _isStale(usePak: boolean): boolean {
		return !this._state || this._state.usePak !== usePak || Date.now() >= this._state.expires;
	}

	/** Starts warming the session's cache when stale, and returns the current state. */
	private _ready(usePak: boolean): IndexState {
		if (this._isStale(usePak)) {
			this._available.clear();
			const state: IndexState = { usePak, expires: Infinity, ready: Promise.resolve([]) };
			state.ready = this._warmCache(usePak).then(({ urls, ttlMs }) => {
				state.expires = Date.now() + ttlMs;
				return urls;
			});
			this._state = state;
		}
		return this._state!;
	}

	/** Runs the helper and resolves with the contrib URLs whose index is now cached. */
	private async _warmCache(usePak: boolean): Promise<{ urls: string[]; ttlMs: number }> {
		try {
			const config = (await this._session.evaluate(SESSION_CONFIG_CODE)).result as SessionConfig;
			const stdout = await runHelper(config.rscript, config.env, `c(${config.config}, list(pak = ${usePak ? 'TRUE' : 'FALSE'}))`);
			const urls = stdout.split(/\r?\n/).filter(url => url.length > 0);
			LOGGER.info(`Cached the package indexes of ${urls.length} R repositories`);
			if (urls.length > 0) {
				return { urls, ttlMs: config.maxAge * 1000 };
			}
		} catch (err) {
			LOGGER.warn(`Failed to fetch R repository indexes: ${err}`);
		}
		return { urls: [], ttlMs: FAILURE_RETRY_MS };
	}

	/**
	 * Looks up `names` in the session's cached indexes. Repositories whose
	 * cached index is missing are skipped, so this never touches the network.
	 */
	private async _lookup(urls: string[], names: string[]): Promise<Set<string>> {
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
			as.list(found)
		})`;
		const found = (await this._session.evaluate(code)).result;
		return new Set(Array.isArray(found) ? found as string[] : []);
	}
}

/** Runs the helper with the session's environment, so proxy and TLS settings match. */
function runHelper(rscript: string, env: Record<string, string>, config: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = execFile(
			rscript,
			['--no-init-file', HELPER_SCRIPT],
			{ cwd: os.tmpdir(), env, timeout: HELPER_TIMEOUT_MS, windowsHide: true },
			(err, stdout) => err ? reject(err) : resolve(stdout),
		);
		// Write failures (e.g. EPIPE when Rscript exits early) are reported by the callback.
		child.stdin?.on('error', () => { });
		child.stdin?.end(config);
	});
}

function rVector(items: string[]): string {
	return `c(${items.map(item => JSON.stringify(item)).join(', ')})`;
}
