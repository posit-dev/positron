/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as playwright from '@playwright/test';
import type { Logger } from './logger';

/**
 * Matches the sticky warning raised by `RuntimeStartupService` when a session starts for
 * an interpreter whose architecture differs from the system's:
 *
 *   The interpreter "Python 3.10.10 (System)" has a different architecture (x64) than
 *   your system (arm64). This may cause problems with performance and package compatibility.
 *
 * On the Windows arm64 lane every interpreter is x64-under-emulation (several test
 * dependencies have no win-arm64 wheels, and CRAN ships no arm64 Windows R), so this fires
 * on essentially every session start.
 */
const ARCH_MISMATCH_TEXT = /has a different architecture/;

/**
 * The notification's own dismissal action, labelled "Don't show again for {Language}".
 * Clicking it persists the dismissal in profile-scoped storage, so the warning stays gone
 * for the rest of the worker's profile instead of returning on the next session start.
 */
const DISMISS_BUTTON_LABEL = /Don't show again for/;

const DISMISS_TIMEOUT = 5000;

/**
 * Upper bound on how many of these toasts one handler run will dismiss. There is at most
 * one per language (Python, R), but the loop is bounded so a mis-matching selector can
 * never spin.
 */
const MAX_TOASTS_PER_RUN = 4;

/**
 * Registers a Playwright locator handler that automatically dismisses the interpreter
 * architecture-mismatch warning, and only that warning.
 *
 * Positron deliberately keeps notification toasts visible during e2e runs (upstream VS Code
 * suppresses them under `--enable-smoke-test-driver`; see the Positron block in
 * notificationsToasts.ts), and this particular toast is sticky, so it sits on top of the
 * workbench and can cover the element a test is trying to click. On the Windows arm64 lane
 * that is deterministic rather than flaky.
 *
 * This is intentionally *not* a blanket "close all toasts": any other unexpected notification
 * must still surface and fail the test, since that is how real bugs show up.
 *
 * The handler is self-gating -- the text only ever appears when the interpreter's
 * architecture differs from the system's -- so it is registered on every platform. It
 * dismisses through the product's own "Don't show again" action, so each language's warning
 * is handled at most once per profile.
 *
 * Note that running a locator handler alters page state (focus and mouse position move to
 * the toast's button). That is bounded here to the first mismatched session start per
 * language, and is strictly better than the alternative of the toast covering the workbench
 * for the whole run.
 *
 * @param page the page to install the handler on
 * @param context the page's browser context; windows opened later get the handler too
 * @param logger records each automatic dismissal, so the suppression is never silent
 */
export async function installArchMismatchNotificationHandler(
	page: playwright.Page,
	context: playwright.BrowserContext | undefined,
	logger: Logger
): Promise<void> {
	await addHandler(page, logger);

	// Cover windows opened later in the run (e.g. a second workbench window).
	context?.on('page', newPage => {
		addHandler(newPage, logger).catch(error => {
			logger.log(`Arch mismatch notification: could not install handler on new page (${error})`);
		});
	});
}

async function addHandler(page: playwright.Page, logger: Logger): Promise<void> {
	const notification = page.locator('.notification-toast').filter({ hasText: ARCH_MISMATCH_TEXT });

	// `.first()` because the trigger locator is resolved in strict mode: Python and R can
	// each raise one of these, and two matches would throw a strict-mode violation out of
	// whatever action happened to run the handler check.
	await page.addLocatorHandler(notification.first(), async () => {
		// Dismiss every matching toast that is currently up, not just the one that
		// triggered the handler: Python and R each raise their own, and Playwright
		// requires the locator to be hidden once the handler returns.
		for (let i = 0; i < MAX_TOASTS_PER_RUN; i++) {
			const toast = notification.first();
			if (!(await toast.isVisible())) {
				return;
			}

			try {
				await toast.getByRole('button', { name: DISMISS_BUTTON_LABEL }).click({ timeout: DISMISS_TIMEOUT });
				logger.log('Arch mismatch notification: dismissed via "Don\'t show again"');
			} catch (error) {
				// Leave the toast for Playwright to report against the triggering action
				// rather than retrying blindly here.
				logger.log(`Arch mismatch notification: failed to dismiss (${error})`);
				return;
			}
		}
	});
}
