/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import test, { expect, Locator, Page } from '@playwright/test';
import { Code, QuickAccess, Console, ContextMenu } from '../infra';
import { QuickInput } from './quickInput';

// Lazy getters for environment variables - these will be evaluated when accessed, not at module load time
const getDesiredPython = () => process.env.POSITRON_PY_VER_SEL;
const getDesiredR = () => process.env.POSITRON_R_VER_SEL;
const getAlternatePython = () => process.env.POSITRON_PY_ALT_VER_SEL;
const getAlternateR = () => process.env.POSITRON_R_ALT_VER_SEL;
const getHiddenPython = () => process.env.POSITRON_HIDDEN_PY;
const getHiddenR = () => process.env.POSITRON_HIDDEN_R;

export const ACTIVE_STATUS_ICON = '.codicon-positron-runtime-status-active';
export const IDLE_STATUS_ICON = '.codicon-positron-runtime-status-idle';
export const DISCONNECTED_STATUS_ICON = '.codicon-positron-runtime-status-disconnected';

/**
 * Class to manage console sessions
 */
export class Sessions {
	private get page(): Page { return this.code.driver.page; }

	// Session management and UI elements
	private get quickPick(): SessionQuickPick { return new SessionQuickPick(this.code, this); }
	sessions = this.page.getByTestId(/console-(?!tab-)[a-zA-Z0-9-]+/);
	sessionTabs = this.page.getByTestId(/console-tab/);
	currentSessionTab = this.sessionTabs.filter({ has: this.page.locator('.tab-button--active') });
	sessionPicker = this.page.locator('[id="workbench.parts.positron-top-action-bar"]').locator('.action-bar-region-right').getByRole('button').first();
	private renameMenuItem = this.page.getByRole('menuitem', { name: 'Rename...' });
	deleteMenuItem = this.page.getByRole('menuitem', { name: 'Delete' });

	// Session status indicators
	private activeStatus = (session: Locator) => session.locator(ACTIVE_STATUS_ICON);
	private idleStatus = (session: Locator) => session.locator(IDLE_STATUS_ICON);
	private disconnectedStatus = (session: Locator) => session.locator(DISCONNECTED_STATUS_ICON);
	private activeStatusIcon = this.page.locator(ACTIVE_STATUS_ICON);

	// Session Metadata
	private metadataButton = this.page.getByRole('button', { name: 'Console information' });
	private metadataDialog = this.page.getByRole('dialog').locator('.console-instance-info').first();
	private consoleInstance = (sessionId: string) => this.page.getByTestId(`console-${sessionId}`);
	private outputChannel = this.page.getByRole('combobox');

	constructor(private code: Code, private quickaccess: QuickAccess, private quickinput: QuickInput, private console: Console, private contextMenu: ContextMenu) { }

	// -- Actions --

	/**
	 * Action: Starts one or more sessions
	 * Note: If you are seeking to start a session and NOT wait for ready, use `startAndSkipMetadata()`
	 *
	 * @param sessions - The session runtime(s) to start: 'python', 'pythonAlt', 'pythonHidden', 'r', 'rAlt'
	 * @param options - Configuration options for session startup
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
			triggerMode?: SessionTrigger;
			reuse?: boolean;
		}
	): Promise<T extends SessionRuntimes ? SessionMetaData : { [K in keyof T]: SessionMetaData }> {
		const {
			triggerMode = 'hotkey',
			reuse = true,
		} = options || {};

		// convert input to array for unified processing
		const sessionsToCreate = (Array.isArray(sessions) ? sessions : [sessions]) as SessionRuntimes[];
		const results: SessionMetaData[] = [];

		// Helper to create a new session and fetch metadata
		const createSession = async (session: SessionRuntimes): Promise<SessionMetaData> => {
			// Get a fresh session object with current environment values
			const sessionTemplate = availableRuntimes[session];
			const newSession = {
				...sessionTemplate,
				waitForReady: true,
				triggerMode,
				// Ensure we get fresh environment values
				name: sessionTemplate.name, // This will call the getter again
				version: sessionTemplate.version, // This will call the getter again
			};
			newSession.id = await this.startAndSkipMetadata(newSession);
			return await this.getMetadata(newSession.id);
		};

		if (reuse) {
			// retrieve the list of active sessions from the session quick pick menu
			// filter the console tabs to include only those sessions that are currently active
			await this.console.focus();
			const quickPickActiveSessionNames = new Set((await this.quickPick.getActiveSessions()).map(s => s.name));
			const consoleTabActiveSessions = (await this.getAllSessionIdsAndNames())
				.filter(session => quickPickActiveSessionNames.has(session.name));

			for (const session of sessionsToCreate) {
				const sessionName = availableRuntimes[session].name;
				const existingSessionIndex = consoleTabActiveSessions.findIndex(currentSession => currentSession.name.includes(sessionName));

				if (existingSessionIndex === -1) {
					// session not found in active sessions, create it
					results.push(await createSession(session));
				} else {
					// session found, retrieve metadata
					const foundSession = consoleTabActiveSessions[existingSessionIndex];
					results.push(await this.getMetadata(foundSession.id));

					// remove the found session from the list to avoid duplicates
					consoleTabActiveSessions.splice(existingSessionIndex, 1);
				}
			}
		} else {
			// no reuse, create all sessions
			for (const session of sessionsToCreate) {
				results.push(await createSession(session));
			}
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
			await expect(async () => {
				await this.console.focus();

				if (await this.getSessionCount() === 1) {
					// Only one session: Use the delete button in the action bar
					const currentSessionId = await this.getCurrentSessionId();
					if (currentSessionId === sessionId) {
						await this.page.getByTestId('trash-session').click();
						return;
					} else {
						if (/(8080|8787)/.test(this.code.driver.page.url())) {
							return; // workaround for server/workbench
						} else {
							throw new Error(`Cannot delete session ${sessionId} because it does not exist`);
						}
					}
				} else {
					// More that one session: Delete via the context menu. (The trash icon
					// is not visible if the tab list is too narrow.)
					await this.deleteViaUI(sessionId);
				}

				await expect(this.page.getByText('Shutting down')).not.toBeVisible();
				await expect(this.consoleInstance(sessionId)).not.toBeVisible();
			}, `Delete session: ${sessionId}`).toPass();
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
			await this.console.focus();

			if (await this.getSessionCount() > 1) {
				await this.getSessionTab(sessionIdOrName).click();
			}

			if (clearConsole) {
				await this.page.getByLabel('Clear console').click();
			}

			await this.console.restartButton.click();
			await this.page.mouse.move(0, 0);

			if (waitForIdle) {
				await expect(this.page.getByText('restarting.')).not.toBeVisible({ timeout: 90000 });
				await expect(this.page.locator('.console-instance[style*="z-index: auto"]').getByText('restarted.')).toBeVisible({ timeout: 90000 });
				await this.expectStatusToBe(sessionIdOrName, 'idle');
			}
		});
	}

	/**
	 * Action: Open the metadata dialog and select the desired menu item
	 *
	 * @param menuItem - the menu item to click on the metadata dialog
	 */
	async selectMetadataOption(menuItem: 'Show Kernel Output Channel' | 'Show Console Output Channel' | 'Show LSP Output Channel') {
		await this.console.focus();
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

			// Workaround for external browser
			if (this.code.driver.page.url().includes('8080')) {
				try { await this.page.getByRole('button', { name: 'Delete Session' }).click({ timeout: 1000 }); } catch (error) { }
			} else {
				await expect(this.page.getByText('There is no session running.')).toBeVisible();
			}
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
		await test.step(`Resize session list: ${options}`, async () => {
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
		});
	}

	/**
	 * Action: Select the session
	 * @param sessionIdOrName - the id or name of the session
	 */
	async select(sessionIdOrName: string, waitForSessionIdle = false): Promise<void> {
		await test.step(`Select session: ${sessionIdOrName}`, async () => {
			await this.console.focus();
			const sessionTab = this.getSessionTab(sessionIdOrName);

			if (waitForSessionIdle) {
				await expect(this.idleStatus(sessionTab)).toBeVisible();
			}

			await sessionTab.click();
		});
	}

	// -- Helpers --

	/**
	 * Helper: Get the number of sessions in the console
	 */
	async getSessionCount(): Promise<number> {
		return await test.step('Get console session count', async () => {
			await this.console.focus();
			const count = (await this.sessions.all()).length;
			return count;
		});
	}

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
	 * @param options.triggerMode - the method used to trigger the selection: session-picker, quickaccess, hotkey.
	 * @param options.waitForReady - whether to wait for the console to be ready after selecting the runtime.
	 */
	async startAndSkipMetadata(options: {
		language: 'Python' | 'R';
		version?: string;
		disambiguator?: string; // additional string to differentiate in picker
		triggerMode?: 'session-picker' | 'quickaccess' | 'hotkey';
		waitForReady?: boolean;
	}): Promise<string> {

		if (!getDesiredPython() || !getDesiredR()) {
			throw new Error('Please set env vars: POSITRON_PY_VER_SEL, POSITRON_R_VER_SEL');
		}

		if (!getAlternatePython() || !getAlternateR()) {
			throw new Error('Please set env vars: POSITRON_PY_ALT_VER_SEL, POSITRON_R_ALT_VER_SEL');
		}

		const {
			language,
			version = language === 'Python' ? getDesiredPython() : getDesiredR(),
			waitForReady = true,
			triggerMode = 'hotkey',
		} = options;

		return await test.step(`Start session via ${triggerMode}: ${language} ${version} ${options.disambiguator}`, async () => {

			// Don't try to start a new runtime if one is currently starting up
			await this.expectAllSessionsToBeReady();

			// Start the runtime via the session picker button, quickaccess or console session button
			if (triggerMode === 'quickaccess') {
				const command = language === 'Python' ? 'python.setInterpreter' : 'r.selectInterpreter';
				await this.quickaccess.runCommand(command, { keepOpen: true });
			} else if (triggerMode === 'session-picker') {
				await this.quickPick.openSessionQuickPickMenu();
			} else {
				await this.page.keyboard.press('Control+Shift+/');
			}

			let input = language;
			if (version) {
				input += ` ${version}`;
			}
			if (options.disambiguator) {
				input += ` ${options.disambiguator}`;
			}

			await this.quickinput.type(input);

			// Wait until the desired runtime appears in the list and select it.
			// We need to click instead of using 'enter' because the Python select interpreter command
			// may include additional items above the desired interpreter string.
			await this.quickinput.selectQuickInputElementContaining(`${language} ${version}`);
			await this.quickinput.waitForQuickInputClosed();

			// Move mouse to prevent tooltip hover
			await this.code.driver.page.mouse.move(0, 0);

			if (waitForReady) {
				await expect(this.console.activeConsole.getByText(/started/)).toBeVisible({ timeout: 90000 });
			}
			return this.getCurrentSessionId();
		});
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
	 * Helper: Wait for runtimes to finish loading
	 */
	async expectNoStartUpMessaging() {
		await test.step('Wait runtimes to finish loading', async () => {
			await expect(this.code.driver.page.locator('[id="workbench.parts.titlebar"]')).toBeVisible({ timeout: 30000 });
			await this.console.focus();
			await this.code.driver.page.mouse.move(0, 0);
			await expect(this.page.locator('text=/^Starting up|^Starting|^Preparing|^Reconnecting|^Discovering( \\w+)? interpreters|starting\\.$/i')).toHaveCount(0, { timeout: 90000 });
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
	 * Helper: Get all session IDs and their names for sessions in the console
	 *
	 * @returns An array of objects containing session IDs and names
	 */
	async getAllSessionIdsAndNames(): Promise<{ id: string; name: string }[]> {
		return await test.step('Get all session IDs and names', async () => {
			const sessionCount = await this.getSessionCount();

			if (sessionCount === 0) {
				// no sessions available
				return [];
			} else if (sessionCount === 1) {
				// single session, fetch metadata directly
				const { id, name } = await this.getMetadata();
				return [{ id, name }];
			} else {
				// multiple sessions, iterate through session tabs
				const allSessions = await this.sessionTabs.all();
				const allSessionsData: { id: string; name: string }[] = [];

				for (const session of allSessions) {
					// extract session ID from data-testid attribute
					const testId = await session.getAttribute('data-testid');
					const match = testId?.match(/console-tab-((python|r)-[a-zA-Z0-9]+)/);
					const id = match ? match[1] : null;

					// extract session name from aria-label attribute
					const ariaLabel = await session.getAttribute('aria-label');
					const name = ariaLabel ? ariaLabel.trim() : null;

					if (!id || !name) {
						throw new Error(`Session ID or name not found for session: ${testId}`);
					}
					allSessionsData.push({ id, name });
				}

				return allSessionsData;
			}
		});
	}

	/**
	 * Helper: Get the session ID for the currently selected session
	 *
	 * @returns the session ID or undefined if no session is selected
	 */
	async getCurrentSessionId(): Promise<string> {
		return await test.step('Get current session ID', async () => {
			const infoButton = this.page.getByTestId(/info-(python|r)-[a-z0-9]+/i);
			const infoButtonCount = await infoButton.count();

			if (infoButtonCount === 0) {
				throw new Error('No active session');
			}

			const testId = await infoButton.getAttribute('data-testid');

			if (!testId || !/^info-((python|r)-[a-z0-9]+)$/i.test(testId)) {
				throw new Error('No active session or unexpected session ID format');
			}

			return testId.replace(/^info-/, '');
		});
	}

	/**
	 * Helper: Get the metadata of the session
	 *
	 * @param sessionId the session ID to get metadata for, otherwise will use the current session
	 * @returns the metadata of the session
	 */
	async getMetadata(sessionId?: string): Promise<SessionMetaData> {
		return await test.step(`Get metadata for: ${sessionId ?? 'current session'}`, async () => {
			await this.console.focus();

			const isSingleSession = (await this.getSessionCount()) === 1;

			if (!isSingleSession && sessionId) {
				await this.page.getByTestId(`console-tab-${sessionId}`).click();
			}

			const metadata = await this.extractMetadataFromDialog();

			// Close the metadata dialog
			await this.page.keyboard.press('Escape');

			return metadata;
		});
	}

	/**
	 * Helper: Extract metadata from the metadata dialog
	 */
	private async extractMetadataFromDialog(): Promise<SessionMetaData> {
		let metadata: SessionMetaData | undefined;

		await test.step('Extract metadata from dialog', async () => {
			await expect(async () => {
				await this.openMetadataDialog();
				const [name, id, state, path, source] = await Promise.all([
					this.metadataDialog.getByTestId('session-name').textContent(),
					this.metadataDialog.getByTestId('session-id').textContent(),
					this.metadataDialog.getByTestId('session-state').textContent(),
					this.metadataDialog.getByTestId('session-path').textContent(),
					this.metadataDialog.getByTestId('session-source').textContent(),
				]);
				metadata = {
					name: (name ?? '').trim(),
					id: (id ?? '').replace('Session ID: ', ''),
					state: (state ?? '').replace('State: ', '') as SessionState,
					path: (path ?? '').replace('Path: ', ''),
					source: (source ?? '').replace('Source: ', ''),
				};
			}, 'Extract session metadata').toPass({ intervals: [500], timeout: 10000 });
		});
		return metadata!;
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
					const isDisconnected = await session.locator('.codicon-positron-runtime-status-disconnected').isVisible();
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

	/**
	 * Action: Rename a session via command
	 *
	 * @param oldName - Name of the session to rename (or part of the name)
	 * @param newName - New session name
	 */
	async rename(oldName: string, newName: string) {
		await test.step(`Rename session: ${oldName} to ${newName}`, async () => {
			await this.quickaccess.runCommand('workbench.action.language.runtime.renameSession', { keepOpen: true });
			await this.quickinput.waitForQuickInputOpened();
			await this.quickinput.type(oldName);
			await this.quickinput.waitForQuickInputElements(e => e.length === 1 && e[0].includes(oldName));
			await this.quickinput.quickInputList.getByText(oldName).first().click();
			await this.quickinput.type(newName);
			await this.code.driver.page.keyboard.press('Enter');
		});
	}

	/**
	 * Action: Rename a session via UI
	 *
	 * @param sessionId - the id of the session
	 * @param newName - the new name for the session
	 */
	async renameViaUI(sessionId: string, newName: string): Promise<void> {
		await test.step(`Rename session: ${sessionId} to ${newName}`, async () => {
			await this.console.focus();
			const sessionTab = this.getSessionTab(sessionId);

			// open the context menu and select "Rename"
			await sessionTab.click({ button: 'right' });
			await this.renameMenuItem.hover();
			await this.page.waitForTimeout(500);
			await this.renameMenuItem.click();

			// input the new name
			await expect(sessionTab.getByRole('textbox')).toBeVisible();
			await this.page.keyboard.type(newName);
			await this.page.keyboard.press('Enter');
		});
	}

	/**
	 * Action: Delete a session via UI
	 *
	 * @param sessionId - the id of the session
	 */
	async deleteViaUI(sessionId: string): Promise<void> {
		await test.step(`Delete session: ${sessionId}`, async () => {
			await this.console.focus();
			const sessionTab = this.getSessionTab(sessionId);

			await this.contextMenu.triggerAndClick({
				menuTrigger: sessionTab,
				menuTriggerButton: 'right',
				menuItemLabel: 'Delete'
			});
		});
	}

	/**
	* Action: Open the metadata dialog for the current session
	*/
	async openMetadataDialog() {
		await expect(async () => {
			const isMetadataDialogVisible = await this.metadataDialog.isVisible();

			if (!isMetadataDialogVisible) {
				await this.metadataButton.click();
				await this.page.mouse.move(0, 0);
				await this.page.waitForTimeout(500);
			}

			await expect(this.metadataDialog).toBeVisible();
		}, 'Open the Metadata Dialog').toPass({ timeout: 3000 });
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
				const statusClass = `.codicon-positron-runtime-status-${expectedStatus}`;

				await expect(sessionTab).toBeVisible();
				await expect(sessionTab.locator(statusClass)).toBeVisible({ timeout });
			} else if (sessionCount === 1) {
				// get status from metadata dialog because there is no tab list view
				await this.openMetadataDialog();
				await expect(this.metadataDialog.getByText(`State: ${expectedStatus}`)).toBeVisible({ timeout });
				await this.page.keyboard.press('Escape');
			} else {
				throw new Error('No sessions found');
			}
		});
	}

	/**
	 * Verify: Check the name of the session
	 *
	 * @param sessionId - the id of the session
	 * @param expectedName - the expected name of the session
	 */
	async expectSessionNameToBe(sessionId: string, expectedName: string) {
		await test.step(`Verify session name: ${sessionId} is ${expectedName}`, async () => {
			const sessionTab = this.getSessionTab(sessionId);
			await expect(sessionTab).toHaveText(expectedName);
		});
	}

	/**
	 * Verify: Check the metadata of the session dialog
	 * @param session - the expected session info to verify
	 */
	async expectMetadataToBe(session: SessionMetaData) {
		await test.step(`Verify ${session.name} metadata: ${session.state}, ${session.path}`, async () => {

			await this.getSessionTab(session.id).click();
			await this.openMetadataDialog();

			// Verify metadata
			await expect(this.metadataDialog.getByTestId('session-name')).toContainText(session.name);
			await expect(this.metadataDialog.getByTestId('session-id')).toContainText(session.id);
			await expect(this.metadataDialog.getByTestId('session-state')).toContainText(session.state);
			await expect(this.metadataDialog.getByTestId('session-path')).toContainText(session.path);
			await expect(this.metadataDialog.getByTestId('session-source')).toContainText(session.source);

			await this.page.keyboard.press('Escape');

			// Verify Language Console
			const baseSessionName = session.name.split('-')[0].trim();
			const escapedFullSessionName = new RegExp(session.name.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'));
			const escapedBaseSessionName = new RegExp(baseSessionName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'));

			await this.selectMetadataOption('Show Console Output Channel');
			await expect(this.outputChannel).toHaveValue(escapedBaseSessionName);
			await expect(this.outputChannel).toHaveValue(/Console$/);

			// Verify Output Channel
			await this.selectMetadataOption('Show Kernel Output Channel');
			await expect(this.outputChannel).toHaveValue(escapedBaseSessionName);
			await expect(this.outputChannel).toHaveValue(/Kernel$/);

			// Verify LSP Output Channel
			await this.selectMetadataOption('Show LSP Output Channel');
			await expect(this.outputChannel).toHaveValue(escapedFullSessionName);
			await expect(this.outputChannel).toHaveValue(/Language Server \(Console\)$/);

			// Go back to console when done
			await this.console.focus();
		});
	}

	/**
	 * Verify: the runtime matches the runtime in the Session Picker button
	 *
	 * @param version - The descriptive string of the runtime to verify.
	 */
	async expectSessionPickerToBe(runtimeName: string) {
		await test.step(`Verify runtime is selected: ${runtimeName}`, async () => {
			const normalizedRuntimeName = runtimeName.replace(/-\s\d+$/, '').trim();
			await expect(this.sessionPicker).toHaveText(normalizedRuntimeName);
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
		const tabsContainer = this.page.locator('.console-core').getByRole('tablist');

		const isHorizontallyScrollable = await tabsContainer.evaluate(el => el.scrollWidth > el.clientWidth);
		const isVerticallyScrollable = await tabsContainer.evaluate(el => el.scrollHeight > el.clientHeight);

		expect(isHorizontallyScrollable).toBe(horizontal);
		expect(isVerticallyScrollable).toBe(vertical);
	}

	/**
	 * Verify: all sessions are "ready" (idle or disconnected)
	 */
	async expectAllSessionsToBeReady() {
		await test.step('Expect all sessions to be ready', async () => {
			await this.expectNoStartUpMessaging();
			await expect(this.activeStatusIcon).toHaveCount(0);
		});
	}

	/**
	 * Verify: Start a New Session menu is visible
	 */
	async expectStartNewSessionMenuToBeVisible() {
		await expect(this.quickPick.allSessionsMenu).toBeVisible();
	}

	/**
	 * Verify: the session quick pick contains the given session entries in the specified order,
	 * even when the list is virtualized (i.e., rows load only when paged down).
	 *
	 * Uses PageDown key presses to trigger loading of more rows.
	 *
	 * @param sessionList - An array of expected session metadata in order of expected appearance
	 */
	async expectSessionQuickPickToContainInRelativeOrder(sessionList: { session: SessionMetaData }[]) {
		await this.quickPick.openSessionQuickPickMenu(true);

		const seen = new Set<string>();
		const actualEntries: { name: string; path: string }[] = [];

		let stable = false;
		while (!stable) {
			const entries = this.page.locator('.quick-input-list-entry');
			const entryCount = await entries.count();

			let newEntriesFound = false;
			for (let i = 0; i < entryCount; i++) {
				const entry = entries.nth(i);

				const rows = entry.locator('.quick-input-list-row');
				const name = await rows.nth(0).innerText();
				const path = await rows.nth(1).innerText();

				const key = `${name}||${path}`;
				if (!seen.has(key)) {
					seen.add(key);
					actualEntries.push({ name, path });
					newEntriesFound = true;
				}
			}

			if (newEntriesFound) {
				await this.page.keyboard.press('PageDown'); // first one just scoots the scroll bar down
				await this.page.keyboard.press('PageDown');
				await this.page.waitForTimeout(50); // allow more items to render
			} else {
				stable = true; // no new items found after a PageDown
			}
		}

		// Verify expected sessions appear in the given order
		let currentIndex = 0;
		for (const { session } of sessionList) {
			const nextIndex = actualEntries.findIndex((entry, i) =>
				i >= currentIndex &&
				entry.name === session.name &&
				entry.path === session.path
			);

			expect(nextIndex).not.toBe(-1);
			currentIndex = nextIndex + 1;
		}

		await this.quickPick.closeSessionQuickPickMenu();
	}

}

/**
 * Helper class to manage the session quick pick
 */
export class SessionQuickPick {
	private get quickInputTitleBar(): Locator { return this.code.driver.page.locator('.quick-input-titlebar'); }
	private get sessionQuickMenu(): Locator { return this.quickInputTitleBar.getByText(/(Select Interpreter Session)|(Start New Interpreter Session)/); }
	get allSessionsMenu(): Locator { return this.quickInputTitleBar.getByText(/Start New Interpreter Session/); }

	constructor(private code: Code, private sessions: Sessions) { }

	// -- Actions --

	/**
	 * Action: Open the session quickpick menu via the "Start Session" button in top action bar.
	 */
	async openSessionQuickPickMenu(viewAllRuntimes = true) {
		await test.step('Open session quickpick menu', async () => {
			// something about the 1.97.0 upstream merge impacted the session picker
			// unfortunately we need to retry the session picker until it works
			await expect(async () => {
				if (!await this.sessionQuickMenu.isVisible()) {
					await this.sessions.sessionPicker.click();
				}

				if (viewAllRuntimes) {
					await this.code.driver.page.getByRole('textbox', { name: /(Select Interpreter Session|New Interpreter Session)/ }).fill('New Session');
					await this.code.driver.page.keyboard.press('Enter');
					await expect(this.code.driver.page.getByText(/Start New Interpreter Session/)).toBeVisible({ timeout: 1000 });
				}
			}, 'Open Session QuickPick Menu').toPass({ intervals: [500], timeout: 10000 });
		});
	}

	/**
	 * Action: Close the session quickpick menu if it is open.
	 */
	async closeSessionQuickPickMenu() {
		await test.step('Close session quickpick menu', async () => {
			if (await this.sessionQuickMenu.isVisible()) {
				await this.code.driver.page.keyboard.press('Escape');
				await expect(this.sessionQuickMenu).not.toBeVisible();
			}
		});
	}

	// --- Helpers ---

	/**
	 * Helper: Get active sessions from the session picker.
	 * @returns The list of active sessions.
	 */
	async getActiveSessions(): Promise<QuickPickSessionInfo[]> {
		return await test.step('Get active sessions from session picker', async () => {
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
				.filter(session => !session.name.includes('New Interpreter Session...'));

			await this.closeSessionQuickPickMenu();
			return filteredSessions;
		});
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

export type SessionTrigger = 'session-picker' | 'quickaccess' | 'hotkey';

export type SessionInfo = {
	name: string;
	language: 'Python' | 'R';
	version: string; // e.g. '3.10.15'
	disambiguator?: string; // additional string to differentiate in picker
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
	state: SessionState;
	source: string;
	path: string;
};

type SessionState = 'active' | 'idle' | 'disconnected' | 'exited';

// Lazy factory functions for session objects - these will use current environment values when called
const createPythonSession = (): SessionInfo => ({
	name: `Python ${getDesiredPython()}`,
	language: 'Python',
	version: getDesiredPython() || '',
	triggerMode: 'hotkey',
	id: '',
	waitForReady: true
});

const createPythonSessionAlt = (): SessionInfo => ({
	name: `Python ${getAlternatePython()}`,
	language: 'Python',
	version: getAlternatePython() || '',
	triggerMode: 'hotkey',
	id: '',
	waitForReady: true
});

const createPythonSessionHidden = (): SessionInfo => ({
	name: `Python ${getHiddenPython()}`,
	language: 'Python',
	version: getHiddenPython() || '',
	triggerMode: 'session-picker',
	id: '',
	waitForReady: true
});

const createPythonReticulate = (): SessionInfo => ({
	name: `Python (reticulate)`,
	language: 'Python',
	version: '',
	disambiguator: 'reticulate',
	triggerMode: 'session-picker',
	id: '',
	waitForReady: true
});

const createRSession = (): SessionInfo => ({
	name: `R ${getDesiredR()}`,
	language: 'R',
	version: getDesiredR() || '',
	triggerMode: 'hotkey',
	id: '',
	waitForReady: true
});

const createRSessionAlt = (): SessionInfo => ({
	name: `R ${getAlternateR()}`,
	language: 'R',
	version: getAlternateR() || '',
	triggerMode: 'hotkey',
	id: '',
	waitForReady: true
});

const createRSessionHidden = (): SessionInfo => ({
	name: `R ${getHiddenR()}`,
	language: 'R',
	version: getHiddenR() || '',
	triggerMode: 'session-picker',
	id: '',
	waitForReady: true
});

export type SessionRuntimes = 'python' | 'pythonAlt' | 'pythonHidden' | 'pythonReticulate' | 'r' | 'rAlt' | 'rHidden';

// Lazy getter for available runtimes - this will create fresh objects with current env values when accessed
export const availableRuntimes: { [key: string]: SessionInfo } = {
	get r() { return createRSession(); },
	get rAlt() { return createRSessionAlt(); },
	get rHidden() { return createRSessionHidden(); },
	get python() { return createPythonSession(); },
	get pythonAlt() { return createPythonSessionAlt(); },
	get pythonHidden() { return createPythonSessionHidden(); },
	get pythonReticulate() { return createPythonReticulate(); },
};
