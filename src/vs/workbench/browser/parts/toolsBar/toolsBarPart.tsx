/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

const React = require('react');
import 'vs/css!./media/toolsBarPart';
import { localize } from 'vs/nls';
import * as DOM from 'vs/base/browser/dom';
import { Part } from 'vs/workbench/browser/part';
import { ToolsBarFocused } from 'vs/workbench/common/contextkeys';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { IHoverService } from 'vs/workbench/services/hover/browser/hover';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { ReactRenderer } from 'vs/base/browser/ui/reactRenderer/reactRenderer';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IToolsBarService } from 'vs/workbench/services/toolsBar/browser/toolsBarService';
import { IWorkbenchLayoutService, Parts } from 'vs/workbench/services/layout/browser/layoutService';
import { ToolsBarBottomMode, ToolsBarComponent, ToolsBarContext, ToolsBarState, ToolsBarTopMode } from 'vs/workbench/browser/parts/toolsBar/toolsBarComponent';

/**
 * ToolsBarPart class.
 */
export class ToolsBarPart extends Part implements IToolsBarService {

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

	// The tools bar container.
	private toolsBarContainer: HTMLElement | undefined;

	private toolsBarState: ToolsBarState = {
		counter: 1,
		topMode: ToolsBarTopMode.Empty,
		bottomMode: ToolsBarBottomMode.Empty
	};

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

		// Temporary.
		console.log(localize('yaya', "YAYA"));
	}

	//#endregion Class Initialization
	override dispose(): void {
		super.dispose();

		console.log('ksksk');
	}

	//#region Part

	// Provide the content area.
	override createContentArea(parent: HTMLElement): HTMLElement {
		// Set the element.
		this.element = parent;
		this.element.tabIndex = 0;

		// Create the tools bar container.
		this.toolsBarContainer = DOM.append(this.element, DOM.$('.tools-bar-container'));

		const reactRenderer = new ReactRenderer(this.toolsBarContainer);

		reactRenderer.render(
			<ToolsBarContext.Provider value={this.toolsBarState}>
				<ToolsBarComponent placeholder='value!' />
			</ToolsBarContext.Provider>
		);

		// Testing.
		setInterval(() => {
			this.toolsBarState.counter++;
		}, 1000);

		// Track focus.
		const scopedContextKeyService = this.contextKeyService.createScoped(this.element);
		ToolsBarFocused.bindTo(scopedContextKeyService).set(true);

		// Return this element.
		return this.toolsBarContainer;
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
