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

/** How long a successfully fetched package list is used before fetching it again. */
const REFRESH_MS = 60 * 60 * 1000;

/** How long to wait before retrying after the helper finds no packages. */
const FAILURE_RETRY_MS = 5 * 60 * 1000;

const HELPER_SCRIPT = path.join(EXTENSION_ROOT_DIR, 'resources', 'scripts', 'list-repo-packages.R');

/** Network-free: reports what the helper needs to list the session's repository packages. */
const SESSION_CONFIG_CODE = `list(
	rscript = file.path(R.home("bin"), "Rscript"),
	env = as.list(Sys.getenv()),
	config = paste(deparse(list(
		repos = getOption("repos"),
		lib = .libPaths(),
		type = getOption("pkgType"),
		options = options()[c("download.file.method", "download.file.extra", "HTTPUserAgent", "timeout", "BioC_mirror")]
	)), collapse = "\\n")
)`;

interface SessionConfig {
	rscript: string;
	env: Record<string, string>;
	config: string;
}

interface IndexState {
	usePak: boolean;
	expires: number;
	/** Resolves with the names of the packages available from the repositories. */
	packages: Promise<Set<string>>;
}

/**
 * Answers whether packages can be installed from an R session's repositories
 * without making the session wait on the network.
 *
 * A helper R process, configured like the session, lists the packages its
 * repositories offer. The list is kept until it expires, or until `reset()`.
 */
export class RRepositoryIndex {
	private _state: IndexState | undefined;

	constructor(private readonly _session: RSession) { }

	/**
	 * Returns the subset of `names` available from the repositories the
	 * installer would use (pak's repositories when `usePak`, otherwise
	 * `getOption("repos")`).
	 */
	async filterAvailable(names: string[], usePak: boolean): Promise<string[]> {
		if (!this._state || this._state.usePak !== usePak || Date.now() >= this._state.expires) {
			const state: IndexState = { usePak, expires: Infinity, packages: Promise.resolve(new Set()) };
			state.packages = this._fetch(usePak).then(({ packages, ttlMs }) => {
				state.expires = Date.now() + ttlMs;
				return packages;
			});
			this._state = state;
		}
		const packages = await this._state.packages;
		return names.filter(name => packages.has(name));
	}

	/** Forgets the package list; call when R restarts, since its repositories may change. */
	reset(): void {
		this._state = undefined;
	}

	/** Runs the helper and resolves with the packages it found and how long to keep them. */
	private async _fetch(usePak: boolean): Promise<{ packages: Set<string>; ttlMs: number }> {
		let config: SessionConfig;
		try {
			config = (await this._session.evaluate(SESSION_CONFIG_CODE)).result as SessionConfig;
		} catch (err) {
			// The session can't answer yet (e.g. it is restarting); ask again on the next check.
			LOGGER.warn(`Failed to read R repository configuration: ${err}`);
			return { packages: new Set(), ttlMs: 0 };
		}
		try {
			const stdout = await runHelper(config.rscript, config.env, `c(${config.config}, list(pak = ${usePak ? 'TRUE' : 'FALSE'}))`);
			const packages = new Set(stdout.split(/\r?\n/).filter(name => name.length > 0));
			LOGGER.info(`Found ${packages.size} packages in R repositories`);
			return { packages, ttlMs: packages.size > 0 ? REFRESH_MS : FAILURE_RETRY_MS };
		} catch (err) {
			LOGGER.warn(`Failed to list R repository packages: ${err}`);
			return { packages: new Set(), ttlMs: FAILURE_RETRY_MS };
		}
	}
}

/** Runs the helper with the session's environment, so proxy and TLS settings match. */
function runHelper(rscript: string, env: Record<string, string>, config: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = execFile(
			rscript,
			['--no-init-file', HELPER_SCRIPT],
			{ cwd: os.tmpdir(), env, timeout: HELPER_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
			(err, stdout) => err ? reject(err) : resolve(stdout),
		);
		// Write failures (e.g. EPIPE when Rscript exits early) are reported by the callback.
		child.stdin?.on('error', () => { });
		child.stdin?.end(config);
	});
}
