/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Locator } from '@playwright/test';
import { Code } from '../infra/code';
import { Positron } from '../infra/positron';

const FULL_APP = 'body';
const AUX_BAR = '.part.auxiliarybar';
const PANEL = '.part.panel';
const SIDEBAR = '.part.sidebar';

const CUSTOMIZE_LAYOUT_BUTTON_LABEL = /customize layout/i;
const PANEL_EXPAND_BUTTON_LABEL = /restore panel/i;
const VIEW_TABS_LABEL = /active view switcher/i;

// Known layouts in Positron.
const positronLayoutPresets = {
	stacked: 'workbench.action.positronFourPaneDataScienceLayout',
	side_by_side: 'workbench.action.positronTwoPaneDataScienceLayout',
	notebook: 'workbench.action.positronNotebookLayout',
	dockedHelp: 'workbench.action.positronHelpPaneDocked',
	fullSizedAuxBar: 'workbench.action.fullSizedAuxiliaryBar',
	fullSizedSidebar: 'workbench.action.fullSizedSidebar',
	fullSizedPanel: 'workbench.action.fullSizedPanel',
};

/**
 * Helper class for testing Positron layouts.
 *
 * Allows for things like getting various locators for parts of the IDE and entering different
 * layouts.
 */
export class Layouts {

	/**
	 * Locator for the entire IDE. This is the "body" of the root page.
	 */
	fullApp = this.code.driver.page.locator(FULL_APP);

	/**
	 * Button in upper right of IDE for customizing layout.
	 */
	customizeLayoutButton = this.fullApp.getByLabel(CUSTOMIZE_LAYOUT_BUTTON_LABEL);

	/**
	 * Locator for the panel part of the IDE.
	 */
	panel = this.code.driver.page.locator(PANEL);

	/**
	 * Locator for the tabs in the panel used to navigate to different views.
	 */
	panelViewsTab = getPaneViewTabs(this.panel);

	/**
	 * The content of the panel. This is what should be tested if visible etc because
	 * the panel never is hidden, just collapsed.
	 * E.g. `await expect(positronLayouts.panelContent).not.toBeVisible();`
	 */
	panelContent = this.panel.locator('.content');

	/**
	 * Locator for the button to expand the panel.
	 */
	panelExpandButton = this.panel.getByLabel(PANEL_EXPAND_BUTTON_LABEL);

	/**
	 * Locator for the auxiliary bar part of the IDE.
	 */
	auxBar = this.code.driver.page.locator(AUX_BAR);

	/**
	 * Locator for the tabs in the auxiliary bar used to navigate to different views.
	 */
	auxBarViewsTab = getPaneViewTabs(this.auxBar);

	/**
	 * Locator for the sidebar part of the IDE.
	 */
	sidebar = this.code.driver.page.locator(SIDEBAR);

	constructor(private code: Code, private workbench: Positron) { }

	/**
	 * Enter a known positron layout.
	 *
	 * Works by calling the command that sets the layout.
	 *
	 * @param layout Known layout to enter.
	 */
	async enterLayout(layout: keyof typeof positronLayoutPresets): Promise<void> {
		await this.workbench.quickaccess.runCommand(positronLayoutPresets[layout], { keepOpen: true });
	}

	/**
	 * A bounding box getting that errors if the element is not found rather than returning null.
	 * @param locator Element locator to get bounding box of. E.g. `this.panelContent`.
	 * @returns Bounding box object
	 */
	async boundingBox(locator: Locator) {
		const boundingBox = await locator.boundingBox();

		if (!boundingBox) {
			throw new Error(`Error finding bounding box of element: element not found`);
		}

		return boundingBox;
	}

	/**
	 * Get just a specific property of the bounding box. Errors if the element is not found.
	 * @param locator Element locator to get bounding box of. E.g. `this.panelContent`.
	 * @param property Which property of the bounding box to return.
	 * @returns A number representing the property of the bounding box.
	 */
	async boundingBoxProperty(locator: Locator, property: 'x' | 'y' | 'width' | 'height') {
		const boundingBox = await this.boundingBox(locator);
		return boundingBox[property];
	}
}

function getPaneViewTabs(locator: Locator) {
	return locator.getByLabel(VIEW_TABS_LABEL).getByRole('tab');
}
