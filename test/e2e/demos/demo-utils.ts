/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Locator, Page } from '@playwright/test';
import { Application } from '../infra';

const OVERLAY_ID = 'demo-overlay';

/**
 * Collapse sidebars and panels to maximize the editor area for recording.
 * Call at the start of a demo before any narration.
 */
export async function setupDemoLayout(app: Application, page: Page): Promise<void> {
	const runCommand = async (id: string) => {
		await app.workbench.quickaccess.runCommand(id);
	};

	// Close left sidebar, bottom panel, and right auxiliary bar
	await runCommand('workbench.action.closeSidebar');
	await runCommand('workbench.action.closePanel');
	await runCommand('workbench.action.closeAuxiliaryBar');

	// Brief settle time for layout to reflow
	await page.waitForTimeout(500);
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
				padding: '10px 24px',
				borderRadius: '8px',
				background: 'rgba(0, 0, 0, 0.78)',
				color: '#fff',
				fontSize: '16px',
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
 * Click with brief pauses before and after, making the action
 * visible and trackable in the video.
 */
export async function humanClick(
	page: Page,
	locator: Locator,
	options?: { beforeMs?: number; afterMs?: number }
): Promise<void> {
	const { beforeMs = 300, afterMs = 500 } = options ?? {};
	await page.waitForTimeout(beforeMs);
	await locator.click();
	await page.waitForTimeout(afterMs);
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
