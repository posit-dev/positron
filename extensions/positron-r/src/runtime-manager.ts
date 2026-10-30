/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as semver from 'semver';
import { RBinary, currentRBinary, currentRInstallation, discoverRInstallationsForRecommendation, discoveredStartupBehavior, getRDiscoveryRootSignature, listedRBinary, looksLikeRProject, makeMetadata, rDefinitionOnlyRuntimes, registerModuleRuntimeWithApi, rFullSearchTriggers, rPixiRuntimeDiscoverer, rRuntimeDiscoverer } from './provider';
import { PackagerMetadata, RInstallation, RMetadataExtra, ReasonDiscovered, friendlyReason, isModuleMetadata, isRVersionsMetadata } from './r-installation';
import { RSession, createJupyterKernelExtra } from './session';
import { createJupyterKernelSpec } from './kernel-spec';
import { LOGGER, supervisorApi } from './extension';
import { POSITRON_R_INTERPRETERS_DEFAULT_SETTING_KEY } from './constants';
import { DefaultInterpreter, getDefaultInterpreter, getInterpreterDefinitionLabels, getInterpreterDefinitionPaths, isDefinitionsOnlyDiscovery } from './interpreter-settings.js';
import { getEnvironmentModulesApi, resolveModuleBinary } from './provider-module.js';
import { packagerMetadataForPath } from './packager-detection.js';
import { rVersionsMetadataForPath } from './provider-rversions.js';
import { setupArkJupyterKernel } from './kernel';
import { getRTerminalEnvironmentMutations, isROnPath } from './r-process-environment';
import { RSessionManager } from './session-manager';
import { choosePinnedR, chooseStartupR, firstListedR, InFlightLookup, listedRPath } from './startup-choice.js';
import { arePathsSameFile, followLink } from './path-utils.js';

/**
 * Whether the R binary at a path is the current R. The current R's path has
 * its symlinks followed, and a path from a setting often doesn't, such as
 * `/usr/local/bin/R` from CRAN's installer, so compare the files.
 *
 * @param curBin The current R binary, if there is one.
 * @param binpath The path to the R binary.
 */
function isCurrentR(curBin: RBinary | undefined, binpath: string): boolean {
	return curBin !== undefined && arePathsSameFile(curBin.path, binpath);
}

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

/**
 * Whether `positron.r.interpreters.default` names an environment module.
 */
function isModulePinned(): boolean {
	return getDefaultInterpreter()?.kind === 'module';
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

	/**
	 * The pinned R lookup that is running. The pinned check and the
	 * recommendation share it when Positron asks for both at once.
	 */
	private readonly _pinnedRLookup = new InFlightLookup<string | undefined, RInstallation | undefined>();

	/**
	 * Positron uses the recommendation when it needs an R runtime, but must
	 * not save it as the workspace's default: whether R starts right away is
	 * decided again in the open folder every time it opens.
	 */
	readonly recommendationIsProjectDefault = false;

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
		const discoveredPaths = new Set<string>();
		try {
			// When discovery is limited to definitions, skip all other discovery.
			const discoverer = isDefinitionsOnlyDiscovery() ? [] : rRuntimeDiscoverer();
			for await (const runtime of discoverer) {
				this._discoveredRuntimeCount++;
				discoveredPaths.add(runtime.runtimePath);
				yield runtime;
			}
			// Interpreters named in interpreters.definitions that discovery missed
			for await (const runtime of rDefinitionOnlyRuntimes(discoveredPaths)) {
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
	 * Register the R installations in the open workspace folders' Pixi
	 * environments, outside the discovery pass.
	 *
	 * Pixi runtimes are workspace-scoped and never cached, so when a warm
	 * discovery cache lets Positron skip `discoverAllRuntimes()`, nothing else
	 * registers them. Scanning just the Pixi environments keeps the discovery
	 * root signature machine-global. When a full pass runs too, registering a
	 * runtime it already registered is a no-op.
	 */
	async registerPixiRuntimes(): Promise<void> {
		// When discovery is limited to definitions, skip all other discovery.
		if (isDefinitionsOnlyDiscovery()) {
			return;
		}
		try {
			for await (const runtime of rPixiRuntimeDiscoverer()) {
				this.registerLanguageRuntime(runtime);
			}
		} catch (err) {
			LOGGER.error(`Failed to register Pixi R runtimes: ${err}`);
		}
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

	async recommendedWorkspaceRuntime(afterDiscovery?: boolean): Promise<positron.LanguageRuntimeMetadata | undefined> {
		// When discovery is limited to definitions, nothing outside them is
		// recommended. A pin is only found when it is one of them. After
		// discovery, without a defined pin, R answers with the first defined R.
		// A pinned module is never replaced by another R.
		const pinOnly = isDefinitionsOnlyDiscovery() || isModulePinned();

		// Decide here, in the folder that's open now, whether R starts right
		// away: Positron never caches the recommendation. The search's records
		// are cached and shared by every folder.
		try {
			if (afterDiscovery) {
				return await this.recommendationAfterDiscovery(await this.pinnedRInstallation());
			}
			const pinnedLookup = this.pinnedRInstallation();
			const choice = await chooseStartupR({
				pinnedR: () => pinnedLookup,
				manualStartup: vscode.workspace.getConfiguration('interpreters', { languageId: 'r' }).get<string>('startupBehavior') === 'manual',
				pinOnly,
				looksLikeRProject,
				currentR: currentRInstallation,
				fullSearchTriggers: rFullSearchTriggers,
				fullSearch: discoverRInstallationsForRecommendation,
			});
			if (!choice) {
				return undefined;
			}
			const pinned = await pinnedLookup;
			const which = choice.installation === pinned ? `the pinned R ${pinned.version}` : `R ${choice.installation.version}`;
			const when = choice.startupBehavior === 'immediate' ?
				'right away, because the folder looks like an R project' :
				'when R is needed';
			LOGGER.info(`[recommendedWorkspaceRuntime] Recommending ${which} at ${choice.installation.binpath} to start ${when}`);
			return await makeMetadata(choice.installation, choice.startupBehavior as positron.LanguageRuntimeStartupBehavior);
		} catch (err) {
			// Positron asks every language at once and waits for all of them,
			// so a throw here would lose every language's recommendation.
			LOGGER.error(`[recommendedWorkspaceRuntime] Failed to recommend an R runtime: ${err}`);
			return undefined;
		}
	}

	/**
	 * R's recommendation when Positron asks again after discovery, which it
	 * does when R has no recommendation yet: either a console had already
	 * started, so Positron didn't ask before discovery, or R recommended
	 * nothing then. The answer is the pinned R, or else the R the search lists
	 * first among the Rs Positron has registered. When discovery is limited
	 * to definitions and no defined R is pinned, the answer is the first
	 * defined R.
	 * Either starts when R is needed. Doesn't search: discovery, or the
	 * discovery cache, has registered every R by now.
	 *
	 * @param pinned The pinned R, if it can start here.
	 */
	private async recommendationAfterDiscovery(pinned: RInstallation | undefined): Promise<positron.LanguageRuntimeMetadata | undefined> {
		const implicit = positron.LanguageRuntimeStartupBehavior.Implicit;
		if (pinned) {
			LOGGER.info(`[recommendedWorkspaceRuntime] Recommending the pinned R ${pinned.version} at ${pinned.binpath} to start when R is needed`);
			return makeMetadata(pinned, implicit);
		}
		if (isModulePinned()) {
			return undefined;
		}
		const registeredRs = (await positron.runtime.getRegisteredRuntimes())
			.filter(runtime => runtime.languageId === 'r');
		if (isDefinitionsOnlyDiscovery()) {
			// Positron registers only the Rs created from definitions in this
			// mode. Take the one the first definition created.
			const defined = getInterpreterDefinitionLabels()
				.map(label => registeredRs.find(runtime => runtime.interpreterDefinition === label))
				.find(runtime => runtime !== undefined);
			if (!defined) {
				return undefined;
			}
			LOGGER.info(`[recommendedWorkspaceRuntime] Recommending the defined R '${defined.interpreterDefinition}' at ${defined.runtimePath} to start when R is needed`);
			return { ...defined, startupBehavior: implicit };
		}
		const registered = registeredRs
			.filter(runtime => !runtime.interpreterDefinition)
			.map(metadata => {
				// Another extension can register an R runtime without R's extra data.
				const extra = metadata.extraRuntimeData as RMetadataExtra | undefined;
				return {
					metadata,
					usable: true,
					current: extra?.current === true,
					arch: extra?.arch ?? '',
					semVersion: semver.coerce(metadata.languageVersion) ?? new semver.SemVer('0.0.0'),
				};
			});
		const first = firstListedR(registered);
		if (!first) {
			return undefined;
		}
		LOGGER.info(`[recommendedWorkspaceRuntime] Recommending R ${first.metadata.languageVersion} at ${first.metadata.runtimePath} to start when R is needed`);
		return { ...first.metadata, startupBehavior: implicit };
	}

	/**
	 * The R that `positron.r.interpreters.default` names, with `implicit`
	 * startup behavior. Positron writes it over the workspace's affiliated R.
	 */
	async pinnedWorkspaceRuntime(): Promise<positron.LanguageRuntimeMetadata | undefined> {
		const inst = await this.pinnedRInstallation();
		if (!inst) {
			return undefined;
		}
		LOGGER.info(`[pinnedWorkspaceRuntime] R ${inst.version} at ${inst.binpath} is pinned by '${POSITRON_R_INTERPRETERS_DEFAULT_SETTING_KEY}'`);
		return makeMetadata(inst, positron.LanguageRuntimeStartupBehavior.Implicit);
	}

	/**
	 * The R installation that `positron.r.interpreters.default` names, if that
	 * R can start here. See `choosePinnedR()`.
	 */
	private pinnedRInstallation(): Promise<RInstallation | undefined> {
		const pin = getDefaultInterpreter();
		const key = pin && (pin.kind === 'module' ? `module:${pin.module}` : pin.path);
		return this._pinnedRLookup.run(key, () => this.lookUpPinnedR(pin));
	}

	/**
	 * Looks up the pinned R installation. Use `pinnedRInstallation()`, which
	 * shares a lookup that is running.
	 *
	 * @param pin The resolved value of `positron.r.interpreters.default`.
	 */
	private async lookUpPinnedR(pin: DefaultInterpreter | undefined): Promise<RInstallation | undefined> {
		const definitionsOnly = isDefinitionsOnlyDiscovery();
		if (pin?.kind === 'module') {
			return definitionsOnly ? undefined : this.lookUpModulePinnedR(pin.module);
		}
		return choosePinnedR<RInstallation, PackagerMetadata>({
			definitionsOnly,
			pinnedPath: pin?.path,
			isDefined: binpath => {
				const defined = getInterpreterDefinitionPaths().includes(binpath);
				if (!defined) {
					LOGGER.info(`[pinnedRInstallation] Path from '${POSITRON_R_INTERPRETERS_DEFAULT_SETTING_KEY}' is not in interpreters.definitions, and discovery is limited to it: ${binpath}`);
				}
				return defined;
			},
			exists: binpath => {
				const found = fs.existsSync(binpath);
				if (!found) {
					LOGGER.warn(`[pinnedRInstallation] Path from '${POSITRON_R_INTERPRETERS_DEFAULT_SETTING_KEY}' does not exist: ${binpath}`);
				}
				return found;
			},
			currentRPath: async () => (await currentRBinary())?.path,
			isSameFile: arePathsSameFile,
			followLink,
			packagerMetadataForPath,
			listedRBinary,
			rVersionsMetadataForPath,
			install: ({ binpath, current, packagerMetadata }) => {
				const inst = new RInstallation(binpath, current, [ReasonDiscovered.userSetting], packagerMetadata);
				if (!inst.usable) {
					LOGGER.info(`[pinnedRInstallation] R at ${binpath} from '${POSITRON_R_INTERPRETERS_DEFAULT_SETTING_KEY}' is not usable. Reason: ${friendlyReason(inst.reasonRejected)}`);
				}
				return inst;
			},
		});
	}

	/**
	 * Looks up the R that a pinned environment module provides.
	 *
	 * @param name The module environment or module from `positron.r.interpreters.default`.
	 */
	private async lookUpModulePinnedR(name: string): Promise<RInstallation | undefined> {
		const rbin = await resolveModuleBinary(name);
		if (!rbin) {
			LOGGER.warn(`[pinnedRInstallation] No R starts, since the module from '${POSITRON_R_INTERPRETERS_DEFAULT_SETTING_KEY}' could not be loaded: ${name}`);
			return undefined;
		}
		const currentPath = (await currentRBinary())?.path;
		const current = currentPath !== undefined && arePathsSameFile(currentPath, rbin.path);
		const inst = new RInstallation(rbin.path, current, rbin.reasons, rbin.packagerMetadata);
		if (!inst.usable) {
			LOGGER.info(`[pinnedRInstallation] R at ${rbin.path} from module '${name}' is not usable. Reason: ${friendlyReason(inst.reasonRejected)}`);
			return undefined;
		}
		return inst;
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
		const mutations = getRTerminalEnvironmentMutations(metadataExtra, isROnPath(metadataExtra.binpath));
		// Drop a PATH entry left by a previously active R.
		if (!mutations.some(mutation => mutation.name === 'PATH')) {
			collection.delete('PATH');
		}
		for (const mutation of mutations) {
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
		// getEnvironmentContributions in mainThreadEnvironment.ts: callers that
		// spawn processes pass the ProcessCreation filter to skip these mutators.
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
		} else if (curBin && isCurrentR(curBin, metadataExtra.binpath)) {
			// A saved path that is a link to the current R, such as
			// `/usr/local/bin/R`, is built at the current R's own path, so its
			// runtime ID matches discovery's entry for the current R.
			inst = new RInstallation(curBin.path, true, [ReasonDiscovered.affiliated], metadataExtra.packagerMetadata);
		} else {
			inst = new RInstallation(metadataExtra.binpath, false, [ReasonDiscovered.affiliated], metadataExtra.packagerMetadata);
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

		// Looks like a valid R installation. Keep the saved startup behavior:
		// Positron writes the result back into the discovery cache, which every
		// folder shares.
		return makeMetadata(inst, metadata.startupBehavior);
	}

	/**
	 * Registers the R installation at a path and adds it to
	 * `positron.r.customBinaries` so future discovery finds it.
	 *
	 * @param binpath The path to the R binary.
	 * @returns The runtime metadata for the installation.
	 */
	async registerRuntimeFromPath(binpath: string): Promise<positron.LanguageRuntimeMetadata> {
		// Register at the path discovery lists for this R, so the picker
		// doesn't show it twice. See `listedRPath()`.
		const listed = listedRPath(binpath, (await currentRBinary())?.path, {
			isSameFile: arePathsSameFile,
			followLink,
			packagerMetadataForPath,
			listedRBinary,
		});
		const inst = new RInstallation(listed.binpath, listed.current, [ReasonDiscovered.userSetting], listed.condaOrPixi);
		if (!inst.usable) {
			throw new Error(`R installation at ${binpath} is not usable. Reason: ${friendlyReason(inst.reasonRejected)}`);
		}
		// Save the path as given, so a link keeps leading to the R it points
		// to after an upgrade. Discovery follows the link. On Windows, save
		// the `bin\x64\R.exe` that is registered, since discovery of saved
		// paths doesn't make that change.
		const savedPath = listedRBinary(path.normalize(binpath));
		const config = vscode.workspace.getConfiguration('positron.r');
		const binaries = config.inspect<string[]>('customBinaries')?.globalValue ?? [];
		if (!binaries.includes(savedPath)) {
			await config.update('customBinaries', [...binaries, savedPath], vscode.ConfigurationTarget.Global);
		}
		// Discovery finds this R from now on; give it the same behavior.
		return makeMetadata(inst, discoveredStartupBehavior(inst));
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
