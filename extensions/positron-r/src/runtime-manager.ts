/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import * as fs from 'fs';
import { currentRBinary, makeMetadata, rRuntimeDiscoverer } from './provider';
import { RInstallation, RMetadataExtra, ReasonDiscovered, friendlyReason } from './r-installation';
import { RSession, createJupyterKernelExtra } from './session';
import { createJupyterKernelSpec } from './kernel-spec';
import { LOGGER, supervisorApi } from './extension';
import { POSITRON_R_INTERPRETERS_DEFAULT_SETTING_KEY } from './constants';
import { getDefaultInterpreterPath } from './interpreter-settings.js';
import { dirname } from 'path';

export class RRuntimeManager implements positron.LanguageRuntimeManager {

	private readonly onDidDiscoverRuntimeEmitter = new vscode.EventEmitter<positron.LanguageRuntimeMetadata>();

	constructor(private readonly _context: vscode.ExtensionContext) {
		this.onDidDiscoverRuntime = this.onDidDiscoverRuntimeEmitter.event;
	}

	/**
	 * An event that fires when a new R language runtime is discovered.
	 */
	onDidDiscoverRuntime: vscode.Event<positron.LanguageRuntimeMetadata>;

	discoverAllRuntimes(): AsyncGenerator<positron.LanguageRuntimeMetadata> {
		return rRuntimeDiscoverer();
	}

	registerLanguageRuntime(runtime: positron.LanguageRuntimeMetadata): void {
		this.onDidDiscoverRuntimeEmitter.fire(runtime);
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

	createSession(
		runtimeMetadata: positron.LanguageRuntimeMetadata,
		sessionMetadata: positron.RuntimeSessionMetadata): Thenable<positron.LanguageRuntimeSession> {

		// When creating a session, we need to create a kernel spec and extra
		// data
		const metadataExtra = runtimeMetadata.extraRuntimeData as RMetadataExtra;
		const kernelExtra = createJupyterKernelExtra();
		const kernelSpec = createJupyterKernelSpec(
			metadataExtra.homepath,
			runtimeMetadata.runtimeName,
			sessionMetadata.sessionMode,
			{
				rBinaryPath: metadataExtra.binpath,
				rArchitecture: metadataExtra.arch
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
		if (!metadataExtra || !metadataExtra.scriptpath) {
			return;
		}

		// Update the QUARTO_R environment variable to point to the script path
		// of the R runtime, if needed. Note that our 'scriptpath' is the full
		// path to the Rscript binary (foo/bar/Rscript), but Quarto expects the
		// directory (foo/bar)
		const currentQuartoR = collection.get('QUARTO_R');
		const scriptPath = dirname(metadataExtra.scriptpath);
		if (currentQuartoR?.value !== scriptPath) {
			collection.replace('QUARTO_R', scriptPath);
			LOGGER.debug(`Updated QUARTO_R environment variable to ${scriptPath}`);
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
			inst = new RInstallation(curBin.path, true, curBin.reasons);
		} else {
			inst = new RInstallation(metadataExtra.binpath, curBin?.path === metadataExtra.binpath, [ReasonDiscovered.affiliated]);
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
