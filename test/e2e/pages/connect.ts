/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

export class PositConnect {
	constructor() {

	}
	async deleteUserContent() {
		console.log('Deleting user content');
		const connectApiUrl = `${process.env.E2E_CONNECT_SERVER}__api__/v1/`
		const headers = { 'Authorization': `Key ${process.env.E2E_CONNECT_APIKEY}` };
		const userGuid = (await (await fetch(connectApiUrl + 'user', { headers: headers })).json()).guid;

		const appInfo = await (await fetch(connectApiUrl + `content?owner_guid=${userGuid}`, { headers: headers })).json();
		const contentGuids: string[] = [];
		for (const app of appInfo) {
			contentGuids.push(app['guid'] as string);
		}

		console.log(contentGuids);

	}
};


// make a clean up for the shiny app, look at clipboard to get an example of what a cleanup for a page looks like

// after this is added, go to workbench.ts and add an instance of this so that I can use it through the workbench
