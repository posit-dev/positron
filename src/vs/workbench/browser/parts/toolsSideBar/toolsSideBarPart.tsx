/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/toolsSideBarPart';
const React = require('react');
import * as DOM from 'vs/base/browser/dom';
import { Part } from 'vs/workbench/browser/part';
import { ToolsSideBarFocused } from 'vs/workbench/common/contextkeys';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { IHoverService } from 'vs/workbench/services/hover/browser/hover';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { ReactRenderer } from 'vs/base/browser/ui/reactRenderer/reactRenderer';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IWorkbenchLayoutService, Parts } from 'vs/workbench/services/layout/browser/layoutService';
import { ToolsSideBarComponent } from 'vs/workbench/browser/parts/toolsSideBar/toolsSideBarComponent';
import { IToolsSideBarService } from 'vs/workbench/services/toolsSideBar/browser/toolsSideBarService';
import { IToolsBarService } from 'vs/workbench/services/toolsBar/browser/toolsBarService';

/**
 * ToolsSideBarPart class.
 */
export class ToolsSideBarPart extends Part implements IToolsSideBarService {

	declare readonly _serviceBrand: undefined;

	//#region IView

	readonly minimumWidth: number = 400;
	readonly maximumWidth: number = Number.POSITIVE_INFINITY;
	readonly minimumHeight: number = 0;
	readonly maximumHeight: number = Number.POSITIVE_INFINITY;

	get preferredWidth(): number | undefined {
		// TODO@softwarenerd - Return preferred width based on which view or views are showing.
		return Math.max(0, 400);
	}

	//#endregion

	//#region Content Area

	// The tools side bar container.
	private toolsSideBarContainer: HTMLElement | undefined;

	// The React renderer used to render the tools bar component.
	private reactRenderer: ReactRenderer | undefined;

	//#endregion Content Area

	//#region Class Initialization

	constructor(
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@IStorageService storageService: IStorageService,
		@IConfigurationService configurationService: IConfigurationService,
		@IWorkbenchLayoutService workbenchLayoutService: IWorkbenchLayoutService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IToolsBarService private readonly toolsBarService: IToolsBarService
	) {
		super(Parts.TOOLSSIDEBAR_PART, { hasTitle: false }, themeService, storageService, workbenchLayoutService);
	}

	//#endregion Class Initialization

	//#region Part

	// Provide the content area.
	override createContentArea(parent: HTMLElement): HTMLElement {
		// Set the element.
		this.element = parent;
		this.element.tabIndex = 0;

		// Create the tools bar container.
		this.toolsSideBarContainer = DOM.append(this.element, DOM.$('.tools-bar-container'));

		// Create the React renderer and render the tools bar component.
		this.reactRenderer = new ReactRenderer(this.toolsSideBarContainer);
		this.reactRenderer.render(
			<ToolsSideBarComponent placeholder='(x)' toolsBarService={this.toolsBarService} />
		);

		// Track focus.
		const scopedContextKeyService = this.contextKeyService.createScoped(this.element);
		ToolsSideBarFocused.bindTo(scopedContextKeyService).set(true);

		// Return this element.
		return this.toolsSideBarContainer;
	}

	toJSON(): object {
		return {
			type: Parts.TOOLSSIDEBAR_PART
		};
	}

	//#endregion Part

	//#region IToolsSideBarService

	focus(): void {
		this.element.focus();
	}

	//#endregion IToolsSideBarService
}

// Register the IToolsSideBarService singleton.
registerSingleton(IToolsSideBarService, ToolsSideBarPart, false);
