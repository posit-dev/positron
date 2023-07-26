/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { ILogService } from 'vs/platform/log/common/log';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { ILanguageRuntime, ILanguageRuntimeService, RuntimeState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

/**
 * The LanguageRuntimeWorkspaceAffiliation class is responsible for managing the
 * affiliation between language runtimes and workspaces, in the service of
 * ensuring that the correct runtime is started when opening each workspace.
 *
 * It works by storing the runtime ID of the affiliated runtime in the workspace
 * storage. When a new runtime is registered, it checks to see if the runtime is
 * affiliated with the current workspace, and if so, starts the runtime.
 *
 * When runtimes become active, they are affiliated with the current workspace;
 * manually shutting down a runtime removes the affiliation.
 */
export class LanguageRuntimeWorkspaceAffiliation extends Disposable {
	private readonly storageKey = 'positron.affiliatedRuntimeId';

	constructor(
		@ILanguageRuntimeService private readonly _runtimeService: ILanguageRuntimeService,
		@IStorageService private readonly _storageService: IStorageService,
		@ILogService private readonly _logService: ILogService) {

		super();

		this._register(
			this._runtimeService.onDidChangeActiveRuntime(this.onDidChangeActiveRuntime, this));
		this._register(
			this._runtimeService.onDidRegisterRuntime(this.onDidRegisterRuntime, this));
	}

	/**
	 * Runs as an event handler when the active runtime changes.
	 *
	 * @param runtime The newly active runtime, or undefined if no runtime is active.
	 */
	private onDidChangeActiveRuntime(runtime: ILanguageRuntime | undefined): void {
		// Ignore if we are entering a state in which no runtime is active.
		if (!runtime) {
			return;
		}

		// Save this runtime as the affiliated runtime for the current workspace.
		this._storageService.store(this.storageKeyForRuntime(runtime),
			runtime.metadata.runtimeId,
			StorageScope.WORKSPACE,
			StorageTarget.MACHINE);

		// If the runtime is exiting, remove the affiliation if it enters the
		// `Exiting` state. This state only occurs when the runtime is manually
		// shut down, so may represent a user's intent to stop using the runtime
		// for this workspace.
		this._register(runtime.onDidChangeRuntimeState((newState) => {
			if (newState === RuntimeState.Exiting) {
				// Just to be safe, check that the runtime is still affiliated
				// before removing the affiliation
				const affiliatedRuntimeId = this._storageService.get(
					this.storageKeyForRuntime(runtime), StorageScope.WORKSPACE);
				if (runtime.metadata.runtimeId === affiliatedRuntimeId) {
					// Remove the affiliation
					this._storageService.remove(this.storageKeyForRuntime(runtime),
						StorageScope.WORKSPACE);
				}
			}
		}));
	}

	/**
	 * Runs as an event handler when a new runtime is registered; checks to see
	 * if the runtime is affiliated with this workspace, and if so, starts the
	 * runtime.
	 *
	 * @param runtime The newly registered runtime.
	 */
	private onDidRegisterRuntime(runtime: ILanguageRuntime): void {

		// Get the runtime ID that is affiliated with this workspace, if any.
		const affiliatedRuntimeId = this._storageService.get(
			this.storageKeyForRuntime(runtime), StorageScope.WORKSPACE);

		// If the runtime is affiliated with this workspace, start it.
		if (runtime.metadata.runtimeId === affiliatedRuntimeId) {
			this._logService.debug(`Starting affiliated runtime ${runtime.metadata.runtimeName} ` +
				` (${runtime.metadata.runtimeId}) for this workspace.`);
			try {
				this._runtimeService.startRuntime(runtime.metadata.runtimeId);
			} catch (e) {
				// This isn't necessarily an error; if another runtime took precedence and has
				// already started for this workspace, we don't want to start this one.
				this._logService.debug(`Did not start affiliated runtime ` +
					`${runtime.metadata.runtimeName} for this workspace: ` +
					`${e.message}`);
			}
		}
	}

	/**
	 * Get the runtime ID affiliated with the given language ID.
	 *
	 * @param languageId The ID of the language for which to get the affiliated runtime.
	 *
	 * @returns The runtime ID.
	 */
	public getAffiliatedRuntimeId(languageId: string): string | undefined {
		return this._storageService.get(`${this.storageKey}.${languageId}`, StorageScope.WORKSPACE);
	}

	/**
	 * Convenience method for creating a storage key for a given runtime.
	 *
	 * @param runtime The runtime for which to get the storage key.
	 *
	 * @returns A string used to store the affiliated runtime ID for the given runtime.
	 */
	private storageKeyForRuntime(runtime: ILanguageRuntime): string {
		return `${this.storageKey}.${runtime.metadata.languageId}`;
	}
}
