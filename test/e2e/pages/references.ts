/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { expect } from '@playwright/test';
import { Code } from '../infra/code';

/*
 *  Reuseable Positron references functionality for tests to leverage.
 */
export class References {

	private static readonly REFERENCES_WIDGET = '.monaco-editor .zone-widget .zone-widget-container.peekview-widget.reference-zone-widget.results-loaded';
	private static readonly REFERENCES_TITLE_COUNT = `${References.REFERENCES_WIDGET} .head .peekview-title .meta`;
	private static readonly REFERENCES = `${References.REFERENCES_WIDGET} .body .ref-tree.inline .monaco-list-row .highlight`;
	private static readonly REFERENCES_TITLE_FILE_NAME = `${References.REFERENCES_WIDGET} .head .peekview-title .filename`;
	private static readonly REFERENCE_FILES = `${References.REFERENCES_WIDGET} .reference-file .label-name`;

	constructor(private code: Code) { }

	async waitUntilOpen(): Promise<void> {
		await expect(this.code.driver.page.locator(References.REFERENCES_WIDGET)).toBeVisible();
	}

	async waitForReferencesCountInTitle(count: number): Promise<void> {

		await expect(async () => {
			const text = await this.code.driver.page.locator(References.REFERENCES_TITLE_COUNT).textContent();
			const matches = text ? text.match(/\d+/) : null;
			return matches ? parseInt(matches[0]) === count : false;
		}).toPass({ timeout: 20000 });
	}

	async waitForReferencesCount(count: number): Promise<void> {
		await expect(async () => {
			const references = await this.code.driver.page.locator(References.REFERENCES).all();

			expect(references.length).toBe(count);
		}).toPass({ timeout: 20000 });

	}

	async waitForFile(file: string): Promise<void> {
		const titles = await this.code.driver.page.locator(References.REFERENCES_TITLE_FILE_NAME).all();

		for (const title of titles) {
			const text = await title.textContent();
			expect(text).toContain(file);
		}
	}

	async waitForReferenceFiles(files: string[]): Promise<void> {
		await expect(async () => {
			const fileNames = await this.code.driver.page.locator(References.REFERENCE_FILES).all();

			for (const fileNameLocator of fileNames) {
				const fileName = await fileNameLocator.textContent();
				expect(files).toContain(fileName);
			}
		}).toPass({ timeout: 20000 });
	}

	async close(): Promise<void> {
		// Sometimes someone else eats up the `Escape` key
		let count = 0;
		while (true) {
			await this.code.driver.page.keyboard.press('Escape');

			try {
				expect((await this.code.driver.page.locator(References.REFERENCES_WIDGET).all()).length).toBe(0);
				return;
			} catch (err) {
				if (++count > 5) {
					throw err;
				} else {
					await this.code.wait(1000);
				}
			}
		}
	}
}
