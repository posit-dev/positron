/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Page } from '@playwright/test';
import { Application } from '../../infra';

/**
 * Set the screenshot viewport. Defaults to 1512x945; override via
 * `POSITRON_SCREENSHOT_VIEWPORT="W,H"` or `"W,H,DPR"`.
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

	let width = 1512;
	let height = 945;
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

	// Best-effort OS window resize. setSize (rather than setContentSize)
	// matches the historical config that produced clean 1680x1050 captures
	// on the same runner. If the OS clamps below this, CDP's metrics
	// override below renders the page at the requested size internally
	// and page.screenshot captures the full virtual rendering.
	const CHROME_HEIGHT_PX = 214;
	await electronApp.evaluate(async ({ BrowserWindow }, size) => {
		const win = BrowserWindow.getAllWindows()[0];
		if (win) {
			win.setSize(size.width, size.height);
			win.center();
		}
	}, { width, height: height + CHROME_HEIGHT_PX });

	// CDP viewport override - always succeeds, regardless of OS window clamp.
	const session = await page.context().newCDPSession(page);
	await session.send('Emulation.setDeviceMetricsOverride', {
		width,
		height,
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
 * Suppress the Monaco sash hover/active highlight (the blue strip you
 * sometimes see between the variables and plots panes after a resize
 * drag). The drag releases the mouse but the sash retains its focus/active
 * class until something else clears it; injecting CSS is more deterministic
 * than blurring focus.
 */
export async function hideSashHighlights(page: Page): Promise<void> {
	await page.evaluate(() => {
		const ID = 'release-screenshot-hide-sash-highlights';
		if (document.getElementById(ID)) {
			return;
		}
		const style = document.createElement('style');
		style.id = ID;
		style.textContent = `
			.monaco-sash:hover,
			.monaco-sash.active,
			.monaco-sash:focus,
			.monaco-sash:focus-within { background-color: transparent !important; }
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
 * Rewrite the parenthesized environment suffix Positron renders next to
 * the Python interpreter name (e.g. "Python 3.10.15 (uv: positron)",
 * "Python 3.10.15 (Pyenv)") with a generic "(Venv: .venv)". The labels
 * otherwise surface CI/runner internals — uv project paths, the local
 * Python manager — into docs screenshots.
 */
export async function overrideRuntimeLabel(page: Page): Promise<void> {
	await page.evaluate(() => {
		// Match "Python <version>" followed by " (<anything>)" and rewrite the
		// suffix only. Anchored on "Python" so we don't touch unrelated
		// parenthesized text elsewhere in the workbench.
		const PATTERN = /(Python\s+[\d.]+)\s+\([^)]+\)/g;
		const REPLACEMENT = '$1 (Venv: .venv)';
		const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
		let node: Node | null;
		while ((node = walker.nextNode())) {
			const t = node as Text;
			if (t.nodeValue && t.nodeValue.includes('Python ')) {
				t.nodeValue = t.nodeValue.replace(PATTERN, REPLACEMENT);
			}
		}
	});
}

/**
 * Standard pre-screenshot cleanup. Composes the smaller helpers in the order
 * that produces a clean, deterministic frame:
 *   1. Hide notification toasts (they cover real UI)
 *   2. Hide activity-bar notification badges (e.g. "sign in to GitHub" red dot)
 *   3. Suppress Monaco sash hover/active highlights left over from drags
 *   4. Rewrite runtime labels (e.g. "(uv: positron)") to "(Venv: .venv)"
 *   5. Unhover (no spurious hover states)
 *   6. Wait for layout to settle
 *
 * Call this immediately before `captureFullWindow` / `capturePanel`. Set up
 * world state with POMs first, then call this once, then capture.
 */
export async function prepareForScreenshot(app: Application, page: Page): Promise<void> {
	await hideToasts(app);
	await hideNotificationBadges(page);
	await hideSashHighlights(page);
	await overrideRuntimeLabel(page);
	await unhoverAll(page);
	await waitForStableUI(page);
}
