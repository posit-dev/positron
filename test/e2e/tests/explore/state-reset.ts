/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Application } from '../../infra/application';

const RESET_STEP_TIMEOUT = 2000;
const SESSION_RESET_TIMEOUT = 6000;
const STARTUP_MESSAGING_TIMEOUT = 30000;

/**
 * Attempt to resolve a Promise within a timeout.
 * Returns true if the operation completed, false if it timed out or errored.
 */
async function withTimeout(fn: () => Promise<void>, timeout: number): Promise<boolean> {
	try {
		await Promise.race([
			fn(),
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error('reset step timeout')), timeout)
			),
		]);
		return true;
	} catch {
		return false;
	}
}

/**
 * Best-effort state cleanup between retry attempts.
 *
 * Each step has a short timeout and swallows errors -- a failing cleanup step
 * must never block the retry. Returns a list of actions taken (or skipped).
 */
export async function resetState(app: Application): Promise<string[]> {
	const actions: string[] = [];
	const page = app.code.driver.page;

	// 1. Dismiss blocking UI (dialogs, quick input, context menus)
	try {
		for (let i = 0; i < 3; i++) {
			await page.keyboard.press('Escape');
			await page.waitForTimeout(100);
		}
		actions.push('Dismissed overlays (3x Escape)');
	} catch {
		actions.push('Dismiss overlays: skipped');
	}

	// 2. Close all open editors
	const closedEditors = await withTimeout(async () => {
		await app.workbench.quickaccess.runCommand('workbench.action.closeAllEditors');
	}, RESET_STEP_TIMEOUT);
	actions.push(closedEditors ? 'Closed all editors' : 'Close editors: skipped');

	// 3. Clear notifications
	const clearedNotifs = await withTimeout(async () => {
		await app.workbench.quickaccess.runCommand('notifications.clearAll');
	}, RESET_STEP_TIMEOUT);
	actions.push(clearedNotifs ? 'Cleared notifications' : 'Clear notifications: skipped');

	// 4. Delete all sessions (needs longer timeout -- involves UI)
	const deletedSessions = await withTimeout(async () => {
		await app.workbench.sessions.deleteAll();
	}, SESSION_RESET_TIMEOUT);
	actions.push(deletedSessions ? 'Deleted all sessions' : 'Delete sessions: skipped');

	// 5. Ensure bottom panel is visible (console)
	const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
	try {
		await page.keyboard.press(`${modifier}+j`);
		await page.waitForTimeout(200);
		actions.push('Toggled bottom panel');
	} catch {
		actions.push('Toggle panel: skipped');
	}

	// 6. Focus editor area
	const focusedEditor = await withTimeout(async () => {
		await app.workbench.quickaccess.runCommand('workbench.action.focusActiveEditorGroup');
	}, RESET_STEP_TIMEOUT);
	actions.push(focusedEditor ? 'Focused editor area' : 'Focus editor: skipped');

	// 7. Wait for startup messaging to clear (interpreter discovery, etc.)
	const startupCleared = await withTimeout(async () => {
		await app.workbench.sessions.expectNoStartUpMessaging();
	}, STARTUP_MESSAGING_TIMEOUT);
	actions.push(startupCleared ? 'Startup messaging cleared' : 'Startup messaging: skipped (timeout)');

	return actions;
}
