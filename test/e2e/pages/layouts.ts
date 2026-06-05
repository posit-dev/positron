/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import test, { expect, Locator } from '@playwright/test';
import { Code } from '../infra/code';
import { Workbench } from '../infra/workbench';

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
	assistant: 'workbench.action.positronAssistantLayout',
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
	get fullApp(): Locator { return this.code.driver.currentPage.locator(FULL_APP); }

	/**
	 * Button in upper right of IDE for customizing layout.
	 */
	get customizeLayoutButton(): Locator { return this.fullApp.getByLabel(CUSTOMIZE_LAYOUT_BUTTON_LABEL); }

	/**
	 * Locator for the panel part of the IDE.
	 */
	get panel(): Locator { return this.code.driver.currentPage.locator(PANEL); }

	/**
	 * Locator for the tabs in the panel used to navigate to different views.
	 */
	get panelViewsTab(): Locator { return getPaneViewTabs(this.panel); }

	/**
	 * The content of the panel. This is what should be tested if visible etc because
	 * the panel never is hidden, just collapsed.
	 * E.g. `await expect(positronLayouts.panelContent).not.toBeVisible();`
	 */
	get panelContent(): Locator { return this.panel.locator('.content'); }

	/**
	 * Locator for the button to expand the panel.
	 */
	get panelExpandButton(): Locator { return this.panel.getByLabel(PANEL_EXPAND_BUTTON_LABEL); }

	/**
	 * Locator for the auxiliary bar part of the IDE.
	 */
	get auxBar(): Locator { return this.code.driver.currentPage.locator(AUX_BAR); }

	/**
	 * Locator for the tabs in the auxiliary bar used to navigate to different views.
	 */
	get auxBarViewsTab(): Locator { return getPaneViewTabs(this.auxBar); }

	/**
	 * Locator for the sidebar part of the IDE.
	 */
	get sidebar(): Locator { return this.code.driver.currentPage.locator(SIDEBAR); }

	constructor(private code: Code, private workbench: Workbench) { }

	/**
	 * Enter a known positron layout.
	 *
	 * Works by calling the command that sets the layout.
	 *
	 * @param layout Known layout to enter.
	 */
	async enterLayout(layout: keyof typeof positronLayoutPresets): Promise<void> {
		const titlebarDragRegion = this.code.driver.currentPage.locator('.titlebar-drag-region');
		if (await titlebarDragRegion.isVisible()) {
			await titlebarDragRegion.click();
		}
		await this.workbench.quickaccess.runCommand(positronLayoutPresets[layout], { keepOpen: true });
	}

	/**
	 * Resize the primary sidebar by dragging its right edge.
	 * Positive x widens the sidebar, negative x narrows it.
	 */
	async resizeSidebar(delta: { x: number }): Promise<void> {
		const sidebar = this.code.driver.currentPage.locator(SIDEBAR);
		const box = await sidebar.boundingBox();
		if (!box) {
			throw new Error('sidebar not found or not visible');
		}
		await this.code.driver.clickAndDrag({
			from: { x: box.x + box.width, y: box.y + box.height / 2 },
			delta: { x: delta.x },
		});
	}

	/**
	 * Resize the secondary sidebar (auxiliary bar / variables-side) by
	 * dragging its left edge. Negative x widens the bar, positive x narrows.
	 */
	async resizeAuxiliaryBar(delta: { x: number }): Promise<void> {
		const auxBar = this.code.driver.currentPage.locator('.part.auxiliarybar');
		const box = await auxBar.boundingBox();
		if (!box) {
			throw new Error('auxiliarybar not found or not visible');
		}
		await this.code.driver.clickAndDrag({
			from: { x: box.x, y: box.y + box.height / 2 },
			delta: { x: delta.x },
		});
	}

	/**
	 * Resize the bottom panel (console / terminal / output area) by dragging
	 * its top edge. Negative y makes the panel taller, positive y shorter.
	 */
	async resizePanel(delta: { y: number }): Promise<void> {
		const panel = this.code.driver.currentPage.locator('.part.panel');
		const box = await panel.boundingBox();
		if (!box) {
			throw new Error('panel not found or not visible');
		}
		await this.code.driver.clickAndDrag({
			from: { x: box.x + box.width / 2, y: box.y },
			delta: { y: delta.y },
		});
	}

	/**
	 * Resize the bottom panel to an exact pixel height, regardless of its
	 * current size. More reliable than resizePanel() across environments where
	 * the default panel height differs.
	 */
	async resizePanelToHeight(targetHeight: number): Promise<void> {
		const panel = this.code.driver.currentPage.locator('.part.panel');
		const box = await panel.boundingBox();
		if (!box) {
			throw new Error('panel not found or not visible');
		}
		await this.resizePanel({ y: box.height - targetHeight });
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

	/**
	 * Assert which view container is currently active (showing) in the sidebar by
	 * its title. The sidebar can be visible while showing the wrong view, so this
	 * checks the actual active composite rather than mere visibility.
	 * @param title The expected title text of the active sidebar view (e.g. 'Chat').
	 */
	async expectActiveSidebarView(title: string): Promise<void> {
		await test.step(`Expect active sidebar view to be "${title}"`, async () => {
			await expect(this.sidebar.locator('.composite.title h2')).toHaveText(title);
		});
	}

	/**
	 * Assert that the bottom panel is visible or not visible.
	 * @param visible Whether the panel should be visible.
	 */
	async expectBottomPanelToBeVisible(visible = true): Promise<void> {
		await test.step(`Expect panel to be ${visible ? 'visible' : 'not visible'}`, async () => {
			if (visible) {
				await expect(this.panelContent).toBeVisible();
			} else {
				await expect(this.panelContent).not.toBeVisible();
			}
		});
	}
}

function getPaneViewTabs(locator: Locator) {
	return locator.getByLabel(VIEW_TABS_LABEL).getByRole('tab');
}
