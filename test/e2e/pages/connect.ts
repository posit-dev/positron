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

			console.log(contentGuids);
			if (contentGuids.length > 0) {
				for (const guid of contentGuids) {
					const response = await fetch(`${connectApiUrl}content/${guid}`, {
						method: 'DELETE',
						headers: headers
					});
					// 204 response = app deleted
					if (response.status !== 204) {
						throw new Error(`Failed to delete content with GUID: ${guid}`);
					}
				}
			}
		}
	}
};
