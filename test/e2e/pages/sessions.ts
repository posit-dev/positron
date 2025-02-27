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
	page: Page;
	activeStatus: (session: Locator) => Locator;
	idleStatus: (session: Locator) => Locator;
	disconnectedStatus: (session: Locator) => Locator;
	sessions: Locator;
	metadataButton: Locator;
	metadataDialog: Locator;
	chooseSessionButton: Locator;
	quickPick: SessionQuickPick;
	allSessionTabs: Locator;
	currentSessionTab: Locator;
	sessionTabById: (sessionId: string) => Locator;
	sessionTrashButton: Locator;
	sessionTrashButtonById: (sessionId: string) => Locator;
	sessionTrashButtonByName: (sessionName: string) => Locator;

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
		this.sessionTrashButton = this.page.getByTestId('trash-session');
		this.sessionTrashButtonById = (sessionId: string) => this.sessionTabById(sessionId).getByTestId('trash-session');
		this.sessionTrashButtonByName = (sessionName: string) => this.sessionTabByName(sessionName).getByTestId('trash-session');
	}

	async validateSessionId(sessionId: string): Promise<boolean> {
		const isValid = /^(python|r)-[a-zA-Z0-9]+$/i.test(sessionId);
		if (!isValid) {
			throw new Error(`Session ID is invalid: ${sessionId}`);
		}
		return isValid;
	}

	async isSessionId(sessionId: string): Promise<boolean> {
		return /^(python|r)-[a-zA-Z0-9]+$/i.test(sessionId);
	}

	// -- Actions --

	/**
	 * Action: Start a session via the session picker button or quickaccess.
	 * @param options - Configuration options for selecting the runtime session.
	 * @param options.language the programming language interpreter to select.
	 * @param options.version the specific version of the interpreter to select (e.g., "3.10.15").
	 * @param options.triggerMode the method used to trigger the selection: session-picker or quickaccess.
	 * @param options.waitForReady whether to wait for the console to be ready after selecting the interpreter.
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
	 * @param session details of the session (language and version)
	 */
	async selectByName(sessionName: string): Promise<void> {
		await test.step(`Select session: ${sessionName}`, async () => {
			await this.sessionTabByName(sessionName).click();
		});
	}


	async selectById(sessionId: string): Promise<void> {
		await this.validateSessionId(sessionId);

		await test.step(`Select session by ID: ${sessionId}`, async () => {
			await this.sessionTabById(sessionId).click();
		});
	}

	/**
	 * Action: Delete the session via trash button
	 * @param sessionId the id of the session
	 */
	async delete(sessionIdOrName: string): Promise<void> {
		const isSessionId = await this.isSessionId(sessionIdOrName);

		await test.step(`Delete session: ${sessionIdOrName}`, async () => {

			if (isSessionId) {
				await this.sessionTabById(sessionIdOrName).click();
				await this.sessionTabById(sessionIdOrName).hover();
				await this.sessionTrashButtonById(sessionIdOrName).click();
			} else {
				await this.sessionTabByName(sessionIdOrName).click();
				await this.sessionTabByName(sessionIdOrName).hover();
				await this.sessionTrashButtonByName(sessionIdOrName).click();
			}

			await expect(this.page.getByText('Shutting down')).not.toBeVisible();
		});
	}

	/**
	 * Action: Start the session
	 * @param session details of the session (language and version)
	 * @param waitForIdle wait for the session to display as "idle" (ready)
	 */
	async startByName(sessionName: string, waitForIdle = true): Promise<string> {
		await test.step(`Start session: ${sessionName}`,
			async () => {

				await this.sessionTabByName(sessionName).click();
				await this.page.getByLabel('Start console', { exact: true }).click();

				if (waitForIdle) {
					await this.checkStatusByName(sessionName, 'idle');
				}
			});

		// bug: this session id isn't updating in dom, but is correct in meta data dialog
		return this.getCurrentSessionId();
		// return (await this.getMetadata()).id;
	}

	/**
	 * Action: Start the session
	 * @param sessionId the id of the session
	 * @param waitForIdle wait for the session to display as "idle" (ready)
	 * @returns the session ID
	 */
	async startById(sessionId: string, waitForIdle = true): Promise<string> {
		await this.validateSessionId(sessionId);

		await test.step(`Start session: ${sessionId}`, async () => {
			await this.sessionTabById(sessionId).click();
			await this.page.getByLabel('Start console', { exact: true }).click();

			if (waitForIdle) {
				await this.checkStatusById(sessionId, 'idle');
			}
		});

		// bug: this session id isn't updating in dom, but is correct in meta data dialog
		return this.getCurrentSessionId();
		// return (await this.getMetadata()).id;
	}

	/**
	 * Action: Restart the session
	 * @param sessionId the id of the session
	 * @param waitForIdle wait for the session to display as "idle" (ready)
	 */
	async restart(session: string, waitForIdle = true, clearConsole = true): Promise<void> {
		const isSessionId = await this.isSessionId(session);

		await test.step(`Restart session:`, async () => {
			await (isSessionId
				? this.sessionTabById(session)
				: this.sessionTabByName(session)
			).click();

			if (clearConsole) {
				await this.console.barClearButton.click();
			}

			await this.page.getByLabel('Restart console', { exact: true }).click();

			if (waitForIdle) {
				isSessionId
					? await this.checkStatusById(session, 'idle')
					: await this.checkStatusByName(session, 'idle');
			}
		});
	}

	/**
	 * Action: Shutdown the session
	 * @param session details of the session (language and version)
	 * @param waitForDisconnected wait for the session to display as disconnected
	 */
	async shutdownByName(sessionName: string, waitForDisconnected = true): Promise<void> {
		await test.step(`Shutdown session: ${sessionName}`, async () => {
			const sessionLocator = this.sessionTabByName(sessionName);
			await sessionLocator.click();
			await this.page.getByLabel('Shutdown console', { exact: true }).click();

			if (waitForDisconnected) {
				await this.checkStatusByName(sessionName, 'disconnected');
			}
		});
	}

	/**
 * Action: Shutdown the session
 * @param sessionId the id of the session
 * @param waitForDisconnected wait for the session to display as disconnected
 */
	async shutdownById(sessionId: string, waitForDisconnected = true): Promise<void> {
		await this.validateSessionId(sessionId);

		await test.step(`Shutdown session: ${sessionId}`, async () => {
			await this.sessionTabById(sessionId).click();
			await this.page.getByLabel('Shutdown console', { exact: true }).click();

			if (waitForDisconnected) {
				await this.checkStatusById(sessionId, 'disconnected');
			}
		});
	}

	/**
	 * Action: Open the metadata dialog and select the desired menu item
	 * @param menuItem the menu item to click on the metadata dialog
	 */
	async clickMetadataMenuItem(menuItem: 'Show Kernel Output Channel' | 'Show Console Output Channel' | 'Show LSP Output Channel') {
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
	 * Helper: Launch a session if it doesn't exist, otherwise reuse the existing session
	 * @param session the session to reuse
	 * @returns id of the session
	 */
	async reuseSessionIfExists(session: SessionName): Promise<string> {
		const sessionLocator = this.sessionTabByName(session.name);
		const sessionExists = await this.sessionTabByName(session.name).isVisible();
		// try by id await this.sessionTab(sessionId).click();
		// try by text

		if (sessionExists) {
			await sessionLocator.click();
			const status = await this.getStatusByName(session.name);
			let sessionId = await this.getCurrentSessionId();
			// let sessionId = (await this.getMetadata()).id;

			if (status === 'idle') {
				return sessionId;
			} else if (status === 'disconnected') {
				sessionId = await this.startByName(session.name);
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




	// /**
	//  * Helper: Get the session ID from the session name
	//  * @param sessionName the session name to get the ID for
	//  * @returns the session ID
	//  */
	// async getSessionId(sessionName: string): Promise<string> {
	// 	const testId = await this.getTestIdFromSessionName(sessionName);
	// 	return testId.match(/-(\S+)$/)?.[1] || '';
	// }

	// /**
	//  * Helper: Get the test ID from the session name
	//  * @param sessionName the session name to get the ID for
	//  * @returns the session ID
	//  */
	// async getTestIdFromSessionName(sessionName: string): Promise<string> {
	// 	const session = this.getSessionLocator(sessionName);
	// 	const testId = await session.getAttribute('data-testid');
	// 	const match = testId?.match(/console-tab-(\S+)/);
	// 	return match ? match[1] : '';
	// }

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
	 * @param session Either a session object (language and version) or a string representing the session name.
	 * @param expectedStatus status to check for ('active', 'idle', 'disconnected')
	 */
	async checkStatusByName(sessionName: string, expectedStatus: 'active' | 'idle' | 'disconnected') {
		await test.step(`Verify ${sessionName} session status: ${expectedStatus}`, async () => {
			const sessionLocator = this.sessionTabByName(sessionName);
			const statusClass = `.codicon-positron-status-${expectedStatus}`;

			await expect(sessionLocator).toBeVisible();
			await expect(sessionLocator.locator(statusClass)).toBeVisible({ timeout: 30000 });
		});
	}

	/**
 * Verify: Check the status of the session tab
 * @param sessionId the session ID to check status for
 * @param expectedStatus status to check for ('active', 'idle', 'disconnected')
 */
	async checkStatusById(sessionId: string, expectedStatus: 'active' | 'idle' | 'disconnected') {
		await this.validateSessionId(sessionId);

		await test.step(`Verify ${sessionId} session status: ${expectedStatus}`, async () => {
			const sessionTabLocator = this.sessionTabById(sessionId);
			const statusClass = `.codicon-positron-status-${expectedStatus}`;

			await expect(sessionTabLocator).toBeVisible();
			await expect(sessionTabLocator.locator(statusClass)).toBeVisible({ timeout: 30000 });
		});
	}


	/**
	 * Verify: Check the metadata of the session dialog
	 * @param data the expected metadata to verify
	 */
	async checkMetadata(data: SessionName & { state: 'active' | 'idle' | 'disconnected' | 'exited' }) {
		await test.step(`Verify ${data.language} ${data.version} metadata`, async () => {

			// Click metadata button for desired session
			await this.sessionTabByName(`${data.language} ${data.version}`).click();
			await this.metadataButton.click();

			// Verify metadata
			await expect(this.metadataDialog.getByText(`${data.language} ${data.version}`)).toBeVisible();
			await expect(this.metadataDialog.getByText(new RegExp(`Session ID: ${data.language.toLowerCase()}-[a-zA-Z0-9]+`))).toBeVisible();
			await expect(this.metadataDialog.getByText(`State: ${data.state}`)).toBeVisible();
			await expect(this.metadataDialog.getByText(/^Path: [\/~a-zA-Z0-9.]+/)).toBeVisible();
			await expect(this.metadataDialog.getByText(/^Source: (Pyenv|System|Global)$/)).toBeVisible();
			await this.page.keyboard.press('Escape');

			// Verify Language Console
			await this.clickMetadataMenuItem('Show Console Output Channel');
			await expect(this.page.getByRole('combobox')).toHaveValue(new RegExp(`^${data.language} ${data.version}.*: Console$`));

			// Verify Output Channel
			await this.clickMetadataMenuItem('Show Kernel Output Channel');
			await expect(this.page.getByRole('combobox')).toHaveValue(new RegExp(`^${data.language} ${data.version}.*: Kernel$`));

			// Verify LSP Output Channel
			await this.clickMetadataMenuItem('Show LSP Output Channel');
			await expect(this.page.getByRole('combobox')).toHaveValue(/Language Server \(Console\)$/);

			// Go back to console when done
			await this.console.clickConsoleTab();
		});
	}

	/**
	 * Verify: the selected runtime is the expected runtime in the Session Picker button
	 * @param version The descriptive string of the runtime to verify.
	 */
	async verifySessionPickerValue(
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
	async getSelectedSessionInfo(): Promise<SessionInfo> {
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


export type SessionName = {
	name: string;
	language: 'Python' | 'R';
	version: string; // e.g. '3.10.15'
	id?: string;
};


export interface SessionInfo extends SessionName {
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
