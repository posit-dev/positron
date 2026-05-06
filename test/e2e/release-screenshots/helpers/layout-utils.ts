/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Page } from '@playwright/test';
import { Application } from '../../infra';

/**
 * Set the screenshot viewport.
 *
 * Sets BOTH the OS window's content area (via Electron's setContentSize)
 * AND the CDP layout viewport (via Emulation.setDeviceMetricsOverride) to
 * the same dimensions. They must match: if the CDP layout viewport is
 * larger than the OS window can actually render, the captured PNG ends
 * up with the renderer's actual content on top and white space below.
 *
 * Defaults to 1024x684 (3:2 aspect ratio, matching the docs references on
 * positron.posit.co and fitting the CI macOS runner's content-area cap).
 * Override with POSITRON_SCREENSHOT_VIEWPORT="W,H" or "W,H,DPR" — local
 * runs use the same default as CI so screenshots look identical.
 *
 * If the OS clamps below the requested size, we log a warning so the
 * mismatch is visible in the test report instead of silently producing
 * white space.
 */
export async function setScreenshotWindowSize(
	app: Application,
	opts?: { deviceScaleFactor?: number },
): Promise<void> {
	const electronApp = app.code.electronApp;
	const page = app.code.driver?.currentPage;
	if (!electronApp || !page) {
		return;
	}

	let width = 1365;
	let height = 912;
	let deviceScaleFactor = 1;
	const fromEnv = process.env.POSITRON_SCREENSHOT_VIEWPORT;
	if (fromEnv && /^\d+,\d+(,\d+(\.\d+)?)?$/.test(fromEnv)) {
		const parts = fromEnv.split(',').map(Number);
		width = parts[0];
		height = parts[1];
		if (parts.length >= 3) {
			deviceScaleFactor = parts[2];
		}
	}
	if (opts?.deviceScaleFactor !== undefined) {
		deviceScaleFactor = opts.deviceScaleFactor;
	}

	const actualBounds = await electronApp.evaluate(async ({ BrowserWindow }, size) => {
		const win = BrowserWindow.getAllWindows()[0];
		if (!win) { return null; }
		win.setContentSize(size.width, size.height);
		win.center();
		const b = win.getContentBounds();
		return { width: b.width, height: b.height };
	}, { width, height });

	// Use whatever the OS actually gave us so the CDP override matches the
	// real renderer surface. Without this, a clamped window would produce
	// white space at the bottom of every screenshot.
	const effectiveWidth = actualBounds?.width ?? width;
	const effectiveHeight = actualBounds?.height ?? height;
	if (actualBounds && (actualBounds.height < height || actualBounds.width < width)) {
		console.warn(
			`[setScreenshotWindowSize] OS window content area was clamped to ` +
			`${actualBounds.width}x${actualBounds.height} (requested ${width}x${height}). ` +
			`Capturing at the clamped size to avoid white space.`,
		);
	}

	const session = await page.context().newCDPSession(page);
	await session.send('Emulation.setDeviceMetricsOverride', {
		width: effectiveWidth,
		height: effectiveHeight,
		deviceScaleFactor,
		mobile: false,
	});
}

/**
 * Hide any visible notification toasts. Toasts appear from many normal
 * interactions (interpreter started, file opened, etc.) and would otherwise
 * leak into screenshots.
 */
export async function hideToasts(app: Application): Promise<void> {
	await app.workbench.toasts.closeAll();
}

/**
 * Move the mouse off-screen so no element is in a `:hover` state when
 * the screenshot is taken. Hover overlays (tooltips, action bar buttons,
 * column header cursors) are common screenshot pollutants.
 */
export async function unhoverAll(page: Page): Promise<void> {
	await page.mouse.move(0, 0);
}

/**
 * Hide notification badges (the small red dots / counts) on activity-bar
 * items. These appear for things like "sign in to GitHub" and shouldn't
 * leak into release screenshots regardless of which test is running.
 *
 * Implemented by injecting a stylesheet so the rule sticks even if the
 * workbench re-renders the badge after we hide it.
 */
export async function hideNotificationBadges(page: Page): Promise<void> {
	await page.evaluate(() => {
		const ID = 'release-screenshot-hide-badges';
		if (document.getElementById(ID)) {
			return;
		}
		const style = document.createElement('style');
		style.id = ID;
		style.textContent = `
			.activitybar .badge,
			.activitybar .activity-action.has-badge .badge,
			.part.activitybar .badge { display: none !important; }
		`;
		document.head.appendChild(style);
	});
}

/**
 * Wait for the workbench to be visually stable. A short fixed wait after
 * `requestAnimationFrame` covers most CSS transitions and async layout reflow.
 *
 * If a specific test needs to wait for a specific locator/state, do that with
 * `expect(...).toBeVisible()` before calling this helper.
 */
export async function waitForStableUI(page: Page, ms = 250): Promise<void> {
	await page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => r())));
	await page.waitForTimeout(ms);
}

/**
 * Standard pre-screenshot cleanup. Composes the smaller helpers in the order
 * that produces a clean, deterministic frame:
 *   1. Hide notification toasts (they cover real UI)
 *   2. Hide activity-bar notification badges (e.g. "sign in to GitHub" red dot)
 *   3. Unhover (no spurious hover states)
 *   4. Wait for layout to settle
 *
 * Call this immediately before `captureFullWindow` / `capturePanel`. Set up
 * world state with POMs first, then call this once, then capture.
 */
export async function prepareForScreenshot(app: Application, page: Page): Promise<void> {
	await hideToasts(app);
	await hideNotificationBadges(page);
	await unhoverAll(page);
	await waitForStableUI(page);
}
