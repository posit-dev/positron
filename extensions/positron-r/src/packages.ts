/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import { LOGGER } from './extension';
import { RSession } from './session';

/**
 * R Package Manager
 *
 * Provides package management functionality for R sessions using pak as the
 * primary backend with base R fallback. Communicates with Ark via RPC methods.
 */
export class RPackageManager {
	/** Whether the pak install recommendation has been shown this session */
	private _pakRecommendationShown: boolean = false;

	constructor(private readonly _session: RSession) { }

	/**
	 * Get list of installed packages from all libpaths.
	 * @param token Optional cancellation token
	 */
	async getPackages(token?: vscode.CancellationToken): Promise<positron.LanguageRuntimePackage[]> {
		if (token?.isCancellationRequested) {
			throw new vscode.CancellationError();
		}

		const method = await this._getPackageMethod();
		const result = await this._callMethod<positron.LanguageRuntimePackage[] | null>(
			'pkg_list', token, method
		) ?? [];
		// Result is not sorted, sort packages alphabetically by name (case-insensitive)
		result.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
		return result;
	}

	/**
	 * Ask R which packages are outdated and return `latestVersion` for each.
	 * Ark's `pkg_outdated` (backed by `utils::old.packages()`) queries the
	 * user's configured repositories, so its `ReposVer` reflects what an
	 * upgrade would actually fetch. Version comparison happens in R using
	 * `numeric_version` semantics, since R package versions don't play
	 * nicely with semver -- see ark PR #625.
	 * @param packageNames Names of installed R packages to look up
	 * @param token Optional cancellation token
	 */
	async getPackageMetadata(
		packageNames: string[],
		token?: vscode.CancellationToken,
	): Promise<Map<string, Partial<positron.LanguageRuntimePackage>>> {
		const outdated = await this._getOutdatedVersions(token);

		const metadata = new Map<string, Partial<positron.LanguageRuntimePackage>>();
		for (const name of packageNames) {
			const key = name.toLowerCase();
			const latestFromArk = outdated.get(name);
			metadata.set(key, {
				outdated: outdated.has(name),
				...(latestFromArk ? { latestVersion: latestFromArk } : {}),
			});
		}

		return metadata;
	}

	/**
	 * Get detail fields for a single installed package.
	 * Returns undefined if the package is not installed or the name is empty.
	 * @param name Package name
	 * @param token Optional cancellation token
	 */
	async getPackageDetail(
		name: string,
		token?: vscode.CancellationToken,
	): Promise<Partial<positron.LanguageRuntimePackage> | undefined> {
		return this._callMethod<Partial<positron.LanguageRuntimePackage> | undefined>('pkg_detail', token, name) ?? undefined;
	}

	/**
	 * Call `pkg_outdated` and return a map of package name to latest version
	 * from the user's configured R repositories. Swallows errors -- the call
	 * hits the network and can fail transiently; outdated state will
	 * repopulate on the next refresh, and the package list stays usable.
	 */
	private async _getOutdatedVersions(token?: vscode.CancellationToken): Promise<Map<string, string>> {
		try {
			const outdated = await this._getOutdatedPackages(token);
			return new Map(outdated.map(p => [p.name, p.latestVersion]));
		} catch (err) {
			LOGGER.warn(`Failed to fetch outdated R package list: ${err}`);
			return new Map();
		}
	}

	private async _getOutdatedPackages(
		token?: vscode.CancellationToken,
	): Promise<Array<{ name: string; latestVersion: string }>> {
		const result = await this._callMethod<Array<{ name: string; latestVersion: string }> | null>(
			'pkg_outdated', token
		);
		return result ?? [];
	}

	/**
	 * Install one or more packages.
	 * @param packages Array of package install requests with name and optional version
	 * @param token Optional cancellation token
	 */
	async installPackages(packages: positron.PackageSpec[], token?: vscode.CancellationToken): Promise<void> {
		if (token?.isCancellationRequested) {
			throw new vscode.CancellationError();
		}

		// Validate package names
		for (const pkg of packages) {
			this._validatePackageName(pkg.name);
		}

		// Check if we're in an renv project
		const isRenv = await this._detectRenv();

		let code: string;
		if (isRenv) {
			// Don't pass `lock = TRUE`: the lockfile update is decoupled from the
			// install so a snapshot failure doesn't report the install as failed.
			const pkgSpecs = packages.map(p => p.version ? `${p.name}@${p.version}` : p.name);
			const pkgVector = this._formatRVector(pkgSpecs);
			code = `renv::install(${pkgVector}, prompt = FALSE)`;
		} else {
			// If we're installing pak itself, don't try to install pak as a side effect.
			const installingPak = packages.some((pkg) => pkg.name === 'pak');
			const method = await this._resolveMethod(!installingPak);

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
		}

		await this._execute(code, token);
		if (isRenv) {
			this._snapshotRenv();
		} else {
			void this._maybeRecommendPak();
		}
		this._session.invalidatePackageResourceCaches();
	}

	/**
	 * Update specific packages to latest versions.
	 * @param packages Array of package install requests with name and optional version
	 * @param token Optional cancellation token
	 */
	async updatePackages(packages: positron.PackageSpec[], token?: vscode.CancellationToken): Promise<void> {
		if (token?.isCancellationRequested) {
			throw new vscode.CancellationError();
		}

		// Validate package names
		for (const pkg of packages) {
			this._validatePackageName(pkg.name);
		}

		const isRenv = await this._detectRenv();

		let code: string;
		if (isRenv) {
			// renv::install supports "pkg@version" syntax. Don't pass `lock = TRUE`:
			// the lockfile update is decoupled from the update so a snapshot failure
			// doesn't report the update as failed.
			const pkgSpecs = packages.map(p => p.version ? `${p.name}@${p.version}` : p.name);
			const pkgVector = this._formatRVector(pkgSpecs);
			code = `renv::install(${pkgVector}, prompt = FALSE)`;
		} else {
			const method = await this._resolveMethod(true);

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
		}

		await this._execute(code, token);
		if (isRenv) {
			this._snapshotRenv();
		} else {
			void this._maybeRecommendPak();
		}
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

		// Check if we're in an renv project
		const isRenv = await this._detectRenv();

		if (isRenv) {
			// Don't pass `lock = TRUE`: the lockfile update is decoupled from the
			// update so a snapshot failure doesn't report the update as failed.
			await this._execute(`renv::update(prompt = FALSE)`, token);
			this._snapshotRenv();
		} else {
			const method = await this._resolveMethod(true);

			if (method === 'pak') {
				// Get outdated packages via RPC, then update with pak
				const outdated = await this._getOutdatedPackages(token);
				if (outdated.length > 0) {
					const pkgVector = this._formatRVector(outdated.map(p => p.name));
					await this._execute(`pak::pkg_install(${pkgVector}, ask = FALSE)`, token);
				} else {
					// TODO: notify user see https://github.com/posit-dev/positron/issues/11997
				}
			} else {
				await this._execute(`update.packages(ask = FALSE)`, token);
			}
			void this._maybeRecommendPak();
		}

		this._session.invalidatePackageResourceCaches();
	}

	/**
	 * Uninstall one or more packages.
	 * @param packageNames Array of package names to uninstall
	 * @param token Optional cancellation token
	 */
	async uninstallPackages(packageNames: string[], token?: vscode.CancellationToken): Promise<void> {
		if (token?.isCancellationRequested) {
			throw new vscode.CancellationError();
		}

		// Validate package names
		for (const pkg of packageNames) {
			this._validatePackageName(pkg);
		}

		// Check if we're in an renv project
		const isRenv = await this._detectRenv();
		const pkgVector = this._formatRVector(packageNames);

		let code: string;
		if (isRenv) {
			code = `renv::remove(${pkgVector})`;
		} else {
			const method = await this._resolveMethod(false);

			if (method === 'pak') {
				code = `pak::pkg_remove(${pkgVector})`;
			} else {
				code = `remove.packages(${pkgVector})`;
			}
		}

		await this._execute(code, token);

		// Silently unload namespaces after removal (ignore errors)
		try {
			const unloadCode = packageNames
				.map(pkg => `try(unloadNamespace("${pkg}"), silent = TRUE)`)
				.join('; ');
			await this._executeSilently(unloadCode);
		} catch {
			// Ignore errors from namespace unloading
		}

		// Update renv lockfile after removal. Decoupled from the remove operation
		// so a snapshot failure doesn't report the uninstall as failed.
		if (isRenv) {
			this._snapshotRenv();
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

		const method = await this._resolveMethod(false);
		const result = await this._callMethod<positron.LanguageRuntimePackage[] | null>(
			'pkg_search', token, query, method
		);
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
		if (token?.isCancellationRequested) {
			throw new vscode.CancellationError();
		}

		this._validatePackageName(name);
		const result = await this._callMethod<string[] | null>(
			'pkg_search_versions', token, name
		);
		return result ?? [];
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
	 * Detect if the session is running in an renv project.
	 */
	private async _detectRenv(): Promise<boolean> {
		try {
			const result = await this._session.evaluate('!is.null(renv::project())');
			return result.result === true;
		} catch {
			return false;
		}
	}

	/**
	 * Whether automatic renv snapshots after package operations are enabled.
	 * Controlled by the `packages.r.renvAutoSnapshot` setting (default: true).
	 */
	private _isAutoSnapshotEnabled(): boolean {
		return vscode.workspace.getConfiguration('packages.r').get<boolean>('renvAutoSnapshot', true);
	}

	/**
	 * Fire `renv::snapshot()` in the console to bring `renv.lock` in sync after a
	 * package operation. This is deliberately decoupled from the operation that
	 * triggered it: the snapshot runs as a visible console side effect and its
	 * success or failure does not affect the package command's result. If the
	 * snapshot errors (e.g. a read-only `renv.lock`), surface a warning
	 * notification, since the package operation itself reported success.
	 *
	 * No-op when the `packages.r.renvAutoSnapshot` setting is disabled.
	 */
	private _snapshotRenv(): void {
		if (!this._isAutoSnapshotEnabled()) {
			return;
		}

		const id = randomUUID();
		const disp = this._session.onDidReceiveRuntimeMessage((msg) => {
			if (msg.parent_id !== id) {
				return;
			}

			if (msg.type === positron.LanguageRuntimeMessageType.Error) {
				const showConsole = vscode.l10n.t('Show Console');
				void vscode.window.showWarningMessage(
					vscode.l10n.t('Failed to update the renv lockfile with renv::snapshot(). Your renv.lock file may be out of date.'),
					showConsole
				).then((selection) => {
					if (selection === showConsole) {
						void vscode.commands.executeCommand('workbench.panel.positronConsole.focus');
					}
				});
				disp.dispose();
			} else if (msg.type === positron.LanguageRuntimeMessageType.State) {
				const stateMsg = msg as positron.LanguageRuntimeState;
				if (stateMsg.state === positron.RuntimeOnlineState.Idle) {
					disp.dispose();
				}
			}
		});

		this._session.execute(
			'renv::snapshot(prompt = FALSE)',
			id,
			positron.RuntimeCodeExecutionMode.NonInteractive,
			positron.RuntimeErrorBehavior.Continue
		);
	}

	/**
	 * Read the configured R packages installer preference.
	 * 'auto' means: use pak if installed, otherwise use base R and recommend pak (non-blocking).
	 * 'pak' means: prefer pak, install it without prompting when missing.
	 * 'base' means: never use or install pak.
	 */
	private _getConfiguredInstaller(): 'auto' | 'pak' | 'base' {
		const value = vscode.workspace.getConfiguration('packages.r').get<string>('installer');
		return value === 'pak' || value === 'base' ? value : 'auto';
	}

	/**
	 * Get the method string for package listing (renv > resolved method).
	 */
	private async _getPackageMethod(): Promise<string> {
		if (await this._detectRenv()) {
			return 'renv';
		}
		return this._resolveMethod(false);
	}

	/**
	 * Recommend installing pak after a package operation, without blocking it.
	 *
	 * Shown at most once per session and only when pak would be preferred
	 * ('auto' setting) but is not installed. The notification is fired after the
	 * operation completes so it never blocks the package command -- a blocking
	 * prompt can hang when notifications are filtered (e.g. Do Not Disturb),
	 * which is the bug this replaces (see #14195).
	 *
	 * - "Install pak" installs pak so subsequent operations use it.
	 * - "Open Settings" reveals the `packages.r.installer` setting so the user
	 *   can choose base R themselves rather than having a consequential setting
	 *   changed silently on their behalf.
	 * - Dismissing leaves everything untouched; the recommendation may return
	 *   in a later session.
	 */
	private async _maybeRecommendPak(): Promise<void> {
		if (this._pakRecommendationShown) {
			return;
		}
		// Only 'auto' recommends: 'pak' installs silently, 'base' has opted out.
		if (this._getConfiguredInstaller() !== 'auto') {
			return;
		}
		if (await this._detectPak()) {
			return;
		}

		// Guard before awaiting so a concurrent operation doesn't double-prompt.
		this._pakRecommendationShown = true;

		const install = vscode.l10n.t('Install pak');
		const openSettings = vscode.l10n.t('Open Settings');
		const result = await vscode.window.showInformationMessage(
			vscode.l10n.t('The pak package provides faster and more reliable package operations. Would you like to install it?'),
			install,
			openSettings
		);

		if (result === install) {
			await this._execute('install.packages("pak")');
			this._session.invalidatePackageResourceCaches();
		} else if (result === openSettings) {
			// Open the installer setting so the user can opt out (e.g. base R)
			// themselves, rather than changing a consequential setting for them.
			await vscode.commands.executeCommand('workbench.action.openSettings', '@id:packages.r.installer');
		}
		// Dismissing the notification does nothing; the session guard above
		// prevents re-prompting until the next session.
	}

	/**
	 * Resolve which installer to use, honoring the `packages.r.installer` setting.
	 *
	 * @param allowInstallPak When true (install/update operations), may silently
	 *                       install pak when the setting is 'pak'. When false
	 *                       (list/search/uninstall), only detects what is
	 *                       available. The 'auto' setting never installs pak
	 *                       here; it falls back to base R and a non-blocking
	 *                       recommendation is shown after the operation (see
	 *                       _maybeRecommendPak).
	 */
	private async _resolveMethod(allowInstallPak: boolean): Promise<string> {
		const setting = this._getConfiguredInstaller();
		if (setting === 'base') {
			return 'base';
		}

		if (await this._detectPak()) {
			return 'pak';
		}

		if (!allowInstallPak) {
			return 'base';
		}

		if (setting === 'pak') {
			// User opted in to pak; install without prompting.
			await this._execute('install.packages("pak")');
			return (await this._detectPak()) ? 'pak' : 'base';
		}

		// setting === 'auto': use base R now;
		return 'base';
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
	private async _execute(code: string, token?: vscode.CancellationToken): Promise<void> {
		const id = randomUUID();

		const promise = new Promise<void>((resolve, reject) => {
			// Register cancellation handler to interrupt R execution
			const cancelDisp = token?.onCancellationRequested(async () => {
				await positron.runtime.interruptSession(this._session.metadata.sessionId);
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
	 * Call an RPC method with cancellation support.
	 * If the token is cancelled, interrupts the R session.
	 */
	private async _callMethod<T>(
		method: string,
		token: vscode.CancellationToken | undefined,
		...args: unknown[]
	): Promise<T> {
		if (token?.isCancellationRequested) {
			throw new vscode.CancellationError();
		}

		const resultPromise = this._session.callMethod(method, ...args) as Promise<T>;

		// If no token provided, just return the method result
		if (!token) {
			return resultPromise;
		}

		// Wrap `callMethod` promise with cancellation handling
		return new Promise<T>((resolve, reject) => {
			const cancelDisp = token.onCancellationRequested(async () => {
				await positron.runtime.interruptSession(this._session.metadata.sessionId);
				reject(new vscode.CancellationError());
			});

			resultPromise
				.then((result) => {
					cancelDisp.dispose();
					resolve(result);
				})
				.catch((err) => {
					cancelDisp.dispose();
					reject(err);
				});
		});
	}

	/**
	 * Execute R code silently without showing in the console.
	 * @param code The R code to execute
	 * @param token Optional cancellation token - if cancelled, interrupts the R session
	 */
	private async _executeSilently(code: string, token?: vscode.CancellationToken): Promise<void> {
		if (token?.isCancellationRequested) {
			throw new vscode.CancellationError();
		}

		const id = randomUUID();

		const promise = new Promise<void>((resolve, reject) => {
			// Register cancellation handler to interrupt R execution
			const cancelDisp = token?.onCancellationRequested(async () => {
				await positron.runtime.interruptSession(this._session.metadata.sessionId);
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
			positron.RuntimeCodeExecutionMode.Silent,
			positron.RuntimeErrorBehavior.Continue
		);

		return promise;
	}
}
