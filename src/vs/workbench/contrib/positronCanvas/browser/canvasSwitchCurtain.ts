/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { renderCurtainCard } from './canvasStartupPresenter.js';

/**
 * Covers the Canvas window while its workspace is switched, then either
 * comes down or offers a way out. Shares the startup curtain's card and
 * styles but not its inert handling: the Canvas group underneath must keep
 * receiving focus so the assistant rebuilds the panel in this window rather
 * than in the hidden IDE.
 */
export class CanvasSwitchCurtain extends Disposable {

	private readonly element: HTMLElement;
	private readonly actions = this._register(new MutableDisposable<DisposableStore>());

	constructor(container: HTMLElement) {
		super();
		this.element = container.ownerDocument.createElement('div');
		this.element.className = 'positron-canvas-startup-curtain';
		container.appendChild(this.element);
	}

	/** Progress with no way out: every step underneath is in flight. */
	showLoading(): void {
		this.element.setAttribute('role', 'status');
		this.element.setAttribute('aria-live', 'polite');
		this.element.setAttribute('aria-busy', 'true');
		this.element.removeAttribute('aria-modal');
		this.element.removeAttribute('aria-labelledby');
		const actions = new DisposableStore();
		this.actions.value = actions;
		renderCurtainCard(this.element, {
			brandText: localize('positron.canvas.switchBrand', "Canvas"),
			messageText: localize('positron.canvas.switchLoading', "Canvas is starting in new workspace"),
			spinner: true,
			actions: []
		}, actions);
	}

	/**
	 * The switch stopped and the user must choose: pick the transaction back
	 * up where it stopped, or take the IDE. A dialog rather than a status so
	 * screen readers move to it.
	 */
	showFailure(detail: string, handlers: { readonly retry: () => void; readonly openPositron: () => void }): void {
		const brandId = 'positron-canvas-switch-failure-brand';
		this.element.setAttribute('role', 'dialog');
		this.element.setAttribute('aria-modal', 'true');
		this.element.setAttribute('aria-busy', 'false');
		this.element.setAttribute('aria-labelledby', brandId);
		this.element.removeAttribute('aria-live');
		const actions = new DisposableStore();
		this.actions.value = actions;
		const { firstButton } = renderCurtainCard(this.element, {
			brandText: localize('positron.canvas.switchFailureBrand', "Canvas could not switch workspaces"),
			brandId,
			messageText: detail,
			spinner: false,
			actions: [
				{ label: localize('positron.canvas.switchRetry', "Retry Canvas"), primary: true, run: handlers.retry },
				{ label: localize('positron.canvas.openPositron', "Open Positron"), run: handlers.openPositron }
			]
		}, actions);
		firstButton?.focus();
	}

	override dispose(): void {
		this.element.remove();
		super.dispose();
	}
}
