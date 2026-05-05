/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Locator, Page } from '@playwright/test';
import * as path from 'path';

/**
 * Resolve a filename to its absolute output path under
 * `test/e2e/release-screenshots/output/`. Tests pass a bare filename
 * (e.g. 'welcome.png') and never construct paths themselves.
 */
function outputPath(filename: string): string {
	return path.resolve(__dirname, '..', 'output', filename);
}

/**
 * Capture the entire Electron window and write it to the output folder.
 * Used for full-app shots like the Welcome page.
 */
export async function captureFullWindow(page: Page, filename: string): Promise<void> {
	await page.screenshot({
		path: outputPath(filename),
		fullPage: false,
	});
}

/**
 * Capture a single panel/element and write it to the output folder.
 * Used for panel shots like Variables Pane.
 *
 * The locator must resolve to exactly one element. Callers should ensure
 * the panel is visible and stable before calling.
 */
export async function capturePanel(locator: Locator, filename: string): Promise<void> {
	await locator.screenshot({
		path: outputPath(filename),
	});
}
