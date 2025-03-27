/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import test, { expect, Locator } from '@playwright/test';
import { Code, HotKeys, QuickAccess } from '../infra';
import { QuickInput } from './quickInput';

const DESIRED_PYTHON = process.env.POSITRON_PY_VER_SEL;
const DESIRED_R = process.env.POSITRON_R_VER_SEL;
const ALTERNATE_PYTHON = process.env.POSITRON_PY_ALT_VER_SEL;
const ALTERNATE_R = process.env.POSITRON_R_ALT_VER_SEL;
const HIDDEN_PYTHON = process.env.POSITRON_HIDDEN_PY;
const HIDDEN_R = process.env.POSITRON_HIDDEN_R;
const ACTIVE_STATUS_ICON = '.codicon-positron-status-active';

/**
 * Class to manage console sessions
 */
export class Sessions {
	private page = this.code.driver.page;

	// Session management and UI elements
	private quickPick = new SessionQuickPick(this.code, this);
	sessions = this.page.getByTestId(/console-(?!tab-)[a-zA-Z0-9-]+/);
	sessionTabs = this.page.getByTestId(/console-tab/);
	currentSessionTab = this.sessionTabs.filter({ has: this.page.locator('.tab-button--active') });
	sessionPicker = this.page.locator('[id="workbench.parts.positron-top-action-bar"]').locator('.action-bar-region-right').getByRole('button').first();
	getSessionCount = async () => (await this.sessions.all()).length;

	// Session status indicators
	private activeStatus = (session: Locator) => session.locator(ACTIVE_STATUS_ICON);
	private idleStatus = (session: Locator) => session.locator('.codicon-positron-status-idle');
	private disconnectedStatus = (session: Locator) => session.locator('.codicon-positron-status-disconnected');
	private activeStatusIcon = this.page.locator(ACTIVE_STATUS_ICON);

	// Session console buttons
	restartButton = this.page.getByLabel('Restart console', { exact: true });
	private shutDownButton = this.page.getByLabel('Shutdown console', { exact: true });
	private trashButton = (sessionId: string) => this.getSessionTab(sessionId).getByTestId('trash-session');
	private newSessionButton = this.page.getByRole('toolbar', { name: 'Console actions' }).getByRole('button', { name: 'Start a New Session' });

	// Session Metadata
	private metadataButton = this.page.getByRole('button', { name: 'Console information' });
	private metadataDialog = this.page.getByRole('dialog');
	private consoleInstance = (sessionId: string) => this.page.getByTestId(`console-${sessionId}`);
	private outputChannel = this.page.getByRole('combobox');

	constructor(private code: Code, private quickaccess: QuickAccess, private quickinput: QuickInput, private hotKeys: HotKeys) { }

	// -- Actions --

	/**
	 * Action: Starts one or more sessions
	 *
	 * @param sessions - The session runtime(s) to start: 'python', 'pythonAlt', 'pythonHidden', 'r', 'rAlt'
	 * @param options - Configuration options for session startup
	 * @param options.waitForReady - Whether to wait for sessions to be fully ready before returning (default: true)
	 * @param options.triggerMode - How the session should be triggered: session-picker, quickaccess, hotkey, or console (default: hotkey)
	 * @param options.reuse - Whether to reuse existing idle sessions if available (default: true)
	 *
	 * @example - start a single session
	 * const pythonSession = await sessions.start('python');
	 *
	 * @example - start multiple sessions with custom options
	 * const [pySession1, pySession2, rSession, rSessionAlt] = await sessions.start(['python', 'python', 'r', 'rAlt'], {
	 *   triggerMode: 'quickaccess',
	 *   reuse: false,
	 * });
	 *
	 * @returns returns the SessionInfo for the session(s)
	 */
	async start<T extends SessionRuntimes | SessionRuntimes[]>(
		sessions: T,
		options?: {
			waitForReady?: boolean;
			triggerMode?: SessionTrigger;
			reuse?: boolean;
		}
	): Promise<T extends SessionRuntimes ? SessionInfo : { [K in keyof T]: SessionInfo }> {
		const {
			waitForReady = true,
			triggerMode = 'hotkey',
			reuse = true,
		} = options || {};

		// convert to array for unified processing
		const sessionKeys = (Array.isArray(sessions) ? sessions : [sessions]) as SessionRuntimes[];
		const results: SessionInfo[] = [];

		// process sessions sequentially
		for (const key of sessionKeys) {
			const session = { ...availableRuntimes[key], waitForReady, triggerMode };
			session.id = reuse
				? await this.reuseIdleSessionIfExists(session)
				: await this.launchNew(session);
			results.push(session);
		}

		// return single result or array based on input type
		return (Array.isArray(sessions) ? results : results[0]) as any;
	}

	/**
	 * Action: Delete the session via trash button
	 *
	 * @param sessionId - the id of the session
	 */
	async delete(sessionId: string): Promise<void> {
		await test.step(`Delete session: ${sessionId}`, async () => {
			await this.hotKeys.focusConsole();

			if (await this.getSessionCount() === 1) {
				const currentSessionId = await this.getCurrentSessionId();
				if (currentSessionId === sessionId) {
					await this.page.getByTestId('trash-session').click();
					return;
				} else {
					throw new Error(`Cannot delete session ${sessionId} because it does not exist`);
				}
			} else {
				const sessionTab = this.getSessionTab(sessionId);

				await sessionTab.click();
				await sessionTab.hover();
				await this.trashButton(sessionId).click();
			}

			await expect(this.page.getByText('Shutting down')).not.toBeVisible();
			await expect(this.consoleInstance(sessionId)).not.toBeVisible();
		});
	}

	/**
	 * Action: Restart the session
	 *
	 * @param sessionIdOrName - the id or name of the session
	 * @param options - Configuration options for the restart
	 * @param options.waitForIdle - wait for the session to display as "idle" (ready)
	 * @param options.clearConsole - clear the console before restarting
	 */
	async restart(sessionIdOrName: string, options?: { waitForIdle?: boolean; clearConsole?: boolean }): Promise<void> {
		const { waitForIdle = true, clearConsole = true } = options || {};

		await test.step(`Restart session: ${sessionIdOrName}`, async () => {
			await this.hotKeys.focusConsole();

			if (await this.getSessionCount() > 1) {
				await this.getSessionTab(sessionIdOrName).click();
			}

			if (clearConsole) {
				await this.page.getByLabel('Clear console').click();
			}

			await this.restartButton.click();
			await this.page.mouse.move(0, 0);

			if (waitForIdle) {
				await expect(this.page.getByText('Restarting')).not.toBeVisible({ timeout: 90000 });
				await expect(this.page.locator('.console-instance[style*="z-index: auto"]').getByText('restarted.')).toBeVisible();
				await this.expectStatusToBe(sessionIdOrName, 'idle');
			}
		});
	}

	/**
	 * Action: Shutdown the session
	 *
	 * @param sessionIdOrName - the id or name of the session
	 * @param waitForDisconnected - wait for the session to display as "disconnected"
	 */
	async shutdown(sessionIdOrName: string, waitForDisconnected = true): Promise<void> {
		await test.step(`Shutdown session: ${sessionIdOrName}`, async () => {
			await this.getSessionTab(sessionIdOrName).click();
			await this.shutDownButton.click();

			if (waitForDisconnected) {
				await this.expectStatusToBe(sessionIdOrName, 'disconnected');
			}
		});
	}

	/**
	 * Action: Open the metadata dialog and select the desired menu item
	 *
	 * @param menuItem - the menu item to click on the metadata dialog
	 */
	async selectMetadataOption(menuItem: 'Show Kernel Output Channel' | 'Show Console Output Channel' | 'Show LSP Output Channel') {
		await this.hotKeys.focusConsole();
		await this.metadataButton.click();
		await this.metadataDialog.getByText(menuItem).click();

		await expect(this.page.getByRole('tab', { name: 'Output' })).toHaveClass(/.*checked.*/);
	}

	/**
	 * Action: Delete all disconnected sessions
	 */
	async deleteDisconnectedSessions() {
		await test.step('Delete all disconnected sessions', async () => {
			const sessionIds = await this.getAllSessionIds();
			const disconnectedSessions: string[] = [];

			// Collect all disconnected session IDs
			for (const sessionId of sessionIds) {
				const status = await this.getIconStatus(sessionId);
				if (status === 'disconnected' || status === 'exited') {
					disconnectedSessions.push(sessionId);
				}
			}

			if (disconnectedSessions.length === 0) { return; } // Nothing to delete

			// Delete all but the last one
			for (let i = 0; i < disconnectedSessions.length; i++) {
				await this.delete(disconnectedSessions[i]);
			}
		});
	}

	/**
	 * Action: Delete all sessions
	 */
	async deleteAll() {
		await test.step('Delete all sessions', async () => {
			const sessionIds = await this.getAllSessionIds();

			// Delete all sessions
			for (let i = 0; i < sessionIds.length; i++) {
				await this.delete(sessionIds[i]);
			}

			await expect(this.page.getByText('There is no session running.')).toBeVisible();
		});
	}

	/**
	 * Action: Clear the Console for all active Sessions
	 */
	async clearConsoleAllSessions() {
		await test.step('Clear all sessions', async () => {
			const sessionIds = await this.getAllSessionIds();

			if (sessionIds.length === 1) {
				await this.page.getByRole('button', { name: 'Clear console' }).click();
			} else if (sessionIds.length > 1) {
				for (let i = 0; i < sessionIds.length; i++) {
					await this.select(sessionIds[i]);
					await this.page.getByRole('button', { name: 'Clear console' }).click();
				}

				await this.select(sessionIds[0]);
			}
		});
	}

	/**
	 * Action: Move the session tab list divider to a specific position from the bottom of the window.
	 * Positions the divider `distanceFromBottom` pixels above the bottom of the window.
	 *
	 * @param distanceFromBottom - Number of pixels above the bottom of the window.
	 */
	async setSessionDividerAboveBottom(distanceFromBottom: number = 100) {
		const windowHeight = await this.page.evaluate(() => window.innerHeight);

		const verticalSash = this.page.locator('.split-view-container > div:nth-child(3) > div > div > div > .monaco-sash');
		const box = await verticalSash.boundingBox();

		if (box) {
			const targetY = windowHeight - distanceFromBottom;
			const currentY = box.y + box.height / 2;
			const offsetY = targetY - currentY;

			await this.resizeSessionList({ y: offsetY });
		}
	}

	/**
	 * Action: Resize the session tab list by dragging a sash.
	 * - If `x` is provided, it adjusts width (horizontal sash).
	 * - If `y` is provided, it adjusts height (vertical sash).
	 * - If both `x` and `y` are provided, it adjusts width first, then height.
	 *
	 * @param options - An object with `x` (horizontal offset) and/or `y` (vertical offset).
	 */
	async resizeSessionList(options: { x?: number; y?: number }) {
		const { x, y } = options;

		// Adjust width if x is provided
		if (x !== undefined) {
			const horizontalSash = this.page.locator('.sash');
			const box = await horizontalSash.boundingBox();
			if (box) {
				await this.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
				await this.page.mouse.down();
				await this.page.mouse.move(box.x + box.width / 2 + x, box.y + box.height / 2);
				await this.page.mouse.up();
			}
		}

		// Adjust height if y is provided
		if (y !== undefined) {
			const verticalSash = this.page.locator('.split-view-container > div:nth-child(3) > div > div > div > .monaco-sash');
			const box = await verticalSash.boundingBox();
			if (box) {
				await this.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
				await this.page.mouse.down();
				await this.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + y);
				await this.page.mouse.up();
			}
		}
	}

	/**
	 * Action: Select the session
	 * @param sessionIdOrName - the id or name of the session
	 */
	async select(sessionIdOrName: string, waitForSessionIdle = false): Promise<void> {
		await test.step(`Select session: ${sessionIdOrName}`, async () => {
			await this.hotKeys.focusConsole();
			const sessionTab = this.getSessionTab(sessionIdOrName);

			if (waitForSessionIdle) {
				await expect(this.idleStatus(sessionTab)).toBeVisible();
			}

			// workaround for issue: https://github.com/posit-dev/positron/issues/6997
			await sessionTab.click();
			await this.page.waitForTimeout(1000);
			await sessionTab.click();
		});
	}

	// -- Helpers --

	/**
	 * Helper: Get the locator for the session tab based on the session ID or name
	 *
	 * @param sessionIdOrName - id or name of the session
	 * @returns locator for the session tab
	 */
	private getSessionTab(sessionIdOrName: string): Locator {
		const sessionIdPattern = /^(python|r)-[a-zA-Z0-9]+$/i;

		return sessionIdPattern.test(sessionIdOrName)
			? this.page.getByTestId(`console-tab-${sessionIdOrName}`)
			: this.sessionTabs.getByText(sessionIdOrName).locator('..');
	}

	/**
	 * Helpers: Start a new session via the session picker button, quickaccess, or console session button.
	 *
	 * @param options - Configuration options for selecting the runtime session.
	 * @param options.language - the runtime language to select (e.g., "Python" or "R").
	 * @param options.version - the specific version of runtime to select (e.g., "3.10.15").
	 * @param options.triggerMode - the method used to trigger the selection: session-picker, quickaccess, hotkey, or console.
	 * @param options.waitForReady - whether to wait for the console to be ready after selecting the runtime.
	 */
	private async launchNew(options: {
		language: 'Python' | 'R';
		version?: string;
		triggerMode?: 'session-picker' | 'quickaccess' | 'console' | 'hotkey';
		waitForReady?: boolean;
	}): Promise<string> {

		if (!DESIRED_PYTHON || !DESIRED_R) {
			throw new Error('Please set env vars: POSITRON_PY_VER_SEL, POSITRON_R_VER_SEL');
		}

		if (!ALTERNATE_PYTHON || !ALTERNATE_R) {
			throw new Error('Please set env vars: POSITRON_PY_ALT_VER_SEL, POSITRON_R_ALT_VER_SEL');
		}

		const {
			language,
			version = language === 'Python' ? DESIRED_PYTHON : DESIRED_R,
			waitForReady = true,
			triggerMode = 'hotkey',
		} = options;

		await test.step(`Start session via ${triggerMode}: ${language} ${version}`, async () => {

			// Don't try to start a new runtime if one is currently starting up
			await this.waitForReadyOrNoSessions();

			// Start the runtime via the session picker button, quickaccess or console session button
			if (triggerMode === 'quickaccess') {
				const command = language === 'Python' ? 'python.setInterpreter' : 'r.selectInterpreter';
				await this.quickaccess.runCommand(command, { keepOpen: true });
			} else if (triggerMode === 'session-picker') {
				await this.quickPick.openSessionQuickPickMenu();
			} else if (triggerMode === 'console') {
				await this.hotKeys.focusConsole();
				await this.newSessionButton.click();
			} else {
				await this.page.keyboard.press('Control+Shift+/');
			}

			await this.quickinput.type(`${language} ${version}`);

			// Wait until the desired runtime appears in the list and select it.
			// We need to click instead of using 'enter' because the Python select interpreter command
			// may include additional items above the desired interpreter string.
			await this.quickinput.selectQuickInputElementContaining(`${language} ${version}`);
			await this.quickinput.waitForQuickInputClosed();

			// Move mouse to prevent tooltip hover
			await this.code.driver.page.mouse.move(0, 0);

			if (waitForReady) {
				await expect(this.page.getByText(/starting/)).not.toBeVisible({ timeout: 90000 });
				const sessionId = await this.getCurrentSessionId();
				await this.expectStatusToBe(sessionId, 'idle');
			}
		});

		return this.getCurrentSessionId();
	}

	/**
	 * Helper: Get the interpreter info for the currently selected runtime via the quickpick menu.
	 * @returns The interpreter info for the selected interpreter if found, otherwise undefined.
	 */
	async getSelectedSessionInfo(): Promise<Omit<ExtendedSessionInfo, 'id'>> {
		if (await this.sessionPicker.textContent() === 'Start Session') {
			throw new Error('No session is currently active');
		}

		await this.quickPick.openSessionQuickPickMenu(false);
		const selectedInterpreter = this.code.driver.page.locator('.quick-input-list-entry').filter({ hasText: 'Currently Selected' });

		// Extract the runtime name
		const runtime = await selectedInterpreter.locator('.monaco-icon-label-container .label-name .monaco-highlighted-label').nth(0).textContent();

		// Extract the language, version, and source from runtime name
		const { language, version, source } = await this.quickPick.parseRuntimeName(runtime);

		// Extract the path
		const path = await selectedInterpreter.locator('.quick-input-list-label-meta .monaco-icon-label-container .label-name .monaco-highlighted-label').nth(0).textContent();

		await this.quickPick.closeSessionQuickPickMenu();

		return {
			name: `${language} ${version}`,
			language: language as 'Python' | 'R',
			version,
			source,
			path: path || '',
		};
	}

	/**
	 * Helper: Launch a session if it doesn't exist, otherwise reuse the existing session if the name matches and the state is idle
	 * @param session - the session to reuse / launch
	 * @returns id of the session
	 */
	private async reuseIdleSessionIfExists(session: SessionInfo): Promise<string> {
		return await test.step(`Reuse session: ${session.name}`, async () => {

			await this.hotKeys.focusConsole();
			const metadataButtonIsVisible = await this.metadataButton.isVisible();
			const sessionTab = this.getSessionTab(session.name);
			const sessionTabExists = await sessionTab.isVisible();

			if (sessionTabExists) {
				await sessionTab.click();
				const status = await this.getIconStatus(session.name);

				if (status === 'idle') {
					return await this.getCurrentSessionId();
				}
			} else if (!sessionTabExists && metadataButtonIsVisible) {
				const { name, state } = await this.getMetadata();
				if (name.includes(session.name) && state === 'idle') {
					return await this.getCurrentSessionId();
				}
			}

			// Create a new session if none exists
			return await this.launchNew(session);
		});
	}

	/**
	 * Helper: Wait for runtimes to finish loading
	 */
	async waitForRuntimesToLoad() {
		await expect(this.page.locator('text=/^Starting up|^Starting|^Preparing|^Discovering( \\w+)? interpreters|starting\\.$/i')).toHaveCount(0, { timeout: 90000 });
	}

	/**
	 * Helper: Wait for the console to be ready or no sessions have been started
	 */
	async waitForReadyOrNoSessions() {
		await test.step('Wait for console to be ready or no session', async () => {

			await this.waitForRuntimesToLoad();

			// ensure we are on Console tab
			await this.hotKeys.focusConsole();

			// Move mouse to prevent tooltip hover
			await this.code.driver.page.mouse.move(0, 0);

			// wait for the dropdown to contain R, Python, or Start Session.
			const currentSession = await this.sessionPicker.textContent() || '';

			if (currentSession.includes('Python') || currentSession.includes('R')) {
				const currentSessionId = await this.getCurrentSessionId();
				await expect(this.consoleInstance(currentSessionId).locator('.current-line')).toBeVisible({ timeout: 30000 });
				await expect(this.page.getByText(/starting/)).not.toBeVisible({ timeout: 90000 });
				return;
			} else if (currentSession.includes('Start Session')) {
				await expect(this.page.getByRole('button', { name: 'Start Session', exact: true })).toBeVisible();
				await expect(this.page.getByText(/starting/)).not.toBeVisible({ timeout: 90000 });
				return;
			}

			// If we reach here, the console is not ready.
			throw new Error('Console is not ready after waiting for session to start');
		});
	}

	/**
	 * Helper: Get all session IDs for sessions in the console
	 *
	 * @returns the list of session IDs
	 */
	async getAllSessionIds(): Promise<string[]> {

		const allSessions = await this.sessions.all();

		const sessionIds = await Promise.all(allSessions.map(async session => {
			const testId = await session.getAttribute('data-testid');
			const match = testId?.match(/console-(?!tab-)(\S+)/);
			return match ? match[1] : null;
		}));

		return sessionIds.filter(sessionId => sessionId !== null) as string[];
	}

	/**
	 * Helper: Get the session ID for the currently selected session in tab list
	 *
	 * @returns the session ID or undefined if no session is selected
	 */
	async getCurrentSessionId(): Promise<string> {
		return (await this.getMetadata()).id;
	}

	/**
	 * Helper: Get the metadata of the session
	 *
	 * @param sessionId the session ID to get metadata for, otherwise will use the current session
	 * @returns the metadata of the session
	 */
	async getMetadata(sessionId?: string): Promise<SessionMetaData> {
		return await test.step(`Get metadata for: ${sessionId ?? 'current session'}`, async () => {
			await this.hotKeys.focusConsole();

			if (sessionId && await this.getSessionCount() > 1) {
				await this.page.getByTestId(`console-tab-${sessionId}`).click();
			}
			await this.metadataButton.click();

			// get metadata
			const name = (await this.metadataDialog.getByTestId('session-name').textContent() || '').trim();
			const id = (await this.metadataDialog.getByTestId('session-id').textContent() || '').replace('Session ID: ', '');
			const state = (await this.metadataDialog.getByTestId('session-state').textContent() || '').replace('State: ', '');
			const path = (await this.metadataDialog.getByTestId('session-path').textContent() || '').replace('Path: ', '');
			const source = (await this.metadataDialog.getByTestId('session-source').textContent() || '').replace('Source: ', '');

			// temporary: close metadata dialog
			await this.metadataButton.click({ force: true });

			// Move mouse to prevent tooltip hover
			await this.code.driver.page.mouse.move(0, 0);

			return { name, id, state, path, source };
		});
	}

	/**
	 * Helper: Get Active Sessions in the Console Session Tab List
	 * Note: Sessions that are disconnected are filtered out
	 */
	async getActiveSessions(): Promise<QuickPickSessionInfo[]> {
		const allSessionTabs = await this.sessionTabs.all();
		const metadataButtonExists = await this.metadataButton.isVisible();

		if (allSessionTabs.length === 0) {
			// No active sessions
			if (!metadataButtonExists) { return []; }

			// One session exists but the tab list is hidden
			const { path, name, state } = await this.getMetadata();
			return state === 'disconnected' || state === 'exited' ? [] : [{ path, name }];
		}

		// Multiple sessions are present
		const activeSessions = (
			await Promise.all(
				allSessionTabs.map(async session => {
					const isDisconnected = await session.locator('.codicon-positron-status-disconnected').isVisible();
					if (isDisconnected) { return null; }

					// Extract session ID from data-testid attribute
					const testId = await session.getAttribute('data-testid');
					const match = testId?.match(/console-tab-(\S+)/);
					const sessionId = match ? match[1] : null;

					return sessionId ? { sessionId, session } : null;
				})
			)
		).filter(session => session !== null) as { sessionId: string; session: Locator }[];


		const activeSessionInfo: QuickPickSessionInfo[] = [];

		for (const session of activeSessions) {
			const { name, path } = await this.getMetadata(session.sessionId);

			activeSessionInfo.push({
				name,
				path,
			});
		}
		return activeSessionInfo;
	}

	/**
	 * Helper: Get the icon status of the session tab
	 *
	 * @param sessionIdOrName - A string representing the session name or id.
	 * @returns 'active', 'idle', 'disconnected', or 'unknown'
	 */
	async getIconStatus(sessionIdOrName: string): Promise<'active' | 'idle' | 'disconnected' | 'exited' | 'unknown'> {
		const session = this.getSessionTab(sessionIdOrName);

		if (await this.activeStatus(session).isVisible()) { return 'active'; }
		if (await this.idleStatus(session).isVisible()) { return 'idle'; }
		if (await this.disconnectedStatus(session).isVisible()) { return 'disconnected'; }
		return 'unknown';
	}

	// -- Verifications --

	/**
	 * Verify: Check the status of the session
	 *
	 * @param sessionIdOrName - the id or name of the session
	 * @param expectedStatus - the expected status of the session: 'active', 'idle', or 'disconnected'
	 */
	async expectStatusToBe(sessionIdOrName: string, expectedStatus: 'active' | 'starting' | 'idle' | 'disconnected' | 'exited', options?: { timeout?: number }) {
		const timeout = options?.timeout || 30000;

		await test.step(`Verify ${sessionIdOrName} session status: ${expectedStatus}`, async () => {
			const sessionCount = await this.getSessionCount();

			if (sessionCount > 1) {
				// get status from icon in tab list view
				const sessionTab = this.getSessionTab(sessionIdOrName);
				const statusClass = `.codicon-positron-status-${expectedStatus}`;

				await expect(sessionTab).toBeVisible();
				await expect(sessionTab.locator(statusClass)).toBeVisible({ timeout });
			} else if (sessionCount === 1) {
				// get status from metadata dialog because there is no tab list view
				await expect.poll(
					async () => (await this.getMetadata()).state,
					{
						timeout: 15000,
						intervals: [1000]
					}
				).toBe(expectedStatus);
			} else {
				throw new Error('No sessions found');
			}
		});
	}

	/**
	 * Verify: Check the metadata of the session dialog
	 * @param session - the expected session info to verify
	 */
	async expectMetaDataToBe(session: SessionInfo & { state: 'active' | 'idle' | 'disconnected' | 'exited' }) {
		await test.step(`Verify ${session.language} ${session.version} metadata`, async () => {

			// Click metadata button for desired session
			await this.getSessionTab(session.id).click();
			await this.metadataButton.click();

			// Verify metadata
			await expect(this.metadataDialog.getByText(`${session.language} ${session.version}`)).toBeVisible();
			await expect(this.metadataDialog.getByText(new RegExp(`Session ID: ${session.language.toLowerCase()}-[a-zA-Z0-9]+`))).toBeVisible();
			await expect(this.metadataDialog.getByText(`State: ${session.state}`)).toBeVisible();
			await expect(this.metadataDialog.getByText(/^Path: [\/~a-zA-Z0-9.]+/)).toBeVisible();
			await expect(this.metadataDialog.getByText(/^Source: (Pyenv|System|Global|VirtualEnv|Conda: base)$/)).toBeVisible();
			await this.page.keyboard.press('Escape');

			// Verify Language Console
			const escapedSessionName = new RegExp(session.name.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'));
			await this.selectMetadataOption('Show Console Output Channel');
			await expect(this.outputChannel).toHaveValue(escapedSessionName);
			await expect(this.outputChannel).toHaveValue(/Console$/);

			// Verify Output Channel
			await this.selectMetadataOption('Show Kernel Output Channel');
			await expect(this.outputChannel).toHaveValue(escapedSessionName);
			await expect(this.outputChannel).toHaveValue(/Kernel$/);

			// Verify LSP Output Channel
			await this.selectMetadataOption('Show LSP Output Channel');
			await expect(this.outputChannel).toHaveValue(escapedSessionName);
			await expect(this.outputChannel).toHaveValue(/Language Server \(Console\)$/);

			// Go back to console when done
			await this.hotKeys.focusConsole();
		});
	}

	/**
	 * Verify: the runtime matches the runtime in the Session Picker button
	 *
	 * @param version - The descriptive string of the runtime to verify.
	 */
	async expectSessionPickerToBe(
		options: { language?: 'Python' | 'R'; version?: string } | 'Start Session' = {}
	) {
		if (!DESIRED_PYTHON || !DESIRED_R) {
			throw new Error('Please set env vars: POSITRON_PY_VER_SEL, POSITRON_R_VER_SEL');
		}

		const isStartSession = options === 'Start Session';

		const language = !isStartSession && typeof options === 'object'
			? options.language ?? 'Python'
			: undefined;

		const version = !isStartSession && typeof options === 'object'
			? options.version ?? (language === 'Python' ? DESIRED_PYTHON : DESIRED_R)
			: '';

		await test.step(
			`Verify runtime is selected: ${isStartSession ? 'Start Session' : `${language} ${version}`}`,
			async () => {
				isStartSession
					? await expect(this.sessionPicker).toHaveText('Start Session')
					: await expect(this.sessionPicker).toContainText(`${language} ${version}`);
			}
		);
	}

	/**
	 * Verify: the session count in the console
	 * @param count - the expected number of sessions
	 * @param sessionType - the type of session to count: 'all' or 'active'
	 */
	async expectSessionCountToBe(count: number, sessionType: 'all' | 'active' = 'all') {
		await test.step(`Verify session count: ${count}`, async () => {
			await expect(async () => {
				if (sessionType === 'active') {
					const activeSessionsFromConsole = await this.getActiveSessions();
					expect(activeSessionsFromConsole).toHaveLength(count);
				} else {
					if (count === 0) {
						await expect(this.sessionTabs).not.toBeVisible();
						await expect(this.metadataButton).not.toBeVisible();
					} else if (count === 1) {
						await expect(this.sessionTabs).not.toBeVisible();
						await expect(this.metadataButton).toBeVisible();
					} else {
						await expect(this.sessionTabs).toHaveCount(count);
					}
				}
			}).toPass({ timeout: 45000 });
		});
	}

	/**
	 * Verify: the active sessions match between console and session picker
	 *
	 * @param - count the expected number of active sessions
	 */
	async expectActiveSessionListsToMatch() {
		await test.step('Verify active sessions match between console and session picker', async () => {
			await expect(async () => {
				const activeSessionsFromConsole = await this.getActiveSessions();
				const activeSessionsFromPicker = await this.quickPick.getActiveSessions();

				expect(activeSessionsFromConsole).toStrictEqual(activeSessionsFromPicker);
			}).toPass({ timeout: 10000 });
		});
	}

	/**
	 * Verify: the session list is scrollable
	 *
	 * @param options - Configuration options for the session list
	 * @param options.horizontal - Whether the session list should be horizontally scrollable
	 * @param options.vertical - Whether the session list should be vertically scrollable
	 */
	async expectSessionListToBeScrollable(options: { horizontal?: boolean; vertical?: boolean } = {}) {
		const { horizontal = false, vertical = true } = options;
		const tabsContainer = this.page.locator('.console-tab-list').getByRole('tablist');

		const isHorizontallyScrollable = await tabsContainer.evaluate(el => el.scrollWidth > el.clientWidth);
		const isVerticallyScrollable = await tabsContainer.evaluate(el => el.scrollHeight > el.clientHeight);

		expect(isHorizontallyScrollable).toBe(horizontal);
		expect(isVerticallyScrollable).toBe(vertical);
	}

	/**
	 * Verify: all sessions are idle (not active)
	 */
	async expectAllSessionsToBeIdle() {
		if (await this.getSessionCount() > 1) {
			await expect(this.activeStatusIcon).toHaveCount(0);
		} else {
			await expect(this.page.getByText(/starting/)).not.toBeVisible();
			await this.metadataButton.click();
			await expect(this.page.getByText('State: idle')).toBeVisible({ timeout: 60000 });
			await this.page.keyboard.press('Escape');
		}
	}

	/**
	 * Verify: Start a New Session menu is visible
	 */
	async expectStartNewSessionMenuToBeVisible() {
		await expect(this.quickPick.allSessionsMenu).toBeVisible();
	}

	async expectStatusBarToContain(runtimePath: string): Promise<void> {
		await expect(this.code.driver.page.locator('footer').getByText(runtimePath)).toBeVisible({ timeout: 30000 });
	}
}

/**
 * Helper class to manage the session quick pick
 */
export class SessionQuickPick {
	private sessionQuickMenu = this.code.driver.page.getByText(/(Select a Session)|(Start a New Session)/);
	allSessionsMenu = this.code.driver.page.getByText(/Start a New Session/);

	constructor(private code: Code, private sessions: Sessions) { }

	// -- Actions --

	/**
	 * Action: Open the session quickpick menu via the "Start Session" button in top action bar.
	 */
	async openSessionQuickPickMenu(viewAllRuntimes = true) {
		// something about the 1.97.0 upstream merge impacted the session picker
		// unfortunately we need to retry the session picker until it works
		await expect(async () => {
			if (!await this.sessionQuickMenu.isVisible()) {
				await this.sessions.sessionPicker.click();
			}

			if (viewAllRuntimes) {
				await this.code.driver.page.getByRole('textbox', { name: 'input' }).fill('New Session');
				await this.code.driver.page.keyboard.press('Enter');
				await expect(this.code.driver.page.getByText(/Start a New Session/)).toBeVisible({ timeout: 1000 });
			}
		}).toPass();
	}

	/**
	 * Action: Close the session quickpick menu if it is open.
	 */
	async closeSessionQuickPickMenu() {
		if (await this.sessionQuickMenu.isVisible()) {
			await this.code.driver.page.keyboard.press('Escape');
			await expect(this.sessionQuickMenu).not.toBeVisible();
		}
	}

	// --- Helpers ---

	/**
	 * Helper: Get active sessions from the session picker.
	 * @returns The list of active sessions.
	 */
	async getActiveSessions(): Promise<QuickPickSessionInfo[]> {
		await this.openSessionQuickPickMenu(false);

		// Check if the "All Sessions" menu is visible: ths indicates that
		// there are no active sessions and we were taken to the "All Sessions" menu
		const isAllSessionsMenuVisible = await this.allSessionsMenu.isVisible();
		const allSessions = isAllSessionsMenuVisible
			? []
			: await this.code.driver.page.locator('.quick-input-list-rows').all();

		// Get the text of all sessions
		const activeSessions = await Promise.all(
			allSessions.map(async element => {
				const runtime = (await element.locator('.quick-input-list-row').nth(0).textContent())?.replace('Currently Selected', '');
				const path = await element.locator('.quick-input-list-row').nth(1).textContent();
				return { name: runtime?.trim() || '', path: path?.trim() || '' };
			})
		);

		// Filter out the one with "New Session..."
		const filteredSessions = activeSessions
			.filter(session => !session.name.includes('New Session...'));

		await this.closeSessionQuickPickMenu();
		return filteredSessions;
	}

	// -- Utils --

	/**
	 * Utils: Parse the full runtime name into language, version, and source.
	 *
	 * @param runtimeName - the full runtime name to parse. E.g., "Python 3.10.15 (Pyenv)"
	 * @returns The parsed runtime name. E.g., { language: "Python", version: "3.10.15", source: "Pyenv" }
	 */
	async parseRuntimeName(runtimeName: string | null) {
		if (!runtimeName) {
			throw new Error('No interpreter string provided');
		}

		// Note: Some interpreters may not have a source, so the source is optional
		const match = runtimeName.match(/^(\w+)\s([\d.]+)(?:\s\(([^)]+)\))?$/);
		if (!match) {
			throw new Error(`Invalid interpreter format: ${runtimeName}`);
		}

		return {
			language: match[1],  // e.g., "Python", "R"
			version: match[2],   // e.g., "3.10.15", "4.4.1"
			source: match[3] || undefined    // e.g., "Pyenv", "System"
		};
	}
}

export type QuickPickSessionInfo = {
	name: string;
	path: string;
};

export type SessionTrigger = 'session-picker' | 'quickaccess' | 'console' | 'hotkey';

export type SessionInfo = {
	name: string;
	language: 'Python' | 'R';
	version: string; // e.g. '3.10.15'
	id: string;
	triggerMode?: SessionTrigger;
	waitForReady?: boolean;
};

export interface ExtendedSessionInfo extends SessionInfo {
	path: string;    // e.g. /usr/local/bin/python3
	source?: string; // e.g. Pyenv, Global, System, etc
}

export type SessionMetaData = {
	name: string;
	id: string;
	state: string;
	source: string;
	path: string;
};


// Use this session object to manage default python env in the test
const pythonSession: SessionInfo = {
	name: `Python ${DESIRED_PYTHON}`,
	language: 'Python',
	version: DESIRED_PYTHON || '',
	triggerMode: 'hotkey',
	id: '',
	waitForReady: true
};

// Use this session object to manage alternate python env in the test
const pythonSessionAlt: SessionInfo = {
	name: `Python ${ALTERNATE_PYTHON}`,
	language: 'Python',
	version: ALTERNATE_PYTHON || '',
	triggerMode: 'hotkey',
	id: '',
	waitForReady: true
};

// Use this session object to manage hidden python env in the test
const pythonSessionHidden: SessionInfo = {
	name: `Python ${HIDDEN_PYTHON}`,
	language: 'Python',
	version: HIDDEN_PYTHON || '',
	triggerMode: 'session-picker',
	id: '',
	waitForReady: true
};

// Use this session object to manage default R env in the test
const rSession: SessionInfo = {
	name: `R ${DESIRED_R}`,
	language: 'R',
	version: DESIRED_R || '',
	triggerMode: 'hotkey',
	id: '',
	waitForReady: true
};

// Use this session object to manage alternate R env in the test
const rSessionAlt: SessionInfo = {
	name: `R ${ALTERNATE_R}`,
	language: 'R',
	version: ALTERNATE_R || '',
	triggerMode: 'hotkey',
	id: '',
	waitForReady: true
};

// Use this session object to manage hidden R env in the test
const rSessionHidden: SessionInfo = {
	name: `R ${HIDDEN_R}`,
	language: 'R',
	version: HIDDEN_R || '',
	triggerMode: 'session-picker',
	id: '',
	waitForReady: true
};

type SessionRuntimes = 'python' | 'pythonAlt' | 'pythonHidden' | 'r' | 'rAlt' | 'rHidden';

export const availableRuntimes: { [key: string]: SessionInfo } = {
	r: { ...rSession },
	rAlt: { ...rSessionAlt },
	rHidden: { ...rSessionHidden },
	python: { ...pythonSession },
	pythonAlt: { ...pythonSessionAlt },
	pythonHidden: { ...pythonSessionHidden },
};
