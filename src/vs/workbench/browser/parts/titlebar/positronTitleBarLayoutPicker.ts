/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/positronTitleBarLayoutPicker.css';
import { $, addDisposableListener, append, EventType, getWindow, reset } from '../../../../base/browser/dom.js';
import { StandardKeyboardEvent } from '../../../../base/browser/keyboardEvent.js';
import { AnchorAlignment } from '../../../../base/browser/ui/contextview/contextview.js';
import { KeyCode } from '../../../../base/common/keyCodes.js';
import { Disposable, DisposableStore, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { IContextViewService } from '../../../../platform/contextview/browser/contextView.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IPositronLayoutService } from '../../../services/positronLayout/browser/interfaces/positronLayoutService.js';
import { getTaskLayout, getTaskLayouts, TaskLayout } from '../../../services/positronLayout/browser/layouts/taskLayouts.js';
import { PositronLayoutPopover } from './positronLayoutPopover.js';

/**
 * The one place in the simplified layout's title bar to change the layout. A button on
 * the left names the layout the window is in. When the user has changed the window so it
 * no longer matches, it names the layout they changed it from, marked as modified, or
 * "Custom" when they never picked one. The button opens the layout popover.
 */
export class PositronTitleBarLayoutPicker extends Disposable {
	private readonly _button: HTMLButtonElement;

	private _popoverOpen = false;

	constructor(
		container: HTMLElement,
		@IContextViewService private readonly _contextViewService: IContextViewService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IPositronLayoutService private readonly _positronLayoutService: IPositronLayoutService,
	) {
		super();

		const button = append(container, $('button.positron-title-bar-layout-picker')) as HTMLButtonElement;
		this._button = button;
		button.setAttribute('aria-haspopup', 'dialog');
		button.setAttribute('aria-expanded', 'false');
		this._register(toDisposable(() => button.remove()));
		this._register(addDisposableListener(button, EventType.CLICK, () => this._togglePopover()));
		this._register(this._positronLayoutService.onDidChangeCurrentLayout(() => this._render()));
		this._render();
	}

	/**
	 * The layout the user picked last, when they have since changed the window so it no
	 * longer matches. Picking it again puts it back.
	 */
	private _modifiedLayout(): TaskLayout | undefined {
		const lastApplied = this._positronLayoutService.lastAppliedLayoutId;
		return !this._positronLayoutService.currentLayoutId && lastApplied ? getTaskLayout(lastApplied) : undefined;
	}

	private _render(): void {
		const current = getTaskLayouts().find(layout => layout.id === this._positronLayoutService.currentLayoutId);
		const modified = this._modifiedLayout();
		const name = current
			? current.name
			: modified
				? localize('positron.titleBarLayoutPicker.modified', "{0} (Modified)", modified.name)
				: localize('positron.titleBarLayoutPicker.custom', "Custom");
		reset(
			this._button,
			$(`span.codicon.codicon-${(current ?? modified)?.codicon ?? 'layout'}`, { 'aria-hidden': 'true' }),
			$('span.positron-title-bar-layout-picker-label', undefined, name),
			$('span.codicon.codicon-chevron-down', { 'aria-hidden': 'true' }),
		);
		this._button.setAttribute('aria-label', localize('positron.titleBarLayoutPicker.ariaLabel', "Layout: {0}", name));
		this._button.title = localize('positron.titleBarLayoutPicker.tooltip', "Change Layout");
	}

	private _togglePopover(): void {
		if (this._popoverOpen) {
			this._contextViewService.hideContextView();
			return;
		}
		this._popoverOpen = true;
		this._button.setAttribute('aria-expanded', 'true');
		this._contextViewService.showContextView({
			getAnchor: () => this._button,
			anchorAlignment: AnchorAlignment.LEFT,
			render: container => this._renderPopover(container),
			onHide: () => {
				this._popoverOpen = false;
				this._button.setAttribute('aria-expanded', 'false');
				this._button.focus();
			},
		});
	}

	/**
	 * Draws the popover into the context view.
	 * @param container The element the context view gives the popover.
	 * @returns What to dispose when the popover closes.
	 */
	private _renderPopover(container: HTMLElement): IDisposable {
		const disposables = new DisposableStore();
		disposables.add(this._instantiationService.createInstance(PositronLayoutPopover, container, {
			close: () => this._contextViewService.hideContextView(),
			layout: () => this._contextViewService.layout(),
		}));

		// Close on a click anywhere else, or on Escape wherever focus is. A click on the
		// button is left to the button, which closes the popover itself.
		const targetWindow = getWindow(this._button);
		disposables.add(addDisposableListener(targetWindow, EventType.MOUSE_DOWN, e => {
			const target = e.target as Node | null;
			if (target && !container.contains(target) && !this._button.contains(target)) {
				this._contextViewService.hideContextView();
			}
		}, true));
		disposables.add(addDisposableListener(targetWindow, EventType.KEY_DOWN, e => {
			if (new StandardKeyboardEvent(e).equals(KeyCode.Escape)) {
				this._contextViewService.hideContextView();
			}
		}));
		// Showing a view from the popover can move focus into a webview, which the window
		// reports as losing focus. Only close when the pointer is outside the popover, as it
		// is when the user clicks into a webview or another app.
		let pointerInside = false;
		disposables.add(addDisposableListener(container, EventType.MOUSE_ENTER, () => pointerInside = true));
		disposables.add(addDisposableListener(container, EventType.MOUSE_LEAVE, () => pointerInside = false));
		disposables.add(addDisposableListener(targetWindow, EventType.BLUR, () => {
			if (!pointerInside) {
				this._contextViewService.hideContextView();
			}
		}));
		return disposables;
	}
}
