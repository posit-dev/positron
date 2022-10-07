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
import { IWorkbenchLayoutService, Parts } from 'vs/workbench/services/layout/browser/layoutService';
import { Emitter } from 'vs/base/common/event';
import { IAuxiliaryActivityBarService } from 'vs/workbench/services/auxiliaryActivityBar/browser/auxiliaryActivityBarService';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { AuxiliaryActivityBarFocused } from 'vs/workbench/common/contextkeys';
import { ToggleAction, ToggleActionBar } from 'vs/base/browser/ui/toggleActionBar/toggleActionBar';
import { ActionsOrientation } from 'vs/base/browser/ui/actionbar/actionbar';
import { IHoverService } from 'vs/workbench/services/hover/browser/hover';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
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

	//#endregion Content Area

	//#region Class Initialization

	/**
	 * Initializes a new instance of the AuxiliaryActivityBarPart class.
	 * @param themeService The theme service.
	 * @param workbenchLayoutService The workbench layout service.
	 * @param storageService The storage service.
	 * @param contextKeyService The context key service.
	 */
	constructor(
		@IThemeService themeService: IThemeService,
		@IWorkbenchLayoutService workbenchLayoutService: IWorkbenchLayoutService,
		@IStorageService storageService: IStorageService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IHoverService private readonly hoverService: IHoverService,
		@IConfigurationService private readonly configurationService: IConfigurationService
	) {
		super(Parts.AUXILIARYACTIVITYBAR_PART, { hasTitle: false }, themeService, storageService, workbenchLayoutService);

		// Temporary...
		console.log(this.hoverService);
		console.log(this.configurationService);
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
		this.environmentToggleAction = this._register(new ToggleAction('auxiliaryActivityBarActionEnvironment', '', 'auxiliary-activity-bar-action-icon.environment', true, async () => {
			this.toggleEnvironmentAuxiliaryActivity();
		}));
		this.previewToggleAction = this._register(new ToggleAction('auxiliaryActivityBarActionPreview', '', 'auxiliary-activity-bar-action-icon.preview', true, async () => {
			this.togglePreviewAuxiliaryActivity();
		}));
		this.helpToggleAction = this._register(new ToggleAction('auxiliaryActivityBarActionHelp', '', 'auxiliary-activity-bar-action-icon.help', true, async () => {
			this.toggleHelpAuxiliaryActivity();
		}));
		this.topToggleActionBar = new ToggleActionBar(this.topActionBarContainer, {
			actionContainerClass: 'auxiliary-activity-bar-action-container',
			orientation: ActionsOrientation.VERTICAL,
			ariaLabel: localize('managew3rewerwer', "Manage w3rewerwer"),
		}, [this.environmentToggleAction, this.previewToggleAction, this.helpToggleAction]);

		// Create the bottom toggle action bar.
		this.plotToggleAction = this._register(new ToggleAction('auxiliaryActivityBarActionPlot', '', 'auxiliary-activity-bar-action-icon.plot', true, async () => {
			this.togglePlotAuxiliaryActivity();
		}));
		this.viewerToggleAction = this._register(new ToggleAction('auxiliaryActivityBarActionViewer', '', 'auxiliary-activity-bar-action-icon.viewer', true, async () => {
			this.toggleViewerAuxiliaryActivity();
		}));
		this.presentationToggleAction = this._register(new ToggleAction('auxiliaryActivityBarActionPresentation', '', 'auxiliary-activity-bar-action-icon.presentation', true, async () => {
			this.togglePresentationAuxiliaryActivity();
		}));
		this.bottomToggleActionBar = new ToggleActionBar(this.bottomActionBarContainer, {
			actionContainerClass: 'auxiliary-activity-bar-action-container',
			orientation: ActionsOrientation.VERTICAL,
			ariaLabel: localize('managew3rewerwer', "Manage w3rewerwer"),
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
		this.showHideAuxiliaryBar();
	}

	togglePreviewAuxiliaryActivity(): void {
		this.topToggleActionBar?.toggleToggleAction(this.previewToggleAction);
		this.showHideAuxiliaryBar();
	}

	toggleHelpAuxiliaryActivity(): void {
		this.topToggleActionBar?.toggleToggleAction(this.helpToggleAction);
		this.showHideAuxiliaryBar();
	}

	togglePlotAuxiliaryActivity(): void {
		this.bottomToggleActionBar?.toggleToggleAction(this.plotToggleAction);
		this.showHideAuxiliaryBar();
	}

	toggleViewerAuxiliaryActivity(): void {
		this.bottomToggleActionBar?.toggleToggleAction(this.viewerToggleAction);
		this.showHideAuxiliaryBar();
	}

	togglePresentationAuxiliaryActivity(): void {
		this.bottomToggleActionBar?.toggleToggleAction(this.presentationToggleAction);
		this.showHideAuxiliaryBar();
	}

	// Show methods.

	showEnvironmentAuxiliaryActivity(): void {
		if (this.topToggleActionBar) {
			this.topToggleActionBar.onToggleAction = this.environmentToggleAction;
		}
		this.showHideAuxiliaryBar();
	}

	showPreviewAuxiliaryActivity(): void {
		if (this.topToggleActionBar) {
			this.topToggleActionBar.onToggleAction = this.previewToggleAction;
		}
		this.showHideAuxiliaryBar();
	}

	showHelpAuxiliaryActivity(): void {
		if (this.topToggleActionBar) {
			this.topToggleActionBar.onToggleAction = this.helpToggleAction;
		}
		this.showHideAuxiliaryBar();
	}

	showPlotAuxiliaryActivity(): void {
		if (this.bottomToggleActionBar) {
			this.bottomToggleActionBar.onToggleAction = this.plotToggleAction;
		}
		this.showHideAuxiliaryBar();
	}

	showViewerAuxiliaryActivity(): void {
		if (this.bottomToggleActionBar) {
			this.bottomToggleActionBar.onToggleAction = this.viewerToggleAction;
		}
		this.showHideAuxiliaryBar();
	}

	showPresentationAuxiliaryActivity(): void {
		if (this.bottomToggleActionBar) {
			this.bottomToggleActionBar.onToggleAction = this.presentationToggleAction;
		}
		this.showHideAuxiliaryBar();
	}

	// Other methods.

	focus(): void {
		this.element.focus();
	}

	//#endregion IAuxiliaryActivityBarService

	//#region Private Methods

	// Shows / hides the auxiliary bar.
	private showHideAuxiliaryBar(): void {
		this.layoutService.setPartHidden(!this.topToggleActionBar?.onToggleAction && !this.bottomToggleActionBar?.onToggleAction, Parts.AUXILIARYBAR_PART);
	}

	//#endregion Private Methods
}

// Register the IAuxiliaryActivityBarService singleton.
registerSingleton(IAuxiliaryActivityBarService, AuxiliaryActivityBarPart, false);
