/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, Page } from '@playwright/test';
import { Application } from '../../infra';

interface ViewportDims {
	width: number;
	height: number;
	deviceScaleFactor: number;
}

function resolveViewport(opts?: { width?: number; height?: number; deviceScaleFactor?: number }): ViewportDims {
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
	if (opts?.width !== undefined) {
		width = opts.width;
	}
	if (opts?.height !== undefined) {
		height = opts.height;
	}
	if (opts?.deviceScaleFactor !== undefined) {
		deviceScaleFactor = opts.deviceScaleFactor;
	}
	return { width, height, deviceScaleFactor };
}

/**
 * Set the screenshot viewport. Defaults to 1512x945; override via
 * `POSITRON_SCREENSHOT_VIEWPORT="W,H"` or `"W,H,DPR"`, or per-test via
 * the `width` / `height` opts (highest precedence).
 *
 * Resizes the OS window AND applies a CDP viewport override. Call this
 * once per test (typically in beforeEach). If you need to re-establish
 * the renderer's viewport after a window reopen (e.g. post-openFolder),
 * use `reapplyCdpViewport` instead — calling setSize again on a freshly
 * reopened window has been observed to destabilize worker teardown.
 */
export async function setScreenshotWindowSize(
	app: Application,
	opts?: { width?: number; height?: number; deviceScaleFactor?: number },
): Promise<void> {
	const electronApp = app.code.electronApp;
	const page = app.code.driver?.currentPage;
	if (!electronApp || !page) {
		return;
	}

	const { width, height, deviceScaleFactor } = resolveViewport(opts);

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

	await applyCdpOverride(page, { width, height, deviceScaleFactor });
}

/**
 * Re-apply just the CDP viewport override on the current page. Use this
 * after operations that reopen the Electron window (e.g. `openFolder`)
 * to restore the renderer-side viewport without calling `setSize` again.
 */
export async function reapplyCdpViewport(
	app: Application,
	opts?: { width?: number; height?: number; deviceScaleFactor?: number },
): Promise<void> {
	const page = app.code.driver?.currentPage;
	if (!page) {
		return;
	}
	await applyCdpOverride(page, resolveViewport(opts));
}

async function applyCdpOverride(page: Page, dims: ViewportDims): Promise<void> {
	const session = await page.context().newCDPSession(page);
	await session.send('Emulation.setDeviceMetricsOverride', {
		width: dims.width,
		height: dims.height,
		deviceScaleFactor: dims.deviceScaleFactor,
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
 * Hide the data-grid cursor border (the blue outline around the focused cell).
 * Injected as a stylesheet so the rule persists across re-renders.
 */
export async function hideDataGridCursor(page: Page): Promise<void> {
	await page.addStyleTag({
		content: '.cursor-border { display: none !important; } .selection-overlay { display: none !important; }',
	});
	await page.waitForTimeout(50);
}

/**
 * Hide the text-insertion caret in any focused input. The blinking cursor
 * causes pixel differences between runs and is not meaningful in a screenshot.
 */
export async function hideCaret(page: Page): Promise<void> {
	await page.evaluate(() => {
		const ID = 'release-screenshot-hide-caret';
		if (document.getElementById(ID)) {
			return;
		}
		const style = document.createElement('style');
		style.id = ID;
		style.textContent = '* { caret-color: transparent !important; }';
		document.head.appendChild(style);
	});
}

/**
 * Hide notification badges (the small red dots / counts) on activity-bar
 * items, panel tabs (e.g. "Problems 2"), etc. These leak into release
 * screenshots from things like "sign in to GitHub", Python lint warnings,
 * or terminal output.
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
			.badge,
			.monaco-count-badge { display: none !important; }
		`;
		document.head.appendChild(style);
	});
}

/**
 * Wait for the workbench to be visually stable. Waits for any in-flight
 * Monaco progress bars (the thin blue strip pane re-renders show at the
 * top of their content area) to clear, then a short fixed wait after
 * `requestAnimationFrame` to cover CSS transitions and async layout reflow.
 *
 * If a specific test needs to wait for a specific locator/state, do that with
 * `expect(...).toBeVisible()` before calling this helper.
 */
export async function waitForStableUI(page: Page, ms = 250): Promise<void> {
	await expect(
		page.locator('.positron-plots-container .monaco-progress-container.active')
	).toHaveCount(0, { timeout: 15000 });
	await page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => r())));
	await page.waitForTimeout(ms);
}

/**
 * Rewrite the Python interpreter label Positron renders in chips and
 * session names (e.g. "Python 3.10.15 (uv: positron)", "Python 3.10.15
 * (Pyenv)") so docs screenshots show a clean, current display version.
 * Two normalizations in one pass:
 *   - Version: pinned to `displayVersion` (default '3.13') so screenshots
 *     keep showing the latest major.minor regardless of which interpreter
 *     CI actually launched. This is a DOM-only override; CI continues to
 *     run whichever Python has the test deps installed.
 *   - Suffix: collapsed to a generic "(Venv: .venv)" so CI/runner internals
 *     (uv project paths, Pyenv, system labels) don't leak into docs.
 *
 * Scoped to the workbench surfaces that render the runtime label:
 *   - `.top-action-bar-session-picker-face`     (top-right interpreter face)
 *   - `.plot-session-name`                       (plots pane header)
 *   - `.tab-header .session-name`                (console session tab)
 *   - `.positron-notebook-kernel-status-badge`   (Positron notebook kernel chip)
 *   - `a.kernel-label`                           (VS Code Jupyter notebook kernel chip)
 *
 * Call this AFTER `waitForStableUI` so any in-flight re-renders don't undo
 * the rewrite before the screenshot fires.
 */
export async function overrideRuntimeLabel(page: Page, displayVersion: string = '3.13.5'): Promise<void> {
	await page.evaluate(({ displayVersion }) => {
		const SELECTORS = [
			'.top-action-bar-session-picker-face',
			'.plot-session-name',
			'.tab-header .session-name',
			'.positron-notebook-kernel-status-badge',
			'a.kernel-label',
		];
		const PATTERN = /Python\s+[\d.]+\s+\([^)]+\)/g;
		const REPLACEMENT = `Python ${displayVersion} (Venv: .venv)`;
		for (const sel of SELECTORS) {
			for (const root of document.querySelectorAll(sel)) {
				const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
				let node: Node | null;
				while ((node = walker.nextNode())) {
					const t = node as Text;
					if (t.nodeValue && t.nodeValue.includes('Python ')) {
						t.nodeValue = t.nodeValue.replace(PATTERN, REPLACEMENT);
					}
				}
			}
		}
	}, { displayVersion });
}

/**
 * Rewrite the workspace folder name shown in the title bar and the top
 * action bar's folder picker. The default test workspace renders as
 * "test-files"; docs screenshots use a friendlier folder name like
 * "positron-demos-notebooks". Replaces only the matching token so other
 * title-bar text (e.g. "Untitled-1.ipynb — ") is preserved.
 *
 * Call this AFTER `waitForStableUI` so any in-flight re-renders don't undo
 * the rewrite before the screenshot fires.
 */
export async function overrideWorkspaceName(
	page: Page,
	from: string,
	to: string,
): Promise<void> {
	await page.evaluate(({ from, to }) => {
		const SELECTORS = [
			'.titlebar .window-title',
			'#top-action-bar-current-working-folder',
		];
		for (const sel of SELECTORS) {
			for (const root of document.querySelectorAll(sel)) {
				const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
				let node: Node | null;
				while ((node = walker.nextNode())) {
					const t = node as Text;
					if (t.nodeValue && t.nodeValue.includes(from)) {
						t.nodeValue = t.nodeValue.split(from).join(to);
					}
				}
			}
		}
		// The console's current-working-directory label renders the full
		// filesystem path (e.g. /private/var/folders/.../test-files).
		// Rewrite to the friendly tilde form (~/my-project) so the docs
		// screenshot doesn't leak the temp workspace path.
		for (const label of document.querySelectorAll('.current-working-directory-label .label')) {
			if (label.textContent && label.textContent.includes(from)) {
				label.textContent = `~/${to}`;
			}
		}
	}, { from, to });
}

/**
 * Hide the debug launch-configuration status bar item. Starting a Python
 * session activates the Python Debugger extension, which registers a
 * "Python Debugger: Current File …" picker in the status bar. It's not
 * meaningful in a release screenshot and should not be visible.
 */
export async function hideDebugStatusBar(page: Page): Promise<void> {
	const items = page.locator('.statusbar-item').filter({ hasText: 'Python Debugger' });
	const count = await items.count();
	for (let i = 0; i < count; i++) {
		await items.nth(i).evaluate((el: HTMLElement) => { el.style.display = 'none'; });
	}
}

/**
 * Standard pre-screenshot cleanup. Composes the smaller helpers in the order
 * that produces a clean, deterministic frame:
 *   1. Hide notification toasts (they cover real UI)
 *   2. Hide activity-bar notification badges (e.g. "sign in to GitHub" red dot)
 *   3. Hide text-insertion caret (blinking cursor causes pixel noise)
 *   4. Hide debug launch-config status bar item (activated by Python sessions)
 *   5. Unhover (no spurious hover states)
 *   6. Wait for layout to settle (and any in-flight progress bars to clear)
 *   7. Rewrite runtime labels (e.g. "(uv: positron)") to "(Venv: .venv)"
 *
 * The label rewrite goes last so React re-renders during the settle wait
 * don't undo it before the screenshot fires.
 *
 * Call this immediately before `captureFullWindow` / `capturePanel`. Set up
 * world state with POMs first, then call this once, then capture.
 */
export async function prepareForScreenshot(app: Application, page: Page): Promise<void> {
	await hideToasts(app);
	await hideNotificationBadges(page);
	await hideCaret(page);
	await hideDebugStatusBar(page);
	await unhoverAll(page);
	await waitForStableUI(page);
	await overrideRuntimeLabel(page);
}
