"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.TopActionBar = void 0;
const POSITRON_TOP_ACTION_BAR = 'div[id="workbench.parts.positron-top-action-bar"]';
const POSITRON_TOP_ACTION_SAVE_BUTTON = 'div[id="workbench.parts.positron-top-action-bar"] .action-bar-region-left .action-bar-button[aria-label="Save"]';
const POSITRON_TOP_ACTION_SAVE_ALL_BUTTON = 'div[id="workbench.parts.positron-top-action-bar"] .action-bar-region-left .action-bar-button[aria-label="Save All"]';
/*
 *  Reuseable Positron top action bar functionality for tests to leverage.
 */
class TopActionBar {
    code;
    topActionBar;
    saveButton;
    saveAllButton;
    constructor(code) {
        this.code = code;
        this.topActionBar = this.code.driver.currentPage.locator(POSITRON_TOP_ACTION_BAR);
        this.saveButton = this.code.driver.currentPage.locator(POSITRON_TOP_ACTION_SAVE_BUTTON);
        this.saveAllButton = this.code.driver.currentPage.locator(POSITRON_TOP_ACTION_SAVE_ALL_BUTTON);
    }
}
exports.TopActionBar = TopActionBar;
//# sourceMappingURL=topActionBar.js.map