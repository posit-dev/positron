/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { Code } from '../code';

const HIDE_SECONDARY_SIDE_BAR = '[aria-label="Hide Secondary Side Bar"]';

export class PositronSideBar {

	constructor(private code: Code) { }

	async closeSecondarySideBar() {
		console.log('Hiding secondary side bar');
		await this.code.waitAndClick(HIDE_SECONDARY_SIDE_BAR);
	}
}
