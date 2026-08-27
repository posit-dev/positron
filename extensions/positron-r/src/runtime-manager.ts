/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import * as fs from 'fs';
import { currentRBinary, getRDiscoveryRootSignature, makeMetadata, registerModuleRuntimeWithApi, rRuntimeDiscoverer } from './provider';
import { PackagerMetadata, RInstallation, RMetadataExtra, ReasonDiscovered, friendlyReason, isModuleMetadata, isRVersionsMetadata } from './r-installation';
import { RSession, createJupyterKernelExtra } from './session';
import { createJupyterKernelSpec } from './kernel-spec';
import { LOGGER, supervisorApi } from './extension';
import { POSITRON_R_INTERPRETERS_DEFAULT_SETTING_KEY } from './constants';
import { getDefaultInterpreterPath } from './interpreter-settings.js';
import { getEnvironmentModulesApi } from './provider-module.js';
import { setupArkJupyterKernel } from './kernel';
import { getRTerminalEnvironmentMutations } from './r-process-environment';
import { RSessionManager } from './session-manager';

/**
 * Extract the list of environment modules to load from an R installation's
 * packager metadata, if it is module-based. Module-discovered installations
 * carry the full list of modules; r-versions entries with a `Module:` field
 * carry a single module.
 *
 * @param packagerMetadata The packager metadata to inspect.
 * @returns The modules to load, or an empty array if not module-based.
 */
function getModulesFromMetadata(packagerMetadata: PackagerMetadata | undefined): string[] {
	if (!packagerMetadata) {
		return [];
	}
	if (isModuleMetadata(packagerMetadata)) {
		return packagerMetadata.modules;
	}
	if (isRVersionsMetadata(packagerMetadata) && packagerMetadata.module) {
		return [packagerMetadata.module];
	}
	return [];
}

export class RRuntimeManager implements positron.LanguageRuntimeManager {

	private readonly onDidDiscoverRuntimeEmitter = new vscode.EventEmitter<positron.LanguageRuntimeMetadata>();
	private readonly _onDidCompleteDiscoveryEmitter = new vscode.EventEmitter<void>();

	/** Whether R runtime discovery has completed */
	private _discoveryComplete = false;

	/** The number of R runtimes discovered */
	private _discoveredRuntimeCount = 0;

	/**
	 * The names of the environment variables most recently applied to the
	 * terminal environment collection from a module-based interpreter. Tracked
	 * so they can be removed when the active interpreter changes (or the feature
	 * is disabled), rather than clearing the whole collection, which also holds
	 * QUARTO_R and JUPYTER_PATH.
	 */
	private _appliedModuleEnvKeys = new Set<string>();

	constructor(private readonly _context: vscode.ExtensionContext) {
		this.onDidDiscoverRuntime = this.onDidDiscoverRuntimeEmitter.event;
		this.onDidCompleteDiscovery = this._onDidCompleteDiscoveryEmitter.event;

		// Keep the contributed terminal environment in sync with the active R
		// console. Creating or restoring a session updates it (see
		// createSession/restoreSession); this handles the case where the user
		// switches the foreground session between R consoles that are already
		// running different R versions, so a newly launched terminal matches the
		// console the user is currently working in. We ride the session
		// manager's console-activation event rather than the raw foreground
		// event so this inherits its console-only filtering and change
		// deduplication (notebook sessions must not drive the terminal
		// environment). When multiple R consoles exist, the most recently
		// focused one wins; this ambiguity is expected
		// (https://github.com/posit-dev/positron/issues/7403).
		this._context.subscriptions.push(
			RSessionManager.instance.onDidActivateConsoleSession((session) => {
				this.updateEnvironment(session.runtimeMetadata);
			})
		);
	}

	/**
	 * An event that fires when a new R language runtime is discovered.
	 */
	onDidDiscoverRuntime: vscode.Event<positron.LanguageRuntimeMetadata>;

	/**
	 * An event that fires when R runtime discovery has completed.
	 */
	onDidCompleteDiscovery: vscode.Event<void>;

	/**
	 * Whether R runtime discovery has completed.
	 */
	get isDiscoveryComplete(): boolean {
		return this._discoveryComplete;
	}

	/**
	 * The number of R runtimes discovered.
	 */
	get discoveredRuntimeCount(): number {
		return this._discoveredRuntimeCount;
	}

	async *discoverAllRuntimes(): AsyncGenerator<positron.LanguageRuntimeMetadata> {
		// Wrap the discoverer to track completion
		const discoverer = rRuntimeDiscoverer();
		try {
			for await (const runtime of discoverer) {
				this._discoveredRuntimeCount++;
				yield runtime;
			}
		} finally {
			this._discoveryComplete = true;
			this._onDidCompleteDiscoveryEmitter.fire();
		}
	}

	registerLanguageRuntime(runtime: positron.LanguageRuntimeMetadata): void {
		this.onDidDiscoverRuntimeEmitter.fire(runtime);
	}

	/**
	 * Snapshot the directories this extension scans for R installations. Used
	 * by Positron to detect newly-installed R interpreters between startups
	 * without having to rerun a full discovery pass. See
	 * `getRDiscoveryRootSignature` for the source list and what's excluded.
	 */
	async getDiscoveryRootSignature(): Promise<positron.RuntimeRootSignature> {
		return getRDiscoveryRootSignature();
	}

	async recommendedWorkspaceRuntime(): Promise<positron.LanguageRuntimeMetadata | undefined> {
		// If the default interpreter path is set and the path exists on the filesystem,
		// recommend it with implicit startup behavior.
		const defaultInterpreterPath = getDefaultInterpreterPath();
		if (defaultInterpreterPath) {
			if (fs.existsSync(defaultInterpreterPath)) {
				LOGGER.info(`[recommendedWorkspaceRuntime] Recommending R runtime from '${POSITRON_R_INTERPRETERS_DEFAULT_SETTING_KEY}' setting: ${defaultInterpreterPath}`);
				const inst = new RInstallation(defaultInterpreterPath, undefined, [ReasonDiscovered.userSetting]);
				return makeMetadata(inst, positron.LanguageRuntimeStartupBehavior.Implicit);
			} else {
				LOGGER.info(`[recommendedWorkspaceRuntime] Path from '${POSITRON_R_INTERPRETERS_DEFAULT_SETTING_KEY}' setting does not exist: ${defaultInterpreterPath}...cannot recommend R runtime`);
			}
		} else {
			LOGGER.debug(`[recommendedWorkspaceRuntime] '${POSITRON_R_INTERPRETERS_DEFAULT_SETTING_KEY}' setting not set...cannot recommend R runtime`);
		}
		return undefined;
	}

	async createSession(
		runtimeMetadata: positron.LanguageRuntimeMetadata,
		sessionMetadata: positron.RuntimeSessionMetadata): Promise<positron.LanguageRuntimeSession> {

		// When creating a session, we need to create a kernel spec and extra
		// data
		const metadataExtra = runtimeMetadata.extraRuntimeData as RMetadataExtra;
		const kernelExtra = createJupyterKernelExtra();
		const kernelSpec = await createJupyterKernelSpec(
			metadataExtra.homepath,
			runtimeMetadata.runtimeName,
			sessionMetadata.sessionMode,
			{
				rBinaryPath: metadataExtra.binpath,
				rArchitecture: metadataExtra.arch,
				packagerMetadata: metadataExtra.packagerMetadata
			});
		const session = new RSession(runtimeMetadata,
			sessionMetadata,
			kernelSpec,
			kernelExtra);

		// Update environment variables for the session
		this.updateEnvironment(runtimeMetadata);

		return Promise.resolve(session);
	}

	/**
	 * Update the contributed terminal environment variables for a given R
	 * runtime metadata.
	 *
	 * @param metadata The R runtime metadata
	 */
	updateEnvironment(metadata: positron.LanguageRuntimeMetadata) {
		const collection = this._context.environmentVariableCollection;

		const metadataExtra = metadata.extraRuntimeData as RMetadataExtra;
		if (!metadataExtra) {
			return;
		}

		// Contribute environment variables so that terminals launched from
		// Positron use the same R installation as the active console (PATH,
		// QUARTO_R). This ensures that extensions which start R in a
		// terminal (Quarto Preview, Shiny Run App, etc.) run against the R the
		// user selected. Apply at both process creation and shell integration so
		// the variables are present however the terminal resolves them.
		const options = { applyAtProcessCreation: true, applyAtShellIntegration: true };
		for (const mutation of getRTerminalEnvironmentMutations(metadataExtra)) {
			// Skip variables that already hold the desired value, to avoid
			// needlessly marking open terminals as stale.
			if (collection.get(mutation.name)?.value === mutation.value) {
				continue;
			}
			switch (mutation.action) {
				case 'replace':
					collection.replace(mutation.name, mutation.value, options);
					break;
				case 'prepend':
					collection.prepend(mutation.name, mutation.value, options);
					break;
				case 'append':
					collection.append(mutation.name, mutation.value, options);
					break;
			}
			LOGGER.debug(`Updated terminal environment variable ${mutation.name} (${mutation.action}) to ${mutation.value}`);
		}

		// Update the ark Jupyter kernel spec with this R's environment.
		// This ensures that when Quarto launches ark via Jupyter, it will use
		// the same R installation as the active Positron console.
		if (metadataExtra.homepath) {
			setupArkJupyterKernel(this._context, metadataExtra.homepath);
		}

		// If this R comes from an environment module, capture the environment
		// variables the module sets and apply them to terminals so tools launched
		// there (Shiny, Quarto preview, etc.) use the same R as the console. This
		// runs asynchronously since it involves launching a shell; the terminal
		// environment collection persists and open terminals get a relaunch
		// indicator when it changes.
		void this.applyModuleTerminalEnvironment(collection, metadataExtra.packagerMetadata);
	}

	/**
	 * Capture and apply the environment variables contributed by a module-based
	 * interpreter to the terminal environment collection. Removes any variables
	 * applied for a previous interpreter first, and is a no-op (beyond that
	 * cleanup) when the feature is disabled or the interpreter is not
	 * module-based.
	 *
	 * @param collection The terminal environment variable collection to mutate.
	 * @param packagerMetadata The active interpreter's packager metadata, if any.
	 */
	private async applyModuleTerminalEnvironment(
		collection: vscode.EnvironmentVariableCollection,
		packagerMetadata: PackagerMetadata | undefined
	): Promise<void> {
		// Remove any variables applied for a previously-active interpreter. The
		// collection is keyed by variable name, so a stale variable no longer set
		// by the new interpreter would otherwise linger.
		for (const key of this._appliedModuleEnvKeys) {
			collection.delete(key);
		}
		this._appliedModuleEnvKeys.clear();
		collection.description = undefined;

		// Environment modules are only supported on Linux.
		if (process.platform !== 'linux') {
			return;
		}

		// Respect the setting that guards this behavior.
		const applyToTerminals = vscode.workspace
			.getConfiguration('positron.environmentModules')
			.get<boolean>('applyToTerminals', true);
		if (!applyToTerminals) {
			return;
		}

		const modules = getModulesFromMetadata(packagerMetadata);
		if (modules.length === 0) {
			return;
		}

		const api = await getEnvironmentModulesApi();
		if (!api) {
			return;
		}

		let captured;
		try {
			captured = await api.captureEnvironmentVariables(modules);
		} catch (error) {
			LOGGER.warn(`Failed to capture module environment for terminals: ${error}`);
			return;
		}

		// Apply these only via shell integration, not at process creation. The
		// supervisor reads terminal environment contributions and applies them to
		// kernel processes; if these were applied at process creation they would
		// be layered on top of the `module load` startup command the kernel
		// already runs, double-applying the module environment (and leaking this
		// R interpreter's module environment into other-language kernels). Kernels
		// get their module environment from the startup command instead; these
		// contributions are for interactive terminals only. See
		// getEnvironmentContributions in mainThreadEnvironment.ts, which skips
		// mutators that opt out of process creation.
		const options = { applyAtProcessCreation: false, applyAtShellIntegration: true };
		for (const v of captured) {
			switch (v.action) {
				case 'prepend':
					collection.prepend(v.name, v.value, options);
					break;
				case 'append':
					collection.append(v.name, v.value, options);
					break;
				default:
					collection.replace(v.name, v.value, options);
					break;
			}
			this._appliedModuleEnvKeys.add(v.name);
		}

		if (captured.length > 0) {
			collection.description = vscode.l10n.t(
				'Environment from modules: {0}', modules.join(', ')
			);
			LOGGER.info(
				`Applied ${captured.length} module environment variable(s) to terminals ` +
				`for modules [${modules.join(', ')}]: ${captured.map(v => v.name).join(', ')}`
			);
		}
	}

	async validateMetadata(metadata: positron.LanguageRuntimeMetadata): Promise<positron.LanguageRuntimeMetadata> {
		const metadataExtra = metadata.extraRuntimeData as RMetadataExtra;

		// Validate that the metadata has all of the extra data we need
		if (!metadataExtra) {
			throw new Error('R metadata is missing extra fields needed for validation');
		}
		if (!metadataExtra.homepath) {
			throw new Error('R metadata is missing home path');
		}
		if (!metadataExtra.binpath) {
			throw new Error('R metadata is missing bin path');
		}
		// metadataExtra.scriptpath may not exist yet and will be constructed via makeMetadata.

		// Look for the current R binary. Note that this can return undefined,
		// if there are no current/default R installations on the system. This
		// is okay.
		const curBin = await currentRBinary();

		let inst: RInstallation;
		if (curBin && metadataExtra.current) {
			// If the metadata says that it represents the "current" version of R, interpret that to
			// mean the current "current" version of R, at this very moment, not whatever it was
			// when this metadata was stored.
			// The motivation for this mindset is immediate launch of an affiliated runtime.
			// More thoughts in this issue:
			// https://github.com/posit-dev/positron/issues/2659
			curBin.reasons.unshift(ReasonDiscovered.affiliated);
			inst = new RInstallation(curBin.path, true, curBin.reasons, metadataExtra.packagerMetadata);
		} else {
			inst = new RInstallation(metadataExtra.binpath, curBin?.path === metadataExtra.binpath, [ReasonDiscovered.affiliated], metadataExtra.packagerMetadata);
		}

		// Check the installation for validity
		if (!inst.usable) {

			// Possible future improvement:
			//
			// It'd be helpful to select and return a valid installation if it's
			// available and reasonably compatible with the installation we were
			// asked for. This is probably going to be common for cases wherein
			// R is upgraded in place.
			throw new Error(`R installation at ${metadataExtra.binpath} is not usable. Reason: ${friendlyReason(inst.reasonRejected)}`);
		}

		// Looks like a valid R installation.
		return Promise.resolve(makeMetadata(inst, positron.LanguageRuntimeStartupBehavior.Immediate));
	}

	/**
	 * Validate an existing session for a Jupyter-compatible kernel.
	 *
	 * @param sessionId The session ID to validate
	 * @returns True if the session is valid, false otherwise
	 */
	async validateSession(sessionId: string): Promise<boolean> {
		const api = await supervisorApi();
		return await api.validateSession(sessionId);
	}

	restoreSession(
		runtimeMetadata: positron.LanguageRuntimeMetadata,
		sessionMetadata: positron.RuntimeSessionMetadata,
		sessionName: string): Thenable<positron.LanguageRuntimeSession> {

		// When restoring an existing session, the kernelspec is stored.
		const session = new RSession(runtimeMetadata, sessionMetadata, undefined, undefined, sessionName);

		this.updateEnvironment(runtimeMetadata);

		return Promise.resolve(session);
	}
}
