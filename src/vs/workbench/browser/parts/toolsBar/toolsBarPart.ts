/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/toolsBarPart';
import { localize } from 'vs/nls';
import * as DOM from 'vs/base/browser/dom';
import { Part } from 'vs/workbench/browser/part';
import { LayoutPriority } from 'vs/base/browser/ui/grid/grid';
import { ToolsBarFocused } from 'vs/workbench/common/contextkeys';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { IHoverService } from 'vs/workbench/services/hover/browser/hover';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IToolsBarService } from 'vs/workbench/services/toolsBar/browser/toolsBarService';
import { IWorkbenchLayoutService, Parts } from 'vs/workbench/services/layout/browser/layoutService';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';

/**
 * ToolsBarPart class.
 */
export class ToolsBarPart extends Part implements IToolsBarService {

	declare readonly _serviceBrand: undefined;

	//#region IView

	readonly minimumWidth: number = 170;
	readonly maximumWidth: number = Number.POSITIVE_INFINITY;
	readonly minimumHeight: number = 0;
	readonly maximumHeight: number = Number.POSITIVE_INFINITY;

	readonly priority: LayoutPriority = LayoutPriority.Low;

	readonly snap = true;

	get preferredWidth(): number | undefined {
		// Return preferred width based on which view or views are showing.
		return Math.max(0, 300);
	}

	//#endregion

	//#region Content Area

	// The action bars container and the top and bottom action bar containers.
	private toolsBarContainer: HTMLElement | undefined;

	//#endregion Content Area

	//#region Class Initialization

	/**
	 * Initializes a new instance of the ToolsBarPart class.
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
		super(Parts.TOOLSBAR_PART, { hasTitle: false }, themeService, storageService, workbenchLayoutService);

		console.log(localize('yaya', "YAYA"));
	}

	//#endregion Class Initialization

	//#region Part

	// Provide the content area.
	override createContentArea(parent: HTMLElement): HTMLElement {
		// Set the element.
		this.element = parent;
		this.element.tabIndex = 0;

		// Create the tools bar container.
		this.toolsBarContainer = DOM.append(this.element, DOM.$('.tools-bar-container'));

		// Temporary.
		console.log(this.toolsBarContainer);

		// Track focus.
		const scopedContextKeyService = this.contextKeyService.createScoped(this.element);
		ToolsBarFocused.bindTo(scopedContextKeyService).set(true);

		// Return this element.
		return this.element;
	}

	toJSON(): object {
		return {
			type: Parts.TOOLSBAR_PART
		};
	}

	//#endregion Part

	//#region IAuxiliaryActivityBarService

	focus(): void {
		this.element.focus();
	}

	//#endregion IAuxiliaryActivityBarService
}

// Register the IToolsBarService singleton.
registerSingleton(IToolsBarService, ToolsBarPart, false);
