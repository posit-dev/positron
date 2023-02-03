/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { ILogService } from 'vs/platform/log/common/log';
import { ILanguageService } from 'vs/editor/common/languages/language';
import { PositronConsoleInstance } from 'vs/workbench/contrib/positronConsole/browser/positronConsoleInstance';
import { IPositronConsoleInstance, IPositronConsoleService } from 'vs/workbench/services/positronConsole/common/positronConsole';
import { formatLanguageRuntime, ILanguageRuntime, ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

/**
 * PositronConsoleService class.
 */
export class PositronConsoleService extends Disposable implements IPositronConsoleService {
	//#region Private Properties

	/**
	 * A map of the running Positron console instances by runtime ID.
	 */
	private readonly _runningPositronConsoleInstancesByRuntimeId = new Map<string, IPositronConsoleInstance>();

	/**
	 * A map of the running Positron console instances by language ID.
	 */
	private readonly _runningPositronConsoleInstancesByLanguageId = new Map<string, IPositronConsoleInstance>();

	/**
	 * The active Positron console instance.
	 */
	private _activePositronConsoleInstance?: IPositronConsoleInstance;

	/**
	 * The onDidStartPositronConsoleInstance event emitter.
	 */
	private readonly _onDidStartPositronConsoleInstanceEmitter = this._register(new Emitter<IPositronConsoleInstance>);

	/**
	 * The onDidChangeActivePositronConsoleInstance event emitter.
	 */
	private readonly _onDidChangeActivePositronConsoleInstanceEmitter = this._register(new Emitter<IPositronConsoleInstance | undefined>);

	//#endregion Private Properties

	//#region Constructor & Dispose

	/**
	 * Constructor.
	 * @param _languageRuntimeService The language runtime service.
	 * @param _languageService The language service.
	 * @param _logService The log service.
	 */
	constructor(
		@ILanguageRuntimeService private _languageRuntimeService: ILanguageRuntimeService,
		@ILanguageService _languageService: ILanguageService,
		@ILogService private _logService: ILogService,
	) {
		// Call the disposable constrcutor.
		super();

		// Start a Positron console instance for each running language runtime.
		this._languageRuntimeService.runningRuntimes.forEach(runtime => {
			this.startPositronConsoleInstance(runtime);
		});

		// Get the active language runtime. If there is one, set the active Positron console instance.
		if (this._languageRuntimeService.activeRuntime) {
			const positronConsoleInstance = this._runningPositronConsoleInstancesByRuntimeId.get(this._languageRuntimeService.activeRuntime.metadata.runtimeId);
			if (positronConsoleInstance) {
				this.setActivePositronConsoleInstance(positronConsoleInstance);
			} else {
				this._logService.error(`Language runtime ${formatLanguageRuntime(this._languageRuntimeService.activeRuntime)} is active, but a Positron console instance for it was not started.`);
			}
		}

		// !!!!!!!!!!!!!!!!!!!
		// Register the onDidStartRuntime event handler so we start a new REPL for each runtime that is started.
		this._register(this._languageRuntimeService.onDidStartRuntime(runtime => {
			// Note that we do not automatically activate the new REPL. Instead, we wait for onDidChangeActiveRuntime
			// to be fired by the language runtime service.
			//this.startConsole(runtime);
		}));
		// !!!!!!!!!!!!!!!!!!!

		// Register the onDidBeginStartRuntime event handler so we start a new Positron console.
		this._register(this._languageRuntimeService.onDidBeginStartRuntime(runtime => {
			console.log('Starting console.');
			this.startPositronConsoleInstance(runtime);
		}));

		// Register the onDidChangeActiveRuntime event handler so we can activate the REPL for the active runtime.
		this._register(this._languageRuntimeService.onDidChangeActiveRuntime(runtime => {
			if (!runtime) {
				this.setActivePositronConsoleInstance();
			} else {
				const positronConsoleInstance = this._runningPositronConsoleInstancesByRuntimeId.get(runtime.metadata.runtimeId);
				if (positronConsoleInstance) {
					this.setActivePositronConsoleInstance(positronConsoleInstance);
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
	readonly onDidStartPositronConsoleInstance = this._onDidStartPositronConsoleInstanceEmitter.event;

	// An event that is fired when the active REPL instance changes.
	readonly onDidChangeActivePositronConsoleInstance = this._onDidChangeActivePositronConsoleInstanceEmitter.event;

	// Gets the repl instances.
	get positronConsoleInstances(): IPositronConsoleInstance[] {
		return Array.from(this._runningPositronConsoleInstancesByRuntimeId.values());
	}

	// Gets the active REPL instance.
	get activePositronConsoleInstance(): IPositronConsoleInstance | undefined {
		return this._activePositronConsoleInstance;
	}

	// /**
	//  * Creates a new REPL instance and returns it.
	//  * @param options The REPL's settings
	//  * @returns A promise that resolves to the newly created REPL instance.
	//  */
	// async createPositronConsoleInstance(options?: IPositronConsoleOptions | undefined): Promise<IPositronConsoleInstance> {
	// 	// TODO@softwarenerd - This exists for ReplCommandId.New. It might / should go away.
	// 	const runtime = this._languageRuntimeService.activeRuntime;
	// 	if (!runtime) {
	// 		throw new Error('Cannot create REPL; no language runtime is active.');
	// 	}
	// 	return this.startPositronConsoleInstance(runtime);
	// }

	/**
	 * Executes code in a PositronConsoleInstance.
	 * @param languageId The language ID.
	 * @param code The code.
	 * @returns A value which indicates whether the code could be executed.
	 */
	executeCode(languageId: string, code: string): boolean {
		const positronConsoleInstance = this._runningPositronConsoleInstancesByLanguageId.get(languageId);
		if (!positronConsoleInstance) {
			// TODO@softwarenerd - See if we can start a new runtime for the language.
			return false;
		} else {
			positronConsoleInstance.executeCode(code);
			return true;
		}
	}

	//#endregion IPositronConsoleService Implementation

	//#region Private Methods

	/**
	 * Starts a new Positron console instance for the specified language runtime.
	 * @param runtime The language runtime to bind to the new Positron console instance.
	 * @returns The new Positron console instance.
	 */
	private startPositronConsoleInstance(runtime: ILanguageRuntime): IPositronConsoleInstance {
		// Log.
		this._logService.trace(`Starting Positron console for language runtime ${formatLanguageRuntime(runtime)}.`);

		// Create the new Positron console instance.
		const positronConsoleInstance = new PositronConsoleInstance(runtime);

		// Add the Positron console instance to the running instances.
		this._runningPositronConsoleInstancesByRuntimeId.set(runtime.metadata.runtimeId, positronConsoleInstance);
		this._runningPositronConsoleInstancesByLanguageId.set(runtime.metadata.languageId, positronConsoleInstance);

		// Fire the onDidStartConsole event.
		this._onDidStartPositronConsoleInstanceEmitter.fire(positronConsoleInstance);

		// When the runtime exits, see if the user wants to restart it.
		// TODO@softwarenerd - The Positron console instance should handle this event and go into a exited state.
		// this._register(runtime.onDidChangeRuntimeState(state => {
		// 	if (state === RuntimeState.Exited) {
		// 		this._runningPositronConsoleInstancesByRuntimeId.delete(runtime.metadata.runtimeId);
		// 		this._runningPositronConsoleInstancesByLanguageId.delete(runtime.metadata.languageId);
		// 	}
		// }));

		// Return the instance.
		return positronConsoleInstance;
	}

	/**
	 * Sets the active Positron console instance.
	 * @param positronConsoleInstance
	 */
	private setActivePositronConsoleInstance(positronConsoleInstance?: IPositronConsoleInstance) {
		// Log.
		if (positronConsoleInstance) {
			this._logService.trace(`Activating REPL for language runtime ${formatLanguageRuntime(positronConsoleInstance.runtime)}.`);
		}

		// Set the active instance and fire the onDidChangeActiveRepl event.
		this._activePositronConsoleInstance = positronConsoleInstance;
		this._onDidChangeActivePositronConsoleInstanceEmitter.fire(positronConsoleInstance);
	}

	//#endregion Private Methods
}
