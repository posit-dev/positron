/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { ILogService } from 'vs/platform/log/common/log';
import { ILanguageService } from 'vs/editor/common/languages/language';
import { formatLanguageRuntime, ILanguageRuntime, ILanguageRuntimeService, RuntimeState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { PositronConsoleInstance } from 'vs/workbench/contrib/positronConsole/browser/positronConsoleInstance';
import { IPositronConsoleInstance, IPositronConsoleOptions, IPositronConsoleService } from 'vs/workbench/services/positronConsole/common/positronConsole';

/**
 * PositronConsoleService class.
 */
export class PositronConsoleService extends Disposable implements IPositronConsoleService {
	//#region Private Properties

	private readonly _runningInstancesById = new Map<string, IPositronConsoleInstance>();

	private readonly _runningInstancesByLanguageId = new Map<string, IPositronConsoleInstance>();

	private _activeInstance?: IPositronConsoleInstance;

	private readonly _onDidStartConsole = this._register(new Emitter<IPositronConsoleInstance>);

	private readonly _onDidChangeActiveConsole = this._register(new Emitter<IPositronConsoleInstance | undefined>);

	//#endregion Private Properties

	//#region Constructor & Dispose

	/**
	 * Constructor.
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
			this.startConsole(runtime);
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
			this.startConsole(runtime);
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

	//#region IPositronConsoleService Implementation

	// Needed for service branding in dependency injector.
	declare readonly _serviceBrand: undefined;

	// An event that is fired when a REPL instance is started.
	readonly onDidStartConsole = this._onDidStartConsole.event;

	// An event that is fired when the active REPL instance changes.
	readonly onDidChangeActiveConsole = this._onDidChangeActiveConsole.event;

	// Gets the repl instances.
	get instances(): IPositronConsoleInstance[] {
		return Array.from(this._runningInstancesById.values());
	}

	// Gets the active REPL instance.
	get activeInstance(): IPositronConsoleInstance | undefined {
		return this._activeInstance;
	}

	/**
	 * Creates a new REPL instance and returns it.
	 * @param options The REPL's settings
	 * @returns A promise that resolves to the newly created REPL instance.
	 */
	async createConsole(options?: IPositronConsoleOptions | undefined): Promise<IPositronConsoleInstance> {
		// TODO@softwarenerd - This exists for ReplCommandId.New. It might / should go away.
		const runtime = this._languageRuntimeService.activeRuntime;
		if (!runtime) {
			throw new Error('Cannot create REPL; no language runtime is active.');
		}
		return this.startConsole(runtime);
	}

	/**
	 * Clears the currently active REPL instance.
	 */
	clearActiveConsole(): void {
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

	//#endregion IPositronConsoleService Implementation

	//#region Private Methods

	/**
	 * Starts a new REPL instance.
	 * @param runtime The language runtime to bind to the new REPL instance.
	 * @returns The new REPL instance.
	 */
	private startConsole(runtime: ILanguageRuntime): IPositronConsoleInstance {
		// Look up supported language ID for this runtime.
		const languageId = this._languageService.getLanguageIdByLanguageName(runtime.metadata.language);
		if (!languageId) {
			throw new Error(`Language runtime ${formatLanguageRuntime(runtime)} was not found in the language service.`);
		}

		// Log.
		this._logService.trace(`Starting REPL for language runtime ${formatLanguageRuntime(runtime)}.`);

		// Create the new REPL instance.
		const instance = new PositronConsoleInstance(languageId, runtime);

		// Add the REPL instance to the running instances.
		this._runningInstancesById.set(runtime.metadata.id, instance);
		this._runningInstancesByLanguageId.set(languageId, instance);

		// Fire the onDidStartRepl event.
		this._onDidStartConsole.fire(instance);

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
	private setActiveRepl(instance?: IPositronConsoleInstance) {
		// Log.
		if (instance) {
			this._logService.trace(`Activating REPL for language runtime ${formatLanguageRuntime(instance.runtime)}.`);
		}

		// Set the active instance and fire the onDidChangeActiveRepl event.
		this._activeInstance = instance;
		this._onDidChangeActiveConsole.fire(instance);
	}

	//#endregion Private Methods
}
