/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from '../../../../nls.js';
import { Event, Emitter } from '../../../../base/common/event.js';
import { tildify } from '../../../../base/common/labels.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { Disposable, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ILanguageRuntimeMetadata, ILanguageRuntimeService, IRuntimePickerContribution, LanguageStartupBehavior, RuntimeStartupPhase, formatLanguageRuntimeMetadata } from './languageRuntimeService.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions, ConfigurationScope, IConfigurationNode, } from '../../../../platform/configuration/common/configurationRegistry.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ISettableObservable, observableValue } from '../../../../base/common/observable.js';
import { IPathService } from '../../../services/path/common/pathService.js';

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

	// The event emitter for the onDidUnregisterRuntime event.
	private readonly _onDidUnregisterRuntimeEmitter =
		this._register(new Emitter<string>);

	// The current startup phase; an observeable value.
	private _startupPhase: ISettableObservable<RuntimeStartupPhase>;

	// Map of picker contributions by handle
	private readonly _pickerContributions = new Map<number, IRuntimePickerContribution>();

	// Cached user home path (remote-aware). Populated eagerly in the constructor
	// so registerRuntime can run synchronously.
	private _cachedUserHome: string | undefined;

	//#endregion Private Properties

	//#region Constructor

	/**
	 * Constructor.
	 *
	 * @param _logService The log service.
	 * @param _configurationService The configuration service.
	 */
	constructor(
		@ILogService private readonly _logService: ILogService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IPathService private readonly _pathService: IPathService,
	) {
		// Call the base class's constructor.
		super();

		this._startupPhase = observableValue(
			'runtime-startup-phase', RuntimeStartupPhase.Initializing);
		this.onDidChangeRuntimeStartupPhase = Event.fromObservable(this._startupPhase);

		// Kick off the remote-aware home resolution eagerly so it's likely
		// cached by the time extensions call registerRuntime. If it hasn't
		// resolved yet, registerRuntime skips tildification rather than
		// falling back to the local-only path.
		this._pathService.userHome({ preferLocal: false }).then(uri => {
			this._cachedUserHome = uri.fsPath;
		});
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

	// An event that fires when a runtime is unregistered, carrying its runtimeId.
	readonly onDidUnregisterRuntime = this._onDidUnregisterRuntimeEmitter.event;

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

		// Check the startup behavior for this language. If it's totally disabled,
		// we can't perform the registration.
		const startupBehavior = this._configurationService.getValue<LanguageStartupBehavior>(
			'interpreters.startupBehavior', { overrideIdentifier: metadata.languageId });
		if (startupBehavior === LanguageStartupBehavior.Disabled) {
			this._logService.info(
				`Attempt to register language runtime ${formatLanguageRuntimeMetadata(metadata)}, ` +
				`but language '${metadata.languageId}' is disabled.`);
			throw new Error(`Cannot register '${metadata.runtimeName}' because ` +
				`the '${metadata.languageId}' language is disabled.`);
		}

		// Enrich metadata with a workbench-computed display path (~-shortened
		// on non-Windows; absolute path unchanged on Windows or system paths).
		// Preserve a caller-supplied runtimeDisplayPath; only compute when absent.
		let runtimeDisplayPath = metadata.runtimeDisplayPath;
		if (!runtimeDisplayPath && this._cachedUserHome) {
			runtimeDisplayPath = tildify(metadata.runtimePath, this._cachedUserHome);
		}
		// If _cachedUserHome isn't ready yet, leave runtimeDisplayPath undefined;
		// getRuntimeDisplayPath() falls back to the raw runtimePath.
		const enriched: ILanguageRuntimeMetadata = {
			...metadata,
			runtimeDisplayPath,
		};

		// Add the runtime to the registered runtimes.
		this._registeredRuntimesByRuntimeId.set(enriched.runtimeId, enriched);

		// Signal that the set of registered runtimes has changed.
		this._onDidRegisterRuntimeEmitter.fire(enriched);

		// Logging.
		this._logService.trace(`Language runtime ${formatLanguageRuntimeMetadata(metadata)} successfully registered.`);

		return this._register(toDisposable(() => {
			this.unregisterRuntime(metadata.runtimeId);
		}));
	}

	/**
	 * Unregister a runtime
	 *
	 * @param runtimeId The runtime identifier of the runtime to unregister
	 */
	unregisterRuntime(runtimeId: string): void {
		if (this._registeredRuntimesByRuntimeId.delete(runtimeId)) {
			this._onDidUnregisterRuntimeEmitter.fire(runtimeId);
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

	/**
	 * Returns the current startup phase.
	 */
	get startupPhase(): RuntimeStartupPhase {
		return this._startupPhase.get();
	}

	/**
	 * Register a runtime picker contribution.
	 *
	 * @param contribution The contribution to register
	 * @returns A disposable that unregisters the contribution when disposed
	 */
	registerPickerContribution(contribution: IRuntimePickerContribution): IDisposable {
		this._pickerContributions.set(contribution.handle, contribution);
		this._logService.trace(`Picker contribution registered for language '${contribution.languageId}' with handle ${contribution.handle}`);

		return toDisposable(() => {
			this._pickerContributions.delete(contribution.handle);
			this._logService.trace(`Picker contribution unregistered with handle ${contribution.handle}`);
		});
	}

	/**
	 * Get all picker contributions for a language.
	 *
	 * @param languageId Optional language ID to filter by
	 * @returns Array of registered contributions
	 */
	getPickerContributions(languageId?: string): IRuntimePickerContribution[] {
		const contributions = Array.from(this._pickerContributions.values());
		if (languageId) {
			return contributions.filter(c => c.languageId === languageId);
		}
		return contributions;
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
		},
		'interpreters.discoveryCache.enabled': {
			scope: ConfigurationScope.APPLICATION_MACHINE,
			type: 'boolean',
			default: true,
			description: nls.localize(
				'positron.runtime.discoveryCache.enabled',
				"Reuse previously discovered interpreters to speed up Positron startup."),
			tags: ['interpreterSettings']
		},
		'interpreters.discoveryCache.maxAgeDays': {
			scope: ConfigurationScope.APPLICATION_MACHINE,
			type: 'number',
			default: 30,
			minimum: 1,
			description: nls.localize(
				'positron.runtime.discoveryCache.maxAgeDays',
				"Number of days a cached interpreter is reused before it is rediscovered."),
			tags: ['interpreterSettings']
		},
		'interpreters.discoveryCache.refreshIntervalDays': {
			scope: ConfigurationScope.APPLICATION_MACHINE,
			type: 'number',
			default: 1,
			minimum: 1,
			description: nls.localize(
				'positron.runtime.discoveryCache.refreshIntervalDays',
				"How often (in days) to run a full interpreter discovery to detect newly installed interpreters."),
			tags: ['interpreterSettings']
		}
	}
});
