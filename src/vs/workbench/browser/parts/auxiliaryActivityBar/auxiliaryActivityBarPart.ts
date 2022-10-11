/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/auxiliaryActivityBarPart';
import * as DOM from 'vs/base/browser/dom';
import { localize } from 'vs/nls';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { IThemeService, registerThemingParticipant } from 'vs/platform/theme/common/themeService';
import { Part } from 'vs/workbench/browser/part';
import { IWorkbenchLayoutService, Parts, Position } from 'vs/workbench/services/layout/browser/layoutService';
import { Emitter } from 'vs/base/common/event';
import { IAuxiliaryActivityBarService } from 'vs/workbench/services/auxiliaryActivityBar/browser/auxiliaryActivityBarService';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { AuxiliaryActivityBarFocused } from 'vs/workbench/common/contextkeys';
import { ToggleAction, ToggleActionBar } from 'vs/base/browser/ui/toggleActionBar/toggleActionBar';
import { ActionsOrientation } from 'vs/base/browser/ui/actionbar/actionbar';
import { IHoverService } from 'vs/workbench/services/hover/browser/hover';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IHoverDelegate, IHoverDelegateOptions, IHoverWidget } from 'vs/base/browser/ui/iconLabel/iconHoverDelegate';
import { HoverPosition } from 'vs/base/browser/ui/hover/hoverWidget';
import {
	AUXILIARY_ACTIVITY_BAR_BACKGROUND,
	AUXILIARY_ACTIVITY_BAR_ACTION_ICON_BACKGROUND,
	AUXILIARY_ACTIVITY_BAR_ACTION_ICON_BACKGROUND_HOVER,
	AUXILIARY_ACTIVITY_BAR_ACTION_CONTAINER_TOGGLED_BACKGROUND,
	AUXILIARY_ACTIVITY_BAR_ACTION_ICON_BACKGROUND_TOGGLED
} from 'vs/workbench/common/theme';

// Theme support
registerThemingParticipant((theme, collector) => {
	// Get the auxiliary activity bar background color.
	const backgroundColor = theme.getColor(AUXILIARY_ACTIVITY_BAR_BACKGROUND);
	if (backgroundColor) {
		collector.addRule(`.monaco-workbench .part.auxiliary-activity-bar {
			background-color: ${backgroundColor};
		}`);
	}

	// Get the auxiliary activity bar action container toggled background color.
	const actionContainerToggledBackgroundColor = theme.getColor(AUXILIARY_ACTIVITY_BAR_ACTION_CONTAINER_TOGGLED_BACKGROUND);
	if (actionContainerToggledBackgroundColor) {
		collector.addRule(`.monaco-workbench .part.auxiliary-activity-bar .action-bar-container .auxiliary-activity-bar-action-container.toggled {
			background: ${actionContainerToggledBackgroundColor};
		}`);
	}

	// Get the auxiliary activity bar action icon background color.
	const actionIconBackgroundColor = theme.getColor(AUXILIARY_ACTIVITY_BAR_ACTION_ICON_BACKGROUND);
	if (actionIconBackgroundColor) {
		collector.addRule(`.monaco-workbench .part.auxiliary-activity-bar .action-bar-container .auxiliary-activity-bar-action-icon {
			background: ${actionIconBackgroundColor};
		}`);
	}

	// Get the auxiliary activity bar action icon background toggled color.
	const actionIconBackgroundToggledColor = theme.getColor(AUXILIARY_ACTIVITY_BAR_ACTION_ICON_BACKGROUND_TOGGLED);
	if (actionIconBackgroundToggledColor) {
		collector.addRule(`.monaco-workbench .part.auxiliary-activity-bar .action-bar-container .auxiliary-activity-bar-action-icon.toggled {
			background: ${actionIconBackgroundToggledColor};
		}`);
	}

	// Get the auxiliary activity bar action icon background hover color.
	const actionIconBackgroundHoverColor = theme.getColor(AUXILIARY_ACTIVITY_BAR_ACTION_ICON_BACKGROUND_HOVER);
	if (actionIconBackgroundHoverColor) {
		collector.addRule(`.monaco-workbench .part.auxiliary-activity-bar .action-bar-container .auxiliary-activity-bar-action-icon:hover:not(.toggled) {
			background: ${actionIconBackgroundHoverColor};
		}`);
	}
});

/**
 * AuxiliaryActivityBarHoverDelegate class.
 */
class AuxiliaryActivityBarHoverDelegate implements IHoverDelegate {

	readonly placement = 'element';
	private lastHoverHideTime: number = 0;

	constructor(
		private readonly layoutService: IWorkbenchLayoutService,
		private readonly configurationService: IConfigurationService,
		private readonly hoverService: IHoverService
	) { }

	showHover(options: IHoverDelegateOptions, focus?: boolean | undefined): IHoverWidget | undefined {
		// Determine the hover position.
		const hoverPosition = this.layoutService.getSideBarPosition() === Position.LEFT ? HoverPosition.LEFT : HoverPosition.RIGHT;

		// Show the hover.
		return this.hoverService.showHover({
			...options,
			hoverPosition
		});
	}

	get delay(): number {
		// Show instantly when a hover was recently shown.
		if (Date.now() - this.lastHoverHideTime < 200) {
			return 0;
		} else {
			return this.configurationService.getValue<number>('workbench.hover.delay');
		}
	}

	onDidHideHover() {
		// Record the last time the hover was hidden.
		this.lastHoverHideTime = Date.now();
	}
}

/**
 * AuxiliaryActivityBarPart class.
 */
export class AuxiliaryActivityBarPart extends Part implements IAuxiliaryActivityBarService {

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
	private topToggleActionBar: ToggleActionBar | undefined;
	private environmentToggleAction: ToggleAction | undefined;
	private previewToggleAction: ToggleAction | undefined;
	private helpToggleAction: ToggleAction | undefined;

	// The bottom toggle action bar.
	private bottomToggleActionBar: ToggleActionBar | undefined;
	private plotToggleAction: ToggleAction | undefined;
	private viewerToggleAction: ToggleAction | undefined;
	private presentationToggleAction: ToggleAction | undefined;

	// The hover delegate.
	private hoverDelegate: IHoverDelegate;

	//#endregion Content Area

	//#region Class Initialization

	/**
	 * Initializes a new instance of the AuxiliaryActivityBarPart class.
	 * @param themeService The theme service.
	 * @param hoverService The theme service.
	 * @param storageService The storage service.
	 * @param configurationService The configuration service.
	 * @param workbenchLayoutService The workbench layout service.
	 * @param contextKeyService The context key service.
	 */
	constructor(
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@IStorageService storageService: IStorageService,
		@IConfigurationService configurationService: IConfigurationService,
		@IWorkbenchLayoutService workbenchLayoutService: IWorkbenchLayoutService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService
	) {
		super(Parts.AUXILIARYACTIVITYBAR_PART, { hasTitle: false }, themeService, storageService, workbenchLayoutService);
		this.hoverDelegate = new AuxiliaryActivityBarHoverDelegate(workbenchLayoutService, configurationService, hoverService);
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
		this.environmentToggleAction = this._register(new ToggleAction('auxiliaryActivityBarActionEnvironment', 'Environment', 'Environment', 'auxiliary-activity-bar-action-icon.environment', true, async () => {
			this.toggleEnvironmentAuxiliaryActivity();
		}));
		this.previewToggleAction = this._register(new ToggleAction('auxiliaryActivityBarActionPreview', 'Preview', 'Preview', 'auxiliary-activity-bar-action-icon.preview', true, async () => {
			this.togglePreviewAuxiliaryActivity();
		}));
		this.helpToggleAction = this._register(new ToggleAction('auxiliaryActivityBarActionHelp', 'Help', 'Help', 'auxiliary-activity-bar-action-icon.help', true, async () => {
			this.toggleHelpAuxiliaryActivity();
		}));
		this.topToggleActionBar = new ToggleActionBar(this.topActionBarContainer, {
			actionContainerClass: 'auxiliary-activity-bar-action-container',
			orientation: ActionsOrientation.VERTICAL,
			ariaLabel: localize('managew3rewerwer', "Manage w3rewerwer"),
			ariaRole: 'toolbar',
			hoverDelegate: this.hoverDelegate,
		}, [this.environmentToggleAction, this.previewToggleAction, this.helpToggleAction]);

		// Create the bottom toggle action bar.
		this.plotToggleAction = this._register(new ToggleAction('auxiliaryActivityBarActionPlot', 'Plot', 'Plot', 'auxiliary-activity-bar-action-icon.plot', true, async () => {
			this.togglePlotAuxiliaryActivity();
		}));
		this.viewerToggleAction = this._register(new ToggleAction('auxiliaryActivityBarActionViewer', 'Viewer', 'Viewer', 'auxiliary-activity-bar-action-icon.viewer', true, async () => {
			this.toggleViewerAuxiliaryActivity();
		}));
		this.presentationToggleAction = this._register(new ToggleAction('auxiliaryActivityBarActionPresentation', 'Presentation', 'Presentation', 'auxiliary-activity-bar-action-icon.presentation', true, async () => {
			this.togglePresentationAuxiliaryActivity();
		}));
		this.bottomToggleActionBar = new ToggleActionBar(this.bottomActionBarContainer, {
			actionContainerClass: 'auxiliary-activity-bar-action-container',
			orientation: ActionsOrientation.VERTICAL,
			ariaLabel: localize('managew3rewerwer', "Manage w3rewerwer"),
			ariaRole: 'toolbar',
			hoverDelegate: this.hoverDelegate,
		}, [this.plotToggleAction, this.viewerToggleAction, this.presentationToggleAction]);

		// Track focus.
		const scopedContextKeyService = this.contextKeyService.createScoped(this.element);
		AuxiliaryActivityBarFocused.bindTo(scopedContextKeyService).set(true);

		// Return this element.
		return this.element;
	}

	toJSON(): object {
		return {
			type: Parts.AUXILIARYACTIVITYBAR_PART
		};
	}

	//#endregion Part

	//#region IAuxiliaryActivityBarService

	// Toggle methods.

	toggleEnvironmentAuxiliaryActivity(): void {
		this.topToggleActionBar?.toggleToggleAction(this.environmentToggleAction);
		this.showHideToolsBar();
	}

	togglePreviewAuxiliaryActivity(): void {
		this.topToggleActionBar?.toggleToggleAction(this.previewToggleAction);
		this.showHideToolsBar();
	}

	toggleHelpAuxiliaryActivity(): void {
		this.topToggleActionBar?.toggleToggleAction(this.helpToggleAction);
		this.showHideToolsBar();
	}

	togglePlotAuxiliaryActivity(): void {
		this.bottomToggleActionBar?.toggleToggleAction(this.plotToggleAction);
		this.showHideToolsBar();
	}

	toggleViewerAuxiliaryActivity(): void {
		this.bottomToggleActionBar?.toggleToggleAction(this.viewerToggleAction);
		this.showHideToolsBar();
	}

	togglePresentationAuxiliaryActivity(): void {
		this.bottomToggleActionBar?.toggleToggleAction(this.presentationToggleAction);
		this.showHideToolsBar();
	}

	// Show methods.

	showEnvironmentAuxiliaryActivity(): void {
		if (this.topToggleActionBar) {
			this.topToggleActionBar.onToggleAction = this.environmentToggleAction;
		}
		this.showHideToolsBar();
	}

	showPreviewAuxiliaryActivity(): void {
		if (this.topToggleActionBar) {
			this.topToggleActionBar.onToggleAction = this.previewToggleAction;
		}
		this.showHideToolsBar();
	}

	showHelpAuxiliaryActivity(): void {
		if (this.topToggleActionBar) {
			this.topToggleActionBar.onToggleAction = this.helpToggleAction;
		}
		this.showHideToolsBar();
	}

	showPlotAuxiliaryActivity(): void {
		if (this.bottomToggleActionBar) {
			this.bottomToggleActionBar.onToggleAction = this.plotToggleAction;
		}
		this.showHideToolsBar();
	}

	showViewerAuxiliaryActivity(): void {
		if (this.bottomToggleActionBar) {
			this.bottomToggleActionBar.onToggleAction = this.viewerToggleAction;
		}
		this.showHideToolsBar();
	}

	showPresentationAuxiliaryActivity(): void {
		if (this.bottomToggleActionBar) {
			this.bottomToggleActionBar.onToggleAction = this.presentationToggleAction;
		}
		this.showHideToolsBar();
	}

	// Other methods.

	focus(): void {
		this.element.focus();
	}

	//#endregion IAuxiliaryActivityBarService

	//#region Private Methods

	// Shows / hides the tools bar.
	private showHideToolsBar(): void {
		this.layoutService.setPartHidden(!this.topToggleActionBar?.onToggleAction && !this.bottomToggleActionBar?.onToggleAction, Parts.TOOLSBAR_PART);
	}

	//#endregion Private Methods
}

// Register the IAuxiliaryActivityBarService singleton.
registerSingleton(IAuxiliaryActivityBarService, AuxiliaryActivityBarPart, false);
