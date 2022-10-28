/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import { Disposable, IDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { ILanguageRuntime, ILanguageRuntimeService, RuntimeState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { ILogService } from 'vs/platform/log/common/log';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';

/**
 * The implementation of ILanguageRuntimeService
 */
export class LanguageRuntimeService extends Disposable implements ILanguageRuntimeService {
	/** Needed for service branding in dependency injector */
	declare readonly _serviceBrand: undefined;

	private readonly _runtimes: Map<String, ILanguageRuntime> = new Map();

	private readonly _onDidStartRuntime = this._register(new Emitter<ILanguageRuntime>);
	readonly onDidStartRuntime = this._onDidStartRuntime.event;

	constructor(
		@ILogService private readonly _logService: ILogService,
		@ICommandService private readonly _commandService: ICommandService,
	) {
		super();
	}

	/**
	 * Register a new language runtime
	 *
	 * @param runtime The runtime to register
	 * @returns A disposable that unregisters the runtime
	 */
	registerRuntime(runtime: ILanguageRuntime): IDisposable {
		this._runtimes.set(runtime.metadata.id, runtime);
		this._logService.trace(`Added new language runtime: ${runtime.metadata.language} (${runtime.metadata.id})`);
		return toDisposable(() => {
			this._runtimes.delete(runtime.metadata.id);
		});
	}

	/**
	 * Returns the list of all registered runtimes
	 */
	getAllRuntimes(): Array<ILanguageRuntime> {
		return Array.from(this._runtimes.values());
	}

	getActiveRuntime(language: string | null): ILanguageRuntime | undefined {
		// Get all runtimes that match the language; return the first one.
		const runtimes = this.getActiveLanguageRuntimes(language);
		if (runtimes.length > 0) {
			return runtimes[0];
		}

		// If there are no runtimes, return undefined
		return;
	}

	startRuntime(id: string): void {
		const runtimes = this._runtimes.values();
		for (const runtime of runtimes) {
			if (runtime.metadata.id === id) {
				// Check to see whether there's already a runtime active for
				// this language
				const activeRuntimes = this.getActiveLanguageRuntimes(runtime.metadata.language);

				// Start the requested runtime if no other runtime is active
				if (activeRuntimes.length === 0) {
					this.startLanguageRuntime(runtime);
				} else {
					throw new Error(`Can't start runtime ${id} because another runtime is already active for language ${runtime.metadata.language}`);
				}
				return;
			}
		}
		throw new Error(`No runtime with id '${id}' was found.`);
	}

	private startLanguageRuntime(runtime: ILanguageRuntime): void {
		this._logService.trace(`Language runtime starting: '${runtime.metadata.language}' (${runtime.metadata.id})`);
		runtime.start().then(info => {
			// Execute the Focus into Console command using the command service
			// to expose the REPL for the new runtime.
			this._commandService.executeCommand('workbench.panel.console.focus');
		});
		this._onDidStartRuntime.fire(runtime);
	}

	getActiveLanguageRuntimes(language: string | null): Array<ILanguageRuntime> {
		return Array.from(this._runtimes.values()).filter(runtime => {
			return runtime.getRuntimeState() !== RuntimeState.Uninitialized &&
				runtime.getRuntimeState() !== RuntimeState.Exited &&
				(language === null || runtime.metadata.language === language);
		});
	}

	/**
	 * Get the active language runtimes
	 *
	 * @returns All active runtimes
	 */
	getActiveRuntimes(): Array<ILanguageRuntime> {
		return this.getActiveLanguageRuntimes(null);
	}
}

registerSingleton(ILanguageRuntimeService, LanguageRuntimeService, InstantiationType.Delayed);
