/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { ILanguageService } from 'vs/editor/common/languages/language';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { ILogService } from 'vs/platform/log/common/log';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { ILanguageRuntimeMetadata, ILanguageRuntimeService, LanguageRuntimeDiscoveryPhase, LanguageRuntimeSessionMode, LanguageRuntimeStartupBehavior, RuntimeState, formatLanguageRuntimeMetadata } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IRuntimeAffiliationService } from 'vs/workbench/services/runtimeAffiliation/common/runtimeAffliationService';
import { ILanguageRuntimeSession, IRuntimeSessionService } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';

/**
 * The RuntimeAffiliationService is responsible for managing the affiliation
 * between language runtimes and workspaces, in the service of ensuring that the
 * correct runtime is started when opening each workspace.
 *
 * It works by storing the runtime ID of the affiliated runtime in the workspace
 * storage. When a new runtime is registered, it checks to see if the runtime is
 * affiliated with the current workspace, and if so, starts the runtime.
 *
 * When runtimes become active, they are affiliated with the current workspace;
 * manually shutting down a runtime removes the affiliation.
 */
export class RuntimeAffiliationService extends Disposable {

	// Needed for service branding in dependency injector.
	declare readonly _serviceBrand: undefined;

	private readonly storageKey = 'positron.affiliatedRuntimeMetadata';

	// The current discovery phase for language runtime registration.
	private _discoveryPhase: LanguageRuntimeDiscoveryPhase =
		LanguageRuntimeDiscoveryPhase.AwaitingExtensions;

	// The set of encountered languages.
	private readonly _encounteredLanguagesByLanguageId = new Set<string>();

	// A map of most recently started runtimes. This is keyed by the languageId
	// (metadata.languageId) of the runtime.
	private readonly _mostRecentlyStartedRuntimesByLanguageId = new Map<string, ILanguageRuntimeMetadata>();

	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IExtensionService private readonly _extensionService: IExtensionService,
		@ILanguageService private readonly _languageService: ILanguageService,
		@ILanguageRuntimeService private readonly _languageRuntimeService: ILanguageRuntimeService,
		@ILogService private readonly _logService: ILogService,
		@IRuntimeSessionService private readonly _runtimeSessionService: IRuntimeSessionService,
		@IStorageService private readonly _storageService: IStorageService) {

		super();

		this._register(
			this._runtimeSessionService.onDidChangeForegroundSession(
				this.onDidChangeActiveRuntime, this));

		this._register(
			this._languageRuntimeService.onDidRegisterRuntime(
				this.onDidRegisterRuntime, this));

		// Listen for runtime start events and update the most recently started
		// runtimes for each language.
		this._register(this._runtimeSessionService.onDidStartRuntime(session => {
			this._mostRecentlyStartedRuntimesByLanguageId.set(session.metadata.languageId,
				session.metadata);
		}));

		// When the discovery phase is complete, check to see if we need to
		// auto-start a runtime.
		this._register(this._languageRuntimeService.onDidChangeDiscoveryPhase(phase => {
			if (phase === LanguageRuntimeDiscoveryPhase.Complete) {
				if (!this.hasAffiliatedRuntime() &&
					!this._runtimeSessionService.hasStartingOrRunningConsole()) {
					// If there are no affiliated runtimes, and no starting or running
					// runtimes, start the first runtime that has Immediate startup
					// behavior.
					const languageRuntimes = this._languageRuntimeService.registeredRuntimes
						.filter(metadata =>
							metadata.startupBehavior === LanguageRuntimeStartupBehavior.Immediate);
					if (languageRuntimes.length) {
						this._runtimeSessionService.autoStartRuntime(languageRuntimes[0],
							`An extension requested the runtime to be started immediately.`);
					}
				}
			}
		}));

		// Add the onDidEncounterLanguage event handler.
		this._register(this._languageService.onDidRequestRichLanguageFeatures(languageId => {
			// Add the language to the set of encountered languages.
			this._encounteredLanguagesByLanguageId.add(languageId);
		}));

		// When a runtime is registered, check to see if we need to auto-start it.
		this._register(this._languageRuntimeService.onDidRegisterRuntime(runtime => {
			// Automatically start the language runtime under the following conditions:
			// - The language runtime wants to start immediately.
			// - No other runtime is currently running.
			// - We have completed the discovery phase of the language runtime
			//   registration process.
			if (runtime.startupBehavior === LanguageRuntimeStartupBehavior.Immediate &&
				this._discoveryPhase === LanguageRuntimeDiscoveryPhase.Complete &&
				!this._runtimeSessionService.hasStartingOrRunningConsole()) {

				this._runtimeSessionService.autoStartRuntime(runtime,
					`An extension requested that the runtime start immediately after being registered.`);
			}

			// Automatically start the language runtime under the following conditions:
			// - We have encountered the language that the runtime serves.
			// - We have completed the discovery phase of the language runtime
			//   registration process.
			// - The runtime is not already starting or running.
			// - The runtime has implicit startup behavior.
			// - There's no runtime affiliated with the current workspace for this
			//   language (if there is, we want that runtime to start, not this one)
			else if (this._encounteredLanguagesByLanguageId.has(runtime.languageId) &&
				this._discoveryPhase === LanguageRuntimeDiscoveryPhase.Complete &&
				!this._runtimeSessionService.hasStartingOrRunningConsole(runtime.languageId) &&
				runtime.startupBehavior === LanguageRuntimeStartupBehavior.Implicit &&
				!this.getAffiliatedRuntimeMetadata(runtime.languageId)) {

				this._runtimeSessionService.autoStartRuntime(runtime,
					`A file with the language ID ${runtime.languageId} was open ` +
					`when the runtime was registered.`);
			}
		}));

		this._extensionService.whenAllExtensionHostsStarted().then(async () => {
			// Eagerly start affiliated runtimes when the workspace is opened.
			this.startAffiliatedLanguageRuntimes();
		});
	}

	/**
	 * Runs as an event handler when the active runtime changes.
	 *
	 * @param runtime The newly active runtime, or undefined if no runtime is active.
	 */
	private onDidChangeActiveRuntime(session: ILanguageRuntimeSession | undefined): void {
		// Ignore if we are entering a state in which no runtime is active.
		if (!session) {
			return;
		}

		// Save this runtime as the affiliated runtime for the current workspace.
		this._storageService.store(this.storageKeyForRuntime(session.metadata),
			JSON.stringify(session.metadata),
			StorageScope.WORKSPACE,
			StorageTarget.MACHINE);

		// If the runtime is exiting, remove the affiliation if it enters the
		// `Exiting` state. This state only occurs when the runtime is manually
		// shut down, so may represent a user's intent to stop using the runtime
		// for this workspace.
		this._register(session.onDidChangeRuntimeState((newState) => {
			if (newState === RuntimeState.Exiting) {
				// Just to be safe, check that the runtime is still affiliated
				// before removing the affiliation
				const affiliatedRuntimeMetadata = this._storageService.get(
					this.storageKeyForRuntime(session.metadata), StorageScope.WORKSPACE);
				if (!affiliatedRuntimeMetadata) {
					return;
				}
				const affiliatedRuntimeId = JSON.parse(affiliatedRuntimeMetadata).runtimeId;
				if (session.metadata.runtimeId === affiliatedRuntimeId) {
					// Remove the affiliation
					this._storageService.remove(this.storageKeyForRuntime(session.metadata),
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
	private onDidRegisterRuntime(metadata: ILanguageRuntimeMetadata): void {

		// Get the runtime metadata that is affiliated with this workspace, if any.
		const affiliatedRuntimeMetadataStr = this._storageService.get(
			this.storageKeyForRuntime(metadata), StorageScope.WORKSPACE);
		if (!affiliatedRuntimeMetadataStr) {
			return;
		}
		const affiliatedRuntimeMetadata = JSON.parse(affiliatedRuntimeMetadataStr);
		const affiliatedRuntimeId = affiliatedRuntimeMetadata.runtimeId;

		// If the runtime is affiliated with this workspace, start it.
		if (metadata.runtimeId === affiliatedRuntimeId) {
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

				this._runtimeSessionService.startNewRuntimeSession(metadata.runtimeId,
					metadata.runtimeName,
					LanguageRuntimeSessionMode.Console,
					`Affiliated runtime for workspace`);
			} catch (e) {
				// This isn't necessarily an error; if another runtime took precedence and has
				// already started for this workspace, we don't want to start this one.
				this._logService.debug(`Did not start affiliated runtime ` +
					`${metadata.runtimeName} for this workspace: ` +
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
	 * Gets the preferred runtime for a language
	 *
	 * @param languageId The language identifier
	 */
	public getPreferredRuntime(languageId: string): ILanguageRuntimeMetadata {
		// If there's an active session for the language, return it.
		const activeSession =
			this._runtimeSessionService.getConsoleSessionForLanguage(languageId);
		if (activeSession) {
			return activeSession.metadata;
		}

		// If there's a runtime affiliated with the workspace for the language,
		// return it.
		const affiliatedRuntimeMetadata = this.getAffiliatedRuntimeMetadata(languageId);
		if (affiliatedRuntimeMetadata) {
			const affiliatedRuntimeInfo =
				this._languageRuntimeService.getRegisteredRuntime(affiliatedRuntimeMetadata.runtimeId);
			if (affiliatedRuntimeInfo) {
				return affiliatedRuntimeInfo;
			}
		}

		// If there is a most recently started runtime for the language, return it.
		const mostRecentlyStartedRuntime = this._mostRecentlyStartedRuntimesByLanguageId.get(languageId);
		if (mostRecentlyStartedRuntime) {
			return mostRecentlyStartedRuntime;
		}

		// If there are registered runtimes for the language, return the first.
		const languageRuntimeInfos =
			this._languageRuntimeService.registeredRuntimes
				.filter(info => info.languageId === languageId);
		if (languageRuntimeInfos.length) {
			return languageRuntimeInfos[0];
		}

		// There are no registered runtimes for the language, throw an error.
		throw new Error(`No language runtimes registered for language ID '${languageId}'.`);
	}

	/**
	 * Starts all affiliated runtimes for the workspace.
	 */
	public startAffiliatedLanguageRuntimes(): void {
		const languageIds = this.getAffiliatedRuntimeLanguageIds();
		if (languageIds) {
			languageIds?.map(languageId => this.startAffiliatedRuntime(languageId));
		}
	}

	/**
	 * Convenience method for creating a storage key for a given runtime.
	 *
	 * @param runtime The runtime for which to get the storage key.
	 *
	 * @returns A string used to store the affiliated runtime ID for the given runtime.
	 */
	private storageKeyForRuntime(metadata: ILanguageRuntimeMetadata): string {
		return `${this.storageKey}.${metadata.languageId}`;
	}

	/**
	 * Starts an affiliated runtime for a single language.
	 */
	private startAffiliatedRuntime(languageId: string): void {
		const affiliatedRuntimeMetadata =
			this.getAffiliatedRuntimeMetadata(languageId);

		if (affiliatedRuntimeMetadata) {
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
		}
	}
}

registerSingleton(IRuntimeAffiliationService, RuntimeAffiliationService, InstantiationType.Eager);
