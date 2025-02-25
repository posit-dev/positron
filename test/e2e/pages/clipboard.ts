/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Code } from '../infra/code';

export class Clipboard {

	constructor(private code: Code) { }

	async getClipboardText(): Promise<string | null> {
		// Grant permissions to read from clipboard
		await this.code.driver.context.grantPermissions(['clipboard-read']);

		const clipboardText = await this.code.driver.page.evaluate(async () => {
			try {
				return await navigator.clipboard.readText();
			} catch (error) {
				console.error('Failed to read clipboard text:', error);
				return null;
			}
		});

		return clipboardText;
	}

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

	async clearClipboard(): Promise<void> {
		// Grant permissions to modify the clipboard
		await this.code.driver.context.grantPermissions(['clipboard-write']);

		// Use the page context to overwrite the clipboard
		await this.code.driver.page.evaluate(async () => {
			await navigator.clipboard.writeText(''); // Clear clipboard by writing an empty string
		});
	}
}
