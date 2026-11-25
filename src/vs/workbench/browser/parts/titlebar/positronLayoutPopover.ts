/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, EventType, getActiveElement, isHTMLElement, reset } from '../../../../base/browser/dom.js';
import { StandardKeyboardEvent } from '../../../../base/browser/keyboardEvent.js';
import { HoverStyle } from '../../../../base/browser/ui/hover/hover.js';
import { HoverPosition } from '../../../../base/browser/ui/hover/hoverWidget.js';
import { RunOnceScheduler } from '../../../../base/common/async.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { Disposable, DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IViewDescriptor, IViewDescriptorService, ViewContainer, ViewContainerLocation } from '../../../common/views.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { IPaneCompositePartService } from '../../../services/panecomposite/browser/panecomposite.js';
import { IPositronLayoutService } from '../../../services/positronLayout/browser/interfaces/positronLayoutService.js';
import { getMatchableLayouts } from '../../../services/positronLayout/browser/layouts/layoutMatch.js';
import { getTaskLayout, getTaskLayouts, TaskLayout } from '../../../services/positronLayout/browser/layouts/taskLayouts.js';
import { CustomPositronLayoutDescription } from '../../../services/positronLayout/common/positronCustomViews.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { ViewPane } from '../views/viewPane.js';
import { ViewPaneContainer } from '../views/viewPaneContainer.js';

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
	/** The view container the pill is, or holds its view. */
	readonly container: ViewContainer;
	/** For a view in the Session container, the view. It moves on its own. */
	readonly sessionView?: IViewDescriptor;
	/** Whether the pill can be dragged to move its view. */
	readonly movable: boolean;
}

/** A group of pills as last drawn, which a dragged pill can be dropped into. */
interface DropGroup {
	readonly part: ViewPart;
	readonly location: ViewContainerLocation;
	readonly section: HTMLElement;
	/** Where the pills are, or undefined when the group has none. */
	readonly list: HTMLElement | undefined;
	readonly pills: readonly ViewPill[];
	readonly elements: readonly HTMLElement[];
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
	/** For a whole part of the picture, which part it is. */
	readonly part?: ViewPart;
}

/** Which part of the window is shown, and which tab it has open, before an action. */
interface PartState {
	readonly part: ViewPart;
	readonly location: ViewContainerLocation;
	readonly visible: boolean;
	readonly activeId: string | undefined;
}

/** The last change the user made from the popover, and how to take it back. */
interface LastAction {
	readonly message: string;
	readonly undo: () => void;
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
	private readonly _groups: HTMLElement;
	private readonly _status: HTMLElement;
	private readonly _customize: HTMLElement;

	/** The Undo button for the last change, when there is one. */
	private _undoButton: HTMLElement | undefined;

	/** The Undo button's listener, replaced with each change. */
	private readonly _statusDisposables = this._register(new DisposableStore());

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

	/** The pointed-at layout, kept so its marks survive the popover being drawn again. */
	private _previewedLayoutId: string | undefined;

	/** The pointed-at pill, kept so its light survives the popover being drawn again. */
	private _highlightedPill: { id: string; part: ViewPart } | undefined;

	/** The groups of pills as last drawn, by part. */
	private readonly _dropGroups = new Map<ViewPart, DropGroup>();

	/** The pill being dragged, and the part it is grouped under. */
	private _drag: { pill: ViewPill; part: ViewPart } | undefined;

	/** Marks where a dragged pill will land. */
	private readonly _dropMarker = $('.positron-layout-popover-drop-marker', { 'aria-hidden': 'true' });

	/** The listeners of the cards and pills, cleared each time they are drawn again. */
	private readonly _itemDisposables = this._register(new DisposableStore());

	/** Draws the popover again once, after a burst of changes to the window. */
	private readonly _refresh = this._register(new RunOnceScheduler(() => this._draw(), 0));

	constructor(
		container: HTMLElement,
		private readonly _host: ILayoutPopoverHost,
		@ICommandService private readonly _commandService: ICommandService,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@IHoverService private readonly _hoverService: IHoverService,
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
		append(viewsHeader, $('span.positron-layout-popover-note', undefined, localize('positron.layoutPopover.viewsHint', "Click a view to show or hide it. Drag it to move it.")));
		this._groups = append(this._element, $('.positron-layout-popover-groups'));
		// Says what the last click or drag did, with a way to take it back.
		this._status = append(this._element, $('.positron-layout-popover-status.empty', { role: 'status', 'aria-live': 'polite' }));

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

	/**
	 * Everything the popover shows, as a string, so it is drawn again only when something
	 * changed. Drawing replaces the card or pill under the pointer, which would flicker.
	 */
	private _stateKey(): string {
		return JSON.stringify([
			this._positronLayoutService.currentLayoutId,
			this._positronLayoutService.lastAppliedLayoutId,
			VIEW_GROUPS.map(group => [
				this._layoutService.isVisible(group.part),
				this._paneCompositeService.getActivePaneComposite(group.location)?.getId(),
			]),
			getTaskLayouts().filter(layout => this._contextKeyService.contextMatchesRules(layout.precondition)).map(layout => layout.id),
			VIEW_GROUPS.map(group => this._pills(group.location).map(pill => [pill.id, pill.shown, pill.name])),
		]);
	}

	/** The state the popover was last drawn for. */
	private _drawnStateKey: string | undefined;

	private _draw(): void {
		const stateKey = this._stateKey();
		if (stateKey === this._drawnStateKey) {
			return;
		}
		this._drawnStateKey = stateKey;

		const active = getActiveElement();
		const focusedId = isHTMLElement(active) && this._element.contains(active) ? active.dataset.id : undefined;
		this._itemDisposables.clear();

		this._drawCards();
		this._drawGroups();
		this._previewLayout(this._previewedLayoutId);
		this._highlightView(this._highlightedPill?.id, this._highlightedPill?.part);

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
		// The selected layout's picture shows the window as it is, so changes the user made
		// by hand show up in it. The others show what picking them would give.
		if (current || modified) {
			card.appendChild(this._picture(layout.id, (part, location) => this._windowPart(part, location)));
		} else if (descriptor) {
			card.appendChild(this._picture(layout.id, (part, location) => this._picturePart(descriptor, part, location)));
		} else {
			card.appendChild($('.positron-layout-popover-picture'));
		}
		const label = append(card, $('span.positron-layout-popover-card-label', undefined, layout.name));
		if (modified) {
			append(label, $('span.codicon.codicon-discard', { 'aria-hidden': 'true' }));
		}

		this._itemDisposables.add(addDisposableListener(card, EventType.CLICK, () => {
			this._host.close();
			this._commandService.executeCommand(layout.id);
		}));
		// Pointing at another layout's card marks the pills of the views it would show.
		// The selected layout's views are already the ones colored, so it marks nothing.
		const preview = () => this._previewLayout(current || modified ? undefined : layout.id);
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
	 * What the window shows in one part right now, for the selected layout's picture: the
	 * open tab, with the other tabs behind it, and the Session container's views one by one.
	 * @param part The part.
	 * @param location Where the part's view containers live.
	 * @returns The part's blocks, or undefined when the part is hidden.
	 */
	private _windowPart(part: ViewPart, location: ViewContainerLocation): PicturePart | undefined {
		if (!this._layoutService.isVisible(part)) {
			return undefined;
		}
		const activeId = this._paneCompositeService.getActivePaneComposite(location)?.getId();
		const tabIds = this._paneCompositeService.getVisiblePaneCompositeIds(location).filter(id => id !== activeId);
		const active = activeId ? this._viewDescriptorService.getViewContainerById(activeId) : null;
		if (active?.id === SESSION_VIEW_CONTAINER_ID) {
			const model = this._viewDescriptorService.getViewContainerModel(active);
			return {
				tabIds,
				blocks: model.activeViewDescriptors.map(view => ({
					ids: [view.id],
					shows: this._viewsService.isViewVisible(view.id),
					weight: model.isCollapsed(view.id) ? 0.3 : 1,
				})),
			};
		}
		return { tabIds, blocks: [{ ids: activeId ? [activeId] : [], shows: !!activeId, weight: 1 }] };
	}

	/**
	 * A small picture of a layout. Each side bar and the bottom panel is drawn as blocks,
	 * one for each view the layout places there, and the views the layout shows are
	 * colored. Pointing at a pill lights up where its view lives in the current layout's
	 * picture.
	 * @param layoutId The layout's command id.
	 * @param partOf What the picture shows in each part.
	 */
	private _picture(layoutId: string, partOf: (part: ViewPart, location: ViewContainerLocation) => PicturePart | undefined): HTMLElement {
		const targets: PictureTarget[] = [];
		const shown = new Set<string>();

		const drawPart = (parent: HTMLElement, className: string, viewPart: ViewPart, part: PicturePart) => {
			const region = append(parent, $(`.picture-region.${className}`));
			targets.push({ element: region, ids: part.tabIds, part: viewPart });
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
		const side = partOf(Parts.SIDEBAR_PART, ViewContainerLocation.Sidebar);
		if (side) {
			drawPart(picture, 'picture-side', Parts.SIDEBAR_PART, side);
		}
		const center = append(picture, $('.picture-center'));
		append(center, $('.picture-editor'));
		const panel = partOf(Parts.PANEL_PART, ViewContainerLocation.Panel);
		if (panel) {
			drawPart(center, 'picture-panel', Parts.PANEL_PART, panel);
		}
		const aux = partOf(Parts.AUXILIARYBAR_PART, ViewContainerLocation.AuxiliaryBar);
		if (aux) {
			drawPart(picture, 'picture-aux', Parts.AUXILIARYBAR_PART, aux);
		}

		this._pictureTargets.set(layoutId, targets);
		this._shownByLayout.set(layoutId, shown);
		return picture;
	}

	/**
	 * Lights up where a view lives in the current layout's picture: its own block when the
	 * layout places it. A view tabbed behind another, or one with no block, outlines the
	 * part of the window it is in instead, so the views drawn there do not look lit too.
	 * Nothing lights up when the picture does not have that part.
	 * @param id The id of the pointed-at pill's view or container, or undefined to clear.
	 * @param part The part of the window the pill is grouped under.
	 */
	private _highlightView(id: string | undefined, part?: ViewPart): void {
		this._highlightedPill = id && part ? { id, part } : undefined;
		for (const targets of this._pictureTargets.values()) {
			for (const target of targets) {
				target.element.classList.remove('highlight', 'highlight-outline');
			}
		}
		const targets = this._activeLayoutId ? this._pictureTargets.get(this._activeLayoutId) : undefined;
		if (!id || !targets) {
			return;
		}
		// A view's own block wins over the part it is tabbed behind.
		const own = targets.filter(target => !target.part && target.ids.includes(id));
		const tabbed = targets.filter(target => target.part && target.ids.includes(id));
		const group = targets.filter(target => target.part === part);
		const matches = own.length ? own : tabbed.length ? tabbed : group;
		for (const target of matches) {
			target.element.classList.add(own.length ? 'highlight' : 'highlight-outline');
		}
	}

	/**
	 * Lights up a whole part of the current layout's picture, while a pill is dragged over
	 * its group.
	 * @param part The part, or undefined to clear.
	 */
	private _highlightPart(part: ViewPart | undefined): void {
		const targets = this._activeLayoutId ? this._pictureTargets.get(this._activeLayoutId) : undefined;
		for (const target of targets ?? []) {
			target.element.classList.toggle('highlight', !!part && target.part === part);
		}
	}

	/**
	 * Marks the pills of the views a layout shows.
	 * @param layoutId The pointed-at layout, or undefined to clear.
	 */
	private _previewLayout(layoutId: string | undefined): void {
		this._previewedLayoutId = layoutId;
		const shown = layoutId ? this._shownByLayout.get(layoutId) : undefined;
		for (const [id, pill] of this._pillsById) {
			pill.classList.toggle('preview', !!shown?.has(id));
		}
	}

	private _drawGroups(): void {
		const groups: HTMLElement[] = [];
		this._groupControls = [];
		this._pillsById = new Map();
		this._dropGroups.clear();

		for (const group of VIEW_GROUPS) {
			const pills = this._pills(group.location);

			const section = $('.positron-layout-popover-group', { role: 'group' });
			const name = group.name();
			section.setAttribute('aria-label', name);
			const header = append(section, $('.positron-layout-popover-group-header'));
			append(header, $(`span.codicon.codicon-${group.icon}`, { 'aria-hidden': 'true' }));
			append(header, $('span.positron-layout-popover-group-name', undefined, name));
			if (group.part === Parts.PANEL_PART) {
				const panelSwitch = this._panelSwitch();
				header.appendChild(panelSwitch);
				this._groupControls.push(panelSwitch);
			}

			let list: HTMLElement | undefined;
			const elements: HTMLElement[] = [];
			if (pills.length) {
				list = append(section, $('.positron-layout-popover-pills'));
				for (const pill of pills) {
					const button = this._pill(pill, group.part);
					list.appendChild(button);
					elements.push(button);
					this._groupControls.push(button);
				}
			} else {
				append(section, $('.positron-layout-popover-empty', undefined, localize(
					'positron.layoutPopover.empty', "No views here in this layout.")));
			}
			const dropGroup: DropGroup = { part: group.part, location: group.location, section, list, pills, elements };
			this._dropGroups.set(group.part, dropGroup);
			this._listenForDrops(dropGroup);
			groups.push(section);
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
						container,
						sessionView: view,
						movable: view.canMoveView !== false && this._viewDescriptorService.canMoveViews(),
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
				container,
				movable: this._viewDescriptorService.canMoveViews(),
			});
		}
		return pills;
	}

	/**
	 * A pill that shows or hides a view.
	 * @param pill The view.
	 * @param part The part of the window the pill is grouped under.
	 */
	private _pill(pill: ViewPill, part: ViewPart): HTMLElement {
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

		// Say what a click does, and that the pill can be dragged.
		const action = pill.shown
			? localize('positron.layoutPopover.pillHide', "Hide {0}", pill.name)
			: localize('positron.layoutPopover.pillShow', "Show {0}", pill.name);
		this._itemDisposables.add(this._hoverService.setupDelayedHover(button, () => {
			const content = $('.positron-layout-popover-hover');
			append(content, $('span.positron-layout-popover-hover-action', undefined, action));
			if (pill.movable) {
				append(content, $('span.positron-layout-popover-hover-hint', undefined, localize(
					'positron.layoutPopover.pillDragHint', "Drag to move it")));
			}
			return {
				content,
				style: HoverStyle.Pointer,
				position: { hoverPosition: HoverPosition.ABOVE },
				appearance: { compact: true },
				persistence: { hideOnKeyDown: true },
			};
		}, { groupId: 'positron-layout-popover-pills' }));

		// The popover stays open, so the user sees the view come and go.
		this._itemDisposables.add(addDisposableListener(button, EventType.CLICK, () => {
			const message = pill.shown
				? localize('positron.layoutPopover.hid', "Hid {0}.", pill.name)
				: localize('positron.layoutPopover.showed', "Showed {0}.", pill.name);
			// Closing or opening a Session view also collapses or expands its pane.
			const reverse = pill.sessionView
				? () => pill.shown ? this._viewsService.openView(pill.id, false) : this._viewsService.closeView(pill.id)
				: () => { };
			this._record(message, () => pill.toggle(), reverse);
		}));
		// Pointing at a pill lights up where its view lives in the current layout.
		const highlight = () => this._highlightView(pill.id, part);
		const clear = () => this._highlightView(undefined);
		this._itemDisposables.add(addDisposableListener(button, EventType.MOUSE_ENTER, highlight));
		this._itemDisposables.add(addDisposableListener(button, EventType.FOCUS, highlight));
		this._itemDisposables.add(addDisposableListener(button, EventType.MOUSE_LEAVE, clear));
		this._itemDisposables.add(addDisposableListener(button, EventType.BLUR, clear));
		this._pillsById.set(pill.id, button);

		// Dragging a pill into another group, or to another spot, moves its view.
		if (pill.movable) {
			button.draggable = true;
			this._itemDisposables.add(addDisposableListener(button, EventType.DRAG_START, (e: DragEvent) => {
				this._drag = { pill, part };
				e.dataTransfer?.setData('text/plain', pill.name);
				if (e.dataTransfer) {
					e.dataTransfer.effectAllowed = 'move';
				}
				button.classList.add('dragging');
			}));
			this._itemDisposables.add(addDisposableListener(button, EventType.DRAG_END, () => {
				button.classList.remove('dragging');
				this._endDrag();
			}));
		}
		return button;
	}

	//#endregion

	//#region Dragging

	/**
	 * Lets a group take dropped pills. While a pill is over it, the group and its part of the
	 * current layout's picture light up, and a marker shows where the pill will land.
	 * @param group The group.
	 */
	private _listenForDrops(group: DropGroup): void {
		const over = (e: DragEvent) => {
			if (!this._drag) {
				return;
			}
			e.preventDefault();
			if (e.dataTransfer) {
				e.dataTransfer.dropEffect = 'move';
			}
			for (const other of this._dropGroups.values()) {
				other.section.classList.toggle('drop-target', other === group);
			}
			this._highlightPart(group.part);
			const index = this._dropIndex(group, e);
			const before = group.elements[index];
			if (before) {
				before.before(this._dropMarker);
			} else {
				(group.list ?? group.section).appendChild(this._dropMarker);
			}
		};
		this._itemDisposables.add(addDisposableListener(group.section, EventType.DRAG_OVER, over));
		this._itemDisposables.add(addDisposableListener(group.section, EventType.DROP, (e: DragEvent) => {
			if (!this._drag) {
				return;
			}
			e.preventDefault();
			const index = this._dropIndex(group, e);
			const drag = this._drag;
			this._endDrag();
			this._move(drag.pill, drag.part, group, index);
		}));
	}

	/**
	 * Where in a group a dragged pill would land: before the first pill the pointer is
	 * above, or left of the middle of on the same row, or else at the end.
	 * @param group The group under the pointer.
	 * @param e The drag event.
	 */
	private _dropIndex(group: DropGroup, e: DragEvent): number {
		const index = group.elements.findIndex(element => {
			const box = element.getBoundingClientRect();
			return e.clientY < box.top || (e.clientY <= box.bottom && e.clientX < box.left + box.width / 2);
		});
		return index === -1 ? group.elements.length : index;
	}

	private _endDrag(): void {
		this._drag = undefined;
		this._dropMarker.remove();
		for (const group of this._dropGroups.values()) {
			group.section.classList.remove('drop-target');
		}
		this._highlightPart(undefined);
	}

	/**
	 * Moves a pill's view to where it was dropped.
	 *
	 * - A view from the Session container dropped among the other Session pills moves to
	 *   that spot in Session. Dropped anywhere else, it becomes its own tab in that part,
	 *   at the end.
	 * - A view container moves to the part it was dropped in, at that spot. Dropped in its
	 *   own group, it moves to that spot among the part's tabs or activity bar items.
	 * @param pill The dragged pill.
	 * @param from The part the pill was grouped under.
	 * @param target The group it was dropped in.
	 * @param index Where in the group it was dropped.
	 */
	private _move(pill: ViewPill, from: ViewPart, target: DropGroup, index: number): void {
		const message = target.part === from
			? localize('positron.layoutPopover.reordered', "Moved {0}.", pill.name)
			: localize('positron.layoutPopover.moved', "Moved {0} to {1}.", pill.name,
				VIEW_GROUPS.find(group => group.part === target.part)!.name());
		this._record(message, () => this._moveAndShow(pill, from, target, index), this._undoMove(pill));
	}

	private _moveAndShow(pill: ViewPill, from: ViewPart, target: DropGroup, index: number): void {
		const targetHidden = !this._layoutService.isVisible(target.part);
		this._moveView(pill, from, target, index);
		// A view dropped into a hidden part would vanish, so open the part on that view.
		if (target.part !== from && targetHidden) {
			if (pill.sessionView) {
				this._viewsService.openView(pill.id, false);
			} else {
				this._paneCompositeService.openPaneComposite(pill.container.id, target.location, false);
			}
			this._unmaximizePanel();
		}
		// Reordering raises no event the popover listens to, so draw it again either way.
		this._refresh.schedule();
	}

	private _moveView(pill: ViewPill, from: ViewPart, target: DropGroup, index: number): void {
		const reason = 'positronLayoutPopover';
		if (pill.sessionView) {
			const sessionIndexes = target.pills.flatMap((candidate, i) => candidate.sessionView ? [i] : []);
			const first = sessionIndexes[0];
			const last = sessionIndexes[sessionIndexes.length - 1];
			if (target.part === from && first !== undefined && index >= first && index <= last + 1) {
				// Moving down, the view lands after the pill it is moved to, so aim one earlier.
				const fromIndex = target.pills.indexOf(pill);
				const to = target.pills[fromIndex < index ? index - 1 : index];
				if (to && to !== pill && to.sessionView) {
					this._moveSessionView(pill, to);
				}
				return;
			}
			this._viewDescriptorService.moveViewToLocation(pill.sessionView, target.location, reason);
			return;
		}

		if (target.part === from) {
			// Put it before the container of the pill it was dropped before, or after the
			// last other container when dropped at the end.
			const after = target.pills.slice(index).find(candidate => candidate.container !== pill.container);
			const before = [...target.pills.slice(0, index)].reverse().find(candidate => candidate.container !== pill.container);
			const neighbor = after ?? before;
			if (neighbor) {
				this._paneCompositeService.movePaneComposite?.(pill.container.id, neighbor.container.id, neighbor === after, target.location);
			}
			return;
		}
		// The position counts containers, and the Session views share one.
		const containersBefore = new Set(target.pills.slice(0, index).map(candidate => candidate.container.id));
		this._viewDescriptorService.moveViewContainerToLocation(pill.container, target.location, containersBefore.size, reason);
	}

	/**
	 * Moves a Session view to another view's spot in Session. When Session is open, its
	 * panes move on screen too, as dragging a pane's header would.
	 * @param pill The view to move.
	 * @param to The view whose spot it takes.
	 */
	private _moveSessionView(pill: ViewPill, to: ViewPill): void {
		this._moveViewInContainer(pill.container, pill.id, to.id);
	}

	private _moveViewInContainer(viewContainer: ViewContainer, id: string, toId: string): void {
		const container = this._viewsService.getActiveViewPaneContainerWithId(viewContainer.id);
		const fromPane = container?.getView(id);
		const toPane = container?.getView(toId);
		if (container instanceof ViewPaneContainer && fromPane instanceof ViewPane && toPane instanceof ViewPane) {
			container.movePane(fromPane, toPane);
		} else {
			this._viewDescriptorService.getViewContainerModel(viewContainer).move(id, toId);
		}
	}

	/**
	 * Notes where a pill's view is now, before it moves.
	 * @param pill The pill about to move.
	 * @returns What puts the view back there.
	 */
	private _undoMove(pill: ViewPill): () => void {
		const reason = 'positronLayoutPopover';
		if (pill.sessionView) {
			const view = pill.sessionView;
			const session = pill.container;
			const order = this._viewDescriptorService.getViewContainerModel(session).activeViewDescriptors.map(descriptor => descriptor.id);
			return () => {
				if (this._viewDescriptorService.getViewContainerByViewId(view.id)?.id !== session.id) {
					this._viewDescriptorService.moveViewsToContainer([view], session, undefined, reason);
				}
				this._restoreOrder(order,
					() => this._viewDescriptorService.getViewContainerModel(session).activeViewDescriptors.map(descriptor => descriptor.id),
					(id, toId) => this._moveViewInContainer(session, id, toId));
				// Moving it back expands it, so collapse it again if it was.
				if (!pill.shown && this._viewsService.isViewVisible(view.id)) {
					this._viewsService.closeView(view.id);
				}
			};
		}
		const container = pill.container;
		const location = this._viewDescriptorService.getViewContainerLocation(container);
		if (location === null) {
			return () => { };
		}
		const order = this._paneCompositeService.getVisiblePaneCompositeIds(location);
		return () => {
			if (this._viewDescriptorService.getViewContainerLocation(container) !== location) {
				this._viewDescriptorService.moveViewContainerToLocation(container, location, order.indexOf(container.id), reason);
			}
			this._restoreOrder(order,
				() => this._paneCompositeService.getVisiblePaneCompositeIds(location),
				(id, toId) => this._paneCompositeService.movePaneComposite?.(id, toId, true, location));
		};
	}

	/**
	 * Puts a list of views or containers back in an earlier order, one move at a time.
	 * Items that came or went since are left where they are.
	 * @param order The earlier order.
	 * @param current Reads the order now.
	 * @param moveBefore Moves an item in front of another.
	 */
	private _restoreOrder(order: readonly string[], current: () => string[], moveBefore: (id: string, toId: string) => void): void {
		const now = new Set(current());
		const wanted = order.filter(id => now.has(id));
		wanted.forEach((id, index) => {
			const at = current().filter(candidate => wanted.includes(candidate))[index];
			if (at && at !== id) {
				moveBefore(id, at);
			}
		});
	}

	/**
	 * Moves the focused pill to the group above or below, for keyboard users.
	 * @param pillElement The focused pill.
	 * @param direction -1 for the group above, 1 for the group below.
	 * @returns Whether the pill could move.
	 */
	private _moveToNeighborGroup(pillElement: HTMLElement, direction: -1 | 1): boolean {
		for (const group of this._dropGroups.values()) {
			const index = group.elements.indexOf(pillElement);
			const pill = group.pills[index];
			if (index === -1 || !pill?.movable) {
				continue;
			}
			const groupIndex = VIEW_GROUPS.findIndex(candidate => candidate.part === group.part);
			const neighbor = VIEW_GROUPS[groupIndex + direction];
			const target = neighbor ? this._dropGroups.get(neighbor.part) : undefined;
			if (!target) {
				return false;
			}
			this._move(pill, group.part, target, target.pills.length);
			return true;
		}
		return false;
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
			const message = shown
				? localize('positron.layoutPopover.hidPanel', "Hid the bottom panel.")
				: localize('positron.layoutPopover.showedPanel', "Showed the bottom panel.");
			this._record(message, () => {
				this._layoutService.setPartHidden(shown, Parts.PANEL_PART);
				if (!shown) {
					this._unmaximizePanel();
				}
			}, () => { });
		}));
		return button;
	}

	/**
	 * The panel reopens maximized when it was maximized as it closed, which happens when no
	 * editor is open. Puts it back at its normal height.
	 */
	private _unmaximizePanel(): void {
		if (this._layoutService.isVisible(Parts.PANEL_PART) && this._layoutService.isPanelMaximized()) {
			this._layoutService.toggleMaximizedPanel();
		}
	}

	//#endregion

	//#region Undo

	/**
	 * Makes a change to the window and says what it did, with an Undo button.
	 * @param message What the change did, as a sentence.
	 * @param run Makes the change.
	 * @param reverse Takes back what the change did beyond showing, hiding, or switching
	 * the tabs of parts, which Undo puts back on its own.
	 */
	private _record(message: string, run: () => void, reverse: () => void): void {
		const parts = this._partStates();
		run();
		this._showLastAction({
			message,
			undo: () => {
				reverse();
				this._restoreParts(parts);
			},
		});
	}

	/** Which parts are shown, and which tab each has open. */
	private _partStates(): PartState[] {
		return VIEW_GROUPS.map(group => ({
			part: group.part,
			location: group.location,
			visible: this._layoutService.isVisible(group.part),
			activeId: this._paneCompositeService.getActivePaneComposite(group.location)?.getId(),
		}));
	}

	/**
	 * Shows and hides parts, and opens their tabs, as they were.
	 * @param states The parts as they were.
	 */
	private _restoreParts(states: readonly PartState[]): void {
		for (const state of states) {
			if (!state.visible) {
				if (this._layoutService.isVisible(state.part)) {
					this._layoutService.setPartHidden(true, state.part);
				}
				continue;
			}
			const container = state.activeId ? this._viewDescriptorService.getViewContainerById(state.activeId) : null;
			const stillThere = container && this._viewDescriptorService.getViewContainerLocation(container) === state.location;
			if (stillThere && this._paneCompositeService.getActivePaneComposite(state.location)?.getId() !== state.activeId) {
				this._paneCompositeService.openPaneComposite(state.activeId, state.location, false);
			} else if (!this._layoutService.isVisible(state.part)) {
				this._layoutService.setPartHidden(false, state.part);
			}
		}
		this._unmaximizePanel();
	}

	/**
	 * Says what the last change did, or clears the line when there is none.
	 * @param action The change, or undefined to clear.
	 */
	private _showLastAction(action: LastAction | undefined): void {
		const hadFocus = this._undoButton !== undefined && getActiveElement() === this._undoButton;
		this._undoButton = undefined;
		this._statusDisposables.clear();
		if (!action) {
			reset(this._status);
		} else {
			const undo = $('button.positron-layout-popover-link.positron-layout-popover-undo', undefined, localize('positron.layoutPopover.undo', "Undo"));
			this._undoButton = undo;
			undo.dataset.id = 'undo';
			this._statusDisposables.add(addDisposableListener(undo, EventType.CLICK, () => {
				this._showLastAction(undefined);
				action.undo();
				this._refresh.schedule();
			}));
			reset(this._status, $('span.positron-layout-popover-status-message', undefined, action.message), undo);
		}
		this._status.classList.toggle('empty', !action);
		if (hadFocus) {
			this._customize.focus();
		}
		this._host.layout();
	}

	//#endregion

	//#region Keyboard

	/** The cards, the pills, the switch, Undo, and the link, in order. */
	private _focusables(): HTMLElement[] {
		return [...this._cardElements, ...this._groupControls, ...(this._undoButton ? [this._undoButton] : []), this._customize];
	}

	private _onKeyDown(event: StandardKeyboardEvent): void {
		const focusables = this._focusables();
		const active = getActiveElement();
		const index = isHTMLElement(active) ? focusables.indexOf(active) : -1;

		// Alt+Up and Alt+Down move the focused pill to the group above or below.
		if (isHTMLElement(active) && (event.equals(KeyMod.Alt | KeyCode.UpArrow) || event.equals(KeyMod.Alt | KeyCode.DownArrow))) {
			if (this._moveToNeighborGroup(active, event.equals(KeyMod.Alt | KeyCode.UpArrow) ? -1 : 1)) {
				event.preventDefault();
				event.stopPropagation();
			}
			return;
		}

		let next: number | undefined;
		if (event.equals(KeyCode.DownArrow) || event.equals(KeyCode.RightArrow)) {
			next = Math.min(index + 1, focusables.length - 1);
		} else if (event.equals(KeyCode.UpArrow) || event.equals(KeyCode.LeftArrow)) {
			next = Math.max(index - 1, 0);
		} else if (event.equals(KeyCode.Home)) {
			next = 0;
		} else if (event.equals(KeyCode.End)) {
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
