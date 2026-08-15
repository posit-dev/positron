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
import { GettingStartedInput } from '../gettingStartedInput.js';
import {
	HealthLanguage,
	IEnvironmentHealthResult,
	IHealthItemFix,
	ILanguageHealthSource,
	isEnvironmentHealthResult,
} from './environmentHealth.js';

const LOG = '[environment health check]';

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
	/**
	 * Fires whenever the snapshot changes: a check starting, a check ending, a fix
	 * starting, a fix ending. The card subscribes and re-reads `state`.
	 */
	readonly onDidChange: Event<EnvironmentHealthSnapshot>;
	readonly state: EnvironmentHealthSnapshot;
	/**
	 * Whether anything is running for this language -- a check, or a fix command,
	 * which can take minutes. The card shows its progress line for this and
	 * disables the controls that would start more work.
	 */
	isBusy(language: HealthLanguage): boolean;
	/**
	 * Runs this language's health check again. Does nothing while a check for it is
	 * already running.
	 */
	recheckLanguage(language: HealthLanguage): void;
	/**
	 * Runs the health check for every language that is turned on. Called when a
	 * welcome page opens.
	 *
	 * Takes that page's editor input, which is how one welcome page is told from
	 * another. Two cases have to behave differently:
	 *
	 * - Splitting the editor shows the same welcome page in a second group. Both
	 *   panes hold the same input, so nothing runs: the results are already there,
	 *   and re-running would repeat a full R discovery for no reason.
	 * - Closing the welcome page and opening it again builds a new input, so the
	 *   checks run again.
	 */
	recheckForPage(page: GettingStartedInput): void;
	runFix(language: HealthLanguage, fix: IHealthItemFix): Promise<void>;
}

/**
 * Runs the environment health commands and holds their results.
 *
 * One per window, so two welcome pages in a split editor share one set of
 * checks rather than each running the commands. Nothing requests this until a
 * welcome page opens, which is what keeps it from activating the Python and R
 * extensions at startup for users who never open one. Do NOT add it to
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
	 * Languages whose fix command is running.
	 *
	 * Separate from `_runningChecks` because a language can have both at once: a
	 * fix runs a check when it finishes, and the user can start a check during a
	 * fix. Sharing one set would mean the check ending removed the language, and
	 * `isBusy` would report idle while the fix was still going.
	 */
	private readonly _runningFixes = new Set<HealthLanguage>();
	/** Languages asked to recheck while their check was already running. */
	private readonly _queuedRechecks = new Set<HealthLanguage>();
	/**
	 * The welcome page the checks last ran for.
	 *
	 * Splitting the editor builds a second pane for the same page, and a new pane
	 * remembers nothing, so a pane cannot tell a split from a reopen on its own.
	 * Keeping it here is what lets `recheckForPage` tell them apart.
	 */
	private _lastPage: WeakRef<GettingStartedInput> | undefined;
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
		private readonly _languageExtensionSources: readonly ILanguageHealthSource[],
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
				this._applyEnabledLanguagesSetting();
			}
		}));

		this._logService.trace(`${LOG} service created`);
		// Sets each language to hidden or loading from the setting. It starts no
		// checks: nothing runs until a welcome page calls recheckForPage.
		this._applyEnabledLanguagesSetting();
	}

	get state(): EnvironmentHealthSnapshot {
		// A new array every call, on purpose. React decides whether to repaint by
		// comparing the old value with the new one by identity, so a cached array
		// would look unchanged and the card would not update.
		return this._languageExtensionSources.map(source => ({
			language: source.language,
			label: source.label,
			state: this._states.get(source.language) ?? { kind: 'loading' },
		}));
	}

	isBusy(language: HealthLanguage): boolean {
		return this._runningChecks.has(language) || this._runningFixes.has(language);
	}

	/**
	 * Runs this language's health check again.
	 *
	 * Does nothing while a check for that language is already running. A running
	 * check cannot be cancelled -- executeCommand takes no cancellation token --
	 * so starting a second would leave two running at once.
	 */
	recheckLanguage(language: HealthLanguage): void {
		this._requestLanguageHealthCheck(language, false);
	}

	recheckForPage(page: GettingStartedInput): void {
		if (this._lastPage?.deref() === page) {
			this._logService.trace(`${LOG} same welcome page as last checked, not rechecking`);
			return;
		}
		// Held weakly so closing the welcome page can still free its editor input.
		// A collected one reads back as undefined, which counts as a different page
		// -- the right answer, because if the old page is gone then whatever asks
		// next is a new one.
		this._lastPage = new WeakRef(page);
		this._started = true;
		this._logService.trace(`${LOG} a welcome page opened, rechecking every visible language`);
		for (const source of this._languageExtensionSources) {
			this._requestLanguageHealthCheck(source.language, false);
		}
	}

	/**
	 * Starts this language's health check, unless one is already running.
	 *
	 * @param queueIfBusy What to do when a check for this language is already
	 * running. `false` drops the request: pressing the recheck control twice should
	 * run one check, not two. `true` runs another check as soon as the current one
	 * ends, which is what a fix needs -- a check that started before the fix ran
	 * cannot show what the fix changed.
	 */
	private _requestLanguageHealthCheck(language: HealthLanguage, queueIfBusy: boolean): void {
		if (this._disposed) {
			return;
		}
		if (this._getDisabledLanguages().has(language)) {
			this._logService.trace(`${LOG} ${language}: turned off in the setting, not checked`);
			return;
		}
		if (this._runningChecks.has(language)) {
			if (queueIfBusy) {
				this._queuedRechecks.add(language);
				this._logService.trace(`${LOG} ${language}: already running, queued a recheck for when it ends`);
			} else {
				this._logService.trace(`${LOG} ${language}: already running, request ignored`);
			}
			return;
		}
		const source = this._languageExtensionSources.find(s => s.language === language);
		if (!source) {
			return;
		}
		this._runningChecks.add(language);
		this._logService.trace(`${LOG} ${language}: check started`);
		this._fireOnDidChange();
		// Not awaited on purpose. Nothing here needs the promise: the check records
		// its own outcome through _handleHealthCheckResult, and the card follows it
		// through onDidChange. Awaiting would also mean making the constructor's
		// call path async, which it cannot be. `void` marks the floating promise as
		// deliberate, which is what satisfies the no-floating-promises rule.
		void this._callHealthCheckCommand(source);
	}

	/**
	 * Runs a fix command, then rechecks that language.
	 *
	 * The language counts as busy for the whole of it, not just the recheck at the
	 * end. A fix can run for minutes -- installing Python, say -- and the card
	 * takes its progress line and its disabled buttons from `isBusy`. Without that
	 * the card looks idle throughout, and pressing recheck would run a check
	 * against a half-installed environment.
	 *
	 * It rechecks after every fix rather than keeping a list of which commands are
	 * worth rechecking after, because the check is cheap and idempotent.
	 */
	async runFix(language: HealthLanguage, fix: IHealthItemFix): Promise<void> {
		if (this._disposed) {
			return;
		}
		this._runningFixes.add(language);
		this._logService.trace(`${LOG} ${language}: fix ${fix.commandId} started`);
		this._fireOnDidChange();

		let ran = true;
		try {
			await this._commandService.executeCommand(fix.commandId, ...(fix.args ?? []));
		} catch (error) {
			// The fix commands surface their own errors, so a notification here
			// would double up.
			this._logService.warn(`${LOG} ${language}: fix ${fix.commandId} failed: ${error}`);
			ran = false;
		} finally {
			this._runningFixes.delete(language);
		}
		this._logService.trace(`${LOG} ${language}: fix ${fix.commandId} ${ran ? 'finished' : 'failed'}`);

		if (!ran) {
			// Nothing else will fire, so say the card is idle again.
			this._fireOnDidChange();
			return;
		}
		// Fires for itself when it starts a run. When a check is already out it
		// queues instead and stays busy on that check's flag, so there is nothing
		// to announce.
		this._requestLanguageHealthCheck(language, true);
	}

	override dispose(): void {
		// A run in flight cannot be stopped, so mark the tracker dead and let
		// _set drop whatever comes back rather than firing on a disposed emitter.
		this._disposed = true;
		super.dispose();
	}

	private _getDisabledLanguages(): Set<HealthLanguage> {
		const configured = this._configurationService.getValue(WELCOME_PAGE_ENVIRONMENT_CHECKS_KEY);
		if (!Array.isArray(configured)) {
			// settings.json is hand-edited, so this can be any shape at all.
			// Falling back to the default (nothing hidden) keeps a typo from
			// turning the section off silently -- and, before this check, from
			// throwing out of the constructor and taking the welcome page with it.
			return new Set();
		}
		return new Set(this._languageExtensionSources.map(s => s.language).filter(l => !configured.includes(l)));
	}

	private _applyEnabledLanguagesSetting(): void {
		const hidden = this._getDisabledLanguages();
		for (const source of this._languageExtensionSources) {
			if (hidden.has(source.language)) {
				this._setLanguageHealthState(source.language, { kind: 'hidden' });
			} else if (this._states.get(source.language)?.kind === 'hidden' || !this._states.has(source.language)) {
				this._setLanguageHealthState(source.language, { kind: 'loading' });
				if (this._started) {
					this.recheckLanguage(source.language);
				}
			}
		}
	}

	/**
	 * Calls one language's health check command and records what came back.
	 *
	 * Every outcome ends at `_handleHealthCheckResult`: the extension not
	 * installed, a reply that does not match the expected shape, a rejected
	 * command, and success.
	 */
	private async _callHealthCheckCommand(source: ILanguageHealthSource): Promise<void> {
		try {
			// Ask whether the extension is there before calling. For a disabled
			// extension, CommandService would otherwise start every extension and
			// wait up to 30 seconds for an answer that was knowable immediately.
			const extension = await this._extensionService.getExtension(source.extensionId);
			if (!extension) {
				this._handleHealthCheckResult(source.language, { kind: 'unavailable' });
				return;
			}
			const result = await this._commandService.executeCommand(source.healthCheckCommandId);
			if (!isEnvironmentHealthResult(result)) {
				this._logService.warn(`${LOG} ${source.language}: check returned an unusable result`);
				this._handleHealthCheckResult(source.language, { kind: 'error' });
				return;
			}
			this._handleHealthCheckResult(source.language, { kind: 'result', result });
		} catch (error) {
			// The message is developer text and is not shown. The card shows a
			// fixed sentence; this line is how a support request finds the detail.
			this._logService.warn(`${LOG} ${source.language}: check failed: ${error}`);
			this._handleHealthCheckResult(source.language, { kind: 'error' });
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
	private _handleHealthCheckResult(language: HealthLanguage, state: LanguageHealthState): void {
		this._runningChecks.delete(language);
		this._logService.trace(`${LOG} ${language}: check finished as ${state.kind}`);
		if (this._getDisabledLanguages().has(language)) {
			// Throw away the result and any queued recheck: the user turned this
			// language off while the check was out. Still fire, because isBusy just
			// changed and nothing else would say so.
			this._queuedRechecks.delete(language);
			this._fireOnDidChange();
			return;
		}

		const hadQueuedRecheck = this._queuedRechecks.delete(language);
		if (hadQueuedRecheck) {
			// This result predates the fix that queued the recheck, so showing it
			// would put the pre-fix failure back on screen for the seconds the
			// recheck takes. Leave the previous result up and run the recheck.
			this._logService.trace(`${LOG} ${language}: superseded by a recheck, result not shown`);
			this._requestLanguageHealthCheck(language, true);
			return;
		}
		this._setLanguageHealthState(language, state);
	}

	private _setLanguageHealthState(language: HealthLanguage, state: LanguageHealthState): void {
		if (this._disposed) {
			return;
		}
		this._states.set(language, state);
		this._fireOnDidChange();
	}

	private _fireOnDidChange(): void {
		if (!this._disposed) {
			this._onDidChange.fire(this.state);
		}
	}
}
