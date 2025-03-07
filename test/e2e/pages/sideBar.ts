/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { Code } from '../infra/code';

const HIDE_SECONDARY_SIDE_BAR = '[aria-label="Hide Secondary Side Bar"]';
const SESSION_BUTTON = '[aria-label="Session"]:has-text("Session")';

/*
 *  Reuseable Positron sidebar functionality for tests to leverage.
 */
export class SideBar {

	constructor(private code: Code) { }

	async closeSecondarySideBar() {
		this.code.logger.log('Hiding secondary side bar');
		await this.code.driver.page.locator(HIDE_SECONDARY_SIDE_BAR).click();
	}

	async openSession() {
		this.code.logger.log('Opening session');
		await this.code.driver.page.locator(SESSION_BUTTON).click();
	}
}
