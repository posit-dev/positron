/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore, IDisposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { CanvasEntryOutcome } from '../common/positronCanvasMode.js';

/**
 * Appends one accessible Canvas curtain to a workbench container.
 *
 * The curtain covers the workbench visually, but the workbench's existing
 * children stay in the accessibility tree and the tab order unless marked
 * inert here. Call the returned `release` when the curtain comes down to
 * restore them.
 */
function createCanvasCurtainElement(container: HTMLElement): { element: HTMLElement; release: () => void } {
	const element = container.ownerDocument.createElement('div');
	element.className = 'positron-canvas-startup-curtain';
	element.setAttribute('role', 'status');
	element.setAttribute('aria-live', 'polite');

	const covered = Array.from(container.children) as HTMLElement[];
	for (const sibling of covered) {
		sibling.inert = true;
	}

	container.appendChild(element);
	return {
		element,
		release: () => {
			for (const sibling of covered) {
				sibling.inert = false;
			}
		},
	};
}

/** Replaces curtain content with the passive Canvas loading state. */
function renderCanvasLoading(element: HTMLElement): void {
	element.setAttribute('aria-busy', 'true');
	const document = element.ownerDocument;
	const card = document.createElement('div');
	card.className = 'positron-canvas-startup-card';
	const brand = document.createElement('div');
	brand.className = 'positron-canvas-startup-brand';
	brand.textContent = localize('positron.canvas.loadingBrand', "Canvas");
	const spinner = document.createElement('div');
	spinner.className = 'positron-canvas-startup-spinner';
	spinner.setAttribute('role', 'progressbar');
	spinner.setAttribute('aria-label', localize('positron.canvas.loadingLabel', "Loading Canvas"));
	const message = document.createElement('p');
	message.className = 'positron-canvas-startup-message';
	message.textContent = localize('positron.canvas.loadingMessage', "Loading Canvas...");
	card.append(brand, spinner, message);
	element.replaceChildren(card);
}

/** One interactive Canvas loading and failure curtain. */
class CanvasStartupCurtain extends Disposable {
	private readonly actionDisposables = this._register(new MutableDisposable<DisposableStore>());
	private readonly element: HTMLElement;
	private readonly releaseSiblings: () => void;
	private running = false;
	private disposed = false;

	constructor(
		container: HTMLElement,
		private readonly enter: () => Promise<CanvasEntryOutcome>,
		private readonly recoverMainWindow: () => Promise<void>,
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

	private async start(): Promise<void> {
		if (this.running || this.disposed) {
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
				// Something asked for the IDE while startup was still opening
				// Canvas -- an explicit exit, or an external open that exits
				// Canvas on its way in. The IDE they asked for is being
				// revealed; a failure card over it would demand a second
				// "Open Positron" for a decision the user already made.
				this.logService.info('[canvas] Standalone startup stood down: the IDE was requested while Canvas was opening');
				this.dispose();
				return;
			}
			// The outcome's message already tells the specific non-entry case
			// apart (AI disabled, no panel, no window); the card's buttons carry
			// the available ways forward.
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
		// Loading is a passive announcement, not something the user acts on, so
		// the curtain stays a polite status region.
		this.element.setAttribute('role', 'status');
		this.element.setAttribute('aria-live', 'polite');
		this.element.removeAttribute('aria-modal');
		this.element.removeAttribute('aria-labelledby');
		renderCanvasLoading(this.element);
		this.actionDisposables.clear();
	}

	private showFailure(detail: string): void {
		this.element.setAttribute('aria-busy', 'false');
		// Failure needs the user to act (Retry, Open Positron, Quit), so it is a
		// dialog rather than a status update: screen readers move focus to it
		// instead of merely announcing it.
		this.element.setAttribute('role', 'dialog');
		this.element.setAttribute('aria-modal', 'true');
		this.element.removeAttribute('aria-live');
		const document = this.element.ownerDocument;
		const actions = new DisposableStore();
		this.actionDisposables.value = actions;
		const card = document.createElement('div');
		card.className = 'positron-canvas-startup-card';
		const brand = document.createElement('div');
		brand.className = 'positron-canvas-startup-brand';
		brand.id = 'positron-canvas-startup-failure-brand';
		brand.textContent = localize('positron.canvas.failureBrand', "Canvas could not start");
		this.element.setAttribute('aria-labelledby', brand.id);
		const message = document.createElement('p');
		message.className = 'positron-canvas-startup-message';
		message.textContent = detail;
		const buttons = document.createElement('div');
		buttons.className = 'positron-canvas-startup-actions';
		const retry = this.createButton(localize('positron.canvas.retry', "Retry"), true, () => void this.start(), actions);
		const openPositron = this.createButton(localize('positron.canvas.openPositron', "Open Positron"), false, () => void this.openPositron(), actions);
		const quit = this.createButton(localize('positron.canvas.quit', "Quit"), false, () => void this.quit(), actions);
		buttons.append(retry, openPositron, quit);
		card.append(brand, message, buttons);
		this.element.replaceChildren(card);
		retry.focus();
	}

	private async openPositron(): Promise<void> {
		if (this.running || this.disposed) {
			return;
		}
		this.running = true;
		try {
			await this.recoverMainWindow();
			this.dispose();
		} catch (error) {
			this.logService.error('[canvas] Failed to recover the Positron window.', error);
		} finally {
			this.running = false;
		}
	}

	private createButton(
		label: string,
		primary: boolean,
		onClick: () => void,
		disposables: DisposableStore,
	): HTMLButtonElement {
		const button = this.element.ownerDocument.createElement('button');
		button.className = `positron-canvas-startup-button${primary ? ' primary' : ''}`;
		button.textContent = label;
		button.type = 'button';
		button.addEventListener('click', onClick);
		disposables.add({ dispose: () => button.removeEventListener('click', onClick) });
		return button;
	}

	override dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
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
