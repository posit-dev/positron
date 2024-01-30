/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ILogService } from 'vs/platform/log/common/log';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { ILanguageRuntime, ILanguageRuntimeMetadata, ILanguageRuntimeService, RuntimeState, formatLanguageRuntimeMetadata } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

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
	private readonly storageKey = 'positron.affiliatedRuntimeMetadata';

	constructor(
		@ILanguageRuntimeService private readonly _runtimeService: ILanguageRuntimeService,
		@IStorageService private readonly _storageService: IStorageService,
		@ILogService private readonly _logService: ILogService,
		@IConfigurationService private readonly _configurationService: IConfigurationService) {

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
			JSON.stringify(runtime.metadata),
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
				const affiliatedRuntimeMetadata = this._storageService.get(
					this.storageKeyForRuntime(runtime), StorageScope.WORKSPACE);
				if (!affiliatedRuntimeMetadata) {
					return;
				}
				const affiliatedRuntimeId = JSON.parse(affiliatedRuntimeMetadata).runtimeId;
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

		// Get the runtime metadata that is affiliated with this workspace, if any.
		const affiliatedRuntimeMetadataStr = this._storageService.get(
			this.storageKeyForRuntime(runtime), StorageScope.WORKSPACE);
		if (!affiliatedRuntimeMetadataStr) {
			return;
		}
		const affiliatedRuntimeMetadata = JSON.parse(affiliatedRuntimeMetadataStr);
		const affiliatedRuntimeId = affiliatedRuntimeMetadata.runtimeId;

		// If the runtime is affiliated with this workspace, start it.
		if (runtime.metadata.runtimeId === affiliatedRuntimeId) {
			try {

				// Check the setting to see if we should be auto-starting.
				const autoStart = this._configurationService.getValue<boolean>(
					'positron.interpreters.automaticStartup');
				if (!autoStart) {
					this._logService.info(`Language runtime ` +
						`${formatLanguageRuntimeMetadata(affiliatedRuntimeMetadata)} ` +
						`is affiliated with this workspace, but won't be started because automatic ` +
						`startup is disabled in configuration.`);
					return;
				}

				this._runtimeService.startRuntime(runtime.metadata.runtimeId,
					`Affiliated runtime for workspace`);
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
	 * @returns The runtime metadata.
	 */
	public getAffiliatedRuntimeMetadata(languageId: string): ILanguageRuntimeMetadata | undefined {
		const stored = this._storageService.get(`${this.storageKey}.${languageId}`, StorageScope.WORKSPACE);
		if (!stored) {
			return undefined;
		}
		try {
			return JSON.parse(stored) as ILanguageRuntimeMetadata;
		} catch (err) {
			this._logService.error(`Error parsing JSON for ${this.storageKey}: ${err}`);
			return undefined;
		}
	}

	/**
	 * Ascertains what languages are affiliated with the current workspace.
	 *
	 * @returns An array of language IDs for which there is a runtime affiliated
	 */
	public getAffiliatedRuntimeLanguageIds(): string[] | undefined {
		// Get the keys from the storage service and find the language Ids.
		const languageIds = new Array<string>();
		const keys = this._storageService.keys(StorageScope.WORKSPACE, StorageTarget.MACHINE);
		for (const key of keys) {
			if (key.startsWith(this.storageKey)) {
				languageIds.push(key.replace(`${this.storageKey}.`, ''));
			}
		}
		return languageIds;
	}

	/**
	 * Ascertains whether a runtime (of any language) is affiliated with the
	 * current workspace.
	 *
	 * @returns True if there is a runtime affiliated with this workspace.
	 */
	public hasAffiliatedRuntime(): boolean {
		// Get the keys from the storage service and see if any of them match
		// the storage key pattern for affiliated runtimes.
		const keys = this._storageService.keys(StorageScope.WORKSPACE, StorageTarget.MACHINE);
		for (const key of keys) {
			if (key.startsWith(this.storageKey)) {
				return true;
			}
		}
		return false;
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
