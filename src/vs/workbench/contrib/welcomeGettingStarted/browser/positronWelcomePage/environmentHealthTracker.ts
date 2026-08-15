/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IExtensionService } from '../../../../services/extensions/common/extensions.js';
import { WELCOME_PAGE_ENVIRONMENT_CHECKS_KEY } from '../../common/positronWelcomePageConfiguration.js';
import {
	HealthLanguage,
	IEnvironmentHealthResult,
	IHealthItemFix,
	ILanguageHealthSource,
	isEnvironmentHealthResult,
} from './environmentHealth.js';

export type LanguageHealthState =
	| { readonly kind: 'hidden' }
	| { readonly kind: 'loading' }
	| { readonly kind: 'unavailable' }
	| { readonly kind: 'error' }
	| { readonly kind: 'result'; readonly result: IEnvironmentHealthResult };

export interface ILanguageHealth {
	readonly language: HealthLanguage;
	readonly label: string;
	readonly state: LanguageHealthState;
}

/** Ordered, so the section renders groups by mapping over it. */
export type EnvironmentHealthSnapshot = readonly ILanguageHealth[];

export interface IEnvironmentHealthTracker {
	readonly onDidChange: Event<EnvironmentHealthSnapshot>;
	readonly state: EnvironmentHealthSnapshot;
	isRunning(language: HealthLanguage): boolean;
	refresh(language: HealthLanguage): void;
	runFix(language: HealthLanguage, fix: IHealthItemFix): Promise<void>;
}

/**
 * Runs the two environment health commands and holds their results.
 *
 * Owned by the welcome page's editor pane and keyed to the editor input, so it
 * outlives the React tree, which the pane rebuilds whenever a walkthrough
 * registers.
 */
export class EnvironmentHealthTracker extends Disposable implements IEnvironmentHealthTracker {

	private readonly _onDidChange = this._register(new Emitter<EnvironmentHealthSnapshot>());
	readonly onDidChange: Event<EnvironmentHealthSnapshot> = this._onDidChange.event;

	private readonly _states = new Map<HealthLanguage, LanguageHealthState>();
	private readonly _running = new Set<HealthLanguage>();
	private _disposed = false;

	constructor(
		private readonly _sources: readonly ILanguageHealthSource[],
		@ICommandService private readonly _commandService: ICommandService,
		@IExtensionService private readonly _extensionService: IExtensionService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();

		// The setting can also change from the Settings editor, so the control in
		// the page only writes it and this listener does the rest. Both routes end
		// in the same place.
		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(WELCOME_PAGE_ENVIRONMENT_CHECKS_KEY)) {
				this._syncVisibility();
			}
		}));

		this._syncVisibility();
	}

	get state(): EnvironmentHealthSnapshot {
		// A fresh array every call. A cached one would let React's identity check
		// swallow the update.
		return this._sources.map(source => ({
			language: source.language,
			label: source.label,
			state: this._states.get(source.language) ?? { kind: 'loading' },
		}));
	}

	isRunning(language: HealthLanguage): boolean {
		return this._running.has(language);
	}

	/**
	 * A run cannot be cancelled: executeCommand takes no cancellation token, so a
	 * "cancel and restart" rule would leave the abandoned run going and start a
	 * second one beside it. So this does nothing while one is in flight, and the
	 * recheck control is disabled meanwhile.
	 */
	refresh(language: HealthLanguage): void {
		if (this._disposed || this._running.has(language) || this._hiddenLanguages().has(language)) {
			return;
		}
		const source = this._sources.find(s => s.language === language);
		if (!source) {
			return;
		}
		this._running.add(language);
		// The current state stays until the run returns. Dropping to `loading`
		// would blank a group the user is reading.
		this._fire();
		void this._run(source);
	}

	/**
	 * The check is cheap and idempotent, so this rechecks after every fix rather
	 * than keeping a list of which commands are worth rechecking after.
	 */
	async runFix(language: HealthLanguage, fix: IHealthItemFix): Promise<void> {
		try {
			await this._commandService.executeCommand(fix.commandId, ...(fix.args ?? []));
		} catch (error) {
			// The fix commands surface their own errors, so a notification here
			// would double up.
			this._logService.warn(`Environment setup fix ${fix.commandId} failed: ${error}`);
			return;
		}
		this.refresh(language);
	}

	override dispose(): void {
		// A run in flight cannot be stopped, so mark the tracker dead and let
		// _set drop whatever comes back rather than firing on a disposed emitter.
		this._disposed = true;
		super.dispose();
	}

	private _hiddenLanguages(): Set<HealthLanguage> {
		const visible = this._configurationService.getValue<HealthLanguage[]>(WELCOME_PAGE_ENVIRONMENT_CHECKS_KEY) ?? [];
		return new Set(this._sources.map(s => s.language).filter(l => !visible.includes(l)));
	}

	private _syncVisibility(): void {
		const hidden = this._hiddenLanguages();
		for (const source of this._sources) {
			if (hidden.has(source.language)) {
				this._set(source.language, { kind: 'hidden' });
			} else if (this._states.get(source.language)?.kind === 'hidden' || !this._states.has(source.language)) {
				this._set(source.language, { kind: 'loading' });
				this.refresh(source.language);
			}
		}
	}

	private async _run(source: ILanguageHealthSource): Promise<void> {
		try {
			// Ask whether the extension is there before calling. For a disabled
			// extension, CommandService would otherwise start every extension and
			// wait up to 30 seconds for an answer that was knowable immediately.
			const extension = await this._extensionService.getExtension(source.extensionId);
			if (!extension) {
				this._finish(source.language, { kind: 'unavailable' });
				return;
			}
			const result = await this._commandService.executeCommand(source.commandId);
			if (!isEnvironmentHealthResult(result)) {
				this._logService.warn(`Environment setup check for ${source.language} returned an unusable result`);
				this._finish(source.language, { kind: 'error' });
				return;
			}
			this._finish(source.language, { kind: 'result', result });
		} catch (error) {
			// The message is developer text and is not shown. The card shows a
			// fixed sentence; this line is how a support request finds the detail.
			this._logService.warn(`Environment setup check failed for ${source.language}: ${error}`);
			this._finish(source.language, { kind: 'error' });
		}
	}

	/**
	 * Ends a run: clears the in-flight flag, then writes the result unless the
	 * language was hidden while the run was out (the user can hide it mid-check,
	 * since the Python check takes seconds). Clearing the flag first, rather than
	 * in a `finally`, keeps `isRunning` and the change event this fires in sync --
	 * a listener reacting to the event never sees `isRunning` still true for a
	 * run that has already finished.
	 */
	private _finish(language: HealthLanguage, state: LanguageHealthState): void {
		this._running.delete(language);
		if (this._hiddenLanguages().has(language)) {
			return;
		}
		this._set(language, state);
	}

	private _set(language: HealthLanguage, state: LanguageHealthState): void {
		if (this._disposed) {
			return;
		}
		this._states.set(language, state);
		this._fire();
	}

	private _fire(): void {
		if (!this._disposed) {
			this._onDidChange.fire(this.state);
		}
	}
}
