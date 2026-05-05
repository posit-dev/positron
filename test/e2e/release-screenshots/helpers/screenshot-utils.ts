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

/**
 * Capture a rectangular region of the page and write it to the output folder.
 * Use this when neither a single locator nor the full window fits, e.g.
 * cropping a sidebar plus an open dropdown that lives outside the sidebar's
 * DOM. Coordinates are in CSS pixels in the renderer's viewport.
 */
export async function captureRegion(
	page: Page,
	filename: string,
	clip: { x: number; y: number; width: number; height: number },
): Promise<void> {
	await page.screenshot({
		path: outputPath(filename),
		clip,
	});
}

/**
 * Capture an element at a higher pixel density than the renderer's
 * deviceScaleFactor. Useful for small UI elements (e.g. an action-bar
 * dropdown) where the docs need a crisp image to scale.
 *
 * Uses raw CDP `Page.captureScreenshot` with `clip.scale`, since
 * Playwright's locator.screenshot() doesn't pick up `setDeviceMetricsOverride`
 * DPR changes reliably.
 */
export async function capturePanelHires(
	page: Page,
	locator: Locator,
	filename: string,
	scale: number,
): Promise<void> {
	const box = await locator.boundingBox();
	if (!box) {
		throw new Error(`Could not measure bounding box for ${filename}`);
	}
	const session = await page.context().newCDPSession(page);
	const { data } = await session.send('Page.captureScreenshot', {
		format: 'png',
		clip: {
			x: box.x,
			y: box.y,
			width: box.width,
			height: box.height,
			scale,
		},
	});
	await session.detach();
	const fs = await import('node:fs/promises');
	await fs.writeFile(outputPath(filename), Buffer.from(data, 'base64'));
}
