/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from '../../../../nls.js';
import { Event, Emitter } from '../../../../base/common/event.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { Disposable, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ILanguageRuntimeMetadata, ILanguageRuntimeService, RuntimeStartupPhase, formatLanguageRuntimeMetadata } from './languageRuntimeService.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions, ConfigurationScope, IConfigurationNode, } from '../../../../platform/configuration/common/configurationRegistry.js';
import { ISettableObservable, observableValue } from '../../../../base/common/observableInternal/base.js';

/**
 * The implementation of ILanguageRuntimeService
 */
export class LanguageRuntimeService extends Disposable implements ILanguageRuntimeService {
	//#region Private Properties

	// A map of the registered runtimes. This is keyed by the runtimeId
	// (metadata.runtimeId) of the runtime.
	private readonly _registeredRuntimesByRuntimeId = new Map<string, ILanguageRuntimeMetadata>();

	// The event emitter for the onDidRegisterRuntime event.
	private readonly _onDidRegisterRuntimeEmitter =
		this._register(new Emitter<ILanguageRuntimeMetadata>);

	// The current startup phase; an observeable value.
	private _startupPhase: ISettableObservable<RuntimeStartupPhase>;

	//#endregion Private Properties

	//#region Constructor

	/**
	 * Constructor.
	 *
	 * @param _logService The log service.
	 */
	constructor(
		@ILogService private readonly _logService: ILogService
	) {
		// Call the base class's constructor.
		super();

		this._startupPhase = observableValue(
			'runtime-startup-phase', RuntimeStartupPhase.Initializing);
		this.onDidChangeRuntimeStartupPhase = Event.fromObservable(this._startupPhase);
	}

	/**
	 * Sets the startup phase
	 *
	 * @param phase The new phase
	 */
	setStartupPhase(phase: RuntimeStartupPhase): void {
		this._startupPhase.set(phase, undefined);
	}

	//#endregion Constructor

	//#region ILanguageRuntimeService Implementation

	// Needed for service branding in dependency injector.
	declare readonly _serviceBrand: undefined;

	// An event that fires when a new runtime is registered.
	readonly onDidRegisterRuntime = this._onDidRegisterRuntimeEmitter.event;

	/**
	 * Event tracking the current startup phase.
	 */
	onDidChangeRuntimeStartupPhase: Event<RuntimeStartupPhase>;

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
	 * Register a new runtime
	 *
	 * @param metadata The metadata of the runtime to register
	 *
	 * @returns A disposable that unregisters the runtime
	 */
	registerRuntime(metadata: ILanguageRuntimeMetadata): IDisposable {
		// If the runtime has already been registered, return early.
		if (this._registeredRuntimesByRuntimeId.has(metadata.runtimeId)) {
			return this._register(toDisposable(() => { }));
		}

		// Add the runtime to the registered runtimes.
		this._registeredRuntimesByRuntimeId.set(metadata.runtimeId, metadata);

		// Signal that the set of registered runtimes has changed.
		this._onDidRegisterRuntimeEmitter.fire(metadata);

		// Logging.
		this._logService.trace(`Language runtime ${formatLanguageRuntimeMetadata(metadata)} successfully registered.`);

		return this._register(toDisposable(() => {
			this._registeredRuntimesByRuntimeId.delete(metadata.runtimeId);
		}));
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
	 * Returns a specific runtime by runtime identifier.
	 * @param runtimeId The runtime identifier of the runtime to retrieve.
	 * @returns The runtime with the given runtime identifier, or undefined if
	 * no runtime with the given runtime identifier exists.
	 */
	getRuntime(runtimeId: string): ILanguageRuntimeMetadata | undefined {
		return this._registeredRuntimesByRuntimeId.get(runtimeId);
	}

	/**
	 * Returns the current startup phase.
	 */
	get startupPhase(): RuntimeStartupPhase {
		return this._startupPhase.get();
	}

	//#endregion ILanguageRuntimeService Implementation
}

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
		'interpreters.restartOnCrash': {
			scope: ConfigurationScope.MACHINE_OVERRIDABLE,
			type: 'boolean',
			default: true,
			description: nls.localize('positron.runtime.restartOnCrash', "When enabled, interpreters are automatically restarted after a crash.")
		},
		'interpreters.startupBehavior': {
			scope: ConfigurationScope.LANGUAGE_OVERRIDABLE,
			type: 'string',
			enum: [
				'always',
				'auto',
				'recommended',
				'manual',
				'disabled'
			],
			default: 'auto',
			enumDescriptions: [
				nls.localize(
					'positron.runtime.startupBehavior.always',
					"An interpreter will always start when a new Positron window is opened; the last used interpreter will start if available, and a default will be chosen otherwise."),
				nls.localize(
					'positron.runtime.startupBehavior.auto',
					"An interpreter will start when needed, or if it was previously used in the workspace."),
				nls.localize(
					'positron.runtime.startupBehavior.recommended',
					"An interpreter will start when the extension providing the interpreter recommends it."),
				nls.localize(
					'positron.runtime.startupBehavior.manual',
					"Interpreters will only start when manually selected."),
				nls.localize(
					'positron.runtime.startupBehavior.disabled',
					"Interpreters are disabled. You will not be able to select an interpreter."),
			],
			description: nls.localize(
				'positron.runtime.automaticStartup',
				"How interpreters are started in new Positron windows."),
			tags: ['interpreterSettings']
		}
	}
});
