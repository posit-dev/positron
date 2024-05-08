/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/


import { Code } from '../code';


export class PositronSideBar {

	constructor(private code: Code) { }

	async closeSecondarySideBar() {
		console.log('Hiding secondary side bar');
		const hideSecondarySideBar = this.code.driver.getLocator('[aria-label="Hide Secondary Side Bar"]');
		await hideSecondarySideBar.click();
	}


}
