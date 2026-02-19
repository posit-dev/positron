/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as positron from 'positron';
import * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import { RSession } from './session';
import { EXTENSION_ROOT_DIR } from './constants';

/** Path to the packages R script */
const PACKAGES_SCRIPT_PATH = path.join(EXTENSION_ROOT_DIR, 'resources', 'scripts', 'packages.R');

/**
 * R Package Manager
 *
 * Provides package management functionality for R sessions using pak as the
 * primary backend with base R fallback.
 */
export class RPackageManager {
	/** Whether the user has declined to install pak (session-scoped) */
	private _pakDeclined: boolean = false;

	constructor(private readonly _session: RSession) { }

	/**
	 * Source the packages.R script in the R session.
	 * Called at session startup to make package management functions available.
	 */
	async sourcePackagesScript(): Promise<void> {
		// Escape backslashes for Windows paths
		const escapedPath = PACKAGES_SCRIPT_PATH.replace(/\\/g, '\\\\');
		// Use Silent mode and suppress all R output to avoid showing internal
		// implementation details to the user
		await this._executeAndCapture(
			`source("${escapedPath}", echo = FALSE, print.eval = FALSE, verbose = FALSE)`,
			positron.RuntimeCodeExecutionMode.Silent
		);
	}

	/**
	 * Get list of installed packages from all libpaths.
	 */
	async getPackages(): Promise<positron.LanguageRuntimePackage[]> {
		const hasPak = await this._ensurePakChecked();
		const code = `.ps.packages.list_packages(method = "${hasPak ? 'pak' : 'base'}")`;

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


		// If we're installing pak, don't prompt to install pak
		let hasPak: boolean;
		if (packages.some((pkg) => pkg.split('@')[0] === 'pak')) {
			hasPak = await this._ensurePakChecked();
		} else {
			hasPak = await this._ensurePak();
		}

		let pkgVector: string;
		if (hasPak) {
			// pak supports "pkg@version" syntax directly
			pkgVector = this._formatPackageVector(packages);
		} else {
			// base R: strip version suffix if present (not supported)
			const pkgNames = packages.map(p => p.split('@')[0]);
			pkgVector = this._formatPackageVector(pkgNames);
		}

		const code = `.ps.packages.install_packages(${pkgVector}, method = "${hasPak ? 'pak' : 'base'}")`;
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

		let pkgVector: string;
		if (hasPak) {
			// pak supports "pkg@version" syntax directly
			pkgVector = this._formatPackageVector(packages);
		} else {
			// base R: strip version suffix if present (not supported)
			const pkgNames = packages.map(p => p.split('@')[0]);
			pkgVector = this._formatPackageVector(pkgNames);
		}

		const code = `.ps.packages.install_packages(${pkgVector}, method = "${hasPak ? 'pak' : 'base'}")`;
		await this._executeAndWait(code);
	}

	/**
	 * Update all packages with available updates.
	 */
	async updateAllPackages(): Promise<void> {
		const hasPak = await this._ensurePak();
		const code = `.ps.packages.update_all_packages(method = "${hasPak ? 'pak' : 'base'}")`;
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
		const pkgVector = this._formatPackageVector(packages);
		const code = `.ps.packages.uninstall_packages(${pkgVector}, method = "${hasPak ? 'pak' : 'base'}")`;
		await this._executeAndWait(code);
	}

	/**
	 * Search repo for packages matching the query.
	 */
	async searchPackages(query: string): Promise<positron.LanguageRuntimePackage[]> {
		const hasPak = await this._ensurePakChecked();

		// Sanitize query: remove quotes and backslashes that could break R string
		const sanitizedQuery = query.replace(/["\\]/g, '');
		const code = `.ps.packages.search_packages(${this._formatString(sanitizedQuery)}, method = "${hasPak ? 'pak' : 'base'}")`;

		const result = await this._executeAndCapture(code);
		if (!result || result.trim() === '') {
			return [];
		}
		return JSON.parse(result);
	}

	/**
	 * Get available versions of a specific package.
	 * Returns the current version from configured repos.
	 *
	 * TODO: Add support for historical versions from repo archive.
	 */
	async searchPackageVersions(name: string): Promise<string[]> {
		this._validatePackageName(name);

		const code = `.ps.packages.search_package_versions(${this._formatString(name)})`;

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
	 * Format a package list as an R character vector.
	 */
	private _formatPackageVector(packages: string[]): string {
		return `c(${packages.map(p => `"${p}"`).join(', ')})`;
	}

	/**
	 * Format a string as an R string literal.
	 */
	private _formatString(str: string): string {
		return `"${str}"`;
	}

	/**
	 * Execute R code and capture the output (for queries).
	 * Uses Transient mode by default so output doesn't appear in history.
	 */
	private async _executeAndCapture(
		code: string,
		mode: positron.RuntimeCodeExecutionMode = positron.RuntimeCodeExecutionMode.Transient
	): Promise<string> {
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
			mode,
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

		const promise = new Promise<void>((resolve, reject) => {
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
			positron.RuntimeCodeExecutionMode.Interactive,
			positron.RuntimeErrorBehavior.Continue
		);

		return promise;
	}

	/**
	 * Detect if pak is available in the R session.
	 */
	private async _detectPak(): Promise<boolean> {
		const pak = await this._session.packageVersion('pak', null, true);
		return pak?.compatible;
	}

	/**
	 * Prompt the user to install pak.
	 */
	private async _promptInstallPak(): Promise<boolean> {
		const install = vscode.l10n.t('Install pak');
		const result = await vscode.window.showInformationMessage(
			vscode.l10n.t('The pak package provides faster and more reliable package operations. Would you like to install it?'),
			install,
			vscode.l10n.t('Not now')
		);
		return result === install;
	}

	/**
	 * Check if pak is available without prompting to install.
	 */
	private async _ensurePakChecked(): Promise<boolean> {
		return this._detectPak();
	}

	/**
	 * Ensure pak is available, prompting to install if needed.
	 * Returns true if pak is available after this call.
	 */
	private async _ensurePak(): Promise<boolean> {
		const hasPak = await this._detectPak();
		if (hasPak) {
			return true;
		}

		if (this._pakDeclined) {
			return false;
		}

		const install = await this._promptInstallPak();
		if (install) {
			await this._executeAndWait('install.packages("pak")');
			return await this._detectPak();
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
