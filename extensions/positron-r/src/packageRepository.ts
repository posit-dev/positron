/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as vscode from 'vscode';
import { LOGGER } from './extension';
import { findReposConf } from './kernel-spec';
import { isRVersionsMetadata, PackagerMetadata } from './r-installation';

/**
 * Which repository an R session installs packages from.
 *
 * Positron asks for this to decide which Posit Package Manager instance, if
 * any, can report security advisories for the installed packages. The
 * resolution has to live here rather than in Positron core: the precedence is
 * ark's, and its highest-priority source -- the `Repo:` field of an r-versions
 * entry -- is per-installation metadata only this extension sees. Getting the
 * precedence wrong in a managed deployment means asking the wrong instance, or
 * a public one.
 *
 * This reads the same launch-time configuration ark received rather than the
 * session's live `getOption("repos")`, so an in-session `options(repos = ...)`
 * override is not seen. Reading the live option needs an ark RPC and is tracked
 * as a follow-up; the launch-time sources cover the managed (Workbench/admin)
 * configurations this feature targets.
 */

/** The public Posit Package Manager CRAN repo, matching ark's default. */
const PUBLIC_PPM_CRAN_REPO = 'https://packagemanager.posit.co/cran/latest';

/**
 * Resolve the repository URL the session's package operations would use,
 * mirroring the precedence in `getArkKernelSpec`: an r-versions `Repo:` field,
 * then (for `auto`) `repos.conf`, the Package Manager Repository setting, and
 * the public instance in web mode.
 *
 * @param packagerMetadata The session's packager metadata, when it came from an
 *   r-versions entry.
 * @param findReposConfImpl repos.conf locator, injectable so tests aren't
 *   hostage to the machine's real XDG configuration directories.
 * @param readFileImpl File reader, injectable for tests.
 * @param uiKind The UI kind, injectable for tests.
 * @returns The repository URL, or undefined when the session isn't configured in
 *   a way that could point at a Package Manager instance.
 */
export function resolveRRepositoryUrl(
	packagerMetadata?: PackagerMetadata,
	findReposConfImpl: () => string | undefined = findReposConf,
	readFileImpl: (path: string) => string | undefined = readFileIfExists,
	uiKind: vscode.UIKind = vscode.env.uiKind,
): string | undefined {
	// An r-versions Repo: field wins outright, exactly as it does at kernel
	// launch. This is the mechanism a Workbench administrator uses to pin each
	// R build's repository, so it must be checked before any setting.
	const rVersionsRepo = resolveRVersionsRepo(packagerMetadata, readFileImpl);
	if (rVersionsRepo) {
		return rVersionsRepo;
	}

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
		return parseReposConf(readFileImpl(reposConf));
	}

	const ppmRepo = config.get<string>('packageManagerRepository');
	if (ppmRepo) {
		return stripTrailingSlash(ppmRepo);
	}

	if (uiKind === vscode.UIKind.Web) {
		// Web mode defaults to Posit's Public Package Manager (see kernel-spec).
		return PUBLIC_PPM_CRAN_REPO;
	}

	// Ark falls back to cran.rstudio.com, which is not a PPM instance.
	return undefined;
}

/**
 * The repository from an r-versions entry's `Repo:` field, which is either a URL
 * or the path to a `repos.conf` file (see `getRVersionsRepoArgs`).
 */
function resolveRVersionsRepo(
	packagerMetadata: PackagerMetadata | undefined,
	readFileImpl: (path: string) => string | undefined,
): string | undefined {
	if (!packagerMetadata || !isRVersionsMetadata(packagerMetadata) || !packagerMetadata.repo) {
		return undefined;
	}
	const repo = packagerMetadata.repo;
	if (repo.startsWith('http://') || repo.startsWith('https://')) {
		return stripTrailingSlash(repo);
	}
	return parseReposConf(readFileImpl(repo));
}

/** Read a file, or return undefined when it's missing or unreadable. */
function readFileIfExists(path: string): string | undefined {
	try {
		return fs.readFileSync(path, 'utf8');
	} catch (err) {
		LOGGER.warn(`[Packages] Failed to read repository configuration at ${path}: ${err}`);
		return undefined;
	}
}

/**
 * Parse `repos.conf` contents (`NAME = URL` lines, `#` comments -- see ark's
 * repos.rs) and return the CRAN repository URL, falling back to the first entry
 * when no CRAN key is present.
 */
function parseReposConf(contents: string | undefined): string | undefined {
	if (!contents) {
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
			return stripTrailingSlash(url);
		}
		firstUrl = firstUrl ?? stripTrailingSlash(url);
	}
	return firstUrl;
}

function stripTrailingSlash(url: string): string {
	return url.endsWith('/') ? url.slice(0, -1) : url;
}
