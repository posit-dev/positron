/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { Emitter } from 'vs/base/common/event';
import { ILogService } from 'vs/platform/log/common/log';
import { Disposable, IDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { CommandsRegistry } from 'vs/platform/commands/common/commands';
import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { ILanguageRuntimeMetadata, ILanguageRuntimeService, LanguageRuntimeDiscoveryPhase, formatLanguageRuntimeMetadata } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { Registry } from 'vs/platform/registry/common/platform';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions, ConfigurationScope, IConfigurationNode, } from 'vs/platform/configuration/common/configurationRegistry';
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

	// The current discovery phase for language runtime registration.
	private _discoveryPhase: LanguageRuntimeDiscoveryPhase =
		LanguageRuntimeDiscoveryPhase.AwaitingExtensions;

	// A map of the registered runtimes. This is keyed by the runtimeId
	// (metadata.runtimeId) of the runtime.
	private readonly _registeredRuntimesByRuntimeId = new Map<string, ILanguageRuntimeMetadata>();

	// The event emitter for the onDidChangeDiscoveryPhase event.
	private readonly _onDidChangeDiscoveryPhaseEmitter =
		this._register(new Emitter<LanguageRuntimeDiscoveryPhase>);

	// The event emitter for the onDidRegisterRuntime event.
	private readonly _onDidRegisterRuntimeEmitter =
		this._register(new Emitter<ILanguageRuntimeMetadata>);

	//#endregion Private Properties

	//#region Constructor

	/**
	 * Constructor.
	 * @param _extensionService The extension service.
	 * @param _languageService The language service.
	 * @param _logService The log service.
	 * @param _storageService The storage service.
	 * @param _configurationService The configuration service.
	 */
	constructor(
		@IExtensionService private readonly _extensionService: IExtensionService,
		@ILogService private readonly _logService: ILogService
	) {
		// Call the base class's constructor.
		super();

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

		this._extensionService.whenAllExtensionHostsStarted().then(async () => {
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
	 * Completes the language runtime discovery phase. If no runtimes were
	 * started or will be started, automatically start one.
	 */
	completeDiscovery(): void {
		this._onDidChangeDiscoveryPhaseEmitter.fire(LanguageRuntimeDiscoveryPhase.Complete);
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
