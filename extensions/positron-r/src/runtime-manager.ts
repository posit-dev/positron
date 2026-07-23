/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import * as fs from 'fs';
import { currentRBinary, getRDiscoveryRootSignature, makeMetadata, registerModuleRuntimeWithApi, rRuntimeDiscoverer } from './provider';
import { RInstallation, RMetadataExtra, ReasonDiscovered, friendlyReason, isModuleMetadata } from './r-installation';
import { RSession, createJupyterKernelExtra } from './session';
import { createJupyterKernelSpec } from './kernel-spec';
import { LOGGER, supervisorApi } from './extension';
import { POSITRON_R_INTERPRETERS_DEFAULT_SETTING_KEY } from './constants';
import { getDefaultInterpreterPath } from './interpreter-settings.js';
import { getEnvironmentModulesApi } from './provider-module.js';
import { setupArkJupyterKernel } from './kernel';
import { getRTerminalEnvironmentMutations } from './terminal-environment';
import { RSessionManager } from './session-manager';

export class RRuntimeManager implements positron.LanguageRuntimeManager {

	private readonly onDidDiscoverRuntimeEmitter = new vscode.EventEmitter<positron.LanguageRuntimeMetadata>();
	private readonly _onDidCompleteDiscoveryEmitter = new vscode.EventEmitter<void>();

	/** Whether R runtime discovery has completed */
	private _discoveryComplete = false;

	/** The number of R runtimes discovered */
	private _discoveredRuntimeCount = 0;

	constructor(private readonly _context: vscode.ExtensionContext) {
		this.onDidDiscoverRuntime = this.onDidDiscoverRuntimeEmitter.event;
		this.onDidCompleteDiscovery = this._onDidCompleteDiscoveryEmitter.event;

		// Keep the contributed terminal environment in sync with the active R
		// console. Creating or restoring a session updates it (see
		// createSession/restoreSession); this handles the case where the user
		// switches the foreground session between R consoles that are already
		// running different R versions, so a newly launched terminal matches the
		// console the user is currently working in. When multiple R consoles
		// exist, the most recently focused one wins; this ambiguity is expected
		// (https://github.com/posit-dev/positron/issues/7403).
		this._context.subscriptions.push(
			positron.runtime.onDidChangeForegroundSession(async (sessionId) => {
				if (!sessionId) {
					return;
				}
				const session = await RSessionManager.instance.getSessionById(sessionId);
				if (session) {
					this.updateEnvironment(session.runtimeMetadata);
				}
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
		// R_HOME, QUARTO_R). This ensures that extensions which start R in a
		// terminal (Quarto Preview, Shiny Run App, etc.) run against the R the
		// user selected. Apply at both process creation and shell integration so
		// the variables are present however the terminal resolves them.
		const options = { applyAtProcessCreation: true, applyAtShellIntegration: true };
		for (const mutation of getRTerminalEnvironmentMutations(metadataExtra)) {
			// Skip variables that already hold the desired value, to avoid
			// needlessly marking open terminals as stale.
			if (collection.get(mutation.variable)?.value === mutation.value) {
				continue;
			}
			switch (mutation.action) {
				case 'replace':
					collection.replace(mutation.variable, mutation.value, options);
					break;
				case 'prepend':
					collection.prepend(mutation.variable, mutation.value, options);
					break;
				case 'append':
					collection.append(mutation.variable, mutation.value, options);
					break;
			}
			LOGGER.debug(`Updated terminal environment variable ${mutation.variable} (${mutation.action}) to ${mutation.value}`);
		}

		// Update the ark Jupyter kernel spec with this R's environment.
		// This ensures that when Quarto launches ark via Jupyter, it will use
		// the same R installation as the active Positron console.
		if (metadataExtra.homepath) {
			setupArkJupyterKernel(this._context, metadataExtra.homepath);
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
