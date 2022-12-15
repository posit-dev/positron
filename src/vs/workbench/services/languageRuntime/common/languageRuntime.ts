/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import { Disposable, IDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { ILanguageRuntime, ILanguageRuntimeService, LanguageRuntimeStartupBehavior, RuntimeState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { ILogService } from 'vs/platform/log/common/log';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { ILanguageService } from 'vs/editor/common/languages/language';
import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';

/**
 * The implementation of ILanguageRuntimeService
 */
export class LanguageRuntimeService extends Disposable implements ILanguageRuntimeService {
	/** Needed for service branding in dependency injector */
	declare readonly _serviceBrand: undefined;

	/** A map of languages to the runtimes that can service that language  */
	private readonly _runtimes: Map<string, ILanguageRuntime> = new Map();

	/** A map of runtime IDs to the runtime's desired startup behavior */
	private readonly _startupBehaviors: Map<string, LanguageRuntimeStartupBehavior> = new Map();

	/** A map of all currently active runtimes. */
	private readonly _activeRuntimes: ILanguageRuntime[] = [];

	/** An event that fires when a runtime starts. */
	private readonly _onDidStartRuntime = this._register(new Emitter<ILanguageRuntime>);

	// The set of active (encountered) languages. This is used to help orchestrate
	// the implicit runtime startup.
	private readonly _activeLanguages = new Set<string>();

	readonly onDidStartRuntime = this._onDidStartRuntime.event;

	constructor(
		@ILogService private readonly _logService: ILogService,
		@ICommandService private readonly _commandService: ICommandService,
		@ILanguageService private readonly _languageService: ILanguageService,
	) {
		super();
		this._register(this._languageService.onDidEncounterLanguage((language) => {
			this._activeLanguages.add(language);
			this.startRuntimeImplicitly(language);
		}));
	}

	/**
	 * Start a runtime implicitly when a language is encountered
	 */
	startRuntimeImplicitly(language: string): void {
		// Ignore if there's already an active runtime for this language
		if (this.getActiveLanguageRuntimes(language).length > 0) {
			return;
		}

		// Get all the runtimes that match the language and have implicit
		// startup behavior
		const runtimes = Array.from(this._runtimes.values()).filter(
			runtime =>
				runtime.metadata.language === language &&
				this._startupBehaviors.has(runtime.metadata.id) &&
				this._startupBehaviors.get(runtime.metadata.id) ===
				LanguageRuntimeStartupBehavior.Implicit);

		// If there are no runtimes, elect the first one. This isn't random; the
		// runtimes are sorted by priority when registered by the extension.
		if (runtimes.length > 0) {
			this._logService.trace(`Language ${language} encountered; automatically starting ${runtimes[0].metadata.name}`);
			this.startLanguageRuntime(runtimes[0]);
		}
	}

	/**
	 * Register a new language runtime
	 *
	 * @param runtime The runtime to register
	 * @returns A disposable that unregisters the runtime
	 */
	registerRuntime(runtime: ILanguageRuntime,
		startupBehavior: LanguageRuntimeStartupBehavior): IDisposable {
		this._runtimes.set(runtime.metadata.id, runtime);
		this._startupBehaviors.set(runtime.metadata.id, startupBehavior);
		this._logService.trace(`Added new language runtime (${runtime.metadata.language}) ${runtime.metadata.language} (${runtime.metadata.id})`);

		// If the runtime allows for implicit startup, and there's an active
		// language that matches this runtime, see if there's already an active
		// runtime for this language. If not, start the runtime right away.
		if (startupBehavior === LanguageRuntimeStartupBehavior.Implicit &&
			this._activeLanguages.has(runtime.metadata.language)) {
			const active = this.getActiveLanguageRuntimes(runtime.metadata.language);
			if (active.length === 0) {
				this._logService.trace(`Language ${runtime.metadata.language} is active; automatically starting ${runtime.metadata.name}`);
				this.startLanguageRuntime(runtime);
			}
		}

		// Ensure that we remove the runtime from the set of active runtimes
		// when it exits.
		this._register(runtime.onDidChangeRuntimeState((state) => {
			if (state === RuntimeState.Exited) {
				// Remove the runtime from the set of active runtimes, since it's
				// no longer active.
				const index = this._activeRuntimes.indexOf(runtime);
				if (index >= 0) {
					this._activeRuntimes.splice(index, 1);
				}
			}
		}));

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

		// Move this runtime to the active list. Note that we can't rely on runtime
		// state because the runtime start event is asynchronous.
		this._activeRuntimes.push(runtime);

		runtime.start().then(info => {
			// Execute the Focus into Console command using the command service
			// to expose the REPL for the new runtime.
			this._commandService.executeCommand('workbench.panel.console.focus');
		});

		// Add an event listener to remove the runtime from the active list
		// when it exits.
		const disposable = runtime.onDidChangeRuntimeState((e) => {
			if (e === RuntimeState.Exited) {
				this._activeRuntimes.splice(this._activeRuntimes.indexOf(runtime), 1);
			}
			disposable.dispose();
		});

		this._onDidStartRuntime.fire(runtime);
	}

	getActiveLanguageRuntimes(language: string | null): Array<ILanguageRuntime> {
		return this._activeRuntimes.filter(runtime =>
			language === null || runtime.metadata.language === language
		);
	}

	/**
	 * Get the active language runtimes
	 *
	 * @returns All active runtimes
	 */
	getActiveRuntimes(): Array<ILanguageRuntime> {
		return this._activeRuntimes;
	}
}

registerSingleton(ILanguageRuntimeService, LanguageRuntimeService, InstantiationType.Delayed);
