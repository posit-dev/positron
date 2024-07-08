/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { Code } from '../code';
import { PositronBaseElement } from './positronBaseElement';

const POSITRON_TOP_ACTION_BAR = 'div[id="workbench.parts.positron-top-action-bar"]';
const POSITRON_TOP_ACTION_SAVE_BUTTON = 'div[id="workbench.parts.positron-top-action-bar"] .action-bar-region-left .action-bar-button[aria-label="Save"]';
const POSITRON_TOP_ACTION_SAVE_ALL_BUTTON = 'div[id="workbench.parts.positron-top-action-bar"] .action-bar-region-left .action-bar-button[aria-label="Save All"]';

/*
 *  Reuseable Positron top action bar functionality for tests to leverage.
 */
export class PositronTopActionBar {
	topActionBar: PositronBaseElement;
	saveButton: PositronBaseElement;
	saveAllButton: PositronBaseElement;

	constructor(private code: Code) {
		this.topActionBar = new PositronBaseElement(POSITRON_TOP_ACTION_BAR, this.code);
		this.saveButton = new PositronBaseElement(POSITRON_TOP_ACTION_SAVE_BUTTON, this.code);
		this.saveAllButton = new PositronBaseElement(POSITRON_TOP_ACTION_SAVE_ALL_BUTTON, this.code);
	}
}
