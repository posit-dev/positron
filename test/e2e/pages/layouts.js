"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.Layouts = void 0;
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
class Layouts {
    code;
    workbench;
    /**
     * Locator for the entire IDE. This is the "body" of the root page.
     */
    get fullApp() { return this.code.driver.currentPage.locator(FULL_APP); }
    /**
     * Button in upper right of IDE for customizing layout.
     */
    get customizeLayoutButton() { return this.fullApp.getByLabel(CUSTOMIZE_LAYOUT_BUTTON_LABEL); }
    /**
     * Locator for the panel part of the IDE.
     */
    get panel() { return this.code.driver.currentPage.locator(PANEL); }
    /**
     * Locator for the tabs in the panel used to navigate to different views.
     */
    get panelViewsTab() { return getPaneViewTabs(this.panel); }
    /**
     * The content of the panel. This is what should be tested if visible etc because
     * the panel never is hidden, just collapsed.
     * E.g. `await expect(positronLayouts.panelContent).not.toBeVisible();`
     */
    get panelContent() { return this.panel.locator('.content'); }
    /**
     * Locator for the button to expand the panel.
     */
    get panelExpandButton() { return this.panel.getByLabel(PANEL_EXPAND_BUTTON_LABEL); }
    /**
     * Locator for the auxiliary bar part of the IDE.
     */
    get auxBar() { return this.code.driver.currentPage.locator(AUX_BAR); }
    /**
     * Locator for the tabs in the auxiliary bar used to navigate to different views.
     */
    get auxBarViewsTab() { return getPaneViewTabs(this.auxBar); }
    /**
     * Locator for the sidebar part of the IDE.
     */
    get sidebar() { return this.code.driver.currentPage.locator(SIDEBAR); }
    constructor(code, workbench) {
        this.code = code;
        this.workbench = workbench;
    }
    /**
     * Enter a known positron layout.
     *
     * Works by calling the command that sets the layout.
     *
     * @param layout Known layout to enter.
     */
    async enterLayout(layout) {
        await this.workbench.quickaccess.runCommand(positronLayoutPresets[layout], { keepOpen: true });
    }
    /**
     * A bounding box getting that errors if the element is not found rather than returning null.
     * @param locator Element locator to get bounding box of. E.g. `this.panelContent`.
     * @returns Bounding box object
     */
    async boundingBox(locator) {
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
    async boundingBoxProperty(locator, property) {
        const boundingBox = await this.boundingBox(locator);
        return boundingBox[property];
    }
}
exports.Layouts = Layouts;
function getPaneViewTabs(locator) {
    return locator.getByLabel(VIEW_TABS_LABEL).getByRole('tab');
}
//# sourceMappingURL=layouts.js.map