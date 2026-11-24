/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, EventType, getActiveElement, isHTMLElement, isHTMLInputElement, reset } from '../../../../base/browser/dom.js';
import { StandardKeyboardEvent } from '../../../../base/browser/keyboardEvent.js';
import { RunOnceScheduler } from '../../../../base/common/async.js';
import { KeyCode } from '../../../../base/common/keyCodes.js';
import { Disposable, DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IViewDescriptorService, ViewContainerLocation } from '../../../common/views.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { IPaneCompositePartService } from '../../../services/panecomposite/browser/panecomposite.js';
import { IPositronLayoutService } from '../../../services/positronLayout/browser/interfaces/positronLayoutService.js';
import { getMatchableLayouts } from '../../../services/positronLayout/browser/layouts/layoutMatch.js';
import { getTaskLayout, getTaskLayouts, TaskLayout } from '../../../services/positronLayout/browser/layouts/taskLayouts.js';
import { CustomPositronLayoutDescription } from '../../../services/positronLayout/common/positronCustomViews.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';

/** The Session container, whose views each get their own pill. */
const SESSION_VIEW_CONTAINER_ID = 'workbench.panel.positronSession';

/** A part of the window the popover lists views for. */
type ViewPart = Parts.SIDEBAR_PART | Parts.PANEL_PART | Parts.AUXILIARYBAR_PART;

/** The parts of the window the popover lists views for, in the order it lists them. */
const VIEW_GROUPS: readonly { part: ViewPart; location: ViewContainerLocation; icon: string; name: () => string }[] = [
	{ part: Parts.SIDEBAR_PART, location: ViewContainerLocation.Sidebar, icon: 'layout-sidebar-left', name: () => localize('positron.layoutPopover.leftSideBar', "Left Side Bar") },
	{ part: Parts.PANEL_PART, location: ViewContainerLocation.Panel, icon: 'layout-panel', name: () => localize('positron.layoutPopover.bottomPanel', "Bottom Panel") },
	{ part: Parts.AUXILIARYBAR_PART, location: ViewContainerLocation.AuxiliaryBar, icon: 'layout-sidebar-right', name: () => localize('positron.layoutPopover.rightSideBar', "Right Side Bar") },
];

/** One view or view container the user can show or hide with a pill. */
interface ViewPill {
	readonly id: string;
	readonly name: string;
	readonly icon: ThemeIcon | URI | undefined;
	/** The command whose keybinding the pill shows. */
	readonly commandId: string;
	readonly shown: boolean;
	readonly toggle: () => void;
}

/** One block in a layout's picture: a view, or a view container that fills its part. */
interface PictureBlock {
	/** The ids of the views and containers the block stands for. */
	readonly ids: readonly string[];
	/** Whether the layout shows the block's view, which colors it. */
	readonly shows: boolean;
	/** How much room the block takes in its part. Collapsed views take a sliver. */
	readonly weight: number;
}

/** A part of a layout's picture: its blocks, and the other containers tabbed behind them. */
interface PicturePart {
	readonly blocks: readonly PictureBlock[];
	/** Containers in the part that are not open, so the whole part stands for them. */
	readonly tabIds: readonly string[];
}

/** An element in a picture that lights up when the user points at one of its views. */
interface PictureTarget {
	readonly element: HTMLElement;
	readonly ids: readonly string[];
}

/**
 * What the popover asks of the title bar button that opens it.
 */
export interface ILayoutPopoverHost {
	/** Closes the popover. */
	close(): void;
	/** Positions the popover again after its size changes. */
	layout(): void;
}

/**
 * The layout button's popover. It answers what is on the screen and how to change it.
 * At the top, a card for each layout, with a small picture of it, switches the whole
 * layout. Pointing at a card marks the pills of the views it shows, and pointing at a
 * pill lights up where its view lives in the current layout's picture. Below, every view is a pill, grouped by the part of the window it lives in,
 * hidden ones included. Clicking a pill shows or hides that view, so a user can find a
 * feature without it taking up the screen until they want it.
 */
export class PositronLayoutPopover extends Disposable {
	private readonly _element: HTMLElement;
	private readonly _cards: HTMLElement;
	private readonly _modifiedNote: HTMLElement;
	private readonly _search: HTMLInputElement;
	private readonly _groups: HTMLElement;
	private readonly _customize: HTMLElement;

	/** The cards as last drawn, in order. */
	private _cardElements: HTMLElement[] = [];

	/** The pills and the panel switch as last drawn, in order. */
	private _groupControls: HTMLElement[] = [];

	/** The pills as last drawn, by the id of their view or container. */
	private _pillsById = new Map<string, HTMLElement>();

	/** The parts of each card's picture that light up, by layout id. */
	private readonly _pictureTargets = new Map<string, PictureTarget[]>();

	/** The views and containers each layout shows, by layout id. */
	private readonly _shownByLayout = new Map<string, Set<string>>();

	/** The layout whose picture shows where a pointed-at pill lives. */
	private _activeLayoutId: string | undefined;

	/** The listeners of the cards and pills, cleared each time they are drawn again. */
	private readonly _itemDisposables = this._register(new DisposableStore());

	/** Draws the popover again once, after a burst of changes to the window. */
	private readonly _refresh = this._register(new RunOnceScheduler(() => this._draw(), 0));

	constructor(
		container: HTMLElement,
		private readonly _host: ILayoutPopoverHost,
		@ICommandService private readonly _commandService: ICommandService,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@IKeybindingService private readonly _keybindingService: IKeybindingService,
		@IPaneCompositePartService private readonly _paneCompositeService: IPaneCompositePartService,
		@IPositronLayoutService private readonly _positronLayoutService: IPositronLayoutService,
		@IViewDescriptorService private readonly _viewDescriptorService: IViewDescriptorService,
		@IViewsService private readonly _viewsService: IViewsService,
		@IWorkbenchLayoutService private readonly _layoutService: IWorkbenchLayoutService,
	) {
		super();

		this._element = append(container, $('.positron-layout-popover', { role: 'dialog' }));
		// The context view keeps its container when it hides, so take the popover out of it.
		this._register(toDisposable(() => this._element.remove()));
		this._element.setAttribute('aria-label', localize('positron.layoutPopover.ariaLabel', "Layout"));

		const layoutHeader = append(this._element, $('.positron-layout-popover-header'));
		append(layoutHeader, $('span.positron-layout-popover-heading', undefined, localize('positron.layoutPopover.layout', "Layout")));
		this._modifiedNote = append(layoutHeader, $('span.positron-layout-popover-note'));
		this._cards = append(this._element, $('.positron-layout-popover-cards', { role: 'radiogroup' }));
		this._cards.setAttribute('aria-label', localize('positron.layoutPopover.layouts', "Layouts"));

		append(this._element, $('.positron-layout-popover-divider'));

		const viewsHeader = append(this._element, $('.positron-layout-popover-header'));
		append(viewsHeader, $('span.positron-layout-popover-heading', undefined, localize('positron.layoutPopover.views', "Views")));
		append(viewsHeader, $('span.positron-layout-popover-note', undefined, localize('positron.layoutPopover.viewsHint', "Click a view to show or hide it.")));
		this._search = append(this._element, $('input.positron-layout-popover-search', { type: 'search' })) as HTMLInputElement;
		this._search.placeholder = localize('positron.layoutPopover.searchPlaceholder', "Search views");
		this._search.setAttribute('aria-label', localize('positron.layoutPopover.searchAriaLabel', "Search views"));
		this._register(addDisposableListener(this._search, EventType.INPUT, () => this._draw()));
		this._groups = append(this._element, $('.positron-layout-popover-groups'));

		append(this._element, $('.positron-layout-popover-divider'));

		this._customize = append(this._element, $('button.positron-layout-popover-link'));
		append(this._customize, $('span.codicon.codicon-gear', { 'aria-hidden': 'true' }));
		append(this._customize, $('span', undefined, localize('positron.layoutPopover.customize', "Customize Layout...")));
		this._register(addDisposableListener(this._customize, EventType.CLICK, () => {
			this._host.close();
			this._commandService.executeCommand('workbench.action.customizeLayout');
		}));

		this._register(addDisposableListener(this._element, EventType.KEY_DOWN, e => this._onKeyDown(new StandardKeyboardEvent(e))));

		// Keep the cards and pills in step with the window.
		const refresh = () => this._refresh.schedule();
		this._register(this._layoutService.onDidChangePartVisibility(refresh));
		this._register(this._positronLayoutService.onDidChangeCurrentLayout(refresh));
		this._register(this._paneCompositeService.onDidPaneCompositeOpen(refresh));
		this._register(this._paneCompositeService.onDidPaneCompositeClose(refresh));
		this._register(this._viewsService.onDidChangeViewVisibility(refresh));
		this._register(this._viewDescriptorService.onDidChangeViewContainers(refresh));
		this._register(this._viewDescriptorService.onDidChangeContainer(refresh));
		this._register(this._viewDescriptorService.onDidChangeContainerLocation(refresh));

		this._draw();

		// Start on the layout the window is in, or the one the user changed it from.
		const selected = this._cardElements.find(card => card.classList.contains('current') || card.classList.contains('modified'));
		(selected ?? this._focusables()[0])?.focus();
	}

	//#region Drawing

	private _draw(): void {
		const active = getActiveElement();
		const focusedId = isHTMLElement(active) && this._element.contains(active) ? active.dataset.id : undefined;
		this._itemDisposables.clear();

		this._drawCards();
		this._drawGroups();

		if (focusedId) {
			this._focusables().find(element => element.dataset.id === focusedId)?.focus();
		}
		this._host.layout();
	}

	private _drawCards(): void {
		const currentId = this._positronLayoutService.currentLayoutId;
		const lastApplied = this._positronLayoutService.lastAppliedLayoutId;
		const modifiedId = !currentId && lastApplied && getTaskLayout(lastApplied) ? lastApplied : undefined;
		this._modifiedNote.textContent = modifiedId
			? localize('positron.layoutPopover.modifiedNote', "Modified. Click its card to reset.")
			: '';

		this._activeLayoutId = currentId ?? modifiedId;
		this._pictureTargets.clear();
		this._shownByLayout.clear();
		const layouts = getTaskLayouts().filter(layout => this._contextKeyService.contextMatchesRules(layout.precondition));
		this._cardElements = layouts.map(layout => this._card(layout, layout.id === currentId, layout.id === modifiedId));
		reset(this._cards, ...this._cardElements);
	}

	/**
	 * A card that switches to a layout.
	 * @param layout The layout.
	 * @param current Whether the window is in this layout.
	 * @param modified Whether the user changed the window from this layout.
	 */
	private _card(layout: TaskLayout, current: boolean, modified: boolean): HTMLElement {
		const card = $('button.positron-layout-popover-card', { role: 'radio' });
		card.dataset.id = layout.id;
		card.classList.toggle('current', current);
		card.classList.toggle('modified', modified);
		card.setAttribute('aria-checked', String(current));
		card.title = modified
			? localize('positron.layoutPopover.cardModifiedTitle', "{0}: modified. Click to reset.", layout.name)
			: layout.description ?? layout.name;

		const descriptor = getMatchableLayouts().find(matchable => matchable.id === layout.id)?.layoutDescriptor;
		card.appendChild(descriptor ? this._picture(layout.id, descriptor) : $('.positron-layout-popover-picture'));
		const label = append(card, $('span.positron-layout-popover-card-label', undefined, layout.name));
		if (modified) {
			append(label, $('span.codicon.codicon-discard', { 'aria-hidden': 'true' }));
		}

		this._itemDisposables.add(addDisposableListener(card, EventType.CLICK, () => {
			this._host.close();
			this._commandService.executeCommand(layout.id);
		}));
		// Pointing at a card marks the pills of the views that layout shows.
		const preview = () => this._previewLayout(layout.id);
		const clear = () => this._previewLayout(undefined);
		this._itemDisposables.add(addDisposableListener(card, EventType.MOUSE_ENTER, preview));
		this._itemDisposables.add(addDisposableListener(card, EventType.FOCUS, preview));
		this._itemDisposables.add(addDisposableListener(card, EventType.MOUSE_LEAVE, clear));
		this._itemDisposables.add(addDisposableListener(card, EventType.BLUR, clear));
		return card;
	}

	/**
	 * What a layout puts in one part of the window, for its picture.
	 * @param layout The layout's description.
	 * @param part The part.
	 * @param location Where the part's view containers live.
	 * @returns The part's blocks, or undefined when the layout hides the part.
	 */
	private _picturePart(layout: CustomPositronLayoutDescription, part: ViewPart, location: ViewContainerLocation): PicturePart | undefined {
		const description = layout[part];
		if (!description || description.hidden) {
			return undefined;
		}
		const containers = description.viewContainers ?? [];
		const opened = containers.find(container => container.opened) ?? containers[0];
		const tabIds = containers.filter(container => container !== opened).map(container => container.id);

		// A part that names no container shows whatever was open there, which is its
		// default container unless the user picked another.
		const openedId = opened?.id ?? this._viewDescriptorService.getDefaultViewContainer(location)?.id;
		if (opened?.views?.length) {
			return {
				tabIds,
				blocks: opened.views.map(view => ({
					ids: [view.id],
					shows: !view.collapsed,
					weight: view.collapsed ? 0.3 : 1,
				})),
			};
		}
		return { tabIds, blocks: [{ ids: openedId ? [openedId] : [], shows: !!openedId, weight: 1 }] };
	}

	/**
	 * A small picture of a layout. Each side bar and the bottom panel is drawn as blocks,
	 * one for each view the layout places there, and the views the layout shows are
	 * colored. Pointing at a pill lights up where its view lives in the current layout's
	 * picture.
	 * @param layoutId The layout's command id.
	 * @param layout The layout's description.
	 */
	private _picture(layoutId: string, layout: CustomPositronLayoutDescription): HTMLElement {
		const targets: PictureTarget[] = [];
		const shown = new Set<string>();

		const drawPart = (parent: HTMLElement, className: string, part: PicturePart) => {
			const region = append(parent, $(`.picture-region.${className}`));
			targets.push({ element: region, ids: part.tabIds });
			for (const block of part.blocks) {
				const element = append(region, $('.picture-block'));
				element.classList.toggle('shows', block.shows);
				element.style.flexGrow = String(block.weight);
				targets.push({ element, ids: block.ids });
				if (block.shows) {
					block.ids.forEach(id => shown.add(id));
				}
			}
		};

		const picture = $('.positron-layout-popover-picture', { 'aria-hidden': 'true' });
		const side = this._picturePart(layout, Parts.SIDEBAR_PART, ViewContainerLocation.Sidebar);
		if (side) {
			drawPart(picture, 'picture-side', side);
		}
		const center = append(picture, $('.picture-center'));
		append(center, $('.picture-editor'));
		const panel = this._picturePart(layout, Parts.PANEL_PART, ViewContainerLocation.Panel);
		if (panel) {
			drawPart(center, 'picture-panel', panel);
		}
		const aux = this._picturePart(layout, Parts.AUXILIARYBAR_PART, ViewContainerLocation.AuxiliaryBar);
		if (aux) {
			drawPart(picture, 'picture-aux', aux);
		}

		this._pictureTargets.set(layoutId, targets);
		this._shownByLayout.set(layoutId, shown);
		return picture;
	}

	/**
	 * Lights up where a view lives in the current layout's picture. Nothing lights up when
	 * that layout does not place the view.
	 * @param id The id of the pointed-at pill's view or container, or undefined to clear.
	 */
	private _highlightView(id: string | undefined): void {
		for (const targets of this._pictureTargets.values()) {
			for (const target of targets) {
				target.element.classList.remove('highlight');
			}
		}
		const targets = this._activeLayoutId ? this._pictureTargets.get(this._activeLayoutId) : undefined;
		if (!id || !targets) {
			return;
		}
		// A view's own block wins over the part it is tabbed behind.
		const own = targets.filter(target => target.element.classList.contains('picture-block') && target.ids.includes(id));
		const matches = own.length ? own : targets.filter(target => target.ids.includes(id));
		for (const target of matches) {
			target.element.classList.add('highlight');
		}
	}

	/**
	 * Marks the pills of the views a layout shows.
	 * @param layoutId The pointed-at layout, or undefined to clear.
	 */
	private _previewLayout(layoutId: string | undefined): void {
		const shown = layoutId ? this._shownByLayout.get(layoutId) : undefined;
		for (const [id, pill] of this._pillsById) {
			pill.classList.toggle('preview', !!shown?.has(id));
		}
	}

	private _drawGroups(): void {
		const query = this._search.value.trim().toLowerCase();
		const groups: HTMLElement[] = [];
		this._groupControls = [];
		this._pillsById = new Map();

		for (const group of VIEW_GROUPS) {
			const pills = this._pills(group.location);
			const matching = query ? pills.filter(pill => pill.name.toLowerCase().includes(query)) : pills;
			// While searching, a part with no match is left out. The bottom panel always
			// stays, for its switch.
			if (query && !matching.length) {
				continue;
			}

			const section = $('.positron-layout-popover-group', { role: 'group' });
			const name = group.name();
			section.setAttribute('aria-label', name);
			const header = append(section, $('.positron-layout-popover-group-header'));
			append(header, $(`span.codicon.codicon-${group.icon}`, { 'aria-hidden': 'true' }));
			append(header, $('span.positron-layout-popover-group-name', undefined, name));
			if (pills.length) {
				append(header, $('span.positron-layout-popover-count', undefined, localize(
					'positron.layoutPopover.count', "{0} of {1} showing",
					pills.filter(pill => pill.shown).length, pills.length)));
			}
			if (group.part === Parts.PANEL_PART) {
				const panelSwitch = this._panelSwitch();
				header.appendChild(panelSwitch);
				this._groupControls.push(panelSwitch);
			}

			if (matching.length) {
				const list = append(section, $('.positron-layout-popover-pills'));
				for (const pill of matching) {
					const button = this._pill(pill);
					list.appendChild(button);
					this._groupControls.push(button);
				}
			} else {
				append(section, $('.positron-layout-popover-empty', undefined, localize(
					'positron.layoutPopover.empty', "No views here in this layout.")));
			}
			groups.push(section);
		}

		if (!groups.length) {
			groups.push($('.positron-layout-popover-empty', undefined, localize(
				'positron.layoutPopover.noMatch', "No views match \"{0}\".", this._search.value.trim())));
		}
		reset(this._groups, ...groups);
	}

	/**
	 * The pills for a part of the window: one for each view container that has a tab or
	 * activity bar item there, in the same order, except the Session container, whose
	 * views each get a pill.
	 * @param location Where the views live.
	 */
	private _pills(location: ViewContainerLocation): ViewPill[] {
		const group = VIEW_GROUPS.find(candidate => candidate.location === location)!;
		const pills: ViewPill[] = [];
		for (const containerId of this._paneCompositeService.getVisiblePaneCompositeIds(location)) {
			const container = this._viewDescriptorService.getViewContainerById(containerId);
			if (!container) {
				continue;
			}
			const model = this._viewDescriptorService.getViewContainerModel(container);
			if (container.id === SESSION_VIEW_CONTAINER_ID) {
				for (const view of model.activeViewDescriptors) {
					const shown = this._viewsService.isViewVisible(view.id);
					pills.push({
						id: view.id,
						name: view.name.value,
						icon: view.containerIcon,
						commandId: view.openCommandActionDescriptor?.id ?? `${view.id}.focus`,
						shown,
						toggle: () => shown ? this._viewsService.closeView(view.id) : this._viewsService.openView(view.id, false),
					});
				}
				continue;
			}
			const shown = this._layoutService.isVisible(group.part) &&
				this._paneCompositeService.getActivePaneComposite(location)?.getId() === container.id;
			pills.push({
				id: container.id,
				name: model.title,
				icon: model.icon,
				commandId: container.openCommandActionDescriptor?.id ?? container.id,
				shown,
				toggle: () => shown
					? this._layoutService.setPartHidden(true, group.part)
					: this._paneCompositeService.openPaneComposite(container.id, location, false),
			});
		}
		return pills;
	}

	private _pill(pill: ViewPill): HTMLElement {
		const button = $('button.positron-layout-popover-pill');
		button.dataset.id = pill.id;
		button.classList.toggle('shown', pill.shown);
		button.setAttribute('aria-pressed', String(pill.shown));

		if (ThemeIcon.isThemeIcon(pill.icon)) {
			append(button, $(`span${ThemeIcon.asCSSSelector(pill.icon)}`, { 'aria-hidden': 'true' }));
		}
		append(button, $('span.positron-layout-popover-pill-name', undefined, pill.name));
		const keybinding = this._keybindingService.lookupKeybinding(pill.commandId)?.getLabel();
		if (keybinding) {
			append(button, $('span.positron-layout-popover-pill-keybinding', undefined, keybinding));
		}

		// The popover stays open, so the user sees the view come and go.
		this._itemDisposables.add(addDisposableListener(button, EventType.CLICK, () => pill.toggle()));
		// Pointing at a pill lights up where its view lives in the current layout.
		const highlight = () => this._highlightView(pill.id);
		const clear = () => this._highlightView(undefined);
		this._itemDisposables.add(addDisposableListener(button, EventType.MOUSE_ENTER, highlight));
		this._itemDisposables.add(addDisposableListener(button, EventType.FOCUS, highlight));
		this._itemDisposables.add(addDisposableListener(button, EventType.MOUSE_LEAVE, clear));
		this._itemDisposables.add(addDisposableListener(button, EventType.BLUR, clear));
		this._pillsById.set(pill.id, button);
		return button;
	}

	/**
	 * A switch that shows or hides the bottom panel. In a task layout nothing lives in the
	 * panel, so its group has no pills, and this is how to open it.
	 */
	private _panelSwitch(): HTMLElement {
		const shown = this._layoutService.isVisible(Parts.PANEL_PART);
		const button = $('button.positron-layout-popover-switch', { role: 'switch' });
		button.dataset.id = 'panelSwitch';
		button.setAttribute('aria-checked', String(shown));
		button.setAttribute('aria-label', localize('positron.layoutPopover.panelSwitch', "Show Bottom Panel"));
		this._itemDisposables.add(addDisposableListener(button, EventType.CLICK, () => {
			this._layoutService.setPartHidden(shown, Parts.PANEL_PART);
			// The panel reopens maximized when it was maximized as it closed, which happens
			// when no editor is open. Open it at its normal height instead.
			if (!shown && this._layoutService.isPanelMaximized()) {
				this._layoutService.toggleMaximizedPanel();
			}
		}));
		return button;
	}

	//#endregion

	//#region Keyboard

	/** The cards, the search box, the pills, the switch, and the link, in order. */
	private _focusables(): HTMLElement[] {
		return [...this._cardElements, this._search, ...this._groupControls, this._customize];
	}

	private _onKeyDown(event: StandardKeyboardEvent): void {
		const focusables = this._focusables();
		const active = getActiveElement();
		const index = isHTMLElement(active) ? focusables.indexOf(active) : -1;
		const inSearch = isHTMLInputElement(active);

		let next: number | undefined;
		if (event.equals(KeyCode.DownArrow) || (!inSearch && event.equals(KeyCode.RightArrow))) {
			next = Math.min(index + 1, focusables.length - 1);
		} else if (event.equals(KeyCode.UpArrow) || (!inSearch && event.equals(KeyCode.LeftArrow))) {
			next = Math.max(index - 1, 0);
		} else if (!inSearch && event.equals(KeyCode.Home)) {
			next = 0;
		} else if (!inSearch && event.equals(KeyCode.End)) {
			next = focusables.length - 1;
		} else if (event.equals(KeyCode.Escape)) {
			this._host.close();
		} else {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		if (next !== undefined) {
			focusables[next]?.focus();
		}
	}

	//#endregion
}
