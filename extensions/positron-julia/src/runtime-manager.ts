/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';

import { LOGGER } from './extension';
import { juliaRuntimeDiscoverer } from './provider';
import { JuliaSession } from './session';
import { JuliaInstallation } from './julia-installation';
import { createJuliaRuntimeMetadata } from './runtime';

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
		const installation = this._installations.get(runtimeMetadata.runtimeId);
		if (!installation) {
			throw new Error(`Julia installation not found for runtime ${runtimeMetadata.runtimeId}`);
		}

		LOGGER.info(`Creating Julia session for ${runtimeMetadata.runtimeName}`);
		return new JuliaSession(
			runtimeMetadata,
			sessionMetadata,
			installation
		);
	}

	/**
	 * Restores an existing Julia session.
	 */
	async restoreSession(
		runtimeMetadata: positron.LanguageRuntimeMetadata,
		sessionMetadata: positron.RuntimeSessionMetadata
	): Promise<positron.LanguageRuntimeSession> {
		// For now, restoring a session creates a new one
		// TODO: Implement proper session restoration
		LOGGER.info(`Restoring Julia session for ${runtimeMetadata.runtimeName}`);
		return this.createSession(runtimeMetadata, sessionMetadata);
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
