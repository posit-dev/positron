/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { isHTMLElement } from '../../../../base/browser/dom.js';
import { Button } from '../../../../base/browser/ui/button/button.js';
import { Disposable, DisposableStore, IDisposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { defaultButtonStyles } from '../../../../platform/theme/browser/defaultStyles.js';
import { CanvasEntryOutcome } from '../common/positronCanvasMode.js';

/**
 * Workbench children that can be appended after the curtain goes up yet
 * render beneath it: they must go inert on arrival or Tab and screen readers
 * land on invisible controls. Deliberately narrow - dialogs and context views
 * render above the curtain (the workspace trust prompt must stay answerable)
 * and must not be matched.
 */
const LATE_COVERED_SELECTOR = '.notifications-toasts, .quick-input-widget';

/**
 * Appends one accessible Canvas curtain to a workbench container.
 *
 * The curtain covers the workbench visually, but the workbench's children
 * stay in the accessibility tree and the tab order unless marked inert here;
 * covered containers appended later (see `LATE_COVERED_SELECTOR`) are marked
 * as they arrive. Call the returned `release` when the curtain comes down to
 * restore them.
 */
function createCanvasCurtainElement(container: HTMLElement): { element: HTMLElement; release: () => void } {
	const element = container.ownerDocument.createElement('div');
	element.className = 'positron-canvas-startup-curtain';
	element.setAttribute('role', 'status');
	element.setAttribute('aria-live', 'polite');

	// Each covered element's prior inert value, restored on release: another
	// component may own an element's inert state, and release clobbering it
	// to false would re-enable what that component disabled.
	const covered = new Map<HTMLElement, boolean>();
	for (const sibling of Array.from(container.children).filter(isHTMLElement)) {
		covered.set(sibling, sibling.inert);
		sibling.inert = true;
	}

	const observer = new MutationObserver(mutations => {
		for (const mutation of mutations) {
			for (const node of mutation.addedNodes) {
				if (isHTMLElement(node) && node !== element && node.matches(LATE_COVERED_SELECTOR) && !covered.has(node)) {
					covered.set(node, node.inert);
					node.inert = true;
				}
			}
		}
	});
	observer.observe(container, { childList: true });

	container.appendChild(element);
	return {
		element,
		release: () => {
			observer.disconnect();
			for (const [sibling, priorInert] of covered) {
				sibling.inert = priorInert;
			}
		},
	};
}

/** One button on the curtain card. */
interface ICurtainAction {
	readonly label: string;
	readonly primary?: boolean;
	readonly run: () => void;
}

/** Renders the card shared by the curtain's loading and failure states. */
function renderCurtainCard(
	element: HTMLElement,
	spec: { brandText: string; brandId?: string; messageText: string; spinner: boolean; actions: readonly ICurtainAction[] },
	disposables: DisposableStore,
): { firstButton: Button | undefined } {
	const document = element.ownerDocument;
	const card = document.createElement('div');
	card.className = 'positron-canvas-startup-card';

	const brand = document.createElement('div');
	brand.className = 'positron-canvas-startup-brand';
	brand.textContent = spec.brandText;
	if (spec.brandId) {
		brand.id = spec.brandId;
	}
	card.appendChild(brand);

	if (spec.spinner) {
		const spinner = document.createElement('div');
		spinner.className = 'positron-canvas-startup-spinner';
		spinner.setAttribute('role', 'progressbar');
		spinner.setAttribute('aria-label', localize('positron.canvas.loadingLabel', "Loading Canvas"));
		card.appendChild(spinner);
	}

	const message = document.createElement('p');
	message.className = 'positron-canvas-startup-message';
	message.textContent = spec.messageText;
	card.appendChild(message);

	const actions = document.createElement('div');
	actions.className = 'positron-canvas-startup-actions';
	let firstButton: Button | undefined;
	for (const action of spec.actions) {
		const button = disposables.add(new Button(actions, { ...defaultButtonStyles, secondary: !action.primary }));
		button.label = action.label;
		disposables.add(button.onDidClick(action.run));
		firstButton ??= button;
	}
	card.appendChild(actions);

	element.replaceChildren(card);
	return { firstButton };
}

/** One interactive Canvas loading and failure curtain. */
class CanvasStartupCurtain extends Disposable {
	private readonly actionDisposables = this._register(new MutableDisposable<DisposableStore>());
	private readonly element: HTMLElement;
	private readonly releaseSiblings: () => void;
	private running = false;
	private recovering = false;

	constructor(
		container: HTMLElement,
		private readonly enter: () => Promise<CanvasEntryOutcome>,
		private readonly recoverMainWindow: () => Promise<void>,
		private readonly showLogs: () => Promise<void>,
		private readonly quit: () => Promise<void>,
		private readonly logService: ILogService,
		private readonly onDidDispose: () => void,
	) {
		super();
		const { element, release } = createCanvasCurtainElement(container);
		this.element = element;
		this.releaseSiblings = release;
		void this.start();
	}

	private get disposed(): boolean {
		return this._store.isDisposed;
	}

	private async start(): Promise<void> {
		// `recovering` blocks a Retry clicked while "Open Positron" or "Show
		// Logs" is mid-recovery: the recovery is about to dispose the curtain,
		// and the retried entry would then re-hide the IDE with no curtain up.
		if (this.running || this.recovering || this.disposed) {
			return;
		}
		this.running = true;
		this.showLoading();
		try {
			const outcome = await this.enter();
			if (this.disposed) {
				return;
			}
			if (outcome.entered) {
				this.dispose();
				return;
			}
			if (outcome.reason === 'superseded') {
				// The IDE was asked for mid-entry and is being revealed; a
				// failure card over it would demand a second "Open Positron"
				// for a decision the user already made.
				this.logService.info('[canvas] Standalone startup stood down: the IDE was requested while Canvas was opening');
				this.dispose();
				return;
			}
			if (outcome.reason === 'engaged-elsewhere') {
				// Another window won the engagement (restored windows can
				// share one stored intent, and each window's opening
				// configuration snapshots the engagement before any renderer
				// can claim it). Canvas IS being presented, so this window
				// stands down to a plain IDE rather than raising a failure
				// card on every such relaunch.
				this.logService.info('[canvas] Standalone startup stood down: Canvas is already presented by another window');
				this.dispose();
				return;
			}
			this.logService.info(`[canvas] Standalone startup did not enter Canvas: ${outcome.reason}`);
			this.showFailure(outcome.message);
		} catch (error) {
			if (this.disposed) {
				return;
			}
			this.logService.error('[canvas] Standalone startup failed.', error);
			this.showFailure(localize('positron.canvas.startupFailure', "Canvas could not be loaded. Try again, open Positron, or quit."));
		} finally {
			this.running = false;
		}
	}

	private showLoading(): void {
		// Loading announces itself politely, but stays cancellable: entry can
		// take a while (extension activation plus the assistant's own ensure
		// deadline), and the user must not be trapped behind the curtain for
		// its whole duration.
		this.element.setAttribute('aria-busy', 'true');
		this.element.setAttribute('role', 'status');
		this.element.setAttribute('aria-live', 'polite');
		this.element.removeAttribute('aria-modal');
		this.element.removeAttribute('aria-labelledby');
		const actions = new DisposableStore();
		this.actionDisposables.value = actions;
		renderCurtainCard(this.element, {
			brandText: localize('positron.canvas.loadingBrand', "Canvas"),
			messageText: localize('positron.canvas.loadingMessage', "Loading Canvas..."),
			spinner: true,
			actions: [
				{ label: localize('positron.canvas.openPositron', "Open Positron"), run: () => void this.openPositron() },
			],
		}, actions);
	}

	private showFailure(detail: string): void {
		this.element.setAttribute('aria-busy', 'false');
		// Failure needs the user to act (Retry, Open Positron, Quit), so it is a
		// dialog rather than a status update: screen readers move focus to it
		// instead of merely announcing it.
		this.element.setAttribute('role', 'dialog');
		this.element.setAttribute('aria-modal', 'true');
		this.element.removeAttribute('aria-live');
		const brandId = 'positron-canvas-startup-failure-brand';
		this.element.setAttribute('aria-labelledby', brandId);
		const actions = new DisposableStore();
		this.actionDisposables.value = actions;
		const { firstButton } = renderCurtainCard(this.element, {
			brandText: localize('positron.canvas.failureBrand', "Canvas could not start"),
			brandId,
			messageText: detail,
			spinner: false,
			actions: [
				{ label: localize('positron.canvas.retry', "Retry"), primary: true, run: () => void this.start() },
				{ label: localize('positron.canvas.openPositron', "Open Positron"), run: () => void this.openPositron() },
				// The curtain covers the notifications and output that explain
				// the failure; this is the road to them.
				{ label: localize('positron.canvas.showLogs', "Show Logs"), run: () => void this.openPositron(true) },
				{ label: localize('positron.canvas.quit', "Quit"), run: () => void this.quitApplication() },
			],
		}, actions);
		firstButton?.focus();
	}

	/**
	 * Available during loading as well as failure: recovering the main window
	 * supersedes an in-flight entry (`exit()` bumps the generation the entry
	 * checks), so cancelling mid-load is the same operation as leaving a
	 * failure card.
	 */
	private async openPositron(withLogs = false): Promise<void> {
		if (this.recovering || this.disposed) {
			return;
		}
		this.recovering = true;
		try {
			await this.recoverMainWindow();
		} catch (error) {
			// The curtain stays up: recovery failing means the IDE is not
			// usable behind it, and the card's actions remain the way out.
			this.logService.error('[canvas] Failed to recover the Positron window.', error);
			return;
		} finally {
			this.recovering = false;
		}

		// The IDE is back; the curtain must not outlive it, showing the logs
		// included - a failure there must not strand the curtain (and its
		// inert marks) over a recovered IDE.
		this.dispose();
		if (withLogs) {
			try {
				await this.showLogs();
			} catch (error) {
				this.logService.error('[canvas] Failed to show the logs after recovering the Positron window.', error);
			}
		}
	}

	private async quitApplication(): Promise<void> {
		try {
			await this.quit();
		} catch (error) {
			this.logService.error('[canvas] Failed to quit from the Canvas startup curtain.', error);
		}
	}

	override dispose(): void {
		if (this.disposed) {
			return;
		}
		this.releaseSiblings();
		this.element.remove();
		super.dispose();
		this.onDidDispose();
	}
}

/** Presents at most one Canvas startup curtain in a workbench window. */
export class CanvasStartupPresenter extends Disposable {
	private readonly currentCurtain = this._register(new MutableDisposable<IDisposable>());

	constructor(
		private readonly container: HTMLElement,
		private readonly enter: () => Promise<CanvasEntryOutcome>,
		private readonly recoverMainWindow: () => Promise<void>,
		private readonly showLogs: () => Promise<void>,
		private readonly quit: () => Promise<void>,
		private readonly logService: ILogService,
	) {
		super();
	}

	/** Presents loading, then enters Canvas behind the curtain. */
	present(): void {
		if (this.currentCurtain.value) {
			return;
		}
		const curtain = new CanvasStartupCurtain(
			this.container,
			this.enter,
			this.recoverMainWindow,
			this.showLogs,
			this.quit,
			this.logService,
			() => {
				if (this.currentCurtain.value === curtain) {
					this.currentCurtain.clearAndLeak();
				}
			},
		);
		this.currentCurtain.value = curtain;
	}
}
