/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Page } from '@playwright/test';
import { Application } from '../../infra';

/**
 * Resize the Electron BrowserWindow to a consistent size for screenshots.
 *
 * Reads POSITRON_WINDOW_SIZE=W,H if set, else defaults to 1600x1000 — large
 * enough that sidebar + editor + secondary sidebar render at marketing
 * proportions instead of Positron's cramped ~800x600 default.
 *
 * Resizing post-launch (via BrowserWindow.setSize) rather than at launch:
 * Chromium's --window-size flag doesn't propagate through VS Code/Positron's
 * own BrowserWindow construction.
 */
export async function setScreenshotWindowSize(app: Application): Promise<void> {
	const electronApp = app.code.electronApp;
	if (!electronApp) {
		return;
	}

	let width = 1600;
	let height = 1000;
	const fromEnv = process.env.POSITRON_WINDOW_SIZE;
	if (fromEnv && /^\d+,\d+$/.test(fromEnv)) {
		[width, height] = fromEnv.split(',').map(Number);
	}

	await electronApp.evaluate(async ({ BrowserWindow }, size) => {
		const win = BrowserWindow.getAllWindows()[0];
		if (win) {
			win.setSize(size.width, size.height);
			win.center();
		}
	}, { width, height });
}

/**
 * Hide any visible notification toasts. Toasts appear from many normal
 * interactions (interpreter started, file opened, etc.) and would otherwise
 * leak into screenshots.
 *
 * Uses the Toasts POM directly rather than the command palette: the
 * `notifications.hideToasts` command works, but routing it through
 * `quickaccess.runCommand` opens the command palette, which restores
 * focus to the primary sidebar on close.
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
 *   2. Unhover (no spurious hover states)
 *   3. Wait for layout to settle
 *
 * Call this immediately before `captureFullWindow` / `capturePanel`. Set up
 * world state with POMs first, then call this once, then capture.
 */
export async function prepareForScreenshot(app: Application, page: Page): Promise<void> {
	await hideToasts(app);
	await unhoverAll(page);
	await waitForStableUI(page);
}
