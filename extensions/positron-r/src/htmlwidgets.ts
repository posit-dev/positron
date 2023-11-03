/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';

export function registerHtmlWidgets() {
	positron.runtime.registerLocalResourceRootsProvider({
		mimeType: 'application/vnd.r.htmlwidget',
		callback: (_data: any) => {
			return [];
		}
	});
}
