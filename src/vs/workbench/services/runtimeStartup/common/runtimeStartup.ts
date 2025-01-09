/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from '../../../../nls.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IEphemeralStateService } from '../../../../platform/ephemeralState/common/ephemeralState.js';
import { IExtensionService } from '../../extensions/common/extensions.js';
import { ILanguageRuntimeExit, ILanguageRuntimeMetadata, ILanguageRuntimeService, LanguageRuntimeSessionLocation, LanguageRuntimeSessionMode, LanguageRuntimeStartupBehavior, RuntimeExitReason, RuntimeStartupPhase, RuntimeState, formatLanguageRuntimeMetadata } from '../../languageRuntime/common/languageRuntimeService.js';
import { IRuntimeStartupService } from './runtimeStartupService.js';
import { ILanguageRuntimeSession, IRuntimeSessionMetadata, IRuntimeSessionService, RuntimeStartMode } from '../../runtimeSession/common/runtimeSessionService.js';
import { ExtensionsRegistry } from '../../extensions/common/extensionsRegistry.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import { ILifecycleService, ShutdownReason } from '../../lifecycle/common/lifecycle.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IWorkspaceTrustManagementService } from '../../../../platform/workspace/common/workspaceTrust.js';
import { URI } from '../../../../base/common/uri.js';
import { IWorkspaceContextService, WorkbenchState } from '../../../../platform/workspace/common/workspace.js';
import { IPositronNewProjectService } from '../../positronNewProject/common/positronNewProject.js';

interface ILanguageRuntimeProviderMetadata {
	languageId: string;
}

interface IAffiliatedRuntimeMetadata {
	metadata: ILanguageRuntimeMetadata;
	lastUsed: number;
}

/**
 * Metadata for serialized runtime sessions.
 */
interface SerializedSessionMetadata {
	/// The metadata for the runtime session itself.
	metadata: IRuntimeSessionMetadata;

	/// The state of the runtime, at the time it was serialized.
	sessionState: RuntimeState;

	/// The time at which the session was last used, in milliseconds since the epoch.
	lastUsed: number;

	/// The metadata of the runtime associated with the session.
	runtimeMetadata: ILanguageRuntimeMetadata;
}

/**
 * Key for storing the set of persistent workspace session list. The session
 * list is stored in ephemeral storage; it persists across browser
 * reloads/reconnects, but not across Positron sessions.
 *
 * Amended with the workspace ID to allow for multiple workspaces to store their
 * sessions separately.
 */
const PERSISTENT_WORKSPACE_SESSIONS = 'positron.workspaceSessionList';

const languageRuntimeExtPoint =
	ExtensionsRegistry.registerExtensionPoint<ILanguageRuntimeProviderMetadata[]>({
		extensionPoint: 'languageRuntimes',
		jsonSchema: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					languageId: {
						type: 'string',
						description: nls.localize('contributes.languageRuntime.languageId', 'The language ID for which this extension provides runtime services.'),
					}
				}
			}
		}
	});

export class RuntimeStartupService extends Disposable implements IRuntimeStartupService {

	// Needed for service branding in dependency injector.
	declare readonly _serviceBrand: undefined;

	private readonly storageKey = 'positron.affiliatedRuntimeMetadata.v1';

	// The language packs; a map of language ID to a list of extensions that provide the language.
	private readonly _languagePacks: Map<string, Array<ExtensionIdentifier>> = new Map();

	// The set of encountered languages.
	private readonly _encounteredLanguagesByLanguageId = new Set<string>();

	// A map of most recently started runtimes. This is keyed by the languageId
	// (metadata.languageId) of the runtime.
	private readonly _mostRecentlyStartedRuntimesByLanguageId = new Map<string, ILanguageRuntimeMetadata>();

	// The current startup phase an observeable value.
	private _startupPhase: RuntimeStartupPhase;

	// Whether we are shutting down
	private _shuttingDown = false;

	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IExtensionService private readonly _extensionService: IExtensionService,
		@ILanguageService private readonly _languageService: ILanguageService,
		@ILanguageRuntimeService private readonly _languageRuntimeService: ILanguageRuntimeService,
		@ILifecycleService private readonly _lifecycleService: ILifecycleService,
		@ILogService private readonly _logService: ILogService,
		@IPositronNewProjectService private readonly _newProjectService: IPositronNewProjectService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IRuntimeSessionService private readonly _runtimeSessionService: IRuntimeSessionService,
		@IStorageService private readonly _storageService: IStorageService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@IWorkspaceTrustManagementService private readonly _workspaceTrustManagementService: IWorkspaceTrustManagementService,
		@IEphemeralStateService private readonly _ephemeralStateService: IEphemeralStateService) {

		super();

		this._register(
			this._runtimeSessionService.onDidChangeForegroundSession(
				this.onDidChangeActiveRuntime, this));

		this._register(
			this._languageRuntimeService.onDidRegisterRuntime(
				this.onDidRegisterRuntime, this));

		// Register the startup phase event handler.
		this._startupPhase = _languageRuntimeService.startupPhase;
		this._register(
			this._languageRuntimeService.onDidChangeRuntimeStartupPhase(
				(phase) => {
					this._logService.debug(`[Runtime startup] Phase changed to '${phase}'`);
					this._startupPhase = phase;
				}));


		this._register(this._runtimeSessionService.onWillStartSession(e => {
			this._register(e.session.onDidEncounterStartupFailure(_exit => {
				// Update the set of workspace sessions
				this.saveWorkspaceSessions();
			}));
		}));

		this._register(this._runtimeSessionService.onDidFailStartRuntime(e => {
			// Update the set of workspace sessions
			this.saveWorkspaceSessions();
		}));

		// Listen for runtime start events and update the most recently started
		// runtimes for each language.
		this._register(this._runtimeSessionService.onDidStartRuntime(session => {

			this._mostRecentlyStartedRuntimesByLanguageId.set(session.runtimeMetadata.languageId,
				session.runtimeMetadata);

			this.saveWorkspaceSessions();

			this._register(session.onDidEndSession(exit => {
				// Ignore if shutting down; sessions 'exit' during shutdown as
				// they disconnect from the extension host.
				if (this._shuttingDown) {
					return;
				}

				// Update the set of workspace sessions
				this.saveWorkspaceSessions();

				// Restart after a crash, if necessary
				this.restartAfterCrash(session, exit);
			}));
		}));

		// When the discovery phase is complete, check to see if we need to
		// auto-start a runtime.
		this._register(this._languageRuntimeService.onDidChangeRuntimeStartupPhase(phase => {
			if (phase === RuntimeStartupPhase.Complete) {
				// if no runtimes were found, notify the user about the problem
				if (this._languageRuntimeService.registeredRuntimes.length === 0) {
					this._notificationService.error(nls.localize('positron.runtimeStartupService.noRuntimesMessage',
						"No interpreters found. Please see the [Get Started](https://positron.posit.co/start) \
						documentation to learn how to prepare your Python and/or R environments to work with Positron."));
				}

				// If there are no affiliated runtimes, and no starting or running
				// runtimes, start the first runtime that has Immediate startup
				// behavior.
				else if (!this.hasAffiliatedRuntime() &&
					!this._runtimeSessionService.hasStartingOrRunningConsole()) {
					const languageRuntimes = this._languageRuntimeService.registeredRuntimes
						.filter(metadata =>
							metadata.startupBehavior === LanguageRuntimeStartupBehavior.Immediate);
					if (languageRuntimes.length) {
						this._runtimeSessionService.autoStartRuntime(languageRuntimes[0],
							`An extension requested the runtime to be started immediately.`,
							true);
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
				this._startupPhase === RuntimeStartupPhase.Complete &&
				!this._runtimeSessionService.hasStartingOrRunningConsole()) {

				this._runtimeSessionService.autoStartRuntime(runtime,
					`An extension requested that the runtime start immediately after being registered.`, true);
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
				this._startupPhase === RuntimeStartupPhase.Complete &&
				!this._runtimeSessionService.hasStartingOrRunningConsole(runtime.languageId) &&
				runtime.startupBehavior === LanguageRuntimeStartupBehavior.Implicit &&
				!this.getAffiliatedRuntimeMetadata(runtime.languageId)) {

				this._runtimeSessionService.autoStartRuntime(runtime,
					`A file with the language ID ${runtime.languageId} was open ` +
					`when the runtime was registered.`, true);
			}
		}));

		// Wait for all extension hosts to start before beginning the main
		// startup sequence.
		this._extensionService.whenAllExtensionHostsStarted().then(async () => {
			if (this._workspaceTrustManagementService.isWorkspaceTrusted()) {
				// In a trusted workspace, we can start the startup sequence
				// immediately.
				await this.startupSequence();
			} else {
				// If we are not in a trusted workspace, wait for the workspace to become
				// trusted before starting the startup sequence.
				this.setStartupPhase(RuntimeStartupPhase.AwaitingTrust);
				this._register(this._workspaceTrustManagementService.onDidChangeTrust((trusted) => {
					if (!trusted) {
						return;
					}
					// If the workspace becomse trusted while we are awaiting trust,
					// move on to the startup sequence.
					if (this._startupPhase === RuntimeStartupPhase.AwaitingTrust) {
						this.startupSequence();
					}
				}));
			}
		});

		languageRuntimeExtPoint.setHandler((extensions) => {
			// This new set of extensions replaces the old set, so clear the
			// language packs.
			this._languagePacks.clear();

			// Loop over each extension that contributes language runtimes.
			for (const extension of extensions) {
				for (const value of extension.value) {
					this._logService.debug(`[Runtime startup] Extension ${extension.description.identifier.value} has been registered for language runtime for language ID '${value.languageId}'`);
					if (this._languagePacks.has(value.languageId)) {
						this._languagePacks.get(value.languageId)?.push(extension.description.identifier);
					} else {
						this._languagePacks.set(value.languageId, [extension.description.identifier]);
					}
				}
			}

			// If we were awaiting trust, and we now have language packs, move on
			// to the discovery phase if we haven't already and there are now registered
			// language packs.
			if (this._startupPhase === RuntimeStartupPhase.AwaitingTrust) {
				if (this._languagePacks.size > 0) {
					this.discoverAllRuntimes();
				} else {
					this._logService.debug(`[Runtime startup] No language packs were found.`);
					this.setStartupPhase(RuntimeStartupPhase.Complete);
				}
			}
		});

		// Register a shutdown event handler so that we have a chance to save
		// state before a reload.
		this._register(this._lifecycleService.onBeforeShutdown((e) => {
			// Mark that we are shutting down
			this._shuttingDown = true;
			if (e.reason === ShutdownReason.RELOAD) {
				// Attempt to save the current state of the workspace sessions
				// before reloading the browser.
				e.veto(this.saveWorkspaceSessions(),
					'positron.runtimeStartup.saveWorkspaceSessions');
			} else if (e.reason === ShutdownReason.CLOSE || e.reason === ShutdownReason.QUIT) {
				// Clear the workspace sessions. In most cases this is not
				// necessary since the sessions are stored in ephemeral
				// storage, but it is possible that this workspace will be
				// re-opened without an interleaving quit (e.g. if multiple
				// Positron windows are open).
				e.veto(this.clearWorkspaceSessions(), 'positron.runtimeStartup.clearWorkspaceSessions');
			}
		}));
	}

	/**
	 * Convenience method for setting the startup phase.
	 */
	private setStartupPhase(phase: RuntimeStartupPhase): void {
		this._startupPhase = phase;
		this._languageRuntimeService.setStartupPhase(phase);
	}

	/**
	 * The main entry point for the runtime startup service.
	 */
	private async startupSequence() {

		// Attempt to reconnect to any active sessions first.
		await this.restoreSessions();

		// If this is a new project, wait for it to initialize the project
		// before proceeding, and then store the new project runtime metadata.
		// as the affiliated runtime for this workspace.
		await this._newProjectService.initTasksComplete.wait();
		const newRuntime = this._newProjectService.newProjectRuntimeMetadata;
		if (newRuntime) {
			const newAffiliation: IAffiliatedRuntimeMetadata = {
				metadata: newRuntime,
				lastUsed: Date.now()
			};
			this._storageService.store(this.storageKeyForRuntime(newRuntime),
				JSON.stringify(newAffiliation),
				StorageScope.WORKSPACE,
				StorageTarget.MACHINE);
		}

		// If no sessions were restored, and we have affiliated runtimes,
		// try to start them.
		if (!this._runtimeSessionService.hasStartingOrRunningConsole() &&
			this.hasAffiliatedRuntime()) {
			await this.startAffiliatedLanguageRuntimes();
		}

		// Then, discover all language runtimes.
		await this.discoverAllRuntimes();
	}

	/**
	 * Completes the language runtime discovery phase. If no runtimes were
	 * started or will be started, automatically start one.
	 */
	completeDiscovery(): void {
		this.setStartupPhase(RuntimeStartupPhase.Complete);
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

		if (session.runtimeMetadata.startupBehavior === LanguageRuntimeStartupBehavior.Manual) {
			return;
		}

		// Save this runtime as the affiliated runtime for the current workspace.
		const affiliated: IAffiliatedRuntimeMetadata = {
			metadata: session.runtimeMetadata,
			lastUsed: Date.now()
		};
		this._storageService.store(this.storageKeyForRuntime(session.runtimeMetadata),
			JSON.stringify(affiliated),
			this.affiliationStorageScope(),
			StorageTarget.MACHINE);

		// If the runtime is exiting, remove the affiliation if it enters the
		// `Exiting` state. This state only occurs when the runtime is manually
		// shut down, so may represent a user's intent to stop using the runtime
		// for this workspace.
		this._register(session.onDidChangeRuntimeState((newState) => {
			if (newState === RuntimeState.Exiting) {
				// Just to be safe, check that the runtime is still affiliated
				// before removing the affiliation
				const serializedMetadata = this._storageService.get(
					this.storageKeyForRuntime(session.runtimeMetadata),
					this.affiliationStorageScope());
				if (!serializedMetadata) {
					return;
				}
				const affiliated = JSON.parse(serializedMetadata) as IAffiliatedRuntimeMetadata;
				const affiliatedRuntimeId = affiliated.metadata.runtimeId;
				if (session.runtimeMetadata.runtimeId === affiliatedRuntimeId) {
					// Remove the affiliation
					this._storageService.remove(this.storageKeyForRuntime(session.runtimeMetadata),
						this.affiliationStorageScope());
				}
			}
		}));
	}

	/**
	 * Activates all of the extensions that provides language runtimes, then
	 * enters the discovery phase, in which each extension is asked to supply
	 * its language runtime metadata.
	 */
	private async discoverAllRuntimes() {

		// If we have no language packs yet, but were awaiting trust, we need to
		// wait until the language packs are reloaded with the new trust
		// settings before we can continue.
		if (this._startupPhase === RuntimeStartupPhase.AwaitingTrust &&
			this._languagePacks.size === 0) {

			// Wait up to 5 seconds for the language packs to be reloaded;
			// this should be very fast since it just requires the extension
			// host to scan the package JSON files of the extensions. If after 5
			// seconds we still don't have any language packs, there's no more
			// work to do; mark as complete so we don't hang in the
			// AwaitingTrust phase forever.
			setTimeout(() => {
				if (this._startupPhase === RuntimeStartupPhase.AwaitingTrust) {
					this.setStartupPhase(RuntimeStartupPhase.Complete);
				}
			}, 5000);
			return;
		}

		// Ensure all extension hosts are started before we start activating extensions
		await this._extensionService.whenAllExtensionHostsStarted();

		// Activate all extensions that contribute language runtimes.
		await this.activateExtensionsForLanguages(Array.from(this._languagePacks.keys()));
		this._logService.debug(`[Runtime startup] All extensions contributing language runtimes have been activated.`);

		// Enter the discovery phase; this triggers us to ask each extension for its
		// language runtime providers.
		this.setStartupPhase(RuntimeStartupPhase.Discovering);
	}

	/**
	 * Runs as an event handler when a new runtime is registered; checks to see
	 * if the runtime is affiliated with this workspace, and if so, starts the
	 * runtime.
	 *
	 * @param runtime The newly registered runtime.
	 */
	private onDidRegisterRuntime(metadata: ILanguageRuntimeMetadata): void {

		// Ignore if we're not in the discovery phase.
		if (this._startupPhase !== RuntimeStartupPhase.Discovering) {
			return;
		}

		// Ignore if we already have a console starting for this language.
		if (this._runtimeSessionService.hasStartingOrRunningConsole(metadata.languageId)) {
			return;
		}

		// Get the runtime metadata that is affiliated with this workspace, if any.
		const affiliatedRuntimeMetadataStr = this._storageService.get(
			this.storageKeyForRuntime(metadata), this.affiliationStorageScope());
		if (!affiliatedRuntimeMetadataStr) {
			return;
		}
		const affiliated = JSON.parse(affiliatedRuntimeMetadataStr) as IAffiliatedRuntimeMetadata;
		const affiliatedRuntimeId = affiliated.metadata.runtimeId;

		// If the runtime is affiliated with this workspace, start it.
		if (metadata.runtimeId === affiliatedRuntimeId) {
			try {

				// Check the setting to see if we should be auto-starting.
				const autoStart = this._configurationService.getValue<boolean>(
					'interpreters.automaticStartup');
				if (!autoStart) {
					this._logService.info(`Language runtime ` +
						`${formatLanguageRuntimeMetadata(affiliated.metadata)} ` +
						`is affiliated with this workspace, but won't be started because automatic ` +
						`startup is disabled in configuration.`);
					return;
				}

				if (metadata.startupBehavior === LanguageRuntimeStartupBehavior.Manual) {
					this._logService.info(`Language runtime ` +
						`${formatLanguageRuntimeMetadata(affiliated.metadata)} ` +
						`is affiliated with this workspace, but won't be started because its ` +
						`startup behavior is manual.`);
					return;
				}

				this._runtimeSessionService.startNewRuntimeSession(metadata.runtimeId,
					metadata.runtimeName,
					LanguageRuntimeSessionMode.Console,
					undefined, // Console session
					`Affiliated runtime for workspace`,
					RuntimeStartMode.Starting,
					true);
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
		const stored = this._storageService.get(`${this.storageKey}.${languageId}`,
			this.affiliationStorageScope());
		if (!stored) {
			return undefined;
		}
		try {
			const affiliated = JSON.parse(stored) as IAffiliatedRuntimeMetadata;
			return affiliated.metadata;
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
		const keys = this._storageService.keys(this.affiliationStorageScope(),
			StorageTarget.MACHINE);
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
		const keys = this._storageService.keys(
			this.affiliationStorageScope(), StorageTarget.MACHINE);
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
			return activeSession.runtimeMetadata;
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
	private async startAffiliatedLanguageRuntimes(): Promise<void> {
		this.setStartupPhase(RuntimeStartupPhase.Starting);
		const languageIds = this.getAffiliatedRuntimeLanguageIds();
		if (languageIds) {
			// TODO: only activate one of these

			// Activate all the extensions that provide language runtimes for the
			// affiliated languages.
			await this.activateExtensionsForLanguages(languageIds);
			languageIds.map(languageId => this.startAffiliatedRuntime(languageId, true));
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
	 * Returns the storage scope to use for storing runtime affiliations. We use
	 * the workspace storage scope if we have a workspace, and the profile scope
	 * otherwise.
	 *
	 * @returns The storage scope to use for storing the affiliation.
	 */
	private affiliationStorageScope(): StorageScope {
		if (this._workspaceContextService.getWorkbenchState() === WorkbenchState.EMPTY) {
			return StorageScope.PROFILE;
		}
		return StorageScope.WORKSPACE;
	}

	/**
	 * Activates the extensions that provide language runtimes for the given
	 * language IDs.
	 *
	 * @param languageIds The language IDs for which to activate the extensions.
	 */
	private async activateExtensionsForLanguages(languageIds: Array<string>): Promise<void> {
		const activationPromises = languageIds.map(
			async (languageId) => {
				for (const extension of this._languagePacks.get(languageId) || []) {
					this._logService.debug(`[Runtime startup] Activating extension ${extension.value} for language ID ${languageId}`);
					try {
						await this._extensionService.activateById(extension,
							{
								extensionId: extension,
								activationEvent: `onLanguageRuntime:${languageId}`,
								startup: false
							});
					} catch (e) {
						this._logService.debug(
							`[Runtime startup] Error activating extension ${extension.value}: ${e}`);
					}
				}
			});
		await Promise.all(activationPromises);
	}

	/**
	 * Starts an affiliated runtime for a single language.
	 *
	 * @param languageId The language to start
	 * @param activate Whether to activate/focus the new session
	 */
	private startAffiliatedRuntime(
		languageId: string,
		activate: boolean
	): void {
		const affiliatedRuntimeMetadata =
			this.getAffiliatedRuntimeMetadata(languageId);

		if (affiliatedRuntimeMetadata) {
			// Check the setting to see if we should be auto-starting.
			const autoStart = this._configurationService.getValue<boolean>(
				'interpreters.automaticStartup');

			if (autoStart) {

				if (affiliatedRuntimeMetadata.startupBehavior === LanguageRuntimeStartupBehavior.Manual) {
					this._logService.info(`Language runtime ` +
						`${formatLanguageRuntimeMetadata(affiliatedRuntimeMetadata)} ` +
						`is affiliated with this workspace, but won't be started because it's startup ` +
						`behavior is manual.`);
					return;
				}

				this._runtimeSessionService.autoStartRuntime(affiliatedRuntimeMetadata,
					`Affiliated ${languageId} runtime for workspace`,
					activate);
			} else {
				this._logService.info(`Language runtime ` +
					`${formatLanguageRuntimeMetadata(affiliatedRuntimeMetadata)} ` +
					`is affiliated with this workspace, but won't be started because automatic ` +
					`startup is disabled in configuration.`);
				return;
			}
		}
	}

	/**
	 * Restores the set of active workspace sessions from ephemeral storage.
	 */
	private async restoreSessions() {

		this._logService.debug(`[Runtime startup] Session restore; workspace: ${this._workspaceContextService.getWorkspace().id}, workbench state: ${this._workspaceContextService.getWorkbenchState()}, startupKind: ${this._lifecycleService.startupKind}`);

		// Get the set of sessions that were active when the workspace was last
		// open, and attempt to reconnect to them.
		let storedSessions: Array<SerializedSessionMetadata> = new Array();
		try {
			const sessions = await this._ephemeralStateService.getItem<Array<SerializedSessionMetadata>>(this.getEphemeralWorkspaceSessionsKey());
			if (sessions) {
				storedSessions = sessions;
			}
		} catch (err) {
			this._logService.warn(`Can't read workspace sessions from ${this.getEphemeralWorkspaceSessionsKey()}: ${err}. No sessions will be restored.`);
		}

		if (!storedSessions) {
			this._logService.debug(`[Runtime startup] No sessions to resume found in ephemeral storage.`);
		}

		// Next, check for any sessions persisted in the workspace storage.
		const sessions = this._storageService.get(PERSISTENT_WORKSPACE_SESSIONS,
			StorageScope.WORKSPACE);
		if (sessions) {
			try {
				const stored = JSON.parse(sessions) as Array<SerializedSessionMetadata>;
				storedSessions.push(...stored);
			} catch (err) {
				this._logService.error(`Error parsing persisted workspace sessions: ${err} (sessions: '${sessions}')`);
			}
		}

		try {
			// Revive the URIs in the session metadata.
			const sessions: SerializedSessionMetadata[] = storedSessions.map(session => ({
				...session,
				metadata: {
					...session.metadata,
					notebookUri: URI.revive(session.metadata.notebookUri),
				},
			}));

			if (sessions.length > 0) {
				// If this workspace has sessions, attempt to reconnect to
				// them.
				await this.restoreWorkspaceSessions(sessions);
			}
		} catch (err) {
			this._logService.error(`Could not restore workspace sessions: ${err?.stack ?? err} ` +
				`(data: ${JSON.stringify(storedSessions)})`);
		}
	}

	/**
	 * Restores the set of active workspace sessions from the workspace storage,
	 * reconnecting to each one.
	 *
	 * @param sessions The set of sessions to restore.
	 */
	private async restoreWorkspaceSessions(sessions: SerializedSessionMetadata[]) {
		this.setStartupPhase(RuntimeStartupPhase.Reconnecting);

		// Activate any extensions needed for the sessions that are persistent on the machine.
		const activatedExtensions: Array<ExtensionIdentifier> = [];
		await Promise.all(sessions.filter(async session =>
			session.runtimeMetadata.sessionLocation === LanguageRuntimeSessionLocation.Machine
		).map(async session => {
			// If we haven't already activated the extension, activate it now.
			// We need the extension to be active so that we can ask it to
			// validate the session before connecting to it.
			if (activatedExtensions.indexOf(session.runtimeMetadata.extensionId) === -1) {
				this._logService.debug(`[Runtime startup] Activating extension ` +
					`${session.runtimeMetadata.extensionId.value} for persisted session ` +
					`${session.metadata.sessionName} (${session.metadata.sessionId})`);
				activatedExtensions.push(session.runtimeMetadata.extensionId);
				return this._extensionService.activateById(session.runtimeMetadata.extensionId,
					{
						extensionId: session.runtimeMetadata.extensionId,
						activationEvent: `onLanguageRuntime:${session.runtimeMetadata.languageId}`,
						startup: false
					});
			}
		}));

		// Before reconnecting, validate any sessions that need it.
		const validSessions = await Promise.all(sessions.map(async session => {
			if (session.runtimeMetadata.sessionLocation === LanguageRuntimeSessionLocation.Machine) {
				// If the session is persistent on the machine, we need to
				// check to see if it is still valid (i.e. still running)
				// before reconnecting.
				this._logService.debug(`[Runtime startup] Checking to see if persisted session ` +
					`${session.metadata.sessionName} (${session.metadata.sessionId}) is still valid.`);
				try {
					// Ask the runtime session service to validate the session.
					// This call will eventually be proxied through to the
					// extension that provides the runtime.
					const valid = await this._runtimeSessionService.validateRuntimeSession(
						session.runtimeMetadata,
						session.metadata.sessionId);

					this._logService.debug(
						`[Runtime startup] Session ` +
						`${session.metadata.sessionName} (${session.metadata.sessionId}) valid = ${valid}`);
					return valid;
				} catch (err) {
					// This is a non-fatal error since we can just avoid reconnecting
					// to the session.
					this._logService.error(
						`Error validating persisted session ` +
						`${session.metadata.sessionName} (${session.metadata.sessionId}): ${err}`);
					return false;
				}
			}

			// Sessions stored in other locations are always valid.
			return true;
		}));

		// Remove all the sessions that are no longer valid.
		sessions = sessions.filter((_, i) => validSessions[i]);

		// Sort the sessions by last used time, so that we reconnect to the
		// most recently used sessions first. Default 0 so we can restore
		// sessions that didn't persist this information.
		sessions.sort((a, b) => (b.lastUsed ?? 0) - (a.lastUsed ?? 0));

		// Reconnect to the remaining sessions.
		this._logService.debug(`Reconnecting to sessions: ` +
			sessions.map(session => session.metadata.sessionName).join(', '));

		await Promise.all(sessions.map(async (session, idx) => {
			const marker =
				`[Reconnect ${session.metadata.sessionId} (${idx + 1}/${sessions.length})]`;

			// Activate the extension that provides the runtime. Note that this
			// waits for the extension service to signal the extension but does
			// not wait for the extension to activate.
			if (!activatedExtensions.includes(session.runtimeMetadata.extensionId)) {
				await this._extensionService.activateById(session.runtimeMetadata.extensionId,
					{
						extensionId: session.runtimeMetadata.extensionId,
						activationEvent: `onLanguageRuntime:${session.runtimeMetadata.languageId}`,
						startup: false
					});
			}

			this._logService.debug(`${marker}: Restoring session for ${session.metadata.sessionName}`);

			// Reconnect to the session; activate it if it is the first session
			await this._runtimeSessionService.restoreRuntimeSession(
				session.runtimeMetadata, session.metadata, idx === 0);
		}));
	}

	/**
	 * Clear the set of workspace sessions in the ephemeral workspace storage.
	 */
	private async clearWorkspaceSessions(): Promise<boolean> {
		// Clear the sessions. Note that we only ever clear the sessions from
		// the ephemeral storage, since the persisted sessions are meant to be
		// restored later.
		await this._ephemeralStateService.removeItem(this.getEphemeralWorkspaceSessionsKey());

		// Always return false (don't veto shutdown)
		return false;
	}

	/**
	 * Update the set of workspace sessions in the workspace storage.
	 *
	 * @returns False, always, so that it can be called during the shutdown
	 * process.
	 */
	private async saveWorkspaceSessions(): Promise<boolean> {
		// Derive the set of sessions that are currently active
		const activeSessions = this._runtimeSessionService.activeSessions
			.filter(session =>
				session.getRuntimeState() !== RuntimeState.Uninitialized &&
				session.getRuntimeState() !== RuntimeState.Initializing &&
				session.getRuntimeState() !== RuntimeState.Exited
			)
			.map(session => {
				const metadata: SerializedSessionMetadata = {
					metadata: session.metadata,
					sessionState: session.getRuntimeState(),
					runtimeMetadata: session.runtimeMetadata,
					lastUsed: session.lastUsed,
				};
				return metadata;
			});

		// Diagnostic logs: what are we saving?
		this._logService.trace(`Saving workspace sessions: ${activeSessions.map(session =>
			`${session.metadata.sessionName} (${session.metadata.sessionId}, ${session.runtimeMetadata.sessionLocation})`).join(', ')}`);

		// Save the ephemeral sessions to the workspace storage.
		const workspaceSessions = activeSessions.filter(session =>
			session.runtimeMetadata.sessionLocation === LanguageRuntimeSessionLocation.Workspace);
		this._logService.debug(`[Runtime startup] Saving ephemeral workspace sessions (${workspaceSessions.length})`);
		this._ephemeralStateService.setItem(this.getEphemeralWorkspaceSessionsKey(),
			workspaceSessions);

		// Save the persisted sessions to the workspace storage.
		const machineSessions = activeSessions.filter(session =>
			session.runtimeMetadata.sessionLocation === LanguageRuntimeSessionLocation.Machine);
		this._logService.debug(`[Runtime startup] Saving machine-persisted workspace sessions (${machineSessions.length})`);
		this._storageService.store(
			PERSISTENT_WORKSPACE_SESSIONS,
			JSON.stringify(machineSessions),
			StorageScope.WORKSPACE, StorageTarget.MACHINE);

		return false;
	}

	/**
	 * Automatically restarts the session after a crash, if necessary.
	 *
	 * @param session The session that exited.
	 * @param exit The reason the session exited.
	 */
	private async restartAfterCrash(session: ILanguageRuntimeSession, exit: ILanguageRuntimeExit) {
		// Ignore if we are still starting up; if a runtime crashes or exits
		// during startup, we'll usually try to start a better one instead of
		// booting to a broken REPL.
		if (this._startupPhase !== RuntimeStartupPhase.Complete) {
			return;
		}

		// Ignore if the runtime exited for a Good Reason.
		// If the reason is `Unknown`, then we don't know the reason for the exit, but the
		// `exit_code` was `0`, so we don't treat it as a crash. If the `exit_code` had not been
		// `0`, then `onKernelExited()` would have upgraded the crash from `Unknown` to `Error`.
		if (exit.reason !== RuntimeExitReason.Error) {
			return;
		}

		const restartOnCrash =
			this._configurationService.getValue<boolean>('interpreters.restartOnCrash');

		let action;

		if (restartOnCrash) {
			// Wait a beat, then start the runtime.
			await new Promise<void>(resolve => setTimeout(resolve, 250));

			await this._runtimeSessionService.startNewRuntimeSession(
				session.runtimeMetadata.runtimeId,
				session.metadata.sessionName,
				session.metadata.sessionMode,
				session.metadata.notebookUri,
				`The runtime exited unexpectedly and is being restarted automatically.`,
				RuntimeStartMode.Restarting,
				false);
			action = 'and was automatically restarted';
		} else {
			action = 'and was not automatically restarted';
		}

		// Let the user know what we did.
		const msg = nls.localize(
			'positronConsole.runtimeCrashed',
			'{0} exited unexpectedly {1}. You may have lost unsaved work.\nExit code: {2}',
			session.runtimeMetadata.runtimeName,
			action,
			exit.exit_code
		);

		this._notificationService.prompt(Severity.Warning, msg, [
			{
				label: nls.localize('openOutputLogs', 'Open Logs'),
				run: () => {
					session.showOutput();
				}
			},
		]);

	}

	/**
	 * Gets the storage key used to store the set of workspace sessions in
	 * ephemeral storage.
	 */
	private getEphemeralWorkspaceSessionsKey(): string {
		// We include the workspace ID in the key since ephemeral storage can
		// be shared among workspaces in e.g. Positron Server.
		return `${PERSISTENT_WORKSPACE_SESSIONS}.${this._workspaceContextService.getWorkspace().id}`;
	}
}

registerSingleton(IRuntimeStartupService, RuntimeStartupService, InstantiationType.Eager);
