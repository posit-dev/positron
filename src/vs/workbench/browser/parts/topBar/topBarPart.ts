/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/topBarPart';
import * as DOM from 'vs/base/browser/dom';
import { localize } from 'vs/nls';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { IThemeService, registerThemingParticipant } from 'vs/platform/theme/common/themeService';
import { Part } from 'vs/workbench/browser/part';
import { IWorkbenchLayoutService, Parts } from 'vs/workbench/services/layout/browser/layoutService';
import { Emitter } from 'vs/base/common/event';
import { ITopBarService } from 'vs/workbench/services/topBar/browser/topBarService';
import { TOP_BAR_BACKGROUND, TOP_BAR_FOREGROUND, TOP_BAR_ICON_FOREGROUND } from 'vs/workbench/common/theme';
import { KeybindingsRegistry, KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { KeyCode } from 'vs/base/common/keyCodes';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { TopBarFocused } from 'vs/workbench/common/contextkeys';
import { ActionBar, ActionsOrientation } from 'vs/base/browser/ui/actionbar/actionbar';
import { Action, IAction } from 'vs/base/common/actions';
import { BaseActionViewItem } from 'vs/base/browser/ui/actionbar/actionViewItems';

// Theme support

registerThemingParticipant((theme, collector) => {
	const backgroundColor = theme.getColor(TOP_BAR_BACKGROUND);
	if (backgroundColor) {
		collector.addRule(`.monaco-workbench .part.topbar { background-color: ${backgroundColor}; }`);
	}

	const foregroundColor = theme.getColor(TOP_BAR_FOREGROUND);
	if (foregroundColor) {
		collector.addRule(`
			.monaco-workbench .part.topbar,
			.monaco-workbench .part.topbar .action-container .codicon,
			.monaco-workbench .part.topbar .message-actions-container .monaco-link,
			.monaco-workbench .part.topbar .message-container a
			{ color: ${foregroundColor}; }
		`);
	}

	const iconForegroundColor = theme.getColor(TOP_BAR_ICON_FOREGROUND);
	if (iconForegroundColor) {
		collector.addRule(`.monaco-workbench .part.topbar .icon-container .codicon { color: ${iconForegroundColor} }`);
	}
});

// TopBarActionViewItem class.
export class TopBarActionViewItem extends BaseActionViewItem {

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

// TopBarPart class.
export class TopBarPart extends Part implements ITopBarService {

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
				return new TopBarActionViewItem(action, 'top-bar-action-container');
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

	//#endregion Part Class

	//#region ITopBarService

	focus(): void {
		this.element.focus();
	}

	//#endregion ITopBarService

	toJSON(): object {
		return {
			type: Parts.TOPBAR_PART
		};
	}
}

registerSingleton(ITopBarService, TopBarPart, false);

// Keybindings

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'workbench.topbar.focusTopBar',
	weight: KeybindingWeight.WorkbenchContrib,
	primary: KeyCode.Escape,
	when: TopBarFocused,
	handler: (accessor: ServicesAccessor) => {
		const topBarService = accessor.get(ITopBarService);
		topBarService.focus();
	}
});
