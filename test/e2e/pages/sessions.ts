/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import test, { expect, Locator, Page } from '@playwright/test';
import { Code, Console, QuickAccess } from '../infra';
import { QuickInput } from './quickInput';

const DESIRED_PYTHON = process.env.POSITRON_PY_VER_SEL;
const DESIRED_R = process.env.POSITRON_R_VER_SEL;


/**
 * Class to manage console sessions
 */
export class Sessions {
	private page: Page;
	private activeStatus: (session: Locator) => Locator;
	private idleStatus: (session: Locator) => Locator;
	private disconnectedStatus: (session: Locator) => Locator;
	sessions: Locator;
	metadataButton: Locator;
	metadataDialog: Locator;
	chooseSessionButton: Locator;
	quickPick: SessionQuickPick;
	allSessionTabs: Locator;
	currentSessionTab: Locator;
	private sessionTabById: (sessionId: string) => Locator;
	private trashButtonById: (sessionId: string) => Locator;
	private trashButtonByName: (sessionName: string) => Locator;
	private startButton: Locator;
	private restartButton: Locator;
	private shutDownButton: Locator;

	constructor(private code: Code, private console: Console, private quickaccess: QuickAccess, private quickinput: QuickInput) {
		this.page = this.code.driver.page;
		this.activeStatus = (session: Locator) => session.locator('.codicon-positron-status-active');
		this.idleStatus = (session: Locator) => session.locator('.codicon-positron-status-idle');
		this.disconnectedStatus = (session: Locator) => session.locator('.codicon-positron-status-disconnected');
		this.sessions = this.page.getByTestId(/console-tab/);
		this.metadataButton = this.page.getByRole('button', { name: 'Console information' });
		this.metadataDialog = this.page.getByRole('dialog');
		this.quickPick = new SessionQuickPick(this.code, this);
		this.chooseSessionButton = this.page.getByRole('button', { name: 'Open Active Session Picker' });
		this.allSessionTabs = this.page.locator('[data-testid^="console-tab-"].tab-button');
		this.currentSessionTab = this.page.locator('[data-testid^="console-tab-"].tab-button--active');
		this.sessionTabById = (sessionId: string) => this.page.getByTestId(`console-tab-${sessionId}`);
		this.trashButtonById = (sessionId: string) => this.sessionTabById(sessionId).getByTestId('trash-session');
		this.trashButtonByName = (sessionName: string) => this.sessionTabByName(sessionName).getByTestId('trash-session');
		this.startButton = this.page.getByLabel('Start console', { exact: true });
		this.restartButton = this.page.getByLabel('Restart console', { exact: true });
		this.shutDownButton = this.page.getByLabel('Shutdown console', { exact: true });
	}

	async validateSessionId(sessionId: string): Promise<boolean> {
		const isValid = /^(python|r)-[a-zA-Z0-9]+$/i.test(sessionId);
		if (!isValid) {
			throw new Error(`Session ID is invalid: ${sessionId}`);
		}
		return isValid;
	}

	async isSessionId(sessionId: string): Promise<boolean> {
		if (!sessionId) {
			throw new Error('Session name/id is required');
		}
		return /^(python|r)-[a-zA-Z0-9]+$/i.test(sessionId);
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
			const sessionTab = await this.getSessionTab(sessionIdOrName);
			await sessionTab.click();
		});
	}

	/**
	 * Action: Delete the session via trash button
	 * @param sessionId the id or name of the session
	 */
	async delete(sessionIdOrName: string): Promise<void> {
		await test.step(`Delete session: ${sessionIdOrName}`, async () => {
			const isSessionId = await this.isSessionId(sessionIdOrName);
			const sessionTab = await this.getSessionTab(sessionIdOrName);

			await sessionTab.click();
			await sessionTab.hover();

			isSessionId
				? await this.trashButtonById(sessionIdOrName).click()
				: await this.trashButtonByName(sessionIdOrName).click();

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
			const sessionTab = await this.getSessionTab(sessionIdOrName);
			await sessionTab.click();

			await this.startButton.click();

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
			const sessionTab = await this.getSessionTab(sessionIdOrName);
			await sessionTab.click();

			if (clearConsole) {
				await this.console.barClearButton.click();
			}

			await this.restartButton.click();

			if (waitForIdle) {
				this.expectStatusToBe(sessionIdOrName, 'idle');
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
			const sessionTab = await this.getSessionTab(sessionIdOrName);
			await sessionTab.click();

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
	async clickMetadataOption(menuItem: 'Show Kernel Output Channel' | 'Show Console Output Channel' | 'Show LSP Output Channel') {
		await this.console.clickConsoleTab();
		await this.metadataButton.click();
		await this.metadataDialog.getByText(menuItem).click();

		await expect(this.page.getByRole('tab', { name: 'Output' })).toHaveClass(/.*checked.*/);
		// Todo: https://github.com/posit-dev/positron/issues/6389
		// Todo: remove when menu closes on click as expected
		await this.page.keyboard.press('Escape');
	}

	// -- Helpers --

	/**
	 * Helper: Get the locator for the session tab based on the session ID or name
	 * @param sessionIdOrName id or name of the session
	 * @returns locator for the session tab
	 */
	private async getSessionTab(sessionIdOrName: string): Promise<Locator> {
		return (await this.isSessionId(sessionIdOrName)
			? this.page.getByTestId(`console-tab-${sessionIdOrName}`)
			: this.allSessionTabs.getByText(sessionIdOrName).locator('..'));
	}

	/**
	 * Helper: Get the locator for the session tab.
	 * @param session Either a session object (language and version) or a string representing the session name.
	 * @returns The locator for the session tab.
	 */
	private sessionTabByName(sessionName: string): Locator {
		if (!sessionName) {
			throw new Error('Session name is required');
		}
		return this.allSessionTabs.getByText(sessionName).locator('..');
	}

	/**
	 * Helper: Launch a session if it doesn't exist, otherwise reuse the existing session if the name matches
	 * @param session the session to reuse / launch
	 * @returns id of the session
	 */
	async reuseSessionIfExists(session: SessionInfo): Promise<string> {
		const sessionLocator = await this.getSessionTab(session.name);
		const sessionExists = await this.sessionTabByName(session.name).isVisible();

		if (sessionExists) {
			await sessionLocator.click();
			const status = await this.getStatusByName(session.name);
			let sessionId = await this.getCurrentSessionId();

			if (status === 'idle') {
				return sessionId;
			} else if (status === 'disconnected') {
				sessionId = await this.start(session.name);
				return sessionId;
			}
		}

		// Create a new session if none exists
		return await this.launch(session);
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

			// wait for the dropdown to contain R, Python, or Choose Session.
			const currentSession = await this.chooseSessionButton.textContent() || '';

			if (currentSession.includes('Python')) {
				await expect(this.page.getByRole('code').getByText('>>>')).toBeVisible({ timeout: 30000 });
				return;
			} else if (currentSession.includes('R') && !currentSession.includes('Choose Session')) {
				await expect(this.page.getByRole('code').getByText('>')).toBeVisible({ timeout: 30000 });
				return;
			} else if (currentSession.includes('Choose Session')) {
				await expect(this.page.getByText('Choose Session')).toBeVisible();
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

		if (await this.allSessionTabs.count() === 0) {
			return []; // No active sessions found
		}

		const sessionIds: string[] = [];

		for (const tab of await this.allSessionTabs.all()) {
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
	 * @param sessionId the session ID to get metadata for
	 * @returns the metadata of the session
	 */
	async getMetadata(sessionId?: string): Promise<SessionMetaData> {
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
	}

	/**
	 * Helper: Get Active Sessions in the Console Session Tab List
	 * Note: Sessions that are disconnected are filtered out
	 */
	async getActiveSessions(): Promise<QuickPickSessionInfo[]> {
		const allSessions = await this.sessions.all();

		const activeSessions = (
			await Promise.all(
				allSessions.map(async session => {
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
	 * @param session Either a session object (language and version) or a string representing the session name.
	 * @returns 'active', 'idle', 'disconnected', or 'unknown'
	 */
	async getStatusByName(sessionName: string): Promise<'active' | 'idle' | 'disconnected' | 'unknown'> {
		const expectedSession = this.sessionTabByName(sessionName);

		if (await this.activeStatus(expectedSession).isVisible()) { return 'active'; }
		if (await this.idleStatus(expectedSession).isVisible()) { return 'idle'; }
		if (await this.disconnectedStatus(expectedSession).isVisible()) { return 'disconnected'; }
		return 'unknown';
	}

	// -- Verifications --

	/**
	 * Verify: Check the status of the session tab
	 * @param sessionIdOrName the id or name of the session
	 * @param expectedStatus the expected status of the session: 'active', 'idle', or 'disconnected'
	 */
	async expectStatusToBe(sessionIdOrName: string, expectedStatus: 'active' | 'idle' | 'disconnected') {
		const isSessionId = await this.isSessionId(sessionIdOrName);

		await test.step(`Verify ${sessionIdOrName} session status: ${expectedStatus}`, async () => {
			const sessionLocator = isSessionId
				? this.sessionTabById(sessionIdOrName)
				: this.sessionTabByName(sessionIdOrName);

			const statusClass = `.codicon-positron-status-${expectedStatus}`;

			await expect(sessionLocator).toBeVisible();
			await expect(sessionLocator.locator(statusClass)).toBeVisible({ timeout: 30000 });
		});
	}

	/**
	 * Verify: Check the metadata of the session dialog
	 * @param session the expected session info to verify
	 */
	async expectMetaDataToBe(session: SessionInfo & { state: 'active' | 'idle' | 'disconnected' | 'exited' }) {
		await test.step(`Verify ${session.language} ${session.version} metadata`, async () => {

			// Click metadata button for desired session
			await this.sessionTabByName(`${session.language} ${session.version}`).click();
			await this.metadataButton.click();

			// Verify metadata
			await expect(this.metadataDialog.getByText(`${session.language} ${session.version}`)).toBeVisible();
			await expect(this.metadataDialog.getByText(new RegExp(`Session ID: ${session.language.toLowerCase()}-[a-zA-Z0-9]+`))).toBeVisible();
			await expect(this.metadataDialog.getByText(`State: ${session.state}`)).toBeVisible();
			await expect(this.metadataDialog.getByText(/^Path: [\/~a-zA-Z0-9.]+/)).toBeVisible();
			await expect(this.metadataDialog.getByText(/^Source: (Pyenv|System|Global)$/)).toBeVisible();
			await this.page.keyboard.press('Escape');

			// Verify Language Console
			await this.clickMetadataOption('Show Console Output Channel');
			await expect(this.page.getByRole('combobox')).toHaveValue(new RegExp(`^${session.language} ${session.version}.*: Console$`));

			// Verify Output Channel
			await this.clickMetadataOption('Show Kernel Output Channel');
			await expect(this.page.getByRole('combobox')).toHaveValue(new RegExp(`^${session.language} ${session.version}.*: Kernel$`));

			// Verify LSP Output Channel
			await this.clickMetadataOption('Show LSP Output Channel');
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
					await expect(this.allSessionTabs).toHaveCount(count);
				}
			}).toPass({ timeout: 5000 });
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
	 * Action: Open the session quickpick menu via the "Choose Session" button in top action bar.
	 */
	async openSessionQuickPickMenu(viewAllRuntimes = true) {
		if (!await this.sessionQuickMenu.isVisible()) {
			await this.sessions.chooseSessionButton.click();
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
