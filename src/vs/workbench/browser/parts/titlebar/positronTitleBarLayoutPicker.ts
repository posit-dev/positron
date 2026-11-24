/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/positronTitleBarLayoutPicker.css';
import { $, addDisposableListener, append, EventType, getActiveElement, getWindow, isHTMLElement, reset } from '../../../../base/browser/dom.js';
import { StandardKeyboardEvent } from '../../../../base/browser/keyboardEvent.js';
import { AnchorAlignment } from '../../../../base/browser/ui/contextview/contextview.js';
import { KeyCode } from '../../../../base/common/keyCodes.js';
import { Disposable, DisposableStore, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextViewService } from '../../../../platform/contextview/browser/contextView.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { IPositronLayoutService } from '../../../services/positronLayout/browser/interfaces/positronLayoutService.js';
import { getTaskLayout, getTaskLayouts, TaskLayout } from '../../../services/positronLayout/browser/layouts/taskLayouts.js';

/**
 * The one place in the simplified layout's title bar to change the layout. A button on
 * the left names the layout the window is in, or "Custom" when the user has moved
 * things so it matches none. Its menu leads with the task layouts, so the first
 * question is what the user is working on, with the Default layout, which shows every
 * view, last. Below them, a switch shows and hides the bottom panel, and VS Code's full
 * layout options are one click further.
 */
export class PositronTitleBarLayoutPicker extends Disposable {
	private readonly _button: HTMLButtonElement;

	/** The menu's items, in order, for moving between them with the arrow keys. */
	private _items: HTMLElement[] = [];

	/** The open menu's item listeners, cleared each time it is drawn again. */
	private readonly _menuDisposables = this._register(new DisposableStore());

	private _menuOpen = false;

	constructor(
		container: HTMLElement,
		@ICommandService private readonly _commandService: ICommandService,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@IContextViewService private readonly _contextViewService: IContextViewService,
		@IPositronLayoutService private readonly _positronLayoutService: IPositronLayoutService,
		@IWorkbenchLayoutService private readonly _layoutService: IWorkbenchLayoutService,
	) {
		super();

		const button = append(container, $('button.positron-title-bar-layout-picker')) as HTMLButtonElement;
		this._button = button;
		button.setAttribute('aria-haspopup', 'menu');
		button.setAttribute('aria-expanded', 'false');
		this._register(toDisposable(() => button.remove()));
		this._register(addDisposableListener(button, EventType.CLICK, () => this._toggleMenu()));
		this._register(this._positronLayoutService.onDidChangeCurrentLayout(() => this._render()));
		this._render();
	}

	/** The picker's layouts the user can switch to now. */
	private _availableLayouts(): TaskLayout[] {
		return getTaskLayouts().filter(layout => this._contextKeyService.contextMatchesRules(layout.precondition));
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

	private _toggleMenu(): void {
		if (this._menuOpen) {
			this._contextViewService.hideContextView();
			return;
		}
		this._menuOpen = true;
		this._button.setAttribute('aria-expanded', 'true');
		this._contextViewService.showContextView({
			getAnchor: () => this._button,
			anchorAlignment: AnchorAlignment.LEFT,
			render: container => this._renderMenu(container),
			onHide: () => {
				this._menuOpen = false;
				this._menuDisposables.clear();
				this._button.setAttribute('aria-expanded', 'false');
				this._button.focus();
			},
		});
	}

	/**
	 * Draws the menu into the context view.
	 * @param container The element the context view gives the menu.
	 * @returns What to dispose when the menu closes.
	 */
	private _renderMenu(container: HTMLElement): IDisposable {
		const menu = append(container, $('.positron-layout-menu', { role: 'menu' }));
		menu.setAttribute('aria-label', localize('positron.layoutMenu.ariaLabel', "Layout"));
		this._fillMenu(menu);

		const disposables = new DisposableStore();
		disposables.add(addDisposableListener(menu, EventType.KEY_DOWN, e => this._onKeyDown(new StandardKeyboardEvent(e))));
		// Keep the switch in step when the panel is shown or hidden some other way, and
		// mark the layout as modified as soon as the window stops matching it.
		disposables.add(this._layoutService.onDidChangePartVisibility(() => this._fillMenu(menu)));
		disposables.add(this._positronLayoutService.onDidChangeCurrentLayout(() => this._fillMenu(menu)));
		// Close on a click anywhere else, or when the window loses focus. A click on the
		// button is left to the button, which closes the menu itself.
		const targetWindow = getWindow(this._button);
		disposables.add(addDisposableListener(targetWindow, EventType.MOUSE_DOWN, e => {
			const target = e.target as Node | null;
			if (target && !menu.contains(target) && !this._button.contains(target)) {
				this._contextViewService.hideContextView();
			}
		}, true));
		disposables.add(addDisposableListener(targetWindow, EventType.BLUR, () => this._contextViewService.hideContextView()));
		// Escape closes the menu even when focus is outside it, such as after a switch.
		disposables.add(addDisposableListener(targetWindow, EventType.KEY_DOWN, e => {
			if (new StandardKeyboardEvent(e).equals(KeyCode.Escape)) {
				this._contextViewService.hideContextView();
			}
		}));

		// Start on the layout the window is in or was modified from, or on the first item.
		const current = this._items.find(item => item.dataset.state !== undefined);
		(current ?? this._items[0])?.focus();
		return disposables;
	}

	/**
	 * Builds the menu's sections. Called again whenever what they show changes, keeping
	 * keyboard focus on the same item.
	 * @param menu The menu element to fill.
	 */
	private _fillMenu(menu: HTMLElement): void {
		const active = getActiveElement();
		const focusedId = isHTMLElement(active) && this._items.includes(active) ? active.dataset.id : undefined;
		this._menuDisposables.clear();
		this._items = [];

		const currentId = this._positronLayoutService.currentLayoutId;
		const modifiedId = this._modifiedLayout()?.id;
		const layouts = this._availableLayouts();
		const layoutItem = (layout: TaskLayout) => this._layoutItem(
			layout,
			layout.id === currentId ? 'current' : layout.id === modifiedId ? 'modified' : undefined,
		);

		// What the user is working on.
		const taskSection = this._section(localize('positron.layoutMenu.tasks', "What are you working on?"));
		// The task layouts, then Default, which shows every view.
		for (const layout of layouts) {
			taskSection.appendChild(layoutItem(layout));
		}

		// A switch for the bottom panel.
		const showSection = this._section(localize('positron.layoutMenu.show', "Show"));
		showSection.appendChild(this._panelSwitchItem());

		// VS Code's full set of layout options.
		const moreSection = this._section();
		moreSection.appendChild(this._item({
			id: 'customize',
			role: 'menuitem',
			label: localize('positron.layoutMenu.more', "More Layout Options..."),
			run: () => this._commandService.executeCommand('workbench.action.customizeLayout'),
		}));

		reset(
			menu,
			taskSection,
			$('.positron-layout-menu-separator', { role: 'separator' }),
			showSection,
			$('.positron-layout-menu-separator', { role: 'separator' }),
			moreSection,
		);

		this._items.find(item => item.dataset.id === focusedId)?.focus();
		this._contextViewService.layout();
	}

	/**
	 * A group of items, with a heading when it has one.
	 * @param heading The heading, read out as the group's name.
	 */
	private _section(heading?: string): HTMLElement {
		const section = $('.positron-layout-menu-section', { role: 'group' });
		if (heading) {
			section.setAttribute('aria-label', heading);
			append(section, $('.positron-layout-menu-heading', { 'aria-hidden': 'true' }, heading));
		}
		return section;
	}

	/**
	 * An item that applies a layout, with its description under its name. The layout the
	 * window is in has a check mark. The layout the user has changed the window from says
	 * so instead of its description, since picking it puts it back.
	 * @param layout The layout.
	 * @param state Whether the window is in this layout or was changed from it.
	 */
	private _layoutItem(layout: TaskLayout, state: 'current' | 'modified' | undefined): HTMLElement {
		const item = this._item({
			id: layout.id,
			role: 'menuitemradio',
			checked: state === 'current',
			icon: state === 'current' ? 'check' : state === 'modified' ? 'discard' : undefined,
			label: layout.name,
			description: state === 'modified'
				? localize('positron.layoutMenu.modified', "Modified. Click to reset.")
				: layout.description,
			run: () => this._commandService.executeCommand(layout.id),
		});
		if (state) {
			item.dataset.state = state;
		}
		return item;
	}

	/**
	 * A switch that shows or hides the bottom panel. The menu stays open, so the user
	 * sees the switch change.
	 */
	private _panelSwitchItem(): HTMLElement {
		const shown = this._layoutService.isVisible(Parts.PANEL_PART);
		const item = this._item({
			id: Parts.PANEL_PART,
			role: 'menuitemcheckbox',
			checked: shown,
			label: localize('positron.layoutMenu.panel', "Bottom Panel"),
			run: () => this._setPanelShown(!shown),
			keepOpen: true,
		});
		append(item, $('span.positron-layout-menu-switch', { 'aria-hidden': 'true' }));
		return item;
	}

	/**
	 * Shows or hides the bottom panel. The panel reopens maximized when it was maximized
	 * as it closed, which happens when no editor is open, and then it covers the whole
	 * editor area. The switch always opens it at its normal height instead, as in the
	 * Default layout.
	 * @param shown Whether to show the panel.
	 */
	private _setPanelShown(shown: boolean): void {
		this._layoutService.setPartHidden(!shown, Parts.PANEL_PART);
		if (shown && this._layoutService.isPanelMaximized()) {
			this._layoutService.toggleMaximizedPanel();
		}
	}

	private _item(options: {
		id: string;
		role: 'menuitem' | 'menuitemradio' | 'menuitemcheckbox';
		label: string;
		description?: string;
		icon?: string;
		checked?: boolean;
		keepOpen?: boolean;
		run: () => void;
	}): HTMLElement {
		const item = $('.positron-layout-menu-item', { role: options.role, tabindex: '-1' });
		item.dataset.id = options.id;
		if (options.checked !== undefined) {
			item.setAttribute('aria-checked', String(options.checked));
		}
		append(item, $(`span.positron-layout-menu-icon${options.icon ? `.codicon.codicon-${options.icon}` : ''}`, { 'aria-hidden': 'true' }));
		const text = append(item, $('span.positron-layout-menu-text'));
		append(text, $('span.positron-layout-menu-label', undefined, options.label));
		if (options.description) {
			append(text, $('span.positron-layout-menu-description', undefined, options.description));
		}

		this._menuDisposables.add(addDisposableListener(item, EventType.CLICK, () => {
			if (!options.keepOpen) {
				this._contextViewService.hideContextView();
			}
			options.run();
		}));
		this._menuDisposables.add(addDisposableListener(item, EventType.MOUSE_ENTER, () => item.focus()));
		this._items.push(item);
		return item;
	}

	private _onKeyDown(event: StandardKeyboardEvent): void {
		const active = getActiveElement();
		const index = isHTMLElement(active) ? this._items.indexOf(active) : -1;
		let next: number | undefined;
		if (event.equals(KeyCode.DownArrow)) {
			next = (index + 1) % this._items.length;
		} else if (event.equals(KeyCode.UpArrow)) {
			next = (index - 1 + this._items.length) % this._items.length;
		} else if (event.equals(KeyCode.Home)) {
			next = 0;
		} else if (event.equals(KeyCode.End)) {
			next = this._items.length - 1;
		} else if (event.equals(KeyCode.Enter) || event.equals(KeyCode.Space)) {
			this._items[index]?.click();
		} else if (event.equals(KeyCode.Escape) || event.equals(KeyCode.Tab)) {
			this._contextViewService.hideContextView();
		} else {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		if (next !== undefined) {
			this._items[next]?.focus();
		}
	}
}
