/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import { RSession } from './session';

/**
 * R Package Manager
 *
 * Provides package management functionality for R sessions using pak as the
 * primary backend with base R fallback.
 */
export class RPackageManager {
	/** Whether pak is available in the R session */
	private _pakAvailable: boolean | null = null;

	/** Whether the user has declined to install pak (session-scoped) */
	private _pakDeclined: boolean = false;

	constructor(private readonly _session: RSession) { }

	/**
	 * Get list of installed packages from all libpaths.
	 */
	async getPackages(): Promise<positron.LanguageRuntimePackage[]> {
		const hasPak = await this._ensurePakChecked();

		// R code is built using array.join() to avoid template literal indentation
		// which fails the project's whitespace hygiene checks.
		let code: string;
		if (hasPak) {
			code = [
				'local({',
				'old_opt <- options(pak.no_extra_messages = TRUE)',
				'on.exit(options(old_opt), add = TRUE)',
				'pkgs <- pak::lib_status()',
				'cat(jsonlite::toJSON(data.frame(',
				'id = paste0(pkgs$package, "-", pkgs$version),',
				'name = pkgs$package,',
				'displayName = pkgs$package,',
				'version = as.character(pkgs$version)',
				'), auto_unbox = TRUE))',
				'})'
			].join('\n');
		} else {
			code = [
				'local({',
				'ip <- installed.packages()',
				'cat(jsonlite::toJSON(data.frame(',
				'id = paste0(ip[, "Package"], "-", ip[, "Version"]),',
				'name = ip[, "Package"],',
				'displayName = ip[, "Package"],',
				'version = ip[, "Version"]',
				'), auto_unbox = TRUE))',
				'})'
			].join('\n');
		}

		const result = await this._executeAndCapture(code);
		if (!result || result.trim() === '') {
			return [];
		}
		return JSON.parse(result);
	}

	/**
	 * Install one or more packages.
	 */
	async installPackages(packages: string[]): Promise<void> {
		// Validate package names (strip @version suffix for validation)
		for (const pkg of packages) {
			this._validatePackageName(pkg.split('@')[0]);
		}

		const hasPak = await this._ensurePak();

		let code: string;
		if (hasPak) {
			// pak supports "pkg@version" syntax directly
			const pkgList = packages.map(p => `"${p}"`).join(', ');
			code = `pak::pkg_install(c(${pkgList}), ask = FALSE)`;
		} else {
			// base R: strip version suffix if present (not supported)
			const pkgNames = packages.map(p => p.split('@')[0]);
			const pkgList = pkgNames.map(p => `"${p}"`).join(', ');
			code = `install.packages(c(${pkgList}))`;
		}

		await this._executeAndWait(code);
	}

	/**
	 * Update specific packages to latest versions.
	 * Package names can optionally include version using '@' syntax (e.g., "dplyr@1.1.0").
	 */
	async updatePackages(packages: string[]): Promise<void> {
		// Validate package names (strip @version suffix for validation)
		for (const pkg of packages) {
			this._validatePackageName(pkg.split('@')[0]);
		}

		const hasPak = await this._ensurePak();

		let code: string;
		if (hasPak) {
			// pak supports "pkg@version" syntax directly
			const pkgList = packages.map(p => `"${p}"`).join(', ');
			code = `pak::pkg_install(c(${pkgList}), ask = FALSE)`;
		} else {
			// base R: strip version suffix if present (not supported)
			const pkgNames = packages.map(p => p.split('@')[0]);
			const pkgList = pkgNames.map(p => `"${p}"`).join(', ');
			code = `install.packages(c(${pkgList}))`;
		}

		await this._executeAndWait(code);
	}

	/**
	 * Update all packages with available updates.
	 */
	async updateAllPackages(): Promise<void> {
		const hasPak = await this._ensurePak();

		let code: string;
		if (hasPak) {
			code = [
				'local({',
				'old_opt <- options(pak.no_extra_messages = TRUE)',
				'on.exit(options(old_opt), add = TRUE)',
				`outdated <- old.packages()[, "Package"]`,
				'if (length(outdated) > 0) pak::pkg_install(outdated, ask = FALSE)',
				'})'
			].join('\n');
		} else {
			code = `update.packages(ask = FALSE)`;
		}

		await this._executeAndWait(code);
	}

	/**
	 * Uninstall one or more packages.
	 */
	async uninstallPackages(packages: string[]): Promise<void> {
		// Validate package names
		for (const pkg of packages) {
			this._validatePackageName(pkg);
		}

		const hasPak = await this._ensurePakChecked();
		const pkgList = packages.map(p => `"${p}"`).join(', ');

		let remove: string;
		if (hasPak) {
			remove = `pak::pkg_remove(c(${pkgList}))`;
		} else {
			remove = `remove.packages(c(${pkgList}))`;
		}

		// Try to unload removed packages from the session (best effort)
		const code = [
			'local({',
			remove,
			`for (pkg in c(${pkgList})) {`,
			'try(unloadNamespace(pkg), silent = TRUE)',
			'}',
			'})'
		].join('\n');
		await this._executeAndWait(code);
	}

	/**
	 * Search repo for packages matching the query.
	 */
	async searchPackages(query: string): Promise<positron.LanguageRuntimePackage[]> {
		const hasPak = await this._ensurePakChecked();

		if (hasPak) {
			// Use pak's search directly - it's fast and returns relevant results
			// Sanitize query: remove quotes and backslashes that could break R string
			const sanitizedQuery = query.replace(/["\\]/g, '');
			const code = [
				'local({',
				'old_opt <- options(pak.no_extra_messages = TRUE)',
				'on.exit(options(old_opt), add = TRUE)',
				`pkgs <- pak::pkg_search("${sanitizedQuery}", size = 100)`,
				'cat(jsonlite::toJSON(data.frame(',
				'id = pkgs$package,',
				'name = pkgs$package,',
				'displayName = pkgs$package,',
				'version = "0"',
				'), auto_unbox = TRUE))',
				'})'
			].join('\n');
			const result = await this._executeAndCapture(code);
			if (!result || result.trim() === '') {
				return [];
			}
			return JSON.parse(result);
		} else {
			// Base R: query available.packages() directly (R handles caching)
			const sanitizedQuery = query.replace(/["\\]/g, '');
			const code = [
				'local({',
				`query <- tolower("${sanitizedQuery}")`,
				'ap <- available.packages()',
				'matches <- ap[grepl(query, tolower(ap[, "Package"]), fixed = TRUE), , drop = FALSE]',
				'cat(jsonlite::toJSON(data.frame(',
				'id = matches[, "Package"],',
				'name = matches[, "Package"],',
				'displayName = matches[, "Package"],',
				'version = "0"',
				'), auto_unbox = TRUE))',
				'})'
			].join('\n');
			const result = await this._executeAndCapture(code);
			if (!result || result.trim() === '') {
				return [];
			}
			return JSON.parse(result);
		}
	}

	/**
	 * Get available versions of a specific package.
	 * Returns the current version from configured repos.
	 *
	 * TODO: Add support for historical versions from repo archive.
	 */
	async searchPackageVersions(name: string): Promise<string[]> {
		this._validatePackageName(name);

		// Use R's configured repos (respects user settings and pak configuration)
		const code = [
			'local({',
			`pkg <- "${name}"`,
			'ap <- available.packages()',
			'current <- if (pkg %in% rownames(ap)) ap[pkg, "Version"] else character(0)',
			'cat(jsonlite::toJSON(current))',
			'})'
		].join('\n');

		try {
			const result = await this._executeAndCapture(code);
			if (!result || result.trim() === '' || result.trim() === '[]') {
				return [];
			}
			return JSON.parse(result);
		} catch {
			// Return empty if we can't get versions
			return [];
		}
	}

	// =========================================================================
	// Private helper methods
	// =========================================================================

	/**
	 * Execute R code and capture the output (for queries).
	 * Uses Silent mode so output doesn't appear in console.
	 */
	private async _executeAndCapture(code: string): Promise<string> {
		const id = randomUUID();
		let output = '';

		const promise = new Promise<string>((resolve, reject) => {
			const disp = this._session.onDidReceiveRuntimeMessage((msg) => {
				if (msg.parent_id !== id) {
					return;
				}

				// cat() output comes through as Stream messages
				if (msg.type === positron.LanguageRuntimeMessageType.Stream) {
					const streamMsg = msg as positron.LanguageRuntimeStream;
					if (streamMsg.name === positron.LanguageRuntimeStreamName.Stdout) {
						output += streamMsg.text;
					}
				}

				// Also check Output messages for rich output
				if (msg.type === positron.LanguageRuntimeMessageType.Output) {
					const outputMsg = msg as positron.LanguageRuntimeOutput;
					if (outputMsg.data['text/plain']) {
						output += outputMsg.data['text/plain'];
					}
				}

				if (msg.type === positron.LanguageRuntimeMessageType.State) {
					const stateMsg = msg as positron.LanguageRuntimeState;
					if (stateMsg.state === positron.RuntimeOnlineState.Idle) {
						resolve(output);
						disp.dispose();
					}
				}

				if (msg.type === positron.LanguageRuntimeMessageType.Error) {
					const errorMsg = msg as positron.LanguageRuntimeError;
					reject(new Error(errorMsg.message));
					disp.dispose();
				}
			});
		});

		this._session.execute(
			code,
			id,
			positron.RuntimeCodeExecutionMode.Transient,
			positron.RuntimeErrorBehavior.Stop
		);

		return promise;
	}

	/**
	 * Execute R code and wait for completion (for mutations).
	 * Uses Interactive mode so output appears in console.
	 */
	private async _executeAndWait(code: string): Promise<void> {
		const id = randomUUID();

		const promise = new Promise<void>((resolve) => {
			const disp = this._session.onDidReceiveRuntimeMessage((msg) => {
				if (msg.parent_id !== id) {
					return;
				}

				if (msg.type === positron.LanguageRuntimeMessageType.State) {
					const stateMsg = msg as positron.LanguageRuntimeState;
					if (stateMsg.state === positron.RuntimeOnlineState.Idle) {
						resolve();
						disp.dispose();
					}
				}
			});
		});

		this._session.execute(
			code,
			id,
			positron.RuntimeCodeExecutionMode.Interactive,
			positron.RuntimeErrorBehavior.Continue
		);

		return promise;
	}

	/**
	 * Detect if pak is available in the R session.
	 */
	private async _detectPak(): Promise<boolean> {
		const code = `cat(requireNamespace("pak", quietly = TRUE))`;
		try {
			const result = await this._executeAndCapture(code);
			return result.trim() === 'TRUE';
		} catch {
			return false;
		}
	}

	/**
	 * Prompt the user to install pak.
	 */
	private async _promptInstallPak(): Promise<boolean> {
		const result = await vscode.window.showInformationMessage(
			vscode.l10n.t('The pak package provides faster and more reliable package operations. Would you like to install it?'),
			vscode.l10n.t('Install pak'),
			vscode.l10n.t('Not now')
		);
		return result === vscode.l10n.t('Install pak');
	}

	/**
	 * Check if pak is available without prompting to install.
	 */
	private async _ensurePakChecked(): Promise<boolean> {
		// TODO: It might be nice to cache this result, but pak can be installed/uninstalled during
		// a session so we need to be careful about staleness. For now we'll just check every time.
		// if (this._pakAvailable === null) {
		// 	this._pakAvailable = await this._detectPak();
		// }
		// return this._pakAvailable;
		return this._detectPak();
	}

	/**
	 * Ensure pak is available, prompting to install if needed.
	 * Returns true if pak is available after this call.
	 */
	private async _ensurePak(): Promise<boolean> {
		if (this._pakAvailable === null) {
			this._pakAvailable = await this._detectPak();
		}

		if (this._pakAvailable) {
			return true;
		}

		if (this._pakDeclined) {
			return false;
		}

		const install = await this._promptInstallPak();
		if (install) {
			await this._executeAndWait('install.packages("pak")');
			this._pakAvailable = await this._detectPak();
			return this._pakAvailable;
		} else {
			this._pakDeclined = true;
			return false;
		}
	}

	/**
	 * Validate an R package name according to CRAN requirements:
	 * - Can only consist of letters, numbers, and periods
	 * - Must start with a letter
	 * - Cannot end with a period
	 *
	 * Throws an error if the name is invalid.
	 */
	private _validatePackageName(name: string): void {
		// Pattern: starts with letter, contains only letters/numbers/periods, doesn't end with period
		if (!/^[a-zA-Z]([a-zA-Z0-9.]*[a-zA-Z0-9])?$/.test(name)) {
			throw new Error(`Invalid R package name: "${name}". Package names must start with a letter, contain only letters, numbers, and periods, and cannot end with a period.`);
		}
	}
}
