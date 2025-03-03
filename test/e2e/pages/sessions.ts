/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import test, { expect, Locator, Page } from '@playwright/test';
import { Code, Console, QuickAccess } from '../infra';
import { QuickInput } from './quickInput';

const DESIRED_PYTHON = process.env.POSITRON_PY_VER_SEL;
const DESIRED_R = process.env.POSITRON_R_VER_SEL;
const sessionIdPattern = /^(python|r)-[a-zA-Z0-9]+$/i;

/**
 * Class to manage console sessions
 */
export class Sessions {
	private page: Page;
	private activeStatus: (session: Locator) => Locator;
	private idleStatus: (session: Locator) => Locator;
	private disconnectedStatus: (session: Locator) => Locator;
	private metadataButton: Locator;
	private metadataDialog: Locator;
	startSessionButton: Locator;
	private quickPick: SessionQuickPick;
	private trashButton: (sessionId: string) => Locator;
	private newConsoleButton: Locator;
	restartButton: Locator;
	private shutDownButton: Locator;
	sessionTabs: Locator;
	currentSessionTab: Locator;

	constructor(private code: Code, private console: Console, private quickaccess: QuickAccess, private quickinput: QuickInput) {
		this.page = this.code.driver.page;
		this.activeStatus = (session: Locator) => session.locator('.codicon-positron-status-active');
		this.idleStatus = (session: Locator) => session.locator('.codicon-positron-status-idle');
		this.disconnectedStatus = (session: Locator) => session.locator('.codicon-positron-status-disconnected');
		this.metadataButton = this.page.getByRole('button', { name: 'Console information' });
		this.metadataDialog = this.page.getByRole('dialog');
		this.quickPick = new SessionQuickPick(this.code, this);
		this.startSessionButton = this.page.getByRole('button', { name: 'Open Active Session Picker' });
		this.trashButton = (sessionId: string) => this.getSessionTab(sessionId).getByTestId('trash-session');
		this.newConsoleButton = this.page.getByRole('button', { name: 'New Console', exact: true });
		this.restartButton = this.page.getByLabel('Restart console', { exact: true });
		this.shutDownButton = this.page.getByLabel('Shutdown console', { exact: true });
		this.sessionTabs = this.page.getByTestId(/console-tab/);
		this.currentSessionTab = this.sessionTabs.filter({ has: this.page.locator('.tab-button--active') });
	}


	// -- Actions --

	/**
	 * Action: Start a session via the session picker button or quickaccess.
	 * @param options - Configuration options for selecting the runtime session.
	 * @param options.language the runtime language to select (e.g., "Python" or "R").
	 * @param options.version the specific version of runtime to select (e.g., "3.10.15").
	 * @param options.triggerMode the method used to trigger the selection: session-picker or quickaccess.
	 * @param options.waitForReady whether to wait for the console to be ready after selecting the runtime.
	 */
	async launch(options: {
		language: 'Python' | 'R';
		version?: string;
		triggerMode?: 'session-picker' | 'quickaccess';
		waitForReady?: boolean;
	}): Promise<string> {

		if (!DESIRED_PYTHON || !DESIRED_R) {
			throw new Error('Please set env vars: POSITRON_PY_VER_SEL, POSITRON_R_VER_SEL');
		}

		const {
			language,
			version = language === 'Python' ? DESIRED_PYTHON : DESIRED_R,
			waitForReady = true,
			triggerMode = 'quickaccess',
		} = options;

		await test.step(`Start session via ${triggerMode}: ${language} ${version}`, async () => {

			// Don't try to start a new runtime if one is currently starting up
			await this.waitForReadyOrNoSessions();

			// Start the runtime via the session picker button or quickaccess
			const command = language === 'Python' ? 'python.setInterpreter' : 'r.selectInterpreter';
			triggerMode === 'quickaccess'
				? await this.quickaccess.runCommand(command, { keepOpen: true })
				: await this.quickPick.openSessionQuickPickMenu();

			await this.quickinput.type(`${language} ${version}`);

			// Wait until the desired runtime appears in the list and select it.
			// We need to click instead of using 'enter' because the Python select interpreter command
			// may include additional items above the desired interpreter string.
			await this.quickinput.selectQuickInputElementContaining(`${language} ${version}`);
			await this.quickinput.waitForQuickInputClosed();

			// Move mouse to prevent tooltip hover
			await this.code.driver.page.mouse.move(0, 0);

			if (waitForReady) {
				language === 'Python'
					? await this.console.waitForReadyAndStarted('>>>', 40000)
					: await this.console.waitForReadyAndStarted('>', 40000);
			}
		});

		return this.getCurrentSessionId();
	}

	/**
	 * Action: Select the session
	 * @param sessionIdOrName the id or name of the session
	 */
	async select(sessionIdOrName: string): Promise<void> {
		await test.step(`Select session: ${sessionIdOrName}`, async () => {
			await this.getSessionTab(sessionIdOrName).click();
		});
	}

	/**
	 * Action: Delete the session via trash button
	 * @param sessionIdOrName the id or name of the session
	 */
	async delete(sessionIdOrName: string): Promise<void> {
		await test.step(`Delete session: ${sessionIdOrName}`, async () => {
			const sessionTab = this.getSessionTab(sessionIdOrName);

			await sessionTab.click();
			await sessionTab.hover();
			await this.trashButton(sessionIdOrName).click();

			await expect(this.page.getByText('Shutting down')).not.toBeVisible();
		});
	}

	/**
	 * Action: Start the session
	 * @param sessionIdOrName the id or name of the session
	 * @param waitForIdle wait for the session to display as "idle" (ready)
	 * @returns the session ID
	 */
	async start(sessionIdOrName: string, waitForIdle = true): Promise<string> {
		await test.step(`Start session: ${sessionIdOrName}`, async () => {
			await this.getSessionTab(sessionIdOrName).click();
			await this.newConsoleButton.click();

			if (waitForIdle) {
				await this.expectStatusToBe(sessionIdOrName, 'idle');
			}
		});

		return this.getCurrentSessionId();
	}

	/**
	 * Action: Restart the session
	 * @param sessionIdOrName the id or name of the session
	 * @param waitForIdle wait for the session to display as "idle" (ready)
	 */
	async restart(sessionIdOrName: string, waitForIdle = true, clearConsole = true): Promise<void> {
		await test.step(`Restart session:`, async () => {
			await this.getSessionTab(sessionIdOrName).click();

			if (clearConsole) {
				await this.console.barClearButton.click();
			}

			await this.restartButton.click();

			if (waitForIdle) {
				this.expectStatusToBe(sessionIdOrName, 'idle', { timeout: 60000 });
			}
		});
	}

	/**
	 * Action: Shutdown the session
	 * @param sessionIdOrName the id or name of the session
	 * @param waitForDisconnected wait for the session to display as "disconnected"
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
	 * @param menuItem the menu item to click on the metadata dialog
	 */
	async selectMetadataOption(menuItem: 'Show Kernel Output Channel' | 'Show Console Output Channel' | 'Show LSP Output Channel') {
		await this.console.clickConsoleTab();
		await this.metadataButton.click();
		await this.metadataDialog.getByText(menuItem).click();

		await expect(this.page.getByRole('tab', { name: 'Output' })).toHaveClass(/.*checked.*/);
		// Todo: https://github.com/posit-dev/positron/issues/6389
		// Todo: remove when menu closes on click as expected
		await this.page.keyboard.press('Escape');
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
				const status = await this.getStatus(sessionId);
				if (status === 'disconnected') {
					disconnectedSessions.push(sessionId);
				}
			}

			if (disconnectedSessions.length === 0) { return; } // Nothing to delete

			// Delete all but the last one
			for (let i = 0; i < disconnectedSessions.length - 1; i++) {
				await this.delete(disconnectedSessions[i]);
			}

			// Handle the last one separately because there is no tab list trash icon to click on
			const { state } = await this.getMetadata();
			if (state === 'disconnected' || state === 'exited') {
				await this.console.barTrashButton.click();
			}
		});
	}

	// -- Helpers --

	/**
	 * Helper: Get the locator for the session tab based on the session ID or name
	 * @param sessionIdOrName id or name of the session
	 * @returns locator for the session tab
	 */
	private getSessionTab(sessionIdOrName: string): Locator {
		return sessionIdPattern.test(sessionIdOrName)
			? this.page.getByTestId(`console-tab-${sessionIdOrName}`)
			: this.sessionTabs.getByText(sessionIdOrName).locator('..');
	}

	/**
	 * Helper: Launch a session if it doesn't exist, otherwise reuse the existing session if the name matches
	 * @param session the session to reuse / launch
	 * @returns id of the session
	 */
	async reuseSessionIfExists(session: SessionInfo): Promise<string> {
		return await test.step(`Reuse session: ${session.name}`, async () => {
			const sessionLocator = this.getSessionTab(session.name);
			const sessionExists = await sessionLocator.isVisible();

			if (sessionExists) {
				await sessionLocator.click();
				const status = await this.getStatus(session.name);

				if (status === 'idle') {
					return await this.getCurrentSessionId();
				}
			}

			// Create a new session if none exists
			return await this.launch(session);
		});
	}

	/**
	 * Helper: Wait for runtimes to finish loading
	 */
	async waitForRuntimesToLoad() {
		await expect(this.page.locator('text=/^Starting up|^Starting|^Preparing|^Discovering( \\w+)? interpreters|starting\\.$/i')).toHaveCount(0, { timeout: 80000 });
	}

	/**
	 * Helper: Wait for the console to be ready or no sessions have been started
	 */
	async waitForReadyOrNoSessions() {
		await test.step('Wait for console to be ready or no session', async () => {

			await this.waitForRuntimesToLoad();

			// ensure we are on Console tab
			await this.page.getByRole('tab', { name: 'Console', exact: true }).locator('a').click();

			// Move mouse to prevent tooltip hover
			await this.code.driver.page.mouse.move(0, 0);

			// wait for the dropdown to contain R, Python, or Start Session.
			const currentSession = await this.startSessionButton.textContent() || '';

			if (currentSession.includes('Python')) {
				await expect(this.page.getByRole('code').getByText('>>>')).toBeVisible({ timeout: 30000 });
				return;
			} else if (currentSession.includes('R') && !currentSession.includes('Start Session')) {
				await expect(this.page.getByRole('code').getByText('>')).toBeVisible({ timeout: 30000 });
				return;
			} else if (currentSession.includes('Start Session')) {
				await expect(this.page.getByRole('button', { name: 'Start Session' })).toBeVisible();
				return;
			}

			// If we reach here, the console is not ready.
			throw new Error('Console is not ready after waiting for session to start');
		});
	}

	/**
	 * Helper: Get all session IDs for sessions in the console
	 * @returns the list of session IDs
	 */
	async getAllSessionIds(): Promise<string[]> {

		if (await this.sessionTabs.count() === 0) {
			return []; // No active sessions found
		}

		const sessionIds: string[] = [];

		for (const tab of await this.sessionTabs.all()) {
			await tab.click();
			const { id } = await this.getMetadata();
			sessionIds.push(id);
			// const testId = await tab.getAttribute('data-testid');
			// if (!testId) { continue; }

			// const match = testId.match(/^console-tab-(python|r)-(.+)$/);
			// if (match) {
			// 	sessionIds.push(`${match[1]}-${match[2]}`);
			// }
		}

		return sessionIds;
	}

	/**
	 * Helper: Get the session ID for the currently selected session in tab list
	 * @returns the session ID or undefined if no session is selected
	 */
	async getCurrentSessionId(): Promise<string> {

		// bug: this session id isn't updating in dom, but is correct in meta data dialog
		return (await this.getMetadata()).id;

		// if (await this.currentSessionTab.count() === 0) {
		// 	return ''; // No active session found
		// }

		// const testId = await this.currentSessionTab.getAttribute('data-testid');
		// if (!testId) { return ''; }

		// // Extract the session ID from `data-testid="console-tab-python-<some-id>"` or `console-tab-r-<some-id>`
		// const match = testId.match(/^console-tab-(python|r)-(.+)$/);
		// return match ? `${match[1]}-${match[2]}` : '';
	}

	async getCurrentSessionName(): Promise<string> {
		if (await this.currentSessionTab.count() === 0) {
			return ''; // No active session found
		}

		return await this.currentSessionTab.textContent() || '';
	}

	/**
	 * Helper: Get the metadata of the session
	 * @param sessionId the session ID to get metadata for, otherwise will use the current session
	 * @returns the metadata of the session
	 */
	async getMetadata(sessionId?: string): Promise<SessionMetaData> {
		return await test.step(`Get metadata for session: ${sessionId ?? 'current tab'}`, async () => {
			if (sessionId) {
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
	 * Helper: Get the status of the session tab
	 * @param sessionIdOrName A string representing the session name or id.
	 * @returns 'active', 'idle', 'disconnected', or 'unknown'
	 */
	async getStatus(sessionIdOrName: string): Promise<'active' | 'idle' | 'disconnected' | 'unknown'> {
		const session = this.getSessionTab(sessionIdOrName);

		if (await this.activeStatus(session).isVisible()) { return 'active'; }
		if (await this.idleStatus(session).isVisible()) { return 'idle'; }
		if (await this.disconnectedStatus(session).isVisible()) { return 'disconnected'; }
		return 'unknown';
	}

	// -- Verifications --

	/**
	 * Verify: Check the status of the session tab
	 * @param sessionIdOrName the id or name of the session
	 * @param expectedStatus the expected status of the session: 'active', 'idle', or 'disconnected'
	 */
	async expectStatusToBe(sessionIdOrName: string, expectedStatus: 'active' | 'idle' | 'disconnected', options?: { timeout?: number }) {
		const timeout = options?.timeout || 30000;
		await test.step(`Verify ${sessionIdOrName} session status: ${expectedStatus}`, async () => {
			const sessionLocator = this.getSessionTab(sessionIdOrName);

			const statusClass = `.codicon-positron-status-${expectedStatus}`;

			await expect(sessionLocator).toBeVisible();
			await expect(sessionLocator.locator(statusClass)).toBeVisible({ timeout });
		});
	}

	/**
	 * Verify: Check the metadata of the session dialog
	 * @param session the expected session info to verify
	 */
	async expectMetaDataToBe(session: SessionInfo & { state: 'active' | 'idle' | 'disconnected' | 'exited' }) {
		await test.step(`Verify ${session.language} ${session.version} metadata`, async () => {

			// Click metadata button for desired session
			await this.getSessionTab(session.name).click();
			await this.metadataButton.click();

			// Verify metadata
			await expect(this.metadataDialog.getByText(`${session.language} ${session.version}`)).toBeVisible();
			await expect(this.metadataDialog.getByText(new RegExp(`Session ID: ${session.language.toLowerCase()}-[a-zA-Z0-9]+`))).toBeVisible();
			await expect(this.metadataDialog.getByText(`State: ${session.state}`)).toBeVisible();
			await expect(this.metadataDialog.getByText(/^Path: [\/~a-zA-Z0-9.]+/)).toBeVisible();
			await expect(this.metadataDialog.getByText(/^Source: (Pyenv|System|Global)$/)).toBeVisible();
			await this.page.keyboard.press('Escape');

			// Verify Language Console
			await this.selectMetadataOption('Show Console Output Channel');
			await expect(this.page.getByRole('combobox')).toHaveValue(new RegExp(`^${session.language} ${session.version}.*: Console$`));

			// Verify Output Channel
			await this.selectMetadataOption('Show Kernel Output Channel');
			await expect(this.page.getByRole('combobox')).toHaveValue(new RegExp(`^${session.language} ${session.version}.*: Kernel$`));

			// Verify LSP Output Channel
			await this.selectMetadataOption('Show LSP Output Channel');
			await expect(this.page.getByRole('combobox')).toHaveValue(/Language Server \(Console\)$/);

			// Go back to console when done
			await this.console.clickConsoleTab();
		});
	}

	/**
	 * Verify: the selected runtime matches the runtime in the Session Picker button
	 * @param version The descriptive string of the runtime to verify.
	 */
	async expectSessionPickerToBe(
		options: { language?: 'Python' | 'R'; version?: string } = {}
	) {
		if (!DESIRED_PYTHON || !DESIRED_R) {
			throw new Error('Please set env vars: POSITRON_PY_VER_SEL, POSITRON_R_VER_SEL');
		}

		const {
			language = 'Python',
			version = language === 'Python' ? DESIRED_PYTHON : DESIRED_R,
		} = options;
		await test.step(`Verify runtime is selected: ${language} ${version}`, async () => {
			const runtimeInfo = await this.quickPick.getSelectedSessionInfo();
			expect(runtimeInfo.language).toContain(language);
			expect(runtimeInfo.version).toContain(version);
		});
	}

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
	 * @param count the expected number of active sessions
	 */
	async expectSessionListsToMatch() {
		await test.step('Verify active sessions match between console and session picker', async () => {
			await expect(async () => {
				const activeSessionsFromConsole = await this.getActiveSessions();
				const activeSessionsFromPicker = await this.quickPick.getActiveSessions();

				expect(activeSessionsFromConsole).toStrictEqual(activeSessionsFromPicker);
			}).toPass({ timeout: 10000 });
		});
	}
}

/**
 * Helper class to manage the session quick pick
 */
export class SessionQuickPick {
	private sessionQuickMenu = this.code.driver.page.getByText(/(Select a Session)|(Start a New Session)/);
	private newSessionQuickOption = this.code.driver.page.getByText(/New Session.../);

	constructor(private code: Code, private sessions: Sessions) { }

	// -- Actions --

	/**
	 * Action: Open the session quickpick menu via the "Start Session" button in top action bar.
	 */
	async openSessionQuickPickMenu(viewAllRuntimes = true) {
		if (!await this.sessionQuickMenu.isVisible()) {
			await this.sessions.startSessionButton.click();
		}

		if (viewAllRuntimes) {
			await this.newSessionQuickOption.click();
			await expect(this.code.driver.page.getByText(/Start a New Session/)).toBeVisible();
		} else {
			await expect(this.code.driver.page.getByText(/Select a Session/)).toBeVisible();
		}
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
		const allSessions = await this.code.driver.page.locator('.quick-input-list-rows').all();

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

	/**
	 * Helper: Get the interpreter info for the currently selected runtime via the quickpick menu.
	 * @returns The interpreter info for the selected interpreter if found, otherwise undefined.
	 */
	async getSelectedSessionInfo(): Promise<ExtendedSessionInfo> {
		await this.openSessionQuickPickMenu(false);
		const selectedInterpreter = this.code.driver.page.locator('.quick-input-list-entry').filter({ hasText: 'Currently Selected' });

		// Extract the runtime name
		const runtime = await selectedInterpreter.locator('.monaco-icon-label-container .label-name .monaco-highlighted-label').nth(0).textContent();

		// Extract the language, version, and source from runtime name
		const { language, version, source } = await this.parseRuntimeName(runtime);

		// Extract the path
		const path = await selectedInterpreter.locator('.quick-input-list-label-meta .monaco-icon-label-container .label-name .monaco-highlighted-label').nth(0).textContent();

		await this.closeSessionQuickPickMenu();

		return {
			name: `${language} ${version}`,
			language: language as 'Python' | 'R',
			version,
			source,
			path: path || '',
		};
	}

	// -- Utils --

	/**
	 * Utils: Parse the full runtime name into language, version, and source.
	 * @param runtimeName the full runtime name to parse. E.g., "Python 3.10.15 (Pyenv)"
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


export type SessionInfo = {
	name: string;
	language: 'Python' | 'R';
	version: string; // e.g. '3.10.15'
	id?: string;
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
