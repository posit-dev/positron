/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from 'vs/base/browser/dom';
import { Action, IAction, IActionRunner } from 'vs/base/common/actions';
import { ActionBar, ActionsOrientation } from 'vs/base/browser/ui/actionbar/actionbar';
import { BaseActionViewItem } from 'vs/base/browser/ui/actionbar/actionViewItems';

export class ToggleAction extends Action {

	constructor(id: string, label: string = '', cssClass: string, enabled: boolean = true, actionCallback?: (event?: unknown) => unknown) {
		super(id, label, cssClass, enabled, actionCallback);
	}

	activate(): void {
		if (!this.checked) {
			this._setChecked(true);
		}
	}

	deactivate(): void {
		if (this.checked) {
			this._setChecked(false);
		}
	}
}

class ToggleActionViewItem extends BaseActionViewItem {

	private readonly _actionContainerClass: string;
	private _actionContainer: HTMLElement | undefined;
	private _actionIcon: HTMLElement | undefined;

	constructor(
		action: IAction,
		actionContainerClass: string
	) {
		super(null, action);
		this._actionContainerClass = actionContainerClass;
	}

	override updateChecked(): void {
		if (this.action.checked) {
			this._actionContainer?.classList.add('active');
		} else {
			this._actionContainer?.classList.remove('active');
		}
	}

	override render(container: HTMLElement): void {
		super.render(container);
		this._actionContainer = DOM.$(`.${this._actionContainerClass}`);
		this._actionIcon = DOM.$(`.${this.action.class}`);
		DOM.append(this._actionContainer, this._actionIcon);
		DOM.append(container, this._actionContainer);
	}
}

export interface IToggleActionBarOptions {
	readonly actionContainerClass: string;
	readonly orientation?: ActionsOrientation;
	readonly actionRunner?: IActionRunner;
	readonly ariaLabel?: string;
	readonly ariaRole?: string;
}

export class ToggleActionBar extends ActionBar {
	private readonly _actionContainerClass: string;
	private readonly _toggleActions: ToggleAction[];
	private _activeToggleAction: ToggleAction | undefined;

	constructor(container: HTMLElement, options: IToggleActionBarOptions, toggleActions: ToggleAction[]) {
		super(container, {
			...options,
			...{
				actionViewItemProvider: action => {
					return new ToggleActionViewItem(action, this._actionContainerClass);
				},
				animated: false,
				preventLoopNavigation: true
			}
		});

		this._actionContainerClass = options.actionContainerClass;

		this._toggleActions = toggleActions;
		this.push(this._toggleActions);
	}

	get activeToggleAction(): ToggleAction | undefined {
		return this._activeToggleAction;
	}

	toggleAction(toggleAction: ToggleAction | undefined) {
		if (!toggleAction) {
			return;
		}

		this.validateToggleAction(toggleAction);

		this._activeToggleAction?.deactivate();
		this._activeToggleAction = this._activeToggleAction === toggleAction ? undefined : toggleAction;
		this._activeToggleAction?.activate();
	}

	selectAction(toggleAction: ToggleAction | undefined) {
		if (!toggleAction) {
			return;
		}

		this.validateToggleAction(toggleAction);

		if (this._activeToggleAction !== toggleAction) {
			this._activeToggleAction?.deactivate();
			this._activeToggleAction = toggleAction;
			this._activeToggleAction.activate();
		}
	}

	private validateToggleAction(toggleAction: ToggleAction) {
		if (this._toggleActions.indexOf(toggleAction) === -1) {
			throw new Error(`Unknown toggle action '${toggleAction.id}'`);
		}
	}
}
