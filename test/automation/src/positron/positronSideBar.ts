/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/


import { Code } from '../code';

const HIDE_SECONDARY_SIDE_BAR = '[aria-label="Hide Secondary Side Bar"]';

export class PositronSideBar {

	constructor(private code: Code) { }

	async closeSecondarySideBar() {
		console.log('Hiding secondary side bar');
		const hideSecondarySideBar = this.code.driver.getLocator(HIDE_SECONDARY_SIDE_BAR);
		await hideSecondarySideBar.click();
	}


}
