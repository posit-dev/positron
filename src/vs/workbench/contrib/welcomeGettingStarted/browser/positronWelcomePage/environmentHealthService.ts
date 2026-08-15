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
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { WELCOME_PAGE_ENVIRONMENT_CHECKS_KEY } from '../../common/positronWelcomePageConfiguration.js';
import {
	HealthLanguage,
	IEnvironmentHealthResult,
	IHealthItemFix,
	ILanguageHealthSource,
	isEnvironmentHealthResult,
} from './environmentHealth.js';

/** One prefix for every line, so the whole feature is a single filter in the log. */
const LOG = '[welcome env health]';

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

export const IEnvironmentHealthService = createDecorator<IEnvironmentHealthService>('environmentHealthService');

export interface IEnvironmentHealthService {
	readonly _serviceBrand: undefined;
	readonly onDidChange: Event<EnvironmentHealthSnapshot>;
	readonly state: EnvironmentHealthSnapshot;
	/**
	 * Whether anything is running for this language -- a check, or a fix command,
	 * which can take minutes. The card shows its progress line for this and
	 * disables the controls that would start more work.
	 */
	isBusy(language: HealthLanguage): boolean;
	refresh(language: HealthLanguage): void;
	/**
	 * Rechecks every visible language for a welcome page that has just opened.
	 *
	 * `page` says which page is asking, and is compared by identity. Splitting the
	 * editor shows the same page in a second group and passes the same value, so
	 * it does not recheck. Closing the page and opening it again makes a new one,
	 * so that does.
	 */
	refreshForPage(page: object): void;
	runFix(language: HealthLanguage, fix: IHealthItemFix): Promise<void>;
}

/**
 * Runs the two environment health commands and holds their results.
 *
 * One per window, so two welcome pages in a split editor share one set of
 * checks rather than each running the commands. Nothing requests this until a
 * welcome page opens, which is what keeps it from activating the Python and R
 * extensions at startup for users who never open one. Do not add it to
 * PositronReactServices: that is built during workbench startup, and requesting
 * it there would undo that.
 */
export class EnvironmentHealthService extends Disposable implements IEnvironmentHealthService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChange = this._register(new Emitter<EnvironmentHealthSnapshot>());
	readonly onDidChange: Event<EnvironmentHealthSnapshot> = this._onDidChange.event;

	private readonly _states = new Map<HealthLanguage, LanguageHealthState>();
	/** Languages whose environment health command is running. */
	private readonly _runningChecks = new Set<HealthLanguage>();
	/**
	 * Languages whose fix command is running. Kept apart from the checks, so a
	 * check finishing cannot clear the flag for a fix that is still going.
	 */
	private readonly _runningFixes = new Set<HealthLanguage>();
	/** Languages asked to recheck while their check was already running. */
	private readonly _pendingRefresh = new Set<HealthLanguage>();
	/** The welcome page the checks last ran for. See refreshForPage. */
	private _lastPage: WeakRef<object> | undefined;
	/**
	 * Whether a welcome page has asked for a check yet.
	 *
	 * The editor pane takes this service as a constructor dependency, and it is
	 * the pane for the classic welcome page as well as the redesigned one. Merely
	 * injecting a delayed service builds it at the next idle callback, so if the
	 * constructor started runs, every user would activate the Python and R
	 * extensions on startup for a card that the feature flag keeps hidden.
	 */
	private _started = false;
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

		// There is one of these per window. Two of these lines means two services,
		// which is the thing being avoided by not building this per editor pane.
		this._logService.trace(`${LOG} service created`);
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

	isBusy(language: HealthLanguage): boolean {
		return this._runningChecks.has(language) || this._runningFixes.has(language);
	}

	/**
	 * A run cannot be cancelled: executeCommand takes no cancellation token, so a
	 * "cancel and restart" rule would leave the abandoned run going and start a
	 * second one beside it. So this does nothing while one is in flight. The card
	 * leaves its recheck control enabled and makes the same check itself, so that
	 * the control stays in the tab order.
	 */
	refresh(language: HealthLanguage): void {
		this._requestRefresh(language, false);
	}

	refreshForPage(page: object): void {
		if (this._lastPage?.deref() === page) {
			this._logService.trace(`${LOG} same welcome page as last checked, not rechecking`);
			return;
		}
		// Weak so a closed page can still be collected. A collected one derefs to
		// undefined and so counts as a different page, which is the right answer:
		// if it is gone, whatever asks next is a new page.
		this._lastPage = new WeakRef(page);
		this._started = true;
		this._logService.trace(`${LOG} a welcome page opened, rechecking every visible language`);
		for (const source of this._sources) {
			this._requestRefresh(source.language, false);
		}
	}

	/**
	 * @param queueIfBusy Whether to run again once the current run ends, rather
	 * than dropping the request. Only a fix needs this: its recheck exists to show
	 * what the fix changed, so a result computed before the fix ran is the wrong
	 * answer. A user pressing the recheck control twice wants one run, not two.
	 */
	private _requestRefresh(language: HealthLanguage, queueIfBusy: boolean): void {
		if (this._disposed) {
			return;
		}
		if (this._hiddenLanguages().has(language)) {
			this._logService.trace(`${LOG} ${language}: turned off in the setting, not checked`);
			return;
		}
		if (this._runningChecks.has(language)) {
			if (queueIfBusy) {
				this._pendingRefresh.add(language);
				this._logService.trace(`${LOG} ${language}: already running, queued a recheck for when it ends`);
			} else {
				this._logService.trace(`${LOG} ${language}: already running, request ignored`);
			}
			return;
		}
		const source = this._sources.find(s => s.language === language);
		if (!source) {
			return;
		}
		this._runningChecks.add(language);
		this._logService.trace(`${LOG} ${language}: check started`);
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
		if (this._disposed) {
			return;
		}
		// A fix command can run for minutes -- installing Python, say. The card
		// shows its progress line for whatever isBusy reports, so without this
		// it looks idle for all of it, and its recheck control stays live: press
		// it and a check runs against the half-installed environment and publishes
		// what it finds.
		this._runningFixes.add(language);
		this._logService.trace(`${LOG} ${language}: fix ${fix.commandId} started`);
		this._fire();

		let ran = true;
		try {
			await this._commandService.executeCommand(fix.commandId, ...(fix.args ?? []));
		} catch (error) {
			// The fix commands surface their own errors, so a notification here
			// would double up.
			this._logService.warn(`Environment setup fix ${fix.commandId} failed: ${error}`);
			ran = false;
		} finally {
			this._runningFixes.delete(language);
		}
		this._logService.trace(`${LOG} ${language}: fix ${fix.commandId} ${ran ? 'finished' : 'failed'}`);

		if (!ran) {
			// Nothing else will fire, so say the card is idle again.
			this._fire();
			return;
		}
		// Fires for itself when it starts a run. When a check is already out it
		// queues instead and stays busy on that check's flag, so there is nothing
		// to announce.
		this._requestRefresh(language, true);
	}

	override dispose(): void {
		// A run in flight cannot be stopped, so mark the tracker dead and let
		// _set drop whatever comes back rather than firing on a disposed emitter.
		this._disposed = true;
		super.dispose();
	}

	private _hiddenLanguages(): Set<HealthLanguage> {
		const configured = this._configurationService.getValue(WELCOME_PAGE_ENVIRONMENT_CHECKS_KEY);
		if (!Array.isArray(configured)) {
			// settings.json is hand-edited, so this can be any shape at all.
			// Falling back to the default (nothing hidden) keeps a typo from
			// turning the section off silently -- and, before this check, from
			// throwing out of the constructor and taking the welcome page with it.
			return new Set();
		}
		return new Set(this._sources.map(s => s.language).filter(l => !configured.includes(l)));
	}

	private _syncVisibility(): void {
		const hidden = this._hiddenLanguages();
		for (const source of this._sources) {
			if (hidden.has(source.language)) {
				this._set(source.language, { kind: 'hidden' });
			} else if (this._states.get(source.language)?.kind === 'hidden' || !this._states.has(source.language)) {
				this._set(source.language, { kind: 'loading' });
				if (this._started) {
					this.refresh(source.language);
				}
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
	 * in a `finally`, keeps `isBusy` and the change event this fires in sync --
	 * a listener reacting to the event never sees `isBusy` still true for a
	 * run that has already finished.
	 */
	private _finish(language: HealthLanguage, state: LanguageHealthState): void {
		this._runningChecks.delete(language);
		this._logService.trace(`${LOG} ${language}: check finished as ${state.kind}`);
		if (this._hiddenLanguages().has(language)) {
			// The result is dropped, but isBusy just changed. isBusy is not
			// observable on its own, so without this a consumer that mirrors it
			// off onDidChange stays busy forever for a language hidden mid-run.
			this._pendingRefresh.delete(language);
			this._fire();
			return;
		}
		if (this._pendingRefresh.delete(language)) {
			// Deliberately not published. This result was computed before the fix
			// ran, which is the answer the queued recheck exists to replace --
			// showing it would put the pre-fix failure back on screen for the
			// seconds the recheck takes. The previous result stays up instead.
			this._logService.trace(`${LOG} ${language}: superseded by a recheck, result not shown`);
			this._requestRefresh(language, true);
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
