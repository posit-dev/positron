/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/css/positronTopBarPart';
import * as React from 'react';
import { Emitter } from 'vs/base/common/event';
import { Part } from 'vs/workbench/browser/part';
import { KeyCode } from 'vs/base/common/keyCodes';
import { TopBarFocused } from 'vs/workbench/common/contextkeys';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { PositronReactRenderer } from 'vs/base/browser/positronReactRenderer';
import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { PositronTopBar } from 'vs/workbench/browser/parts/positronTopBar/positronTopBar';
import { IWorkbenchLayoutService, Parts } from 'vs/workbench/services/layout/browser/layoutService';
import { KeybindingsRegistry, KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { IPositronTopBarService } from 'vs/workbench/services/positronTopBar/browser/positronTopBarService';
import { IQuickInputService } from 'vs/platform/quickinput/common/quickInput';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IWorkspacesService } from 'vs/platform/workspaces/common/workspaces';
import { ILabelService } from 'vs/platform/label/common/label';
import { IHostService } from 'vs/workbench/services/host/browser/host';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

/**
 * PositronTopBarPart class.
 */
export class PositronTopBarPart extends Part implements IPositronTopBarService {

	declare readonly _serviceBrand: undefined;

	// #region IView

	readonly height: number = 36;
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

	// The React renderer used to render the tools bar component.
	private positronReactRenderer: PositronReactRenderer | undefined;

	//#endregion Content Area

	//#region Class Initialization

	constructor(
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@ICommandService private readonly commandService: ICommandService,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
		@IContextMenuService private readonly contextMenuService: IContextMenuService,
		@IWorkspacesService private readonly workspacesService: IWorkspacesService,
		@ILabelService private readonly labelService: ILabelService,
		@IHostService private readonly hostService: IHostService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@ILanguageRuntimeService private readonly languageRuntimeService: ILanguageRuntimeService
	) {
		super(Parts.POSITRON_TOP_BAR_PART, { hasTitle: false }, themeService, storageService, layoutService);
	}

	//#endregion Class Initialization

	//#region Part Class

	// Provide the content area.
	override createContentArea(parent: HTMLElement): HTMLElement {
		// Set the element.
		this.element = parent;
		this.element.tabIndex = 0;

		// Render the Positron top bar component.
		this.positronReactRenderer = new PositronReactRenderer(this.element);
		this.positronReactRenderer.render(
			<PositronTopBar
				commandService={this.commandService}
				configurationService={this.configurationService}
				contextKeyService={this.contextKeyService}
				contextMenuService={this.contextMenuService}
				hostService={this.hostService}
				keybindingService={this.keybindingService}
				labelService={this.labelService}
				layoutService={this.layoutService}
				quickInputService={this.quickInputService}
				workspaceContextService={this.workspaceContextService}
				workspacesService={this.workspacesService}
				languageRuntimeService={this.languageRuntimeService}
			/>
		);

		// Track focus
		const scopedContextKeyService = this.contextKeyService.createScoped(this.element);
		TopBarFocused.bindTo(scopedContextKeyService).set(true);

		// Return this element.
		return this.element;
	}

	toJSON(): object {
		return {
			type: Parts.POSITRON_TOP_BAR_PART
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

	//#region IPositronTopBarService

	focus(): void {
		this.element.focus();
	}

	//#endregion IPositronTopBarService
}

registerSingleton(IPositronTopBarService, PositronTopBarPart, InstantiationType.Eager);

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
