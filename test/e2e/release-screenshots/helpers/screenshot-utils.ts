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
 *
 * Reads the renderer's reported viewport size and passes it as an explicit
 * clip. Without a clip, page.screenshot captures at the OS window's
 * actual render-surface size — which on CI macOS runners is shorter than
 * the CDP-forced viewport, producing white space. With a clip, CDP forces
 * the renderer to lay out the clip region at the requested size.
 */
export async function captureFullWindow(page: Page, filename: string): Promise<void> {
	const { width, height } = await page.evaluate(() => ({
		width: window.innerWidth,
		height: window.innerHeight,
	}));
	await page.screenshot({
		path: outputPath(filename),
		clip: { x: 0, y: 0, width, height },
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
 * Capture the workbench from the top of the viewport down to the bottom
 * of the status bar. Use this instead of capturePanel(.monaco-workbench)
 * when the OS window may be shorter than the CDP-forced viewport: the
 * status bar's bounding box reflects where the workbench actually ends,
 * so we never include the empty white space between the rendered
 * workbench bottom and the renderer viewport bottom.
 */
export async function captureWorkbenchContent(
	page: Page,
	filename: string,
): Promise<void> {
	const statusbar = page.locator('.part.statusbar');
	const box = await statusbar.boundingBox();
	if (!box) {
		throw new Error('statusbar not found - cannot measure workbench extent');
	}
	const width = await page.evaluate(() => window.innerWidth);
	await page.screenshot({
		path: outputPath(filename),
		clip: {
			x: 0,
			y: 0,
			width,
			height: Math.ceil(box.y + box.height),
		},
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
