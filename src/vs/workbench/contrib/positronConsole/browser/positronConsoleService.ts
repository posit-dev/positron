/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { ILogService } from 'vs/platform/log/common/log';
import { ILanguageService } from 'vs/editor/common/languages/language';
import { PositronConsoleInstance } from 'vs/workbench/contrib/positronConsole/browser/positronConsoleInstance';
import { IPositronConsoleInstance, IPositronConsoleOptions, IPositronConsoleService } from 'vs/workbench/services/positronConsole/common/positronConsole';
import { formatLanguageRuntime, ILanguageRuntime, ILanguageRuntimeService, RuntimeState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

/**
 * PositronConsoleService class.
 */
export class PositronConsoleService extends Disposable implements IPositronConsoleService {
	//#region Private Properties

	/**
	 * A map of the running Positron console instances by runtime ID.
	 */
	private readonly _runningPositronConsoleInstancesByRuntimeId = new Map<string, IPositronConsoleInstance>();

	private readonly _runningInstancesByLanguageId = new Map<string, IPositronConsoleInstance>();

	private _activePositronConsoleInstance?: IPositronConsoleInstance;

	private readonly _onDidStartConsoleEmitter = this._register(new Emitter<IPositronConsoleInstance>);

	private readonly _onDidChangeActiveConsoleEmitter = this._register(new Emitter<IPositronConsoleInstance | undefined>);

	//#endregion Private Properties

	//#region Constructor & Dispose

	/**
	 * Constructor.
	 */
	constructor(
		@ILanguageRuntimeService private _languageRuntimeService: ILanguageRuntimeService,
		@ILanguageService _languageService: ILanguageService,
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
			const instance = this._runningPositronConsoleInstancesByRuntimeId.get(this._languageRuntimeService.activeRuntime.metadata.runtimeId);
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
				const instance = this._runningPositronConsoleInstancesByRuntimeId.get(runtime.metadata.runtimeId);
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
	readonly onDidStartConsole = this._onDidStartConsoleEmitter.event;

	// An event that is fired when the active REPL instance changes.
	readonly onDidChangeActiveConsole = this._onDidChangeActiveConsoleEmitter.event;

	// Gets the repl instances.
	get instances(): IPositronConsoleInstance[] {
		return Array.from(this._runningPositronConsoleInstancesByRuntimeId.values());
	}

	// Gets the active REPL instance.
	get activeInstance(): IPositronConsoleInstance | undefined {
		return this._activePositronConsoleInstance;
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
	 * Starts a new Positron console instance.
	 * @param runtime The language runtime to bind to the new Positron console instance.
	 * @returns The new Positron console instance.
	 */
	private startConsole(runtime: ILanguageRuntime): IPositronConsoleInstance {
		// Log.
		this._logService.trace(`Starting REPL for language runtime ${formatLanguageRuntime(runtime)}.`);

		// Create the new REPL instance.
		const instance = new PositronConsoleInstance(runtime.metadata.languageId, runtime);

		// Add the REPL instance to the running instances.
		this._runningPositronConsoleInstancesByRuntimeId.set(runtime.metadata.runtimeId, instance);
		this._runningInstancesByLanguageId.set(runtime.metadata.languageId, instance);

		// Fire the onDidStartRepl event.
		this._onDidStartConsoleEmitter.fire(instance);

		// When the runtime exits, see if the user wants to restart it.
		this._register(runtime.onDidChangeRuntimeState(state => {
			if (state === RuntimeState.Exited) {
				this._runningPositronConsoleInstancesByRuntimeId.delete(runtime.metadata.runtimeId);
				this._runningInstancesByLanguageId.delete(runtime.metadata.languageId);
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
		this._activePositronConsoleInstance = instance;
		this._onDidChangeActiveConsoleEmitter.fire(instance);
	}

	//#endregion Private Methods
}
