/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import * as semver from 'semver';

import { LOGGER, supervisorApi } from './extension';
import { juliaRuntimeDiscoverer } from './provider';
import { JuliaSession } from './session';
import { JuliaInstallation, ReasonDiscovered } from './julia-installation';
import { createJuliaRuntimeMetadata } from './runtime';
import { createJuliaKernelSpec } from './kernel-spec';

/**
 * Extra runtime data stored in Julia runtime metadata.
 */
interface JuliaExtraRuntimeData {
	homepath: string;
	arch: string;
}

/**
 * Manages Julia runtimes for Positron.
 */
export class JuliaRuntimeManager implements positron.LanguageRuntimeManager {

	private readonly _context: vscode.ExtensionContext;

	/** Map of runtime ID to Julia installation */
	private readonly _installations = new Map<string, JuliaInstallation>();

	/** Recommended runtime for the current workspace */
	private _recommendedRuntime: positron.LanguageRuntimeMetadata | undefined;

	/**
	 * Returns the recommended runtime for the current workspace.
	 */
	recommendedWorkspaceRuntime(): Thenable<positron.LanguageRuntimeMetadata | undefined> {
		return Promise.resolve(this._recommendedRuntime);
	}

	constructor(context: vscode.ExtensionContext) {
		this._context = context;
	}

	/**
	 * Gets a Julia installation from the cache or reconstructs it from runtime metadata.
	 * This is needed because session restoration may happen before runtime discovery completes.
	 */
	private getOrReconstructInstallation(
		runtimeMetadata: positron.LanguageRuntimeMetadata
	): JuliaInstallation {
		// First, try to get from the cache
		const cached = this._installations.get(runtimeMetadata.runtimeId);
		if (cached) {
			return cached;
		}

		// Otherwise, reconstruct from runtime metadata
		const extraData = runtimeMetadata.extraRuntimeData as JuliaExtraRuntimeData;
		if (!extraData?.homepath) {
			throw new Error(`Cannot reconstruct Julia installation: missing extraRuntimeData`);
		}

		LOGGER.debug(`Reconstructing Julia installation from metadata for ${runtimeMetadata.runtimeName}`);
		const parsedVersion = semver.parse(runtimeMetadata.languageVersion);
		if (!parsedVersion) {
			throw new Error(`Cannot parse Julia version: ${runtimeMetadata.languageVersion}`);
		}
		return {
			binpath: runtimeMetadata.runtimePath,
			homepath: extraData.homepath,
			version: runtimeMetadata.languageVersion,
			semVersion: parsedVersion,
			arch: extraData.arch || process.arch,
			current: false,
			reasonDiscovered: ReasonDiscovered.PATH,
		};
	}

	/**
	 * Discovers all available Julia runtimes on the system.
	 */
	async* discoverAllRuntimes(): AsyncGenerator<positron.LanguageRuntimeMetadata> {
		LOGGER.info('Discovering Julia runtimes...');

		for await (const installation of juliaRuntimeDiscoverer()) {
			const metadata = createJuliaRuntimeMetadata(installation);
			this._installations.set(metadata.runtimeId, installation);
			LOGGER.info(`Discovered Julia ${installation.version} at ${installation.binpath}`);
			yield metadata;
		}
	}

	/**
	 * Creates a new Julia session for the given runtime.
	 */
	async createSession(
		runtimeMetadata: positron.LanguageRuntimeMetadata,
		sessionMetadata: positron.RuntimeSessionMetadata
	): Promise<positron.LanguageRuntimeSession> {
		const installation = this.getOrReconstructInstallation(runtimeMetadata);

		// Create the kernel spec for a new session
		const kernelSpec = createJuliaKernelSpec(installation);

		LOGGER.info(`Creating Julia session for ${runtimeMetadata.runtimeName}`);
		return new JuliaSession(
			runtimeMetadata,
			sessionMetadata,
			installation,
			kernelSpec
		);
	}

	/**
	 * Restores an existing Julia session.
	 * When restoring, we don't pass a kernel spec so the session reconnects
	 * to the existing kernel rather than starting a new one.
	 */
	async restoreSession(
		runtimeMetadata: positron.LanguageRuntimeMetadata,
		sessionMetadata: positron.RuntimeSessionMetadata,
		sessionName: string
	): Promise<positron.LanguageRuntimeSession> {
		const installation = this.getOrReconstructInstallation(runtimeMetadata);

		LOGGER.info(`Restoring Julia session for ${runtimeMetadata.runtimeName}`);
		// Don't pass kernelSpec so the session will reconnect to the existing kernel
		return new JuliaSession(
			runtimeMetadata,
			sessionMetadata,
			installation,
			undefined,  // No kernel spec for restore
			sessionName
		);
	}

	/**
	 * Validates an existing session to check if it can be restored.
	 *
	 * @param sessionId The session ID to validate
	 * @returns True if the session is valid and can be restored, false otherwise
	 */
	async validateSession(sessionId: string): Promise<boolean> {
		const api = await supervisorApi();
		return await api.validateSession(sessionId);
	}

	/**
	 * Validates session metadata to check if a session can be restored.
	 */
	async validateMetadata(
		metadata: positron.LanguageRuntimeMetadata
	): Promise<positron.LanguageRuntimeMetadata> {
		// Return metadata as-is for now
		// TODO: Validate that the Julia installation still exists
		return metadata;
	}
}
