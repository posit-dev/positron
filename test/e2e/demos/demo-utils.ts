/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import { Locator, Page, test } from '@playwright/test';
import { Application } from '../infra';

const OVERLAY_ID = 'demo-overlay';
const SENTINEL_ID = 'demo-sentinel';
const RING_CLASS = 'demo-click-ring';

/** How long the black start-of-demo sentinel frame is held, in ms. */
const SENTINEL_MS = 300;

/** Where `postprocess-demo-video.ts` looks for videos and manifests. */
const DEMO_VIDEO_DIR = path.resolve(__dirname, '../../../demo-videos');

interface DemoMark {
	caption: string;
	position: 'top' | 'bottom';
	/** Milliseconds since the sentinel cleared, i.e. since the first frame worth keeping. */
	atMs: number;
}

/**
 * Per-test recording timeline. The point of tracking this is that trimming the raw capture then
 * becomes arithmetic: the sentinel marks where the demo starts in the video, and the last mark
 * plus the tail marks where it ends. Without it the only way to find those two timestamps is to
 * read frames out of the finished video, which is by far the slowest step in the workflow.
 */
let startedAtMs: number | null = null;
let lastActivityMs = 0;
let marks: DemoMark[] = [];

/**
 * Screencast mode settings tuned for demo recordings.
 * Spread into `settingsFile.append()` in the test's `beforeApp` fixture.
 */
export const DEMO_SCREENCAST_SETTINGS = {
	'screencastMode.verticalOffset': 10,
	'screencastMode.mouseIndicatorSize': 30,
	'screencastMode.keyboardOverlayTimeout': 1000,
	'screencastMode.keyboardOptions': {
		showKeys: true,
		showKeybindings: true,
		showCommands: false,
		showCommandGroups: false,
		showSingleEditorCursorMoves: false,
	},
};

/**
 * Collapse sidebars and panels to maximize the editor area for recording, then enable screencast
 * mode so keystrokes appear on screen. Call at the start of a demo before any narration.
 *
 * Keep whichever area the demo actually happens in: a Data Connections, Explorer, or SCM demo
 * needs `keepSidebar`, and closing it is a silent way to record a video of the wrong thing.
 */
export async function setupDemoLayout(
	app: Application,
	page: Page,
	options?: {
		keepSidebar?: boolean;
		keepPanel?: boolean;
		keepAuxiliaryBar?: boolean;
		screencast?: boolean;
	}
): Promise<void> {
	const {
		keepSidebar = false,
		keepPanel = false,
		keepAuxiliaryBar = false,
		screencast = true,
	} = options ?? {};

	const runCommand = async (id: string) => {
		await app.workbench.quickaccess.runCommand(id);
	};

	if (!keepSidebar) {
		await runCommand('workbench.action.closeSidebar');
	}
	if (!keepPanel) {
		await runCommand('workbench.action.closePanel');
	}
	if (!keepAuxiliaryBar) {
		await runCommand('workbench.action.closeAuxiliaryBar');
	}

	// Screencast mode renders the keystroke overlay. It does not render anything for Playwright's
	// synthesized mouse events, which is why `humanClick` draws its own ring.
	if (screencast) {
		await runCommand('workbench.action.toggleScreencastMode');
	}

	// Clear startup toasts (interpreter discovery, version warnings) so they stay out of frame.
	await runCommand('notifications.clearAll');

	// Brief settle time for layout to reflow
	await page.waitForTimeout(500);
}

/**
 * Mark the first frame worth keeping. Everything before this point is app startup and command
 * palette chatter -- roughly 40 seconds of a typical capture.
 *
 * Holds a full-screen black frame briefly. `postprocess-demo-video.ts` finds it with ffmpeg's
 * `blackdetect` and trims to the moment it clears, which is why the trim point does not have to
 * be discovered by reading frames afterwards. Called automatically by the first `showOverlay` or
 * `narrate`; call it directly only to start the clock somewhere else.
 */
export async function startDemo(page: Page): Promise<void> {
	await page.evaluate(({ id, ms }) => {
		const el = document.createElement('div');
		el.id = id;
		Object.assign(el.style, {
			position: 'fixed',
			inset: '0',
			background: '#000',
			zIndex: '2147483646',
			pointerEvents: 'none',
		});
		document.body.appendChild(el);
		setTimeout(() => el.remove(), ms);
	}, { id: SENTINEL_ID, ms: SENTINEL_MS });

	await page.waitForTimeout(SENTINEL_MS + 100);
	startedAtMs = Date.now();
	lastActivityMs = 0;
	marks = [];
	writeManifest();
}

/**
 * Run a step that exists only for visual polish, swallowing any failure.
 *
 * A demo recording is expensive (a minute or two of app startup per attempt) and a cosmetic step
 * that throws discards the whole capture. Wrap anything whose failure should cost a nice frame
 * rather than the run: hovering to reveal a toolbar, expanding a notification, widening a pane.
 */
export async function bestEffort(label: string, fn: () => Promise<void>): Promise<boolean> {
	try {
		await fn();
		return true;
	} catch (err) {
		console.log(`[demo] optional step skipped (${label}): ${err}`);
		return false;
	}
}

/**
 * Show a text overlay on the screen describing what is happening.
 * The overlay appears at the bottom of the viewport with a semi-transparent
 * background. Call with empty text to hide it.
 */
export async function showOverlay(
	page: Page,
	text: string,
	options?: { position?: 'top' | 'bottom'; fadeInMs?: number }
): Promise<void> {
	const { position = 'bottom', fadeInMs = 200 } = options ?? {};

	if (startedAtMs === null) {
		await startDemo(page);
	}
	recordMark(text, position);

	await page.evaluate(({ id, text, position, fadeInMs }) => {
		let el = document.getElementById(id);

		if (!text) {
			if (el) {
				el.style.opacity = '0';
				setTimeout(() => el?.remove(), 300);
			}
			return;
		}

		if (!el) {
			el = document.createElement('div');
			el.id = id;
			Object.assign(el.style, {
				position: 'fixed',
				left: '50%',
				transform: 'translateX(-50%)',
				zIndex: '999999',
				padding: '14px 32px',
				borderRadius: '8px',
				background: 'rgba(0, 0, 0, 0.78)',
				color: '#fff',
				fontSize: '22px',
				fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
				fontWeight: '500',
				letterSpacing: '0.2px',
				textAlign: 'center',
				pointerEvents: 'none',
				opacity: '0',
				transition: `opacity ${fadeInMs}ms ease-in-out`,
				maxWidth: '80%',
			});
			document.body.appendChild(el);
		}

		el.style[position === 'top' ? 'top' : 'bottom'] = '24px';
		el.style[position === 'top' ? 'bottom' : 'top'] = 'auto';
		el.textContent = text;

		// Force reflow then fade in
		void el.offsetHeight;
		el.style.opacity = '1';
	}, { id: OVERLAY_ID, text, position, fadeInMs });
}

/**
 * Show overlay text, pause for the viewer to read it, then optionally hide it.
 * Convenience wrapper combining showOverlay + pause.
 */
export async function narrate(
	page: Page,
	text: string,
	holdMs = 2000,
	options?: { position?: 'top' | 'bottom'; hideAfter?: boolean }
): Promise<void> {
	const { position = 'bottom', hideAfter = false } = options ?? {};
	await showOverlay(page, text, { position });
	await page.waitForTimeout(holdMs);
	if (hideAfter) {
		await showOverlay(page, '');
		await page.waitForTimeout(300); // wait for fade out
	}
}

/**
 * Pause to let the viewer absorb what just happened.
 * Use between demo steps for a natural, watchable pace.
 */
export async function pause(page: Page, ms = 1000): Promise<void> {
	await page.waitForTimeout(ms);
	touchActivity();
}

/**
 * Type text with human-like keystroke speed.
 * Default delay of 80ms per character looks natural on video.
 */
export async function humanType(
	page: Page,
	locator: Locator,
	text: string,
	delay = 80
): Promise<void> {
	await locator.pressSequentially(text, { delay });
}

/**
 * Click at human speed with a visible marker at the cursor.
 *
 * Screencast mode's mouse indicator only responds to real OS input, so it draws nothing for
 * Playwright's synthesized events: without the ring the recording shows the UI changing state
 * with no visible cause, which is the single most common complaint about these videos.
 */
export async function humanClick(
	page: Page,
	locator: Locator,
	options?: { beforeMs?: number; holdMs?: number; afterMs?: number; ring?: boolean }
): Promise<void> {
	const { beforeMs = 300, holdMs = 250, afterMs = 500, ring = true } = options ?? {};
	await page.waitForTimeout(beforeMs);
	const box = await locator.boundingBox();
	if (box) {
		const x = box.x + box.width / 2;
		const y = box.y + box.height / 2;
		await page.mouse.move(x, y);
		if (ring) {
			await drawClickRing(page, x, y);
		}
		await page.mouse.down();
		await page.waitForTimeout(holdMs);
		await page.mouse.up();
	} else {
		await locator.click();
	}
	await page.waitForTimeout(afterMs);
	touchActivity();
}

/**
 * Double-click at human speed. Draws two overlapping rings so the video reads as a double-click
 * rather than as a single click that happened to do more.
 */
export async function humanDoubleClick(
	page: Page,
	locator: Locator,
	options?: { beforeMs?: number; afterMs?: number; ring?: boolean }
): Promise<void> {
	const { beforeMs = 350, afterMs = 500, ring = true } = options ?? {};
	await page.waitForTimeout(beforeMs);
	const box = await locator.boundingBox();
	if (box) {
		const x = box.x + box.width / 2;
		const y = box.y + box.height / 2;
		await page.mouse.move(x, y);
		if (ring) {
			await drawClickRing(page, x, y);
			await drawClickRing(page, x, y, 120);
		}
		await page.mouse.dblclick(x, y);
	} else {
		await locator.dblclick();
	}
	await page.waitForTimeout(afterMs);
	touchActivity();
}

/** Pulse a ring at the given viewport coordinates. `delayMs` staggers the second half of a double-click. */
export async function drawClickRing(page: Page, x: number, y: number, delayMs = 0): Promise<void> {
	await page.evaluate(({ x, y, delayMs, cls }) => {
		window.setTimeout(() => {
			const ring = document.createElement('div');
			ring.className = cls;
			Object.assign(ring.style, {
				position: 'fixed',
				left: `${x - 26}px`,
				top: `${y - 26}px`,
				width: '52px',
				height: '52px',
				border: '4px solid #e51400',
				borderRadius: '50%',
				boxShadow: '0 0 0 2px rgba(255, 255, 255, 0.9)',
				zIndex: '2147483647',
				pointerEvents: 'none',
				opacity: '1',
				transition: 'transform 550ms ease-out, opacity 550ms ease-out',
			});
			document.body.appendChild(ring);
			requestAnimationFrame(() => {
				ring.style.transform = 'scale(0.35)';
				ring.style.opacity = '0';
			});
			window.setTimeout(() => ring.remove(), 800);
		}, delayMs);
	}, { x, y, delayMs, cls: RING_CLASS });
}

/**
 * Hover over an element with pauses, useful for showing tooltips
 * or hover states in the demo.
 */
export async function humanHover(
	page: Page,
	locator: Locator,
	options?: { beforeMs?: number; holdMs?: number }
): Promise<void> {
	const { beforeMs = 300, holdMs = 800 } = options ?? {};
	await page.waitForTimeout(beforeMs);
	await locator.hover();
	await page.waitForTimeout(holdMs);
}

/**
 * Smoothly zoom into an area of interest. The zoom is a CSS transform on the
 * workbench container, so text stays sharp and the video recorder captures it
 * natively. Call `zoomReset()` to animate back out.
 */
export async function zoomTo(
	page: Page,
	target: Locator,
	options?: { scale?: number; durationMs?: number }
): Promise<void> {
	const { scale = 2, durationMs = 600 } = options ?? {};
	const box = await target.boundingBox();
	if (!box) {
		return;
	}

	// Center the zoom on the target element
	const centerX = box.x + box.width / 2;
	const centerY = box.y + box.height / 2;

	await page.evaluate(({ centerX, centerY, scale, durationMs }) => {
		const wb = document.querySelector('.monaco-workbench') as HTMLElement;
		if (!wb) {
			return;
		}
		const W = wb.clientWidth;
		const H = wb.clientHeight;

		// Compute the transform-origin that places the target at viewport center
		// after scaling, clamped so we don't show blank space beyond edges.
		const ox = Math.max(0, Math.min(W, (centerX * scale - W / 2) / (scale - 1)));
		const oy = Math.max(0, Math.min(H, (centerY * scale - H / 2) / (scale - 1)));

		wb.style.transition = `transform ${durationMs}ms ease-in-out`;
		wb.style.transformOrigin = `${ox}px ${oy}px`;
		wb.style.transform = `scale(${scale})`;
	}, { centerX, centerY, scale, durationMs });

	// Wait for the animation to finish
	await page.waitForTimeout(durationMs + 50);
}

/**
 * Reset zoom back to normal with a smooth animation.
 */
export async function zoomReset(
	page: Page,
	options?: { durationMs?: number }
): Promise<void> {
	const { durationMs = 600 } = options ?? {};

	await page.evaluate(({ durationMs }) => {
		const wb = document.querySelector('.monaco-workbench') as HTMLElement;
		if (!wb) {
			return;
		}
		wb.style.transition = `transform ${durationMs}ms ease-in-out`;
		wb.style.transform = 'scale(1)';
	}, { durationMs });

	await page.waitForTimeout(durationMs + 50);
}

// --- Recording manifest -------------------------------------------------------------------------

/** Record a caption change, or the clearing of one, against the demo clock. */
function recordMark(caption: string, position: 'top' | 'bottom'): void {
	if (startedAtMs === null) {
		return;
	}
	lastActivityMs = Date.now() - startedAtMs;
	if (caption) {
		marks.push({ caption, position, atMs: lastActivityMs });
	}
	writeManifest();
}

/** Keep the manifest's end time current, so a demo that ends on a long hold is not cut short. */
function touchActivity(): void {
	if (startedAtMs === null) {
		return;
	}
	lastActivityMs = Date.now() - startedAtMs;
	writeManifest();
}

/**
 * Write the manifest next to the video. Rewritten on every mark rather than at the end of the
 * test so a demo that fails partway still leaves a usable one behind.
 */
function writeManifest(): void {
	try {
		fs.mkdirSync(DEMO_VIDEO_DIR, { recursive: true });
		fs.writeFileSync(manifestPath(), JSON.stringify({
			test: safeTestName(),
			sentinelMs: SENTINEL_MS,
			marks,
			endedAtMs: lastActivityMs,
		}, null, '\t') + '\n');
	} catch {
		// A manifest is an optimization for trimming, never a reason to fail a recording.
	}
}

function manifestPath(): string {
	return path.join(DEMO_VIDEO_DIR, `${safeTestName()}.manifest.json`);
}

/** The demo's spec file basename, e.g. `odbc-driver-reload` for `odbc-driver-reload.demo.test.ts`. */
function safeTestName(): string {
	const file = test.info().file;
	return path.basename(file).replace(/\.demo\.test\.ts$/, '').replace(/\.test\.ts$/, '');
}
