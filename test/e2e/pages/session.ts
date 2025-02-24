/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import test, { expect, Locator, Page } from '@playwright/test';
import { Code, Console, QuickPickSessionInfo } from '../infra';


/**
 * Class to manage console sessions
 */
export class Session {
	page: Page;
	activeStatus: (session: Locator) => Locator;
	idleStatus: (session: Locator) => Locator;
	disconnectedStatus: (session: Locator) => Locator;
	sessions: Locator;
	metadataButton: Locator;
	metadataDialog: Locator;

	constructor(private code: Code, private console: Console) {
		this.page = this.code.driver.page;
		this.activeStatus = (session: Locator) => session.locator('.codicon-positron-status-active');
		this.idleStatus = (session: Locator) => session.locator('.codicon-positron-status-idle');
		this.disconnectedStatus = (session: Locator) => session.locator('.codicon-positron-status-disconnected');
		this.sessions = this.page.getByTestId(/console-tab/);
		this.metadataButton = this.page.getByRole('button', { name: 'Console information' });
		this.metadataDialog = this.page.getByRole('dialog');
	}

	// -- Actions --

	/**
	 * Action: Select the session
	 * @param session details of the session (language and version)
	 */
	async select(session: SessionName): Promise<void> {
		await test.step(`Select session: ${session.language} ${session.version}`, async () => {
			const sessionLocator = this.getSessionLocator(session);
			await sessionLocator.click();
		});
	}

	/**
	 * Action: Start the session
	 * @param session details of the session (language and version)
	 * @param waitForIdle wait for the session to display as "idle" (ready)
	 */
	async start(session: SessionName, waitForIdle = true): Promise<void> {
		await test.step(`Start session: ${session.language} ${session.version}`, async () => {
			const sessionLocator = this.getSessionLocator(session);
			await sessionLocator.click();
			await this.page.getByLabel('Start console', { exact: true }).click();

			if (waitForIdle) {
				await this.checkStatus(session, 'idle');
			}
		});
	}

	/**
	 * Action: Restart the session
	 * @param session details of the session (language and version)
	 * @param waitForIdle wait for the session to display as "idle" (ready)
	 */
	async restart(session: SessionName, waitForIdle = true): Promise<void> {
		await test.step(`Restart session: ${session.language} ${session.version}`, async () => {
			const sessionLocator = this.getSessionLocator(session);
			await sessionLocator.click();
			await this.page.getByLabel('Restart console', { exact: true }).click();

			if (waitForIdle) {
				await this.checkStatus(session, 'idle');
			}
		});
	}

	/**
	 * Action: Shutdown the session
	 * @param session details of the session (language and version)
	 * @param waitForDisconnected wait for the session to display as disconnected
	 */
	async shutdown(session: SessionName, waitForDisconnected = true): Promise<void> {
		await test.step(`Shutdown session: ${session.language} ${session.version}`, async () => {
			const sessionLocator = this.getSessionLocator(session);
			await sessionLocator.click();
			await this.page.getByLabel('Shutdown console', { exact: true }).click();

			if (waitForDisconnected) {
				await this.checkStatus(session, 'disconnected');
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

		await expect(this.page.getByRole('tab', { name: 'Output' })).toHaveClass('action-item checked');
		// Todo: https://github.com/posit-dev/positron/issues/6389
		// Todo: remove when menu closes on click as expected
		await this.page.keyboard.press('Escape');
	}

	// -- Helpers --

	/**
	 * Helper: Ensure the session is started and idle (ready)
	 * @param session details of the session (language and version)
	 */
	async ensureStartedAndIdle(session: SessionName): Promise<void> {
		await test.step(`Ensure ${session.language} ${session.version} session is started and idle`, async () => {

			// Start Session if it does not exist
			const sessionExists = await this.getSessionLocator(session).isVisible({ timeout: 30000 });
			if (!sessionExists) {
				await this.console.startSession(session);
			}

			// Ensure session is idle (ready)
			const status = await this.getStatus(session);
			if (status !== 'idle') {
				await this.start(session);
			}
		});
	}

	/**
	 * Helper: Get the session ID from the session name
	 * @param sessionName the session name to get the ID for
	 * @returns the session ID
	 */
	async getSessionId(sessionName: string): Promise<string> {
		const testId = await this.getTestIdFromSessionName(sessionName);
		return testId.match(/-(\S+)$/)?.[1] || '';
	}

	/**
	 * Helper: Get the test ID from the session name
	 * @param sessionName the session name to get the ID for
	 * @returns the session ID
	 */
	async getTestIdFromSessionName(sessionName: string): Promise<string> {
		const session = this.getSessionLocator(sessionName);
		const testId = await session.getAttribute('data-testid');
		const match = testId?.match(/console-tab-(\S+)/);
		return match ? match[1] : '';
	}

	/**
	 * Helper: Get the metadata of the session
	 * @param sessionId the session ID to get metadata for
	 * @returns the metadata of the session
	 */
	async getMetadata(sessionId: string): Promise<SessionMetaData> {
		// select the session tab and open the metadata dialog
		await this.page.getByTestId(`console-tab-${sessionId}`).click();
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
	private getSessionLocator(session: SessionName | string): Locator {
		const sessionName = typeof session === 'string'
			? session
			: `${session.language} ${session.version}`;

		return this.page.getByRole('tab', { name: new RegExp(sessionName) });
	}

	/**
	 * Helper: Get the status of the session tab
	 * @param session Either a session object (language and version) or a string representing the session name.
	 * @returns 'active', 'idle', 'disconnected', or 'unknown'
	 */
	async getStatus(session: SessionName | string): Promise<'active' | 'idle' | 'disconnected' | 'unknown'> {
		const expectedSession = this.getSessionLocator(session);

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
	async checkStatus(session: SessionName | string, expectedStatus: 'active' | 'idle' | 'disconnected') {
		const stepTitle = session instanceof Object
			? `Verify ${session.language} ${session.version} session status: ${expectedStatus}`
			: `Verify ${session} session status: ${expectedStatus}`;

		await test.step(stepTitle, async () => {
			const sessionLocator = this.getSessionLocator(session);
			const statusClass = `.codicon-positron-status-${expectedStatus}`;

			await expect(sessionLocator).toBeVisible();
			await expect(sessionLocator.locator(statusClass)).toBeVisible({ timeout: 30000 });
		});
	}


	/**
	 * Verify: Check the metadata of the session dialog
	 * @param data the expected metadata to verify
	 */
	async checkMetadata(data: SessionName & { state: 'active' | 'idle' | 'disconnected' | 'exited' }) {
		await test.step(`Verify ${data.language} ${data.version} metadata`, async () => {

			// Click metadata button for desired session
			const sessionLocator = this.getSessionLocator({ language: data.language, version: data.version });
			await sessionLocator.click();
			await this.metadataButton.click();

			// Verify metadata
			await expect(this.metadataDialog.getByText(`${data.language} ${data.version}`)).toBeVisible();
			await expect(this.metadataDialog.getByText(new RegExp(`Session ID: ${data.language.toLowerCase()}-[a-zA-Z0-9]+`))).toBeVisible();
			await expect(this.metadataDialog.getByText(`State: ${data.state}`)).toBeVisible();
			await expect(this.metadataDialog.getByText(/^Path: [\/~a-zA-Z0-9.]+/)).toBeVisible();
			await expect(this.metadataDialog.getByText(/^Source: (Pyenv|System)$/)).toBeVisible();
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
}

export type SessionName = {
	language: 'Python' | 'R';
	version: string; // e.g. '3.10.15'
};

export type SessionMetaData = {
	name: string;
	id: string;
	state: string;
	source: string;
	path: string;
};
