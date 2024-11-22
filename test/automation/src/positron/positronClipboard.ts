/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Code } from '../code';

export class PositronClipboard {

	constructor(private code: Code) { }

	async getClipboardImage(): Promise<Buffer | null> {
		// Grant permissions to read from clipboard
		await this.code.driver.context.grantPermissions(['clipboard-read']);

		const clipboardImageBuffer = await this.code.driver.page.evaluate(async () => {
			const clipboardItems = await navigator.clipboard.read();
			for (const item of clipboardItems) {
				if (item.types.includes('image/png')) {
					const blob = await item.getType('image/png');
					const arrayBuffer = await blob.arrayBuffer();
					return Array.from(new Uint8Array(arrayBuffer));
				}
			}
			return null;
		});

		return clipboardImageBuffer ? Buffer.from(clipboardImageBuffer) : null;
	}
}
