/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Page } from '@playwright/test';
import { Application } from '../../infra';

/**
 * Set the renderer viewport for screenshots, decoupled from the OS window.
 *
 * GitHub Actions macOS runners have a virtual display capped around 900px
 * tall, so calling BrowserWindow.setSize(1920, 1294) gets clamped — the
 * captured page area ends up ~684px tall (way wider than the originals on
 * positron.posit.co, which are typically 1920x1080 or 2696x1782 retina).
 *
 * Workaround: use Chrome DevTools Protocol's setDeviceMetricsOverride to
 * force the renderer to lay out and screenshot at an arbitrary size and
 * deviceScaleFactor regardless of the OS window. We still resize the OS
 * window best-effort so any code that reads window size sees something
 * sensible.
 *
 * Reads POSITRON_SCREENSHOT_VIEWPORT="W,H" or "W,H,DPR". Default 1920x1080@1x.
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

	let width = 1920;
	let height = 1080;
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
	// Per-test override wins over env, useful for capturing a small element
	// at higher resolution so the docs can scale it.
	if (opts?.deviceScaleFactor !== undefined) {
		deviceScaleFactor = opts.deviceScaleFactor;
	}

	// Best-effort OS window resize so the chrome (title bar etc.) layout looks
	// right; if the runner's display can't accommodate, macOS clamps and the
	// CDP override below picks up the slack.
	const CHROME_HEIGHT_PX = 214;
	await electronApp.evaluate(async ({ BrowserWindow }, size) => {
		const win = BrowserWindow.getAllWindows()[0];
		if (win) {
			win.setSize(size.width, size.height);
			win.center();
		}
	}, { width, height: height + CHROME_HEIGHT_PX });

	// CDP viewport override — always succeeds, used by page.screenshot.
	const session = await page.context().newCDPSession(page);
	await session.send('Emulation.setDeviceMetricsOverride', {
		width,
		height,
		deviceScaleFactor,
		mobile: false,
	});

	// Force a window resize event so the workbench's layout service
	// recomputes part heights against the new viewport. Without this,
	// the workbench can stay laid out at the OS-clamped height and the
	// captured PNG shows empty white space below the bottom panel.
	await page.evaluate(() => window.dispatchEvent(new Event('resize')));
	await page.waitForTimeout(100);
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
 * Force the workbench to lay out to the renderer's full viewport height.
 *
 * On macOS CI runners the OS window is clamped (~900px tall), and even
 * after CDP `setDeviceMetricsOverride` forces the renderer viewport to
 * 1080, the workbench's layout service can stay laid out at the
 * OS-clamped height. Result: `.monaco-workbench` is shorter than the
 * captured viewport, leaving white space below the rendered parts.
 *
 * Forces explicit pixel heights on html/body/.monaco-workbench and its
 * mounting parent, then dispatches a resize event so the workbench's
 * layout service re-reads parent.clientHeight (now the forced value)
 * and re-lays-out. Polls until `.monaco-workbench` actually hits the
 * target height, or until a short timeout.
 */
export async function forceWorkbenchLayout(page: Page): Promise<void> {
	await page.evaluate(() => {
		const targetH = window.innerHeight;
		const targetW = window.innerWidth;

		// Pin every container in the chain to the renderer viewport so
		// getClientArea(parent) reads the forced size, not the OS window.
		const html = document.documentElement;
		const body = document.body;
		const wb = document.querySelector('.monaco-workbench') as HTMLElement | null;
		const wbParent = wb?.parentElement ?? null;
		for (const el of [html, body, wbParent, wb]) {
			if (!el) { continue; }
			el.style.height = `${targetH}px`;
			el.style.width = `${targetW}px`;
			el.style.minHeight = `${targetH}px`;
			el.style.minWidth = `${targetW}px`;
		}

		return new Promise<void>((resolve, reject) => {
			let attempts = 0;
			const poll = () => {
				const h = wb ? wb.clientHeight : 0;
				if (h >= targetH - 1) {
					resolve();
					return;
				}
				if (attempts >= 30) {
					reject(new Error(
						`forceWorkbenchLayout timed out: workbench height ${h}px ` +
						`did not reach target ${targetH}px after ${attempts} resize attempts. ` +
						`window.innerHeight=${window.innerHeight}, ` +
						`window.innerWidth=${window.innerWidth}, ` +
						`body.clientHeight=${document.body.clientHeight}.`,
					));
					return;
				}
				attempts++;
				window.dispatchEvent(new Event('resize'));
				setTimeout(poll, 100);
			};
			poll();
		});
	});
}

/**
 * Standard pre-screenshot cleanup. Composes the smaller helpers in the order
 * that produces a clean, deterministic frame:
 *   1. Force the workbench to lay out to the full renderer viewport
 *   2. Hide notification toasts (they cover real UI)
 *   3. Hide activity-bar notification badges (e.g. "sign in to GitHub" red dot)
 *   4. Unhover (no spurious hover states)
 *   5. Wait for layout to settle
 *
 * Call this immediately before `captureFullWindow` / `capturePanel`. Set up
 * world state with POMs first, then call this once, then capture.
 */
export async function prepareForScreenshot(app: Application, page: Page): Promise<void> {
	await forceWorkbenchLayout(page);
	await hideToasts(app);
	await hideNotificationBadges(page);
	await unhoverAll(page);
	await waitForStableUI(page);
}
