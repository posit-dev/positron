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
	 * Fires when a result lands, and on every start and end of a check or a fix.
	 *
	 * Only the first of those changes the snapshot. The others move `isBusy`,
	 * which the snapshot does not carry, so this event is the only way to observe
	 * it -- a consumer showing a progress indicator has to mirror `isBusy` from
	 * here rather than poll it.
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
	rerunCheckForLanguage(language: HealthLanguage): void;
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
	rerunChecksForPage(page: GettingStartedInput): void;
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
	/** Languages whose check must run again once the one in flight ends. */
	private readonly _queuedReruns = new Set<HealthLanguage>();
	/**
	 * The welcome page the checks last ran for.
	 *
	 * Splitting the editor builds a second pane for the same page, and a new pane
	 * remembers nothing, so a pane cannot tell a split from a reopen on its own.
	 * Keeping it here is what lets `rerunChecksForPage` tell them apart.
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

		// The card only opens the Settings editor at this key; the user changes the
		// value there. This listener is what makes that take effect without a
		// reload.
		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(WELCOME_PAGE_ENVIRONMENT_CHECKS_KEY)) {
				this._applyEnabledLanguagesSetting();
			}
		}));

		this._logService.trace(`${LOG} service created`);
		// Sets each language to hidden or loading from the setting. It starts no
		// checks: nothing runs until a welcome page calls rerunChecksForPage.
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
	rerunCheckForLanguage(language: HealthLanguage): void {
		this._requestLanguageHealthCheck(language, false);
	}

	rerunChecksForPage(page: GettingStartedInput): void {
		if (this._lastPage?.deref() === page) {
			this._logService.trace(`${LOG} same welcome page as last checked, not rerunning`);
			return;
		}
		// Held weakly so closing the welcome page can still free its editor input.
		// A collected one reads back as undefined, which counts as a different page
		// -- the right answer, because if the old page is gone then whatever asks
		// next is a new one.
		this._lastPage = new WeakRef(page);
		this._started = true;
		this._logService.trace(`${LOG} a welcome page opened, rerunning the check for every visible language`);
		for (const source of this._languageExtensionSources) {
			this._requestLanguageHealthCheck(source.language, false);
		}
	}

	/**
	 * Starts this language's health check, unless one is already running.
	 *
	 * @param queueIfBusy What to do when a check for this language is already
	 * running. `false` drops the request: pressing the rerun control twice should
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
				this._queuedReruns.add(language);
				this._logService.trace(`${LOG} ${language}: already running, queued a rerun for when it ends`);
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
	 * Runs a fix command, then reruns that language.
	 *
	 * The language counts as busy for the whole of it, not just the rerun at the
	 * end. A fix can run for minutes -- installing Python, say -- and the card
	 * takes its progress line and its disabled buttons from `isBusy`. Without that
	 * the card looks idle throughout, and pressing rerun would run a check
	 * against a half-installed environment.
	 *
	 * A fix that succeeds is followed by a rerun; one that fails is not. It
	 * reruns after any successful fix rather than keeping a list of which
	 * commands are worth rerunning the check after, because such a list would go stale
	 * against the extensions. The check is not free -- R rediscovers every
	 * installation -- but paying for it once after a fix is the point.
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
		if (this._getDisabledLanguages().has(language)) {
			// The user turned this language off while the fix ran, so there is
			// nothing to rerun. Fire anyway: isBusy just went false and the call
			// below would return at its own disabled-language guard without saying
			// so, leaving the card showing a progress line that never stops.
			this._fireOnDidChange();
			return;
		}
		// Fires for itself when it starts a check. When a check is already out it
		// queues instead and stays busy on that check's flag, so there is nothing
		// to announce.
		this._requestLanguageHealthCheck(language, true);
	}

	override dispose(): void {
		// A check in flight cannot be stopped, so mark the service dead and let
		// _setLanguageHealthState drop whatever comes back rather than firing on a
		// disposed emitter.
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
					this.rerunCheckForLanguage(source.language);
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
	 * Takes the outcome of a finished check and decides what to do with it. The
	 * language stops counting as busy either way; the result is published unless
	 * one of two things is true:
	 *
	 * - the user turned the language off while the check was out, so the result is
	 *   about something no longer on screen
	 * - a fix queued a rerun while this check was out, so this result predates
	 *   the fix and the rerun is about to replace it
	 *
	 * The busy flag is cleared before firing rather than in a `finally`, so a
	 * listener reacting to the event never sees `isBusy` still true for a check
	 * that has already finished.
	 */
	private _handleHealthCheckResult(language: HealthLanguage, state: LanguageHealthState): void {
		this._runningChecks.delete(language);
		this._logService.trace(`${LOG} ${language}: check finished as ${state.kind}`);
		if (this._getDisabledLanguages().has(language)) {
			// Throw away the result and any queued rerun: the user turned this
			// language off while the check was out. Still fire, because isBusy just
			// changed and nothing else would say so.
			this._queuedReruns.delete(language);
			this._fireOnDidChange();
			return;
		}

		const hadQueuedRerun = this._queuedReruns.delete(language);
		if (hadQueuedRerun) {
			// This result predates the fix that queued the rerun, so showing it
			// would put the pre-fix failure back on screen for the seconds the
			// rerun takes. Leave the previous result up and start the rerun.
			this._logService.trace(`${LOG} ${language}: superseded by a rerun, result not shown`);
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
