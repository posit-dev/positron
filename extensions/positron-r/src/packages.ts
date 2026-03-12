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
 * primary backend with base R fallback. Communicates with Ark via RPC methods.
 */
export class RPackageManager {
	/** Whether the user has declined to install pak (session-scoped) */
	private _pakDeclined: boolean = false;

	constructor(private readonly _session: RSession) { }

	/**
	 * Get list of installed packages from all libpaths.
	 * @param token Optional cancellation token
	 */
	async getPackages(token?: vscode.CancellationToken): Promise<positron.LanguageRuntimePackage[]> {
		if (token?.isCancellationRequested) {
			throw new vscode.CancellationError();
		}
		const method = await this._getPakMethod();
		const result = await this._session.callMethod('pkg_list', method);
		if (token?.isCancellationRequested) {
			throw new vscode.CancellationError();
		}
		return result ?? [];
	}

	/**
	 * Install one or more packages.
	 * @param packages Array of package install requests with name and optional version
	 * @param token Optional cancellation token
	 */
	async installPackages(packages: positron.PackageSpec[], token?: vscode.CancellationToken): Promise<void> {
		// Validate package names
		for (const pkg of packages) {
			this._validatePackageName(pkg.name);
		}

		if (token?.isCancellationRequested) {
			throw new vscode.CancellationError();
		}

		// If we're installing pak, don't prompt to install pak
		let method: string;
		if (packages.some((pkg) => pkg.name === 'pak')) {
			method = await this._getPakMethod();
		} else {
			method = await this._ensurePak();
		}

		let code: string;
		if (method === 'pak') {
			// pak supports "pkg@version" syntax directly
			const pkgSpecs = packages.map(p => p.version ? `${p.name}@${p.version}` : p.name);
			const pkgVector = this._formatRVector(pkgSpecs);
			code = `pak::pkg_install(${pkgVector}, ask = FALSE)`;
		} else {
			// base R: version not supported
			const pkgNames = packages.map(p => p.name);
			const pkgVector = this._formatRVector(pkgNames);
			code = `install.packages(${pkgVector})`;
		}

		await this._executeAndWait(code, token);
		this._session.invalidatePackageResourceCaches();
	}

	/**
	 * Update specific packages to latest versions.
	 * @param packages Array of package install requests with name and optional version
	 * @param token Optional cancellation token
	 */
	async updatePackages(packages: positron.PackageSpec[], token?: vscode.CancellationToken): Promise<void> {
		// Validate package names
		for (const pkg of packages) {
			this._validatePackageName(pkg.name);
		}

		if (token?.isCancellationRequested) {
			throw new vscode.CancellationError();
		}

		const method = await this._ensurePak();

		let code: string;
		if (method === 'pak') {
			const pkgSpecs = packages.map(p => p.version ? `${p.name}@${p.version}` : p.name);
			const pkgVector = this._formatRVector(pkgSpecs);
			code = `pak::pkg_install(${pkgVector}, ask = FALSE)`;
		} else {
			// base R: version not supported
			const pkgNames = packages.map(p => p.name);
			const pkgVector = this._formatRVector(pkgNames);
			code = `install.packages(${pkgVector})`;
		}

		await this._executeAndWait(code, token);
		this._session.invalidatePackageResourceCaches();
	}

	/**
	 * Update all packages with available updates.
	 * @param token Optional cancellation token
	 */
	async updateAllPackages(token?: vscode.CancellationToken): Promise<void> {
		if (token?.isCancellationRequested) {
			throw new vscode.CancellationError();
		}

		const method = await this._ensurePak();

		if (method === 'pak') {
			// Get outdated packages via RPC, then update with pak
			const outdated = await this._session.callMethod('pkg_outdated') as string[] ?? [];
			if (token?.isCancellationRequested) {
				throw new vscode.CancellationError();
			}
			if (outdated.length > 0) {
				const pkgVector = this._formatRVector(outdated);
				await this._executeAndWait(`pak::pkg_install(${pkgVector}, ask = FALSE)`, token);
			} else {
				// TODO: notify user see https://github.com/posit-dev/positron/issues/11997
			}

		} else {
			await this._executeAndWait(`update.packages(ask = FALSE)`, token);
		}

		this._session.invalidatePackageResourceCaches();
	}

	/**
	 * Uninstall one or more packages.
	 * @param packageNames Array of package names to uninstall
	 * @param token Optional cancellation token
	 */
	async uninstallPackages(packageNames: string[], token?: vscode.CancellationToken): Promise<void> {
		// Validate package names
		for (const pkg of packageNames) {
			this._validatePackageName(pkg);
		}

		if (token?.isCancellationRequested) {
			throw new vscode.CancellationError();
		}

		const method = await this._getPakMethod();
		const pkgVector = this._formatRVector(packageNames);

		let code: string;
		if (method === 'pak') {
			code = `pak::pkg_remove(${pkgVector})`;
		} else {
			code = `remove.packages(${pkgVector})`;
		}

		await this._executeAndWait(code, token);

		// Silently unload namespaces after removal (ignore errors)
		try {
			const unloadCode = packageNames
				.map(pkg => `try(unloadNamespace("${pkg}"), silent = TRUE)`)
				.join('; ');
			await this._executeSilently(unloadCode);
		} catch {
			// Ignore errors from namespace unloading
		}

		this._session.invalidatePackageResourceCaches();
	}

	/**
	 * Search repo for packages matching the query.
	 * @param query Search query string
	 * @param token Optional cancellation token
	 */
	async searchPackages(query: string, token?: vscode.CancellationToken): Promise<positron.LanguageRuntimePackage[]> {
		if (token?.isCancellationRequested) {
			throw new vscode.CancellationError();
		}
		const method = await this._getPakMethod();
		const result = await this._session.callMethod('pkg_search', query, method);
		if (token?.isCancellationRequested) {
			throw new vscode.CancellationError();
		}
		return result ?? [];
	}

	/**
	 * Get available versions of a specific package.
	 * Returns the current version from configured repos.
	 * @param name Package name
	 * @param token Optional cancellation token
	 *
	 * TODO: Add support for historical versions from repo archive.
	 */
	async searchPackageVersions(name: string, token?: vscode.CancellationToken): Promise<string[]> {
		this._validatePackageName(name);

		if (token?.isCancellationRequested) {
			throw new vscode.CancellationError();
		}

		try {
			const result = await this._session.callMethod('pkg_search_versions', name);
			if (token?.isCancellationRequested) {
				throw new vscode.CancellationError();
			}
			return result ?? [];
		} catch (e) {
			console.log(e);
			// Return empty if we can't get versions
			return [];
		}
	}

	// =========================================================================
	// Private helper methods
	// =========================================================================

	/**
	 * Detect if pak is available in the R session.
	 */
	private async _detectPak(): Promise<boolean> {
		const pak = await this._session.packageVersion('pak', null, true);
		return pak?.compatible ?? false;
	}

	/**
	 * Get the method string based on pak availability (without prompting).
	 */
	private async _getPakMethod(): Promise<string> {
		const hasPak = await this._detectPak();
		return hasPak ? 'pak' : 'base';
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
	 * Ensure pak is available, prompting to install if needed.
	 * Returns 'pak' or 'base' depending on availability.
	 */
	private async _ensurePak(): Promise<string> {
		const hasPak = await this._detectPak();
		if (hasPak) {
			return 'pak';
		}

		if (this._pakDeclined) {
			return 'base';
		}

		const install = await this._promptInstallPak();
		if (install) {
			// Use base R to install pak
			await this._executeAndWait('install.packages("pak")');
			const nowHasPak = await this._detectPak();
			return nowHasPak ? 'pak' : 'base';
		} else {
			this._pakDeclined = true;
			return 'base';
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

	/**
	 * Format an array of strings as an R character vector.
	 */
	private _formatRVector(items: string[]): string {
		const escaped = items.map(s => `"${s.replace(/"/g, '\\"')}"`);
		return `c(${escaped.join(', ')})`;
	}

	/**
	 * Execute R code in the console and wait for completion.
	 * Uses NonInteractive mode so output appears in the console.
	 * @param code The R code to execute
	 * @param token Optional cancellation token - if cancelled, interrupts the R session
	 */
	private async _executeAndWait(code: string, token?: vscode.CancellationToken): Promise<void> {
		const id = randomUUID();

		const promise = new Promise<void>((resolve, reject) => {
			// Register cancellation handler to interrupt R execution
			const cancelDisp = token?.onCancellationRequested(() => {
				this._session.interrupt();
				reject(new vscode.CancellationError());
				disp.dispose();
			});

			const disp = this._session.onDidReceiveRuntimeMessage((msg) => {
				if (msg.parent_id !== id) {
					return;
				}

				if (msg.type === positron.LanguageRuntimeMessageType.State) {
					const stateMsg = msg as positron.LanguageRuntimeState;
					if (stateMsg.state === positron.RuntimeOnlineState.Idle) {
						resolve();
						disp.dispose();
						cancelDisp?.dispose();
					}
				}

				if (msg.type === positron.LanguageRuntimeMessageType.Error) {
					const errorMsg = msg as positron.LanguageRuntimeError;
					reject(new Error(errorMsg.message));
					disp.dispose();
					cancelDisp?.dispose();
				}
			});
		});

		this._session.execute(
			code,
			id,
			positron.RuntimeCodeExecutionMode.NonInteractive,
			positron.RuntimeErrorBehavior.Continue
		);

		return promise;
	}

	/**
	 * Execute R code silently without showing in the console.
	 */
	private async _executeSilently(code: string): Promise<void> {
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
			positron.RuntimeCodeExecutionMode.Silent,
			positron.RuntimeErrorBehavior.Continue
		);

		return promise;
	}
}
