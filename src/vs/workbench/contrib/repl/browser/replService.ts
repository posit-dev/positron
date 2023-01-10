/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { ILogService } from 'vs/platform/log/common/log';
import { ILanguageService } from 'vs/editor/common/languages/language';
import { ReplInstance } from 'vs/workbench/contrib/repl/browser/replInstance';
import { ICreateReplOptions, IReplInstance, IReplService } from 'vs/workbench/contrib/repl/browser/repl';
import { formatLanguageRuntime, ILanguageRuntime, ILanguageRuntimeService, RuntimeState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

/**
 * The implementation of IReplService
 */
export class ReplService extends Disposable implements IReplService {
	//#region Private Properties

	// A map of the running REPL instances. This is keyed by the id (metadata.id) of the language runtime.
	private readonly _runningInstancesById = new Map<string, IReplInstance>();

	// A map of the running REPL instances. This is keyed by the language id of the language runtime.
	private readonly _runningInstancesByLanguageId = new Map<string, IReplInstance>();

	/** The set of active REPL instances */
	private _activeInstance?: IReplInstance;

	// The event emitter for the onDidStartRepl event.
	private readonly _onDidStartRepl = this._register(new Emitter<IReplInstance>);

	// The event emitter for the onDidChangeActiveRepl event.
	private readonly _onDidChangeActiveRepl = this._register(new Emitter<IReplInstance | undefined>);

	//#endregion Private Properties

	//#region Constructor & Dispose

	/**
	 * Construct a new REPL service from injected services
	 */
	constructor(
		@ILanguageRuntimeService private _languageRuntimeService: ILanguageRuntimeService,
		@ILanguageService private readonly _languageService: ILanguageService,
		@ILogService private _logService: ILogService,
	) {
		// Call the disposable constrcutor.
		super();

		// Start a REPL instance for each running language runtime.
		this._languageRuntimeService.runningRuntimes.forEach(runtime => {
			this.startRepl(runtime);
		});

		// Get the active language runtime. If there is one, activate the REPL for it.
		if (this._languageRuntimeService.activeRuntime) {
			const instance = this._runningInstancesById.get(this._languageRuntimeService.activeRuntime.metadata.id);
			if (instance) {
				this.setActiveRepl(instance);
			} else {
				this._logService.error(`Language runtime ${formatLanguageRuntime(this._languageRuntimeService.activeRuntime)} is active, but a REPL instance for it was not started.`);
			}
		}

		// Register the onDidStartRuntime event handler so we start a new REPL for each runtime that is started.
		this._register(this._languageRuntimeService.onDidStartRuntime(runtime => {
			// Note that we do not automatically activate the new REPL. Instead, we wait for onDidChangeActiveRuntime
			// to be fired by the language runtime service.
			this.startRepl(runtime);
		}));

		// Register the onDidChangeActiveRuntime event handler so we can activate the REPL for the active runtime.
		this._register(this._languageRuntimeService.onDidChangeActiveRuntime(runtime => {
			if (!runtime) {
				this.setActiveRepl();
			} else {
				const instance = this._runningInstancesById.get(runtime.metadata.id);
				if (instance) {
					this.setActiveRepl(instance);
				} else {
					this._logService.error(`Language runtime ${formatLanguageRuntime(runtime)} became active, but a REPL instance for it is not running.`);
				}
			}
		}));
	}

	//#endregion Constructor & Dispose

	//#region IReplService Implementation

	// Needed for service branding in dependency injector.
	declare readonly _serviceBrand: undefined;

	// An event that is fired when a REPL instance is started.
	readonly onDidStartRepl = this._onDidStartRepl.event;

	// An event that is fired when the active REPL instance changes.
	readonly onDidChangeActiveRepl = this._onDidChangeActiveRepl.event;

	// Gets the repl instances.
	get instances(): IReplInstance[] {
		return Array.from(this._runningInstancesById.values());
	}

	// Gets the active REPL instance.
	get activeInstance(): IReplInstance | undefined {
		return this._activeInstance;
	}

	/**
	 * Creates a new REPL instance and returns it.
	 * @param options The REPL's settings
	 * @returns A promise that resolves to the newly created REPL instance.
	 */
	async createRepl(options?: ICreateReplOptions | undefined): Promise<IReplInstance> {
		// TODO@softwarenerd - This exists for ReplCommandId.New. It might / should go away.
		const runtime = this._languageRuntimeService.activeRuntime;
		if (!runtime) {
			throw new Error('Cannot create REPL; no language runtime is active.');
		}
		return this.startRepl(runtime);
	}

	/**
	 * Clears the currently active REPL instance.
	 */
	clearActiveRepl(): void {
		if (this._activeInstance) {
			this._activeInstance.clear();
		} else {
			this._logService.warn('Clear REPL command issued when no REPL is active; ignoring.');
		}
	}

	/**
	 * Executes code in the REPL active for the language.
	 * @param languageId The language of the code.
	 * @param code The code to execute.
	 */
	executeCode(languageId: string, code: string): void {
		const instance = this._runningInstancesByLanguageId.get(languageId);
		if (!instance) {
			this._logService.error(`Cannot execute code fragment '${code}' in language ${languageId} because no REPL is active for that language.`);
		} else {
			instance.executeCode(code);
		}
	}

	//#endregion IReplService Implementation

	//#region Private Methods

	/**
	 * Starts a new REPL instance.
	 * @param runtime The language runtime to bind to the new REPL instance.
	 * @returns The new REPL instance.
	 */
	private startRepl(runtime: ILanguageRuntime): IReplInstance {
		// Look up supported language ID for this runtime.
		const languageId = this._languageService.getLanguageIdByLanguageName(runtime.metadata.language);
		if (!languageId) {
			throw new Error(`Language runtime ${formatLanguageRuntime(runtime)} was not found in the language service.`);
		}

		// Log.
		this._logService.trace(`Starting REPL for language runtime ${formatLanguageRuntime(runtime)}.`);

		// Create the new REPL instance.
		const instance = new ReplInstance(languageId, runtime);

		// Add the REPL instance to the running instances.
		this._runningInstancesById.set(runtime.metadata.id, instance);
		this._runningInstancesByLanguageId.set(languageId, instance);

		// Fire the onDidStartRepl event.
		this._onDidStartRepl.fire(instance);

		// When the runtime exits, see if the user wants to restart it.
		this._register(runtime.onDidChangeRuntimeState(state => {
			if (state === RuntimeState.Exited) {
				this._runningInstancesById.delete(runtime.metadata.id);
				this._runningInstancesByLanguageId.delete(languageId);
			}
		}));

		// Return the instance.
		return instance;
	}

	/**
	 * Sets the
	 * @param instance
	 */
	private setActiveRepl(instance?: IReplInstance) {
		// Log.
		if (instance) {
			this._logService.trace(`Activating REPL for language runtime ${formatLanguageRuntime(instance.runtime)}.`);
		}

		// Set the active instance and fire the onDidChangeActiveRepl event.
		this._activeInstance = instance;
		this._onDidChangeActiveRepl.fire(instance);
	}

	//#endregion Private Methods
}
