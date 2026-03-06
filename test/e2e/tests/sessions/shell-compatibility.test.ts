/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags, expect } from '../_test.setup';
import * as os from 'os';
import * as fs from 'fs';

test.use({
	suiteId: __filename
});

test.describe('Sessions: Shell Compatibility', {
	tag: [tags.SESSIONS, tags.CONSOLE, tags.CRITICAL]
}, () => {

	test.beforeEach(async function ({ sessions }) {
		await sessions.deleteAll();
	});

	/**
	 * Helper function to check if a shell is installed on the system
	 */
	async function isShellInstalled(shellPath: string): Promise<boolean> {
		return fs.promises.access(shellPath, fs.constants.X_OK)
			.then(() => true)
			.catch(() => false);
	}

	/**
	 * Helper to get shell paths by OS
	 */
	function getShellPaths(): Record<string, string> {
		const platform = os.platform();
		if (platform === 'win32') {
			return {
				'powershell': 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
				'cmd': 'C:\\Windows\\System32\\cmd.exe'
			};
		} else {
			// Unix-like systems (macOS, Linux)
			return {
				'bash': '/bin/bash',
				'zsh': '/bin/zsh',
				'fish': '/usr/local/bin/fish',
				'nushell': '/usr/local/bin/nu'
			};
		}
	}

	test('R session starts successfully with bash shell', {
		tag: [tags.ARK],
		annotation: { type: 'issue', description: 'https://github.com/posit-dev/positron/issues/12156' }
	}, async function ({ app, settings, sessions }) {
		const platform = os.platform();
		if (platform === 'win32') {
			test.skip();
		}

		const shellPath = '/bin/bash';
		if (!await isShellInstalled(shellPath)) {
			test.skip();
		}

		// Set terminal shell to bash
		await settings.set({ 'terminal.integrated.defaultProfile.linux': 'bash' });
		await settings.set({ 'terminal.integrated.defaultProfile.osx': 'bash' });

		// Start R session and verify it starts successfully
		const sessionId = await sessions.startAndSkipMetadata({ language: 'R', waitForReady: true });
		await sessions.expectStatusToBe(sessionId, 'idle', { timeout: 30000 });

		// Execute a simple command to verify the session is functional
		await app.workbench.console.executeCode('R', '1 + 1');
		await app.workbench.console.waitForConsoleContents('2', { expectedCount: 1, timeout: 5000 });
	});

	test('Python session starts successfully with bash shell', {
		annotation: { type: 'issue', description: 'https://github.com/posit-dev/positron/issues/12156' }
	}, async function ({ app, settings, sessions }) {
		const platform = os.platform();
		if (platform === 'win32') {
			test.skip();
		}

		const shellPath = '/bin/bash';
		if (!await isShellInstalled(shellPath)) {
			test.skip();
		}

		// Set terminal shell to bash
		await settings.set({ 'terminal.integrated.defaultProfile.linux': 'bash' });
		await settings.set({ 'terminal.integrated.defaultProfile.osx': 'bash' });

		// Start Python session and verify it starts successfully
		const sessionId = await sessions.startAndSkipMetadata({ language: 'Python', waitForReady: true });
		await sessions.expectStatusToBe(sessionId, 'idle', { timeout: 30000 });

		// Execute a simple command to verify the session is functional
		await app.workbench.console.executeCode('Python', '1 + 1');
		await app.workbench.console.waitForConsoleContents('2', { expectedCount: 1, timeout: 5000 });
	});

	test('R session starts successfully with zsh shell', {
		tag: [tags.ARK],
		annotation: { type: 'issue', description: 'https://github.com/posit-dev/positron/issues/12156' }
	}, async function ({ app, settings, sessions }) {
		const platform = os.platform();
		if (platform === 'win32') {
			test.skip();
		}

		const shellPath = '/bin/zsh';
		if (!await isShellInstalled(shellPath)) {
			test.skip();
		}

		// Set terminal shell to zsh
		await settings.set({ 'terminal.integrated.defaultProfile.linux': 'zsh' });
		await settings.set({ 'terminal.integrated.defaultProfile.osx': 'zsh' });

		// Start R session and verify it starts successfully
		const sessionId = await sessions.startAndSkipMetadata({ language: 'R', waitForReady: true });
		await sessions.expectStatusToBe(sessionId, 'idle', { timeout: 30000 });

		// Execute a simple command to verify the session is functional
		await app.workbench.console.executeCode('R', '1 + 1');
		await app.workbench.console.waitForConsoleContents('2', { expectedCount: 1, timeout: 5000 });
	});

	test('Kallichore supervisor starts without parse errors on nushell', {
		tag: [tags.ARK],
		annotation: { type: 'issue', description: 'https://github.com/posit-dev/positron/issues/12156' }
	}, async function ({ app, settings, sessions, logger }) {
		const platform = os.platform();
		if (platform === 'win32') {
			test.skip();
		}

		const shellPath = '/usr/local/bin/nu';
		if (!await isShellInstalled(shellPath)) {
			test.skip();
		}

		// Set terminal shell to nushell
		await settings.set({ 'terminal.integrated.defaultProfile.linux': 'nushell' });
		await settings.set({ 'terminal.integrated.defaultProfile.osx': 'nushell' });

		// Attempt to start R session
		const sessionId = await sessions.startAndSkipMetadata({ language: 'R', waitForReady: false });

		// Wait for session to become ready or fail
		try {
			await sessions.expectStatusToBe(sessionId, 'idle', { timeout: 30000 });

			// If successful, execute a command to verify functionality
			await app.workbench.console.executeCode('R', '1 + 1');
			await app.workbench.console.waitForConsoleContents('2', { expectedCount: 1, timeout: 5000 });
		} catch (error) {
			// If session fails to start, check logs for nushell parse errors
			await app.workbench.output.openOutputPane('Positron Kernel Supervisor');

			// Select and copy all output
			await app.workbench.output.scrollToTop();
			const isMac = os.platform() === 'darwin';
			const modifier = isMac ? 'Meta' : 'Control';
			await app.workbench.quickaccess.runCommand('editor.action.selectAll');
			const outputText = await app.workbench.output.copySelectedText();

			logger.log('Kallichore supervisor output:', outputText);

			// Check for nushell-specific parse errors (from issue #12156)
			const hasParseError = outputText.includes('parse_mismatch') ||
				outputText.includes('expected operator') ||
				outputText.includes('nu::parser::parse_mismatch');

			// If we see parse errors, this is the bug we're testing for
			if (hasParseError) {
				expect.fail('Nushell shell compatibility issue detected: kallichore command arguments are not properly escaped for nushell syntax. See issue #12156');
			}

			// If the failure is something else, rethrow
			throw error;
		}
	});

	test('Multiple shells can be used sequentially without conflicts', {
		tag: [tags.ARK],
		annotation: { type: 'issue', description: 'https://github.com/posit-dev/positron/issues/12156' }
	}, async function ({ app, settings, sessions }) {
		const platform = os.platform();
		if (platform === 'win32') {
			test.skip();
		}

		// Test with bash first
		await settings.set({ 'terminal.integrated.defaultProfile.osx': 'bash' });
		const session1 = await sessions.startAndSkipMetadata({ language: 'R', waitForReady: true });
		await sessions.expectStatusToBe(session1, 'idle', { timeout: 30000 });
		await app.workbench.console.executeCode('R', 'x <- 1');
		await sessions.deleteAll();

		// Switch to zsh and start another session
		if (await isShellInstalled('/bin/zsh')) {
			await settings.set({ 'terminal.integrated.defaultProfile.osx': 'zsh' });
			const session2 = await sessions.startAndSkipMetadata({ language: 'R', waitForReady: true });
			await sessions.expectStatusToBe(session2, 'idle', { timeout: 30000 });
			await app.workbench.console.executeCode('R', 'y <- 2');
		}
	});
});
