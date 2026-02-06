/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
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

	/** Cached CRAN package index (session-scoped) */
	private _cranIndexCache: positron.LanguageRuntimePackage[] | null = null;

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
		const hasPak = await this._ensurePak();
		const repo = this._getCranRepository();

		let code: string;
		if (hasPak) {
			// pak supports "pkg@version" syntax directly
			const pkgList = packages.map(p => `"${this._escapeString(p)}"`).join(', ');
			code = `pak::pkg_install(c(${pkgList}), ask = FALSE)`;
		} else {
			// base R: strip version suffix if present (not supported)
			const pkgNames = packages.map(p => p.split('@')[0]);
			const pkgList = pkgNames.map(p => `"${this._escapeString(p)}"`).join(', ');
			code = `install.packages(c(${pkgList}), repos = "${repo}")`;
		}

		await this._executeAndWait(code);
	}

	/**
	 * Update specific packages to latest versions.
	 * Package names can optionally include version using '@' syntax (e.g., "dplyr@1.1.0").
	 */
	async updatePackages(packages: string[]): Promise<void> {
		const hasPak = await this._ensurePak();
		const repo = this._getCranRepository();

		let code: string;
		if (hasPak) {
			// pak supports "pkg@version" syntax directly
			const pkgList = packages.map(p => `"${this._escapeString(p)}"`).join(', ');
			code = `pak::pkg_install(c(${pkgList}), ask = FALSE)`;
		} else {
			// base R: strip version suffix if present (not supported)
			const pkgNames = packages.map(p => p.split('@')[0]);
			const pkgList = pkgNames.map(p => `"${this._escapeString(p)}"`).join(', ');
			code = `install.packages(c(${pkgList}), repos = "${repo}")`;
		}

		await this._executeAndWait(code);
	}

	/**
	 * Update all packages with available updates.
	 */
	async updateAllPackages(): Promise<void> {
		const hasPak = await this._ensurePak();
		const repo = this._getCranRepository();

		let code: string;
		if (hasPak) {
			code = [
				'local({',
				'old_opt <- options(pak.no_extra_messages = TRUE)',
				'on.exit(options(old_opt), add = TRUE)',
				`outdated <- old.packages(repos = "${repo}")[, "Package"]`,
				'if (length(outdated) > 0) pak::pkg_install(outdated, ask = FALSE)',
				'})'
			].join('\n');
		} else {
			code = `update.packages(repos = "${repo}", ask = FALSE)`;
		}

		await this._executeAndWait(code);
	}

	/**
	 * Uninstall one or more packages.
	 */
	async uninstallPackages(packages: string[]): Promise<void> {
		const hasPak = await this._ensurePakChecked();
		const pkgList = packages.map(p => `"${this._escapeString(p)}"`).join(', ');

		let code: string;
		if (hasPak) {
			code = `pak::pkg_remove(c(${pkgList}))`;
		} else {
			code = `remove.packages(c(${pkgList}))`;
		}

		await this._executeAndWait(code);
	}

	/**
	 * Search CRAN for packages matching the query.
	 */
	async searchPackages(query: string): Promise<positron.LanguageRuntimePackage[]> {
		const hasPak = await this._ensurePakChecked();

		if (hasPak) {
			// Use pak's search directly - it's fast and returns relevant results
			const code = [
				'local({',
				'old_opt <- options(pak.no_extra_messages = TRUE)',
				'on.exit(options(old_opt), add = TRUE)',
				`pkgs <- pak::pkg_search("${this._escapeString(query)}", size = 100)`,
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
			// Base R: cache available.packages() and filter locally
			if (!this._cranIndexCache) {
				await this._refreshCranIndex();
			}
			const lowerQuery = query.toLowerCase();
			return this._cranIndexCache!.filter(pkg =>
				pkg.name.toLowerCase().includes(lowerQuery)
			);
		}
	}

	/**
	 * Get available versions of a specific package.
	 * Returns the current CRAN version.
	 */
	async searchPackageVersions(name: string): Promise<string[]> {
		const repo = this._getCranRepository();
		const escapedName = this._escapeString(name);

		const code = [
			'local({',
			`pkg <- "${escapedName}"`,
			`repo <- "${repo}"`,
			'ap <- available.packages(repos = repo)',
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
		if (this._pakAvailable === null) {
			this._pakAvailable = await this._detectPak();
		}
		return this._pakAvailable;
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
	 * Get the configured CRAN repository URL.
	 */
	private _getCranRepository(): string {
		const config = vscode.workspace.getConfiguration('positron.r');
		return config.get<string>('packageRepository', 'https://cloud.r-project.org');
	}

	/**
	 * Refresh the cached CRAN package index (used for base R fallback only).
	 */
	private async _refreshCranIndex(): Promise<void> {
		const repo = this._getCranRepository();

		const code = [
			'local({',
			`ap <- available.packages(repos = "${repo}")`,
			'cat(jsonlite::toJSON(data.frame(',
			'id = ap[, "Package"],',
			'name = ap[, "Package"],',
			'displayName = ap[, "Package"],',
			'version = "0"',
			'), auto_unbox = TRUE))',
			'})'
		].join('\n');

		const result = await this._executeAndCapture(code);
		this._cranIndexCache = JSON.parse(result);
	}

	/**
	 * Escape a string for use in R code.
	 */
	private _escapeString(str: string): string {
		return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
	}
}
