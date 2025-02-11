/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './positronTopActionBarPart.css';

// React.
import React from 'react';

// Other dependencies.
import { Part } from '../../part.js';
import { KeyCode } from '../../../../base/common/keyCodes.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { ILabelService } from '../../../../platform/label/common/label.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { PositronTopActionBarFocused } from '../../../common/contextkeys.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IWorkspacesService } from '../../../../platform/workspaces/common/workspaces.js';
import { PositronReactRenderer } from '../../../../base/browser/positronReactRenderer.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { KeybindingsRegistry, KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { IRuntimeStartupService } from '../../../services/runtimeStartup/common/runtimeStartupService.js';
import { ILanguageRuntimeService } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { IPositronTopActionBarService } from '../../../services/positronTopActionBar/browser/positronTopActionBarService.js';
import { IPositronTopActionBarContainer, PositronTopActionBar } from './positronTopActionBar.js';
import { IAccessibilityService } from '../../../../platform/accessibility/common/accessibility.js';

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
				runtimeSessionService={this.runtimeSessionService}
				runtimeStartupService={this.runtimeStartupService}
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
