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
import { createInterpreterVariant, getMatchingDefinitions, IInterpreterDefinition, INTERPRETER_DEFINITIONS_KEY, INTERPRETER_DISCOVERY_KEY } from './interpreterDefinitions.js';

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

	// Variant runtime IDs (from interpreters.definitions) by the ID of the runtime they derive from
	private readonly _variantIdsByBaseId = new Map<string, string[]>();

	// Runtimes found only because a definition points at them, by runtime ID.
	// They are not shown, but their variants are derived from them.
	private readonly _definitionOnlyRuntimesByRuntimeId = new Map<string, ILanguageRuntimeMetadata>();

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

		// Re-derive interpreter variants when their definitions change.
		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(INTERPRETER_DEFINITIONS_KEY)) {
				const definitions = this._configurationService.getValue<IInterpreterDefinition[]>(INTERPRETER_DEFINITIONS_KEY);
				for (const runtime of [...this.registeredRuntimes, ...this._definitionOnlyRuntimesByRuntimeId.values()]) {
					if (!runtime.interpreterDefinition) {
						this._registerVariants(runtime);
					} else if (!getMatchingDefinitions(definitions, runtime).some(d => d.label === runtime.interpreterDefinition)) {
						// Also covers variants registered directly (restored or validated) before their base.
						this.unregisterRuntime(runtime.runtimeId);
					}
				}
			}
		}));
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
		if (this._registeredRuntimesByRuntimeId.has(metadata.runtimeId) || this._definitionOnlyRuntimesByRuntimeId.has(metadata.runtimeId)) {
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

		// A definition-only runtime is not shown; register just its variants.
		// When discovery is limited to definitions, every runtime that is not a
		// variant is treated this way, wherever it came from (discovery, the
		// cache, a workspace's saved interpreter, a newly created environment).
		const definitionsOnly = !enriched.interpreterDefinition && this._configurationService.getValue<string>(
			INTERPRETER_DISCOVERY_KEY, { overrideIdentifier: enriched.languageId }) === 'definitionsOnly';
		if (enriched.definitionOnly || definitionsOnly) {
			this._definitionOnlyRuntimesByRuntimeId.set(enriched.runtimeId, enriched);
			this._registerVariants(enriched);
			return this._register(toDisposable(() => {
				this.unregisterRuntime(metadata.runtimeId);
			}));
		}

		// Add the runtime to the registered runtimes.
		this._registeredRuntimesByRuntimeId.set(enriched.runtimeId, enriched);

		// Signal that the set of registered runtimes has changed.
		this._onDidRegisterRuntimeEmitter.fire(enriched);

		// Logging.
		this._logService.trace(`Language runtime ${formatLanguageRuntimeMetadata(metadata)} successfully registered.`);

		this._registerVariants(enriched);

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
		this._definitionOnlyRuntimesByRuntimeId.delete(runtimeId);
		this._unregisterVariants(runtimeId);
	}

	/**
	 * Register a variant of a runtime for each interpreter definition that
	 * matches it, and unregister its variants that no longer match. Variants
	 * that are unchanged stay registered.
	 */
	private _registerVariants(base: ILanguageRuntimeMetadata): void {
		if (base.interpreterDefinition) {
			return;
		}
		const definitions = this._configurationService.getValue<IInterpreterDefinition[]>(INTERPRETER_DEFINITIONS_KEY);
		const variants = getMatchingDefinitions(definitions, base).map(definition => createInterpreterVariant(base, definition));
		const variantIds = variants.map(variant => variant.runtimeId);
		const staleIds = (this._variantIdsByBaseId.get(base.runtimeId) ?? []).filter(id => !variantIds.includes(id));
		this._variantIdsByBaseId.set(base.runtimeId, variantIds);
		for (const staleId of staleIds) {
			this.unregisterRuntime(staleId);
		}
		for (const variant of variants) {
			this.registerRuntime(variant);
		}
	}

	/**
	 * Unregister the variants derived from a runtime.
	 */
	private _unregisterVariants(baseId: string): void {
		const variantIds = this._variantIdsByBaseId.get(baseId) ?? [];
		this._variantIdsByBaseId.delete(baseId);
		for (const variantId of variantIds) {
			this.unregisterRuntime(variantId);
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
					"An interpreter may start, if the language extension providing the interpreter recommends it."),
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
		'interpreters.unsavedScriptsDirectory': {
			scope: ConfigurationScope.MACHINE_OVERRIDABLE,
			type: 'string',
			default: '',
			description: nls.localize(
				'positron.runtime.unsavedScriptsDirectory',
				"Directory for temporary files created when running unsaved scripts. When empty, the workspace root is used (or the system temporary directory when no workspace is open)."),
			tags: ['interpreterSettings']
		},
		[INTERPRETER_DEFINITIONS_KEY]: {
			scope: ConfigurationScope.MACHINE,
			type: 'array',
			default: [],
			markdownDescription: nls.localize(
				'positron.runtime.definitions',
				"Additional interpreters, each with its own environment variables and startup script. R and Python are fully supported; other languages work to the extent their extension supports definitions. If Positron also finds the interpreter at `path` on its own, that interpreter stays available too; otherwise only the defined interpreter is shown, and a new one appears after Positron restarts. Variables the startup script sets are also applied to terminals while the interpreter is active. `path` must be the absolute runtime path; do not use shortened display paths such as `~`. Can only be set in user or remote settings."),
			items: {
				type: 'object',
				required: ['language', 'path', 'label'],
				additionalProperties: false,
				properties: {
					language: {
						type: 'string',
						examples: ['r', 'python'],
						description: nls.localize('positron.runtime.definitions.language', "The language ID of the interpreter, such as r or python.")
					},
					path: {
						type: 'string',
						description: nls.localize('positron.runtime.definitions.path', "Absolute path of the interpreter. It does not need to be one Positron finds on its own. Do not use shortened display paths such as ~.")
					},
					label: {
						type: 'string',
						description: nls.localize('positron.runtime.definitions.label', "The name shown for this interpreter. Must be unique for each language.")
					},
					env: {
						type: 'object',
						additionalProperties: { type: 'string' },
						description: nls.localize('positron.runtime.definitions.env', "Environment variables to set for this interpreter.")
					},
					startupScript: {
						type: 'string',
						description: nls.localize('positron.runtime.definitions.startupScript', "Shell script to source before starting this interpreter. The environment variables it sets are applied to the interpreter and to terminals; variables it unsets are not removed. Not supported on Windows.")
					},
				}
			},
			tags: ['interpreterSettings']
		},
		[INTERPRETER_DISCOVERY_KEY]: {
			scope: ConfigurationScope.LANGUAGE_OVERRIDABLE,
			type: 'string',
			enum: ['auto', 'definitionsOnly'],
			default: 'auto',
			markdownEnumDescriptions: [
				nls.localize(
					'positron.runtime.discovery.auto',
					"Positron finds interpreters installed on this system, and also shows the ones in `#interpreters.definitions#`."),
				nls.localize(
					'positron.runtime.discovery.definitionsOnly',
					"Positron does not look for interpreters. Only the ones in `#interpreters.definitions#` are available, and other interpreter discovery settings are ignored. To limit this to one language, set it for that language only, for example in `\"[python]\"`."),
			],
			markdownDescription: nls.localize(
				'positron.runtime.discovery',
				"How Positron finds interpreters. Can be set for each language. Requires a restart to take effect."),
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
