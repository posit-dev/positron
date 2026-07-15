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
 * Default capture scale (PNG native pixels per CSS pixel). 2x keeps
 * workbench text crisp when docs scale the image at fixed width.
 */
const DEFAULT_SCALE = 2;

async function writePng(filename: string, base64: string): Promise<void> {
	const fs = await import('node:fs/promises');
	const out = outputPath(filename);
	await fs.mkdir(path.dirname(out), { recursive: true });
	await fs.writeFile(out, Buffer.from(base64, 'base64'));
}

async function cdpCapture(
	page: Page,
	clip: { x: number; y: number; width: number; height: number; scale: number },
	filename: string,
): Promise<void> {
	const session = await page.context().newCDPSession(page);
	const { data } = await session.send('Page.captureScreenshot', { format: 'png', clip });
	await session.detach();
	await writePng(filename, data);
}

/**
 * Capture the entire Electron window and write it to the output folder.
 * Used for full-app shots like the Welcome page. The capture is wrapped in
 * a rounded-corner drop shadow halo to mimic a floating macOS window — pass
 * `{ shadow: false }` to skip when a raw capture is needed.
 *
 * Reads the renderer's reported viewport size and passes it as an explicit
 * clip through CDP at the requested scale (defaults to 2x). Playwright's
 * page.screenshot() with clip captures CSS pixels and doesn't reliably
 * honor deviceScaleFactor, so we go through raw CDP.
 *
 * The clip height is clamped to the bottom of the workbench status bar
 * rather than `window.innerHeight`. When the CDP viewport override is taller
 * than the (OS-clamped) window the workbench actually laid out in, the region
 * below the status bar renders as empty white space; the status bar's
 * bounding box reflects where the workbench truly ends, so clamping to it
 * trims that gap. For a correctly-sized window this is a no-op.
 */
export async function captureFullWindow(
	page: Page,
	filename: string,
	opts?: { scale?: number; shadow?: boolean },
): Promise<void> {
	const width = await page.evaluate(() => window.innerWidth);
	const innerHeight = await page.evaluate(() => window.innerHeight);
	const statusbarBox = await page.locator('.part.statusbar').boundingBox();
	const height = statusbarBox
		? Math.min(innerHeight, Math.ceil(statusbarBox.y + statusbarBox.height))
		: innerHeight;
	await cdpCapture(page, { x: 0, y: 0, width, height, scale: opts?.scale ?? DEFAULT_SCALE }, filename);
	if (opts?.shadow !== false) {
		await applyDropShadow(filename);
	}
}

/**
 * Capture a single panel/element and write it to the output folder.
 * Used for panel shots like Variables Pane.
 *
 * The locator must resolve to exactly one element. Callers should ensure
 * the panel is visible and stable before calling.
 */
export async function capturePanel(
	page: Page,
	locator: Locator,
	filename: string,
	opts?: { scale?: number },
): Promise<void> {
	const box = await locator.boundingBox();
	if (!box) {
		throw new Error(`Could not measure bounding box for ${filename}`);
	}
	await cdpCapture(page, { ...box, scale: opts?.scale ?? DEFAULT_SCALE }, filename);
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
	opts?: { scale?: number },
): Promise<void> {
	await cdpCapture(page, { ...clip, scale: opts?.scale ?? DEFAULT_SCALE }, filename);
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
	opts?: { scale?: number },
): Promise<void> {
	const statusbar = page.locator('.part.statusbar');
	const box = await statusbar.boundingBox();
	if (!box) {
		throw new Error('statusbar not found - cannot measure workbench extent');
	}
	const width = await page.evaluate(() => window.innerWidth);
	await cdpCapture(
		page,
		{ x: 0, y: 0, width, height: Math.ceil(box.y + box.height), scale: opts?.scale ?? DEFAULT_SCALE },
		filename,
	);
}

/**
 * Deprecated alias for `capturePanel`. Kept temporarily for callers that
 * passed an explicit scale; new code should use `capturePanel({ scale })`.
 */
export async function capturePanelHires(
	page: Page,
	locator: Locator,
	filename: string,
	scale: number,
): Promise<void> {
	await capturePanel(page, locator, filename, { scale });
}

/**
 * Composite a captured PNG onto a slightly larger white canvas, round the
 * corners, and paint a soft drop shadow behind it. Approximates the
 * floating-window look of the legacy macOS-chrome screenshots that this
 * repo's CDP captures cannot reproduce directly. Mutates the file in place.
 * Radius and padding are in source pixels (i.e. the captured PNG is at 2x by
 * default, so radius=24 ≈ 12 CSS px).
 */
export async function applyDropShadow(
	filename: string,
	opts?: { padding?: number; blur?: number; opacity?: number; radius?: number },
): Promise<void> {
	const { createCanvas, loadImage } = await import('canvas');
	const fs = await import('node:fs/promises');
	const file = outputPath(filename);
	const img = await loadImage(file);
	const padding = opts?.padding ?? 60;
	const blur = opts?.blur ?? 40;
	const opacity = opts?.opacity ?? 0.25;
	const radius = opts?.radius ?? 24;

	// Clip the source image to a rounded rect on a transparent canvas so the
	// shadow that follows traces the rounded silhouette, not the rectangle.
	const clipped = createCanvas(img.width, img.height);
	const clipCtx = clipped.getContext('2d');
	clipCtx.beginPath();
	clipCtx.roundRect(0, 0, img.width, img.height, radius);
	clipCtx.closePath();
	clipCtx.clip();
	clipCtx.drawImage(img, 0, 0);

	const W = img.width + padding * 2;
	const H = img.height + padding * 2;
	const canvas = createCanvas(W, H);
	const ctx = canvas.getContext('2d');
	ctx.fillStyle = '#ffffff';
	ctx.fillRect(0, 0, W, H);
	ctx.shadowColor = `rgba(0,0,0,${opacity})`;
	ctx.shadowBlur = blur;
	ctx.shadowOffsetX = 0;
	ctx.shadowOffsetY = Math.round(blur / 3);
	ctx.drawImage(clipped, padding, padding);

	await fs.writeFile(file, canvas.toBuffer('image/png'));
}
