/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./positronTopActionBarPart';

// React.
import * as React from 'react';

// Other dependencies.
import { Part } from 'vs/workbench/browser/part';
import { KeyCode } from 'vs/base/common/keyCodes';
import { Emitter, Event } from 'vs/base/common/event';
import { ILabelService } from 'vs/platform/label/common/label';
import { IHoverService } from 'vs/platform/hover/browser/hover';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { IHostService } from 'vs/workbench/services/host/browser/host';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { PositronTopActionBarFocused } from 'vs/workbench/common/contextkeys';
import { IQuickInputService } from 'vs/platform/quickinput/common/quickInput';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IWorkspacesService } from 'vs/platform/workspaces/common/workspaces';
import { PositronReactRenderer } from 'vs/base/browser/positronReactRenderer';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IWorkbenchLayoutService, Parts } from 'vs/workbench/services/layout/browser/layoutService';
import { KeybindingsRegistry, KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { IRuntimeSessionService } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';
import { IRuntimeStartupService } from 'vs/workbench/services/runtimeStartup/common/runtimeStartupService';
import { ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IPositronTopActionBarService } from 'vs/workbench/services/positronTopActionBar/browser/positronTopActionBarService';
import { IPositronTopActionBarContainer, PositronTopActionBar } from 'vs/workbench/browser/parts/positronTopActionBar/positronTopActionBar';
import { IAccessibilityService } from 'vs/platform/accessibility/common/accessibility';

/**
 * PositronTopActionBarPart class.
 */
export class PositronTopActionBarPart extends Part implements IPositronTopActionBarContainer, IPositronTopActionBarService {
	/**
	 * Needed for service branding in dependency injector.
	 */
	declare readonly _serviceBrand: undefined;

	/**
	 * Gets or sets the width. This value is set in layout and is used to implement the
	 * IPositronTopActionBarContainer interface.
	 */
	private _width = 0;

	/**
	 * The onWidthChanged event emitter.
	 */
	private _onWidthChangedEmitter = this._register(new Emitter<number>());

	/**
	 * The onShowStartInterpreterPopup event emitter.
	 */
	private _onShowStartInterpreterPopupEmitter = this._register(new Emitter<void>());

	//#region IView

	get width() {
		return this._width;
	}

	readonly height: number = 34;
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

	/**
	 * The onWidthChanged event.
	 */
	readonly onWidthChanged: Event<number> = this._onWidthChangedEmitter.event;

	//#endregion IView

	//#region Content Area

	// The React renderer used to render the tools bar component.
	private positronReactRenderer: PositronReactRenderer | undefined;

	//#endregion Content Area

	//#region Class Initialization

	constructor(
		@IAccessibilityService private readonly _accessibilityService: IAccessibilityService,
		@ICommandService private readonly commandService: ICommandService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IContextMenuService private readonly contextMenuService: IContextMenuService,
		@IHostService private readonly hostService: IHostService,
		@IHoverService private readonly hoverService: IHoverService,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
		@ILabelService private readonly labelService: ILabelService,
		@ILanguageRuntimeService private readonly languageRuntimeService: ILanguageRuntimeService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@IRuntimeStartupService private readonly runtimeStartupService: IRuntimeStartupService,
		@IRuntimeSessionService private readonly runtimeSessionService: IRuntimeSessionService,
		@IStorageService storageService: IStorageService,
		@IThemeService themeService: IThemeService,
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IWorkspacesService private readonly workspacesService: IWorkspacesService
	) {
		super(Parts.POSITRON_TOP_ACTION_BAR_PART, { hasTitle: false }, themeService, storageService, layoutService);
	}

	//#endregion Class Initialization

	//#region Part Class

	// Provide the content area.
	protected override createContentArea(parent: HTMLElement): HTMLElement {
		// Set the element.
		this.element = parent;
		this.element.tabIndex = -1;

		// Render the Positron top action bar component.
		this.positronReactRenderer = new PositronReactRenderer(this.element);
		this.positronReactRenderer.render(
			<PositronTopActionBar
				accessibilityService={this._accessibilityService}
				commandService={this.commandService}
				configurationService={this.configurationService}
				contextKeyService={this.contextKeyService}
				contextMenuService={this.contextMenuService}
				hostService={this.hostService}
				hoverService={this.hoverService}
				keybindingService={this.keybindingService}
				labelService={this.labelService}
				languageRuntimeService={this.languageRuntimeService}
				layoutService={this.layoutService}
				positronTopActionBarContainer={this}
				positronTopActionBarService={this}
				quickInputService={this.quickInputService}
				runtimeStartupService={this.runtimeStartupService}
				runtimeSessionService={this.runtimeSessionService}
				workspaceContextService={this.workspaceContextService}
				workspacesService={this.workspacesService}
			/>
		);

		// Track focus
		const scopedContextKeyService = this.contextKeyService.createScoped(this.element);
		PositronTopActionBarFocused.bindTo(scopedContextKeyService).set(true);

		// Return this element.
		return this.element;
	}

	override layout(width: number, height: number, _top: number, _left: number): void {
		super.layout(width, height, _top, _left);
		this._width = width;
		this._onWidthChangedEmitter.fire(width);
	}

	toJSON(): object {
		return {
			type: Parts.POSITRON_TOP_ACTION_BAR_PART
		};
	}

	public override dispose(): void {
		if (this.positronReactRenderer) {
			this.positronReactRenderer.destroy();
			this.positronReactRenderer = undefined;
		}
		super.dispose();
	}

	//#endregion Part Class

	//#region IPositronTopActionBarService

	/**
	 * The onShowStartInterpreterPopup event.
	 */
	readonly onShowStartInterpreterPopup: Event<void> = this._onShowStartInterpreterPopupEmitter.event;

	/**
	 * Drives focus to the Positron top action bar.
	 */
	focus(): void {
		this.element.focus();
	}

	/**
	 * Shows the start interpreter popup.
	 */
	showStartInterpreterPopup(): void {
		this._onShowStartInterpreterPopupEmitter.fire();
	}

	//#endregion IPositronTopActionBarService
}

registerSingleton(IPositronTopActionBarService, PositronTopActionBarPart, InstantiationType.Eager);

// Keybindings
KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'workbench.top-action-bar.focusTopActionBar',
	weight: KeybindingWeight.WorkbenchContrib,
	primary: KeyCode.Escape,
	when: PositronTopActionBarFocused,
	handler: (accessor: ServicesAccessor) => {
		const positronTopActionBarService = accessor.get(IPositronTopActionBarService);
		positronTopActionBarService.focus();
	}
});
