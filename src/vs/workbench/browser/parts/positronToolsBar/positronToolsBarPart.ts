/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/css/positronToolsBarPart';
import { localize } from 'vs/nls';
import * as DOM from 'vs/base/browser/dom';
import { Emitter } from 'vs/base/common/event';
import { Part } from 'vs/workbench/browser/part';
import { HoverPosition } from 'vs/base/browser/ui/hover/hoverWidget';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { IHoverService } from 'vs/workbench/services/hover/browser/hover';
import { ActionsOrientation } from 'vs/base/browser/ui/actionbar/actionbar';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { PositronToolsBarFocused } from 'vs/workbench/common/contextkeys';
import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IThemeService, registerThemingParticipant } from 'vs/platform/theme/common/themeService';
import { IWorkbenchLayoutService, Parts, Position } from 'vs/workbench/services/layout/browser/layoutService';
import { IHoverDelegate, IHoverDelegateOptions, IHoverWidget } from 'vs/base/browser/ui/iconLabel/iconHoverDelegate';
import { PositronToggleAction, PositronToggleActionBar } from 'vs/base/browser/ui/positronToggleActionBar/positronToggleActionBar';
import { PositronToolsBarBottomMode, PositronToolsBarTopMode, IPositronToolsBarService } from 'vs/workbench/services/positronToolsBar/browser/positronToolsBarService';
import {
	POSITRON_TOOLS_BAR_BACKGROUND,
	POSITRON_TOOLS_BAR_ACTION_ICON_BACKGROUND,
	POSITRON_TOOLS_BAR_ACTION_ICON_BACKGROUND_HOVER,
	POSITRON_TOOLS_BAR_ACTION_CONTAINER_TOGGLED_BACKGROUND,
	POSITRON_TOOLS_BAR_ACTION_ICON_BACKGROUND_TOGGLED
} from 'vs/workbench/common/theme';

/**
 * Theme support.
 */
registerThemingParticipant((theme, collector) => {
	// Get the tools bar background color.
	const backgroundColor = theme.getColor(POSITRON_TOOLS_BAR_BACKGROUND);
	if (backgroundColor) {
		collector.addRule(`.monaco-workbench .part.positron-tools-bar {
			background-color: ${backgroundColor};
		}`);
	}

	// Get the tools bar action container toggled background color.
	const actionContainerToggledBackgroundColor = theme.getColor(POSITRON_TOOLS_BAR_ACTION_CONTAINER_TOGGLED_BACKGROUND);
	if (actionContainerToggledBackgroundColor) {
		collector.addRule(`.monaco-workbench .part.positron-tools-bar .action-bar-container .tools-bar-action-container.toggled {
			background: ${actionContainerToggledBackgroundColor};
		}`);
	}

	// Get the tools bar action icon background color.
	const actionIconBackgroundColor = theme.getColor(POSITRON_TOOLS_BAR_ACTION_ICON_BACKGROUND);
	if (actionIconBackgroundColor) {
		collector.addRule(`.monaco-workbench .part.positron-tools-bar .action-bar-container .tools-bar-action-icon {
			background: ${actionIconBackgroundColor};
		}`);
	}

	// Get the tools bar action icon background toggled color.
	const actionIconBackgroundToggledColor = theme.getColor(POSITRON_TOOLS_BAR_ACTION_ICON_BACKGROUND_TOGGLED);
	if (actionIconBackgroundToggledColor) {
		collector.addRule(`.monaco-workbench .part.positron-tools-bar .action-bar-container .tools-bar-action-icon.toggled {
			background: ${actionIconBackgroundToggledColor};
		}`);
	}

	// Get the tools bar action icon background hover color.
	const actionIconBackgroundHoverColor = theme.getColor(POSITRON_TOOLS_BAR_ACTION_ICON_BACKGROUND_HOVER);
	if (actionIconBackgroundHoverColor) {
		collector.addRule(`.monaco-workbench .part.positron-tools-bar .action-bar-container .tools-bar-action-icon:hover:not(.toggled) {
			background: ${actionIconBackgroundHoverColor};
		}`);
	}
});

/**
 * ToolsBarHoverDelegate class.
 */
class ToolsBarHoverDelegate implements IHoverDelegate {

	readonly placement = 'element';
	private lastHoverHideTime: number = 0;

	/**
	 * Initializes a new instance of the ToolsBarHoverDelegate class.
	 * @param layoutService The layout service.
	 * @param configurationService The configuration service.
	 * @param hoverService The hover service.
	 */
	constructor(
		private readonly layoutService: IWorkbenchLayoutService,
		private readonly configurationService: IConfigurationService,
		private readonly hoverService: IHoverService
	) { }

	/**
	 * Shows the hover.
	 * @param options The options for the hover.
	 * @param focus A value which indicates whether to focus the hover.
	 * @returns The hover widget.
	 */
	showHover(options: IHoverDelegateOptions, focus?: boolean | undefined): IHoverWidget | undefined {
		// Determine the hover position.
		const hoverPosition = this.layoutService.getSideBarPosition() === Position.LEFT ? HoverPosition.LEFT : HoverPosition.RIGHT;

		// Show the hover.
		return this.hoverService.showHover({
			...options,
			hoverPosition
		});
	}

	/**
	 * Gets the hover delay in MS.
	 */
	get delay(): number {
		// Show instantly when a hover was recently shown.
		if (Date.now() - this.lastHoverHideTime < 200) {
			return 0;
		} else {
			return this.configurationService.getValue<number>('workbench.hover.delay');
		}
	}

	/**
	 * Raised when the hover is hidden.
	 */
	onDidHideHover() {
		// Record the last time the hover was hidden.
		this.lastHoverHideTime = Date.now();
	}
}

/**
 * PositronToolsBarPart class.
 */
export class PositronToolsBarPart extends Part implements IPositronToolsBarService {

	declare readonly _serviceBrand: undefined;

	//#region IView

	readonly width: number = 38;
	readonly minimumHeight: number = 0;
	readonly maximumHeight: number = Number.POSITIVE_INFINITY;

	get minimumWidth(): number {
		return this.width;
	}

	get maximumWidth(): number {
		return this.width;
	}

	private _onDidChangeSize = this._register(new Emitter<{ width: number; height: number } | undefined>());
	override get onDidChange() { return this._onDidChangeSize.event; }

	//#endregion IView

	//#region Content Area

	// The action bars container and the top and bottom action bar containers.
	private actionBarsContainer: HTMLElement | undefined;
	private topActionBarContainer: HTMLElement | undefined;
	private bottomActionBarContainer: HTMLElement | undefined;

	// The top toggle action bar.
	private topToggleActionBar: PositronToggleActionBar | undefined;
	private environmentToggleAction: PositronToggleAction | undefined;
	private previewToggleAction: PositronToggleAction | undefined;
	private helpToggleAction: PositronToggleAction | undefined;

	// The bottom toggle action bar.
	private bottomToggleActionBar: PositronToggleActionBar | undefined;
	private plotToggleAction: PositronToggleAction | undefined;
	private viewerToggleAction: PositronToggleAction | undefined;
	private presentationToggleAction: PositronToggleAction | undefined;

	// The hover delegate.
	private hoverDelegate: IHoverDelegate;

	//#endregion Content Area

	private _onDidChangeTopMode = this._register(new Emitter<PositronToolsBarTopMode>());
	readonly onDidChangeTopMode = this._onDidChangeTopMode.event;

	private _onDidChangeBottomMode = this._register(new Emitter<PositronToolsBarBottomMode>());
	readonly onDidChangeBottomMode = this._onDidChangeBottomMode.event;

	//#region Class Initialization

	constructor(
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@IStorageService storageService: IStorageService,
		@IConfigurationService configurationService: IConfigurationService,
		@IWorkbenchLayoutService workbenchLayoutService: IWorkbenchLayoutService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
	) {
		super(Parts.POSITRON_TOOLS_BAR_PART, { hasTitle: false }, themeService, storageService, workbenchLayoutService);
		this.hoverDelegate = new ToolsBarHoverDelegate(workbenchLayoutService, configurationService, hoverService);

	}

	//#endregion Class Initialization

	//#region Part

	// Provide the content area.
	override createContentArea(parent: HTMLElement): HTMLElement {
		// Set the element.
		this.element = parent;
		this.element.tabIndex = 0;

		// Create the action bars container and the top and bottom action bar containers.
		this.actionBarsContainer = DOM.append(this.element, DOM.$('.action-bars-container'));
		this.topActionBarContainer = DOM.append(this.actionBarsContainer, DOM.$('.action-bar-container'));
		this.bottomActionBarContainer = DOM.append(this.actionBarsContainer, DOM.$('.action-bar-container'));

		// Create the top toggle action bar.
		this.environmentToggleAction = this._register(new PositronToggleAction('toolsBarActionEnvironment', 'Environment', 'Environment', 'tools-bar-action-icon.environment', true, async () => {
			this.toggleEnvironment();
		}));
		this.previewToggleAction = this._register(new PositronToggleAction('toolsBarActionPreview', 'Preview', 'Preview', 'tools-bar-action-icon.preview', true, async () => {
			this.togglePreview();
		}));
		this.helpToggleAction = this._register(new PositronToggleAction('toolsBarActionHelp', 'Help', 'Help', 'tools-bar-action-icon.help', true, async () => {
			this.toggleHelp();
		}));
		this.topToggleActionBar = new PositronToggleActionBar(this.topActionBarContainer, {
			actionContainerClass: 'tools-bar-action-container',
			orientation: ActionsOrientation.VERTICAL,
			ariaLabel: localize('managew3rewerwer', "Manage w3rewerwer"),
			ariaRole: 'toolbar',
			hoverDelegate: this.hoverDelegate,
		}, [this.environmentToggleAction, this.previewToggleAction, this.helpToggleAction]);

		// Create the bottom toggle action bar.
		this.plotToggleAction = this._register(new PositronToggleAction('toolsBarActionPlot', 'Plot', 'Plot', 'tools-bar-action-icon.plot', true, async () => {
			this.togglePlot();
		}));
		this.viewerToggleAction = this._register(new PositronToggleAction('toolsBarActionViewer', 'Viewer', 'Viewer', 'tools-bar-action-icon.viewer', true, async () => {
			this.toggleViewer();
		}));
		this.presentationToggleAction = this._register(new PositronToggleAction('toolsBarActionPresentation', 'Presentation', 'Presentation', 'tools-bar-action-icon.presentation', true, async () => {
			this.togglePresentation();
		}));
		this.bottomToggleActionBar = new PositronToggleActionBar(this.bottomActionBarContainer, {
			actionContainerClass: 'tools-bar-action-container',
			orientation: ActionsOrientation.VERTICAL,
			ariaLabel: localize('managew3rewerwer', "Manage w3rewerwer"),
			ariaRole: 'toolbar',
			hoverDelegate: this.hoverDelegate,
		}, [this.plotToggleAction, this.viewerToggleAction, this.presentationToggleAction]);

		// Track focus.
		const scopedContextKeyService = this.contextKeyService.createScoped(this.element);
		PositronToolsBarFocused.bindTo(scopedContextKeyService).set(true);

		// Return this element.
		return this.element;
	}

	toJSON(): object {
		return {
			type: Parts.POSITRON_TOOLS_BAR_PART
		};
	}

	//#endregion Part

	//#region IPositronToolsBarService

	// Toggle methods.

	toggleEnvironment(): void {
		this.topToggleActionBar?.toggleToggleAction(this.environmentToggleAction);
	}

	togglePreview(): void {
		this.topToggleActionBar?.toggleToggleAction(this.previewToggleAction);
	}

	toggleHelp(): void {
		this.topToggleActionBar?.toggleToggleAction(this.helpToggleAction);
	}

	togglePlot(): void {
		this.bottomToggleActionBar?.toggleToggleAction(this.plotToggleAction);
	}

	toggleViewer(): void {
		this.bottomToggleActionBar?.toggleToggleAction(this.viewerToggleAction);
	}

	togglePresentation(): void {
		this.bottomToggleActionBar?.toggleToggleAction(this.presentationToggleAction);
	}

	// Show methods.

	showEnvironment(): void {
		if (this.topToggleActionBar) {
			this.topToggleActionBar.activeToggleAction = this.environmentToggleAction;
		}
	}

	showPreview(): void {
		if (this.topToggleActionBar) {
			this.topToggleActionBar.activeToggleAction = this.previewToggleAction;
		}
	}

	showHelp(): void {
		if (this.topToggleActionBar) {
			this.topToggleActionBar.activeToggleAction = this.helpToggleAction;
		}
	}

	showPlot(): void {
		if (this.bottomToggleActionBar) {
			this.bottomToggleActionBar.activeToggleAction = this.plotToggleAction;
		}
	}

	showViewer(): void {
		if (this.bottomToggleActionBar) {
			this.bottomToggleActionBar.activeToggleAction = this.viewerToggleAction;
		}
	}

	showPresentation(): void {
		if (this.bottomToggleActionBar) {
			this.bottomToggleActionBar.activeToggleAction = this.presentationToggleAction;
		}
	}

	// Other methods.

	focus(): void {
		this.element.focus();
	}

	//#endregion IPositronToolsBarService

	//#region Private Methods
	//#endregion Private Methods
}

// Register the IPositronToolsBarService singleton.
registerSingleton(IPositronToolsBarService, PositronToolsBarPart, InstantiationType.Eager);
