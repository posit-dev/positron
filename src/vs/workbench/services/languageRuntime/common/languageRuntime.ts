/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { Emitter } from 'vs/base/common/event';
import { ILogService } from 'vs/platform/log/common/log';
import { ILanguageService } from 'vs/editor/common/languages/language';
import { Disposable, IDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { CommandsRegistry } from 'vs/platform/commands/common/commands';
import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { ILanguageRuntimeMetadata, ILanguageRuntimeService, LanguageRuntimeDiscoveryPhase, LanguageRuntimeStartupBehavior, RuntimeExitReason, formatLanguageRuntimeMetadata, formatLanguageRuntimeSession, LanguageRuntimeSessionMode } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IRuntimeSessionService } from '../../runtimeSession/common/runtimeSessionService';
import { LanguageRuntimeWorkspaceAffiliation } from 'vs/workbench/services/languageRuntime/common/languageRuntimeWorkspaceAffiliation';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { Registry } from 'vs/platform/registry/common/platform';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions, ConfigurationScope, IConfigurationNode, } from 'vs/platform/configuration/common/configurationRegistry';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ExtensionsRegistry } from 'vs/workbench/services/extensions/common/extensionsRegistry';
import { ExtensionIdentifier } from 'vs/platform/extensions/common/extensions';

interface ILanguageRuntimeProviderMetadata {
	languageId: string;
}

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

/**
 * The implementation of ILanguageRuntimeService
 */
export class LanguageRuntimeService extends Disposable implements ILanguageRuntimeService {
	//#region Private Properties

	// The language packs; a map of language ID to a list of extensions that provide the language.
	private readonly _languagePacks: Map<string, Array<ExtensionIdentifier>> = new Map();

	// The set of encountered languages. This is keyed by the languageId and is
	// used to orchestrate implicit runtime startup.
	private readonly _encounteredLanguagesByLanguageId = new Set<string>();

	// The current discovery phase for language runtime registration.
	private _discoveryPhase: LanguageRuntimeDiscoveryPhase =
		LanguageRuntimeDiscoveryPhase.AwaitingExtensions;

	// A map of the registered runtimes. This is keyed by the runtimeId
	// (metadata.runtimeId) of the runtime.
	private readonly _registeredRuntimesByRuntimeId = new Map<string, ILanguageRuntimeMetadata>();

	// A map of most recently started runtimes. This is keyed by the languageId
	// (metadata.languageId) of the runtime.
	private readonly _mostRecentlyStartedRuntimesByLanguageId = new Map<string, ILanguageRuntimeMetadata>();

	// The object that manages the runtimes affliated with workspaces.
	private readonly _workspaceAffiliation: LanguageRuntimeWorkspaceAffiliation;

	// The event emitter for the onDidChangeDiscoveryPhase event.
	private readonly _onDidChangeDiscoveryPhaseEmitter =
		this._register(new Emitter<LanguageRuntimeDiscoveryPhase>);

	// The event emitter for the onDidRegisterRuntime event.
	private readonly _onDidRegisterRuntimeEmitter =
		this._register(new Emitter<ILanguageRuntimeMetadata>);

	// The event emitter for the onDidRequestLanguageRuntime event.
	private readonly _onDidRequestLanguageRuntimeEmitter =
		this._register(new Emitter<ILanguageRuntimeMetadata>);

	//#endregion Private Properties

	//#region Constructor

	/**
	 * Constructor.
	 * @param _extensionService The extension service.
	 * @param _languageService The language service.
	 * @param _runtimeSessionService The runtime session service.
	 * @param _logService The log service.
	 * @param _storageService The storage service.
	 * @param _configurationService The configuration service.
	 */
	constructor(
		@IExtensionService private readonly _extensionService: IExtensionService,
		@ILanguageService private readonly _languageService: ILanguageService,
		@IRuntimeSessionService private readonly _runtimeSessionService: IRuntimeSessionService,
		@ILogService private readonly _logService: ILogService,
		@IStorageService private readonly _storageService: IStorageService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
	) {
		// Call the base class's constructor.
		super();

		// Create the object that tracks the affiliation of runtimes to workspaces.
		this._workspaceAffiliation =
			new LanguageRuntimeWorkspaceAffiliation(this,
				this._runtimeSessionService,
				this._storageService,
				this._logService,
				this._configurationService);
		this._register(this._workspaceAffiliation);

		languageRuntimeExtPoint.setHandler((extensions) => {
			// This new set of extensions replaces the old set, so clear the
			// language packs.
			this._languagePacks.clear();

			// Loop over each extension that contributes language runtimes.
			for (const extension of extensions) {
				for (const value of extension.value) {
					this._logService.info(`Extension ${extension.description.identifier.value} contributes language runtime for language ID ${value.languageId}`);
					if (this._languagePacks.has(value.languageId)) {
						this._languagePacks.get(value.languageId)?.push(extension.description.identifier);
					} else {
						this._languagePacks.set(value.languageId, [extension.description.identifier]);
					}
				}
			}
		});

		// Add the onDidEncounterLanguage event handler.
		this._register(this._languageService.onDidRequestRichLanguageFeatures(languageId => {
			// Add the language to the set of encountered languages.
			this._encounteredLanguagesByLanguageId.add(languageId);

			// If a runtime for the language is already starting or running,
			// there is no need to check for implicit startup below.
			if (this._runtimeSessionService.hasStartingOrRunningConsole(languageId)) {
				return;
			}

			// Find the registered runtimes for the language that have implicit
			// startup behavior. If there aren't any, return.
			const languageRuntimeInfos = Array.from(this._registeredRuntimesByRuntimeId.values())
				.filter(
					metadata =>
						metadata.languageId === languageId &&
						metadata.startupBehavior === LanguageRuntimeStartupBehavior.Implicit);
			if (!languageRuntimeInfos.length) {
				return;
			}

			// Start the first runtime that was found. This isn't random; the
			// runtimes are sorted by priority when registered by the extension
			// so they will be in the right order so the first one is the right
			// one to start.
			this._logService.trace(`Language runtime ${formatLanguageRuntimeMetadata(languageRuntimeInfos[0])} automatically starting`);
			this._runtimeSessionService.autoStartRuntime(languageRuntimeInfos[0],
				`A file with the language ID ${languageId} was opened.`);
		}));

		this._extensionService.whenAllExtensionHostsStarted().then(async () => {
			// Start affiliated runtimes for the workspace
			this.startAffiliatedLanguageRuntimes();

			// Activate all extensions that contribute language runtimes.
			const activationPromises = Array.from(this._languagePacks.keys()).map(
				async (languageId) => {
					for (const extension of this._languagePacks.get(languageId) || []) {
						this._logService.info(`Activating extension ${extension.value} for language ID ${languageId}`);
						this._extensionService.activateById(extension,
							{
								extensionId: extension,
								activationEvent: `onLanguageRuntime:${languageId}`,
								startup: true
							});
					}
				});
			await Promise.all(activationPromises);
			this._logService.info(`All extensions contributing language runtimes have been activated.`);

			// Enter the discovery phase; this triggers us to ask each extension for its
			// language runtime providers.
			this._onDidChangeDiscoveryPhaseEmitter.fire(LanguageRuntimeDiscoveryPhase.Discovering);
		});

		// Listen for runtime start events and update the most recently started
		// runtimes for each language.
		this._register(this._runtimeSessionService.onDidStartRuntime(session => {
			this._mostRecentlyStartedRuntimesByLanguageId.set(session.metadata.languageId,
				session.metadata);
		}));

		// Update the discovery phase when the language service's state changes.
		this.onDidChangeDiscoveryPhase(phase => {
			this._discoveryPhase = phase;
		});
	}

	//#endregion Constructor

	//#region ILanguageRuntimeService Implementation

	// Needed for service branding in dependency injector.
	declare readonly _serviceBrand: undefined;

	// An event that fires when the language runtime discovery phase changes.
	readonly onDidChangeDiscoveryPhase = this._onDidChangeDiscoveryPhaseEmitter.event;

	// An event that fires when a new runtime is registered.
	readonly onDidRegisterRuntime = this._onDidRegisterRuntimeEmitter.event;

	// An event that fires when a language runtime is requested.
	readonly onDidRequestLanguageRuntime = this._onDidRequestLanguageRuntimeEmitter.event;

	/**
	 * Gets the registered runtimes.
	 */
	get registeredRuntimes(): ILanguageRuntimeMetadata[] {
		return Array.from(this._registeredRuntimesByRuntimeId.values());
	}

	/**
	 * Gets a single registered runtime by runtime identifier.
	 *
	 * @param runtimeId The runtime identifier of the runtime to retrieve.
	 *
	 * @returns The runtime with the given runtime identifier, or undefined if
	 *  no runtime with the given runtime identifier exists.
	 */
	getRegisteredRuntime(runtimeId: string): ILanguageRuntimeMetadata | undefined {
		return this._registeredRuntimesByRuntimeId.get(runtimeId);
	}

	/**
	 * Gets the current discovery phase
	 */
	get discoveryPhase(): LanguageRuntimeDiscoveryPhase {
		return this._discoveryPhase;
	}

	/**
	 * Selects and starts a new runtime session, after shutting down any currently active
	 * sessions for the language.
	 *
	 * @param runtimeId The ID of the runtime to select
	 * @param source The source of the selection
	 *
	 * @returns A promise that resolves to the session ID when the runtime is started
	 */
	async selectRuntime(runtimeId: string, source: string): Promise<void> {
		const runtime = this._registeredRuntimesByRuntimeId.get(runtimeId);
		if (!runtime) {
			return Promise.reject(new Error(`Language runtime ID '${runtimeId}' ` +
				`is not registered.`));
		}

		// Shut down any other runtime consoles for the language.
		const activeSession =
			this._runtimeSessionService.getConsoleSessionForLanguage(runtime.languageId);
		if (activeSession) {
			// Is this, by chance, the runtime that's already running?
			if (activeSession.metadata.runtimeId === runtimeId) {
				return Promise.reject(
					new Error(`${formatLanguageRuntimeMetadata(runtime)} is already running.`));
			}

			// We wait for `onDidEndSession()` rather than `RuntimeState.Exited`, because the former
			// generates some Console output that must finish before starting up a new runtime:
			const promise = new Promise<void>(resolve => {
				const disposable = activeSession.onDidEndSession((exit) => {
					resolve();
					disposable.dispose();
				});
			});

			const timeout = new Promise<void>((_, reject) => {
				setTimeout(() => {
					reject(new Error(`Timed out waiting for runtime ` +
						`${formatLanguageRuntimeSession(activeSession)} to finish exiting.`));
				}, 5000);
			});

			// Ask the runtime to shut down.
			await activeSession.shutdown(RuntimeExitReason.SwitchRuntime);

			// Wait for the runtime onDidEndSession to resolve, or for the timeout to expire
			// (whichever comes first)
			await Promise.race([promise, timeout]);
		}

		// Wait for the selected runtime to start.
		await this._runtimeSessionService.startNewRuntimeSession(runtime.runtimeId,
			runtime.runtimeName,
			LanguageRuntimeSessionMode.Console,
			source);
	}

	/**
	 * Register a new runtime
	 *
	 * @param metadata The metadata of the runtime to register
	 *
	 * @returns A disposable that unregisters the runtime
	 */
	registerRuntime(metadata: ILanguageRuntimeMetadata): IDisposable {
		// If the runtime has already been registered, return early.
		if (this._registeredRuntimesByRuntimeId.has(metadata.runtimeId)) {
			return toDisposable(() => { });
		}

		// Add the runtime to the registered runtimes.
		this._registeredRuntimesByRuntimeId.set(metadata.runtimeId, metadata);

		// Signal that the set of registered runtimes has changed.
		this._onDidRegisterRuntimeEmitter.fire(metadata);

		// Logging.
		this._logService.trace(`Language runtime ${formatLanguageRuntimeMetadata(metadata)} successfully registered.`);

		// Automatically start the language runtime under the following conditions:
		// - The language runtime wants to start immediately.
		// - No other runtime is currently running.
		// - We have completed the discovery phase of the language runtime
		//   registration process.
		if (metadata.startupBehavior === LanguageRuntimeStartupBehavior.Immediate &&
			this._discoveryPhase === LanguageRuntimeDiscoveryPhase.Complete &&
			!this._runtimeSessionService.hasStartingOrRunningConsole()) {

			this._runtimeSessionService.autoStartRuntime(metadata,
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
		else if (this._encounteredLanguagesByLanguageId.has(metadata.languageId) &&
			this._discoveryPhase === LanguageRuntimeDiscoveryPhase.Complete &&
			!this._runtimeSessionService.hasStartingOrRunningConsole(metadata.languageId) &&
			metadata.startupBehavior === LanguageRuntimeStartupBehavior.Implicit &&
			!this._workspaceAffiliation.getAffiliatedRuntimeMetadata(metadata.languageId)) {

			this._runtimeSessionService.autoStartRuntime(metadata,
				`A file with the language ID ${metadata.languageId} was open ` +
				`when the runtime was registered.`);
		}

		return toDisposable(() => {
			this._registeredRuntimesByRuntimeId.delete(metadata.runtimeId);
		});
	}

	/**
	 * Unregister a runtime
	 *
	 * @param runtimeId The runtime identifier of the runtime to unregister
	 */
	unregisterRuntime(runtimeId: string): void {
		this._registeredRuntimesByRuntimeId.delete(runtimeId);
	}

	/**
	 * Gets the preferred runtime for a language
	 *
	 * @param languageId The language identifier
	 */
	getPreferredRuntime(languageId: string): ILanguageRuntimeMetadata {
		// If there's an active session for the language, return it.
		const activeSession =
			this._runtimeSessionService.getConsoleSessionForLanguage(languageId);
		if (activeSession) {
			return activeSession.metadata;
		}

		// If there's a runtime affiliated with the workspace for the language,
		// return it.
		const affiliatedRuntimeMetadata = this._workspaceAffiliation.getAffiliatedRuntimeMetadata(languageId);
		if (affiliatedRuntimeMetadata) {
			const affiliatedRuntimeInfo = this._registeredRuntimesByRuntimeId.get(affiliatedRuntimeMetadata.runtimeId);
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
			Array.from(this._registeredRuntimesByRuntimeId.values())
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
	startAffiliatedLanguageRuntimes(): void {
		const languageIds = this._workspaceAffiliation.getAffiliatedRuntimeLanguageIds();
		if (languageIds) {
			languageIds?.map(languageId => this.startAffiliatedRuntime(languageId));
		}
	}

	/**
	 * Completes the language runtime discovery phase. If no runtimes were
	 * started or will be started, automatically start one.
	 */
	completeDiscovery(): void {
		this._onDidChangeDiscoveryPhaseEmitter.fire(LanguageRuntimeDiscoveryPhase.Complete);

		if (!this._workspaceAffiliation.hasAffiliatedRuntime() &&
			!this._runtimeSessionService.hasStartingOrRunningConsole()) {
			// If there are no affiliated runtimes, and no starting or running
			// runtimes, start the first runtime that has Immediate startup
			// behavior.
			const languageRuntimes = Array.from(this._registeredRuntimesByRuntimeId.values())
				.filter(metadata =>
					metadata.startupBehavior === LanguageRuntimeStartupBehavior.Immediate);
			if (languageRuntimes.length) {
				this._runtimeSessionService.autoStartRuntime(languageRuntimes[0],
					`An extension requested the runtime to be started immediately.`);
			}
		}
	}

	/**
	 * Returns a specific runtime by runtime identifier.
	 * @param runtimeId The runtime identifier of the runtime to retrieve.
	 * @returns The runtime with the given runtime identifier, or undefined if
	 * no runtime with the given runtime identifier exists.
	 */
	getRuntime(runtimeId: string): ILanguageRuntimeMetadata | undefined {
		return this._registeredRuntimesByRuntimeId.get(runtimeId);
	}

	//#endregion ILanguageRuntimeService Implementation

	//#region Private Methods

	/**
	 * Starts an affiliated runtime for a single language.
	 */
	private startAffiliatedRuntime(languageId: string): void {
		const affiliatedRuntimeMetadata =
			this._workspaceAffiliation.getAffiliatedRuntimeMetadata(languageId);

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
			this._onDidRequestLanguageRuntimeEmitter.fire(affiliatedRuntimeMetadata);
		}
	}


	//#endregion Private Methods
}

CommandsRegistry.registerCommand('positron.activateInterpreters', () => true);

// Instantiate the language runtime service "eagerly", meaning as soon as a
// consumer depdends on it. This fixes an issue where languages are encountered
// BEFORE the language runtime service has been instantiated.
registerSingleton(ILanguageRuntimeService, LanguageRuntimeService, InstantiationType.Eager);

export const positronConfigurationNodeBase = Object.freeze<IConfigurationNode>({
	'id': 'positron',
	'order': 7,
	'title': nls.localize('positronConfigurationTitle', "Positron"),
	'type': 'object',
});

// Register configuration options for the runtime service
const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);
configurationRegistry.registerConfiguration({
	...positronConfigurationNodeBase,
	properties: {
		'positron.interpreters.restartOnCrash': {
			scope: ConfigurationScope.MACHINE,
			type: 'boolean',
			default: true,
			description: nls.localize('positron.runtime.restartOnCrash', "When enabled, interpreters are automatically restarted after a crash.")
		},
		'positron.interpreters.automaticStartup': {
			scope: ConfigurationScope.MACHINE,
			type: 'boolean',
			default: true,
			description: nls.localize('positron.runtime.automaticStartup', "When enabled, interpreters can start automatically.")
		}
	}
});
