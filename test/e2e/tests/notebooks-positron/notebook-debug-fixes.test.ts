/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { tags } from '../_test.setup';
import { test } from './_test.setup.js';
import { expect } from '@playwright/test';

test.use({ suiteId: __filename });

test.describe('Notebook Debug Fixes', {
	tag: [tags.WEB, tags.WIN, tags.DEBUG, tags.POSITRON_NOTEBOOKS],
}, () => {

	// #12845: F5 starts notebook debugging when kernel supports it
	test('F5 starts notebook debugging with active kernel [#12845]', {
		annotation: [
			{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/12845' },
		],
	}, async ({ app, hotKeys }) => {
		const { notebooksPositron, debug } = app.workbench;

		await test.step('Create notebook with Python kernel', async () => {
			await notebooksPositron.createNewNotebook();
			await notebooksPositron.kernel.select('Python');
			await notebooksPositron.addCodeToCell(0, SIMPLE_CODE, { fast: true });
		});

		await test.step('Set breakpoint on line 2', async () => {
			const page = app.code.driver.currentPage;
			await notebooksPositron.editorWidgetAtIndex(0).click();
			const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
			await page.keyboard.press(`${modifier}+Home`);
			await page.keyboard.press('ArrowDown');
			await page.keyboard.press('F9');
			await expect(page.locator('.codicon-debug-breakpoint').first()).toBeVisible();
		});

		await test.step('F5 starts debug session and pauses at breakpoint', async () => {
			const page = app.code.driver.currentPage;
			await page.keyboard.press('F5');
			await debug.expectCurrentLineIndicatorVisible();
			await expect(debug.debugToolbar).toBeVisible();
		});

		await test.step('Cleanup', async () => {
			const page = app.code.driver.currentPage;
			await page.keyboard.press('Shift+F5');
			await expect(debug.debugToolbar).not.toBeVisible({ timeout: 10000 });
			await hotKeys.clearAllBreakpoints();
		});
	});

	// #10226: F5 in notebook never produces "${file}" error or unhandled launch config
	test('F5 in notebook does not produce launch config error [#10226]', {
		annotation: [
			{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/10226' },
		],
	}, async ({ app, hotKeys }) => {
		const { notebooksPositron, debug } = app.workbench;
		const page = app.code.driver.currentPage;

		await test.step('Create notebook and press F5 immediately', async () => {
			await notebooksPositron.createNewNotebook();
			await notebooksPositron.addCodeToCell(0, 'x = 1', { fast: true });
			await page.keyboard.press('F5');
		});

		await test.step('No error notification with file reference', async () => {
			// The bug produced a notification containing "${file}" from an unresolved launch config.
			// Wait briefly to allow any error to surface.
			await page.waitForTimeout(2000);
			const errorNotification = page.locator('.notifications-toasts .notification-toast');
			const count = await errorNotification.count();
			for (let i = 0; i < count; i++) {
				const text = await errorNotification.nth(i).textContent();
				expect(text).not.toContain('${file}');
				expect(text).not.toContain('launch.json');
			}
		});

		await test.step('Cleanup', async () => {
			// If debugging started, stop it
			if (await debug.debugToolbar.isVisible()) {
				await page.keyboard.press('Shift+F5');
				await expect(debug.debugToolbar).not.toBeVisible({ timeout: 10000 });
			}
			await hotKeys.clearAllBreakpoints();
		});
	});

	// #10231: Debug Cell does not show unclear/confusing error dialog
	test('Debug Cell does not produce confusing error [#10231]', {
		annotation: [
			{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/10231' },
		],
	}, async ({ app, hotKeys }) => {
		const { notebooksPositron, debug } = app.workbench;
		const page = app.code.driver.currentPage;

		await test.step('Create notebook and invoke Debug Cell', async () => {
			await notebooksPositron.createNewNotebook();
			await notebooksPositron.addCodeToCell(0, 'x = 1', { fast: true });
			await app.workbench.quickaccess.runCommand('notebook.debugCell');
		});

		await test.step('No error dialog or notification', async () => {
			await page.waitForTimeout(2000);
			// No error modal dialog
			const dialog = page.locator('.monaco-dialog-box .dialog-message');
			if (await dialog.isVisible()) {
				const text = await dialog.textContent();
				expect(text).not.toContain('No active runtime');
				expect(text).not.toContain('unexpected');
			}
			// No error notification toast
			const errorToast = page.locator('.notifications-toasts .notification-toast .severity-icon.codicon-error');
			await expect(errorToast).not.toBeVisible();
		});

		await test.step('Cleanup', async () => {
			if (await debug.debugToolbar.isVisible()) {
				await page.keyboard.press('Shift+F5');
				await expect(debug.debugToolbar).not.toBeVisible({ timeout: 10000 });
			}
			await hotKeys.clearAllBreakpoints();
		});
	});

	// #12845 re-entry: Debug Cell during active session executes without error
	test('Debug Cell during active session executes without error [#12845]', {
		annotation: [
			{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/12845' },
		],
	}, async ({ app, hotKeys }) => {
		const { notebooksPositron, debug } = app.workbench;
		const page = app.code.driver.currentPage;

		await test.step('Create notebook and start debug session', async () => {
			await notebooksPositron.createNewNotebook();
			await notebooksPositron.kernel.select('Python');
			await notebooksPositron.addCodeToCell(0, BREAKPOINT_CODE, { fast: true });

			// Set breakpoint on line 2
			await notebooksPositron.editorWidgetAtIndex(0).click();
			const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
			await page.keyboard.press(`${modifier}+Home`);
			await page.keyboard.press('ArrowDown');
			await page.keyboard.press('F9');
			await expect(page.locator('.codicon-debug-breakpoint').first()).toBeVisible();
		});

		await test.step('Start debugging with F5', async () => {
			await page.keyboard.press('F5');
			await debug.expectCurrentLineIndicatorVisible();
		});

		await test.step('Debug Cell again: no error, session stays active', async () => {
			// This should NOT show "Notebook is already being debugged" error
			await app.workbench.quickaccess.runCommand('notebook.debugCell');

			// Debug toolbar should still be visible (session alive)
			await expect(debug.debugToolbar).toBeVisible();

			// No error notification
			const errorNotification = page.locator('.notification-toast .severity-icon.codicon-error');
			await expect(errorNotification).not.toBeVisible({ timeout: 3000 });
		});

		await test.step('Cleanup', async () => {
			await page.keyboard.press('Shift+F5');
			await expect(debug.debugToolbar).not.toBeVisible({ timeout: 10000 });
			await hotKeys.clearAllBreakpoints();
		});
	});
});

const SIMPLE_CODE = [
	'x = 42',
	'y = x * 2',
	'print(y)',
].join('\n');

const BREAKPOINT_CODE = [
	'a = 10',
	'b = a + 5',
	'print(b)',
].join('\n');
