/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/css/positronTopBarPart';
import * as DOM from 'vs/base/browser/dom';
import { localize } from 'vs/nls';
import { Emitter } from 'vs/base/common/event';
import { Part } from 'vs/workbench/browser/part';
import { KeyCode } from 'vs/base/common/keyCodes';
import { Action, IAction } from 'vs/base/common/actions';
import { TOP_BAR_BACKGROUND } from 'vs/workbench/common/theme';
import { TopBarFocused } from 'vs/workbench/common/contextkeys';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { BaseActionViewItem } from 'vs/base/browser/ui/actionbar/actionViewItems';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { ActionBar, ActionsOrientation } from 'vs/base/browser/ui/actionbar/actionbar';
import { IThemeService, registerThemingParticipant } from 'vs/platform/theme/common/themeService';
import { IWorkbenchLayoutService, Parts } from 'vs/workbench/services/layout/browser/layoutService';
import { KeybindingsRegistry, KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { IPositronTopBarService } from 'vs/workbench/services/positronTopBar/browser/positronTopBarService';

// Theme support

registerThemingParticipant((theme, collector) => {
	const backgroundColor = theme.getColor(TOP_BAR_BACKGROUND);
	if (backgroundColor) {
		collector.addRule(`.monaco-workbench .part.top-bar { background-color: ${backgroundColor}; }`);
	}
});

/**
 * PositronTopBarActionViewItem class
 */
export class PositronTopBarActionViewItem extends BaseActionViewItem {

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

	override render(container: HTMLElement): void {
		super.render(container);
		this._actionContainer = DOM.$(`.${this._actionContainerClass}`);
		this._actionIcon = DOM.$(`.${this.action.class}`);
		DOM.append(this._actionContainer, this._actionIcon);
		DOM.append(container, this._actionContainer);
	}
}

/**
 * PositronTopBarPart class.
 */
export class PositronTopBarPart extends Part implements IPositronTopBarService {

	declare readonly _serviceBrand: undefined;

	// #region IView

	readonly height: number = 48;
	readonly minimumWidth: number = 0;
	readonly maximumWidth: number = Number.POSITIVE_INFINITY;

	// Gets the minimum height.
	get minimumHeight(): number {
		return this.height;
	}

	// Gets the maximum height.
	get maximumHeight(): number {
		return this.height;
	}

	private _onDidChangeSize = this._register(new Emitter<{ width: number; height: number } | undefined>());
	override get onDidChange() { return this._onDidChangeSize.event; }

	//#endregion IView

	//#region Content Area

	// The action bars container and the left and right action bar containers.
	private actionBarsContainer: HTMLElement | undefined;
	private leftActionBarContainer: HTMLElement | undefined;
	// private rightActionBarContainer: HTMLElement | undefined;

	// The left action bar.
	private leftActionBar: ActionBar | undefined;
	private newFileAction: Action | undefined;

	// The right action bar.
	//private rightActionBar: ActionBar | undefined;
	//private newFileAction: Action | undefined;

	//#endregion Content Area

	//#region Class Initialization

	constructor(
		@IThemeService themeService: IThemeService,
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@IStorageService storageService: IStorageService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService
	) {
		super(Parts.TOPBAR_PART, { hasTitle: false }, themeService, storageService, layoutService);
	}

	//#endregion Class Initialization

	//#region Part Class

	// Provide the content area.
	override createContentArea(parent: HTMLElement): HTMLElement {
		// Set the element.
		this.element = parent;
		this.element.tabIndex = 0;

		// Create the action bars container and the top and bottom action bar containers.
		this.actionBarsContainer = DOM.append(this.element, DOM.$('div.action-bars-container'));
		this.leftActionBarContainer = DOM.append(this.actionBarsContainer, DOM.$('div.action-bar-container'));
		//this.rightActionBarContainer = DOM.append(this.actionBarsContainer, DOM.$('div.action-bar-container'));

		this.leftActionBar = this._register(new ActionBar(this.leftActionBarContainer, {
			actionViewItemProvider: action => {
				return new PositronTopBarActionViewItem(action, 'top-bar-action-container');
			},
			orientation: ActionsOrientation.HORIZONTAL,
			ariaLabel: localize('managew3rewerwer', "Manage w3rewerwer"),
			animated: false,
			preventLoopNavigation: true
		}));

		this.newFileAction = this._register(new Action('testAction1', '', 'top-bar-action.new-file', true, async () => {
			console.log('New file action.');
		}));
		this.leftActionBar.push(this.newFileAction);

		// Track focus
		const scopedContextKeyService = this.contextKeyService.createScoped(this.element);
		TopBarFocused.bindTo(scopedContextKeyService).set(true);

		// Return this element.
		return this.element;
	}

	toJSON(): object {
		return {
			type: Parts.TOPBAR_PART
		};
	}

	//#endregion Part Class

	//#region IPositronTopBarService

	focus(): void {
		this.element.focus();
	}

	//#endregion IPositronTopBarService
}

registerSingleton(IPositronTopBarService, PositronTopBarPart, false);

// Keybindings

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'workbench.top-bar.focusTopBar',
	weight: KeybindingWeight.WorkbenchContrib,
	primary: KeyCode.Escape,
	when: TopBarFocused,
	handler: (accessor: ServicesAccessor) => {
		const positronTopBarService = accessor.get(IPositronTopBarService);
		positronTopBarService.focus();
	}
});
