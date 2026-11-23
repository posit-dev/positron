/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/positronTitleBarLayoutPicker.css';
import { $, addDisposableListener, append, EventType, reset } from '../../../../base/browser/dom.js';
import { toAction } from '../../../../base/common/actions.js';
import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IPositronLayoutService } from '../../../services/positronLayout/browser/interfaces/positronLayoutService.js';
import { getTaskLayouts, TaskLayout } from '../../../services/positronLayout/browser/layouts/taskLayouts.js';

/**
 * A dropdown on the left of the title bar, shown in the simplified layout. It
 * names the layout the window is in, or "Custom" when it matches none, and
 * switches between the task layouts.
 */
export class PositronTitleBarLayoutPicker extends Disposable {
	private readonly _button: HTMLButtonElement;

	constructor(
		container: HTMLElement,
		@ICommandService private readonly _commandService: ICommandService,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@IContextMenuService private readonly _contextMenuService: IContextMenuService,
		@IPositronLayoutService private readonly _positronLayoutService: IPositronLayoutService,
	) {
		super();

		const button = append(container, $('button.positron-title-bar-layout-picker')) as HTMLButtonElement;
		this._button = button;
		button.setAttribute('aria-haspopup', 'menu');
		this._register(toDisposable(() => button.remove()));
		this._register(addDisposableListener(button, EventType.CLICK, () => this._showMenu()));
		this._register(this._positronLayoutService.onDidChangeCurrentLayout(() => this._render()));
		this._render();
	}

	/** The task layouts the user can switch to now. */
	private _availableLayouts(): TaskLayout[] {
		return getTaskLayouts().filter(layout => this._contextKeyService.contextMatchesRules(layout.precondition));
	}

	private _render(): void {
		const current = getTaskLayouts().find(layout => layout.id === this._positronLayoutService.currentLayoutId);
		const name = current?.name ?? localize('positron.titleBarLayoutPicker.custom', "Custom");
		reset(
			this._button,
			$(`span.codicon.codicon-${current?.codicon ?? 'layout'}`, { 'aria-hidden': 'true' }),
			$('span.positron-title-bar-layout-picker-label', undefined, name),
			$('span.codicon.codicon-chevron-down', { 'aria-hidden': 'true' }),
		);
		this._button.setAttribute('aria-label', localize('positron.titleBarLayoutPicker.ariaLabel', "Layout: {0}", name));
		this._button.title = localize('positron.titleBarLayoutPicker.tooltip', "Switch Layout");
	}

	private _showMenu(): void {
		const currentId = this._positronLayoutService.currentLayoutId;
		this._contextMenuService.showContextMenu({
			getAnchor: () => this._button,
			getActions: () => this._availableLayouts().map(layout => toAction({
				id: layout.id,
				label: layout.name,
				checked: layout.id === currentId,
				run: () => this._commandService.executeCommand(layout.id),
			})),
			onHide: () => this._button.focus(),
		});
	}
}
