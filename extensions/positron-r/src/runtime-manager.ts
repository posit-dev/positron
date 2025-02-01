/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { currentRBinary, makeMetadata, rRuntimeDiscoverer } from './provider';
import { RInstallation, RMetadataExtra, ReasonDiscovered, friendlyReason } from './r-installation';
import { RSession, createJupyterKernelExtra } from './session';
import { createJupyterKernelSpec } from './kernel-spec';

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
		// TODO: If the workspace contains an R project, we could recommend an
		// R runtime from e.g. the `DESCRIPTION` file or an renv lockfile.
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
			sessionMetadata.sessionMode);
		const session = new RSession(runtimeMetadata,
			sessionMetadata,
			this._context,
			kernelSpec,
			kernelExtra);

		return Promise.resolve(session);
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
		const config = vscode.workspace.getConfiguration('kernelSupervisor');
		if (config.get<boolean>('enable', true)) {
			const ext = vscode.extensions.getExtension('positron.positron-supervisor');
			if (!ext) {
				throw new Error('Positron Supervisor extension not found');
			}
			if (!ext.isActive) {
				await ext.activate();
			}
			return ext.exports.validateSession(sessionId);
		}

		// When not using the kernel supervisor, sessions are not
		// persisted.
		return false;
	}

	restoreSession(
		runtimeMetadata: positron.LanguageRuntimeMetadata,
		sessionMetadata: positron.RuntimeSessionMetadata): Thenable<positron.LanguageRuntimeSession> {

		// When restoring an existing session, the kernelspec is stored.
		const session = new RSession(runtimeMetadata,
			sessionMetadata,
			this._context);

		return Promise.resolve(session);
	}
}
