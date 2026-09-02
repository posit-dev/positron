/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import test, { expect } from '@playwright/test';
import { Code } from '../infra/code.js';
import { STARTUP_MESSAGING_SELECTOR, STARTUP_MESSAGING_TIMEOUT } from './utils/startupMessaging.js';

/**
 * How long a single post-reload probe may wait before it is abandoned and retried.
 */
const RELOAD_PROBE_TIMEOUT = 2000;

/** Overall budget for the post-reload workbench gate. */
const RELOAD_READY_TIMEOUT = 30000;

/**
 * Wall-clock margin on top of a probe's own timeout, so a probe that is merely
 * slow still reports its own failure and only a parked one is abandoned.
 */
const RELOAD_PROBE_GRACE = 500;

/** Budget for the post-reload load-state hint (best effort, see reloadWindow). */
const RELOAD_LOADSTATE_TIMEOUT = 5000;

/**
 * Await `operation`, abandoning it after `timeoutMs` of wall clock.
 *
 * A Playwright query can park on a discarded execution-context promise, and no
 * option on the query bounds that wait: the one-shot probe inside
 * `expect(...).toBeVisible({ timeout })` never observes its own deadline, and
 * every retry wrapper (`toPass`, `Code#poll`) awaits the probe, so the retry the
 * timeout was supposed to trigger never runs. Racing a real timer is what
 * actually lets go. `Promise.race` leaves a rejection handler attached to
 * `operation`, so a late settle is handled rather than unhandled.
 */
async function withDeadline<T>(operation: Promise<T>, timeoutMs: number, what: string): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const expired = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error(`${what} did not settle within ${timeoutMs}ms`)), timeoutMs);
	});

	try {
		return await Promise.race([operation, expired]);
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Provides hotkey shortcuts for common operations. References the keybindings defined in `test/e2e/fixtures/keybindings.json`.
 */
export class HotKeys {
	constructor(private code: Code) { }

	private getModifierKey(): string {
		return process.platform === 'darwin' ? 'Meta' : 'Control';
	}

	private isExternalBrowser(): boolean {
		return (/(8080|8787|8888)/.test(this.code.driver.currentPage.url()));
	}

	// ----------------------
	// --- Editing Actions ---
	// ----------------------

	public async copy() {
		await this.pressHotKeys('Cmd+C', 'Copy');
	}

	public async cut() {
		await this.pressHotKeys('Cmd+X', 'Cut');
	}

	public async paste() {
		await this.pressHotKeys('Cmd+V', 'Paste');
	}

	public async redo() {
		await this.pressHotKeys('Cmd+Shift+Z', 'Redo');
	}

	public async selectAll() {
		await this.pressHotKeys('Cmd+A', 'Select All');
	}

	public async undo() {
		await this.pressHotKeys('Cmd+Z', 'Undo');
	}

	// ------------------------
	// --- Notebook Actions ---
	// ------------------------

	public async executeNotebookCell() {
		await this.pressHotKeys('Shift+Enter', 'Execute notebook cell');
	}

	public async runFileInConsole() {
		await this.pressHotKeys('Cmd+Shift+Enter', 'Run file in console');
	}

	public async runLineOfCode() {
		await this.pressHotKeys('Cmd+Enter', 'Run line of code');
		await this.code.driver.currentPage.waitForTimeout(500); // Wait for the console to process the command
	}

	public async selectNotebookKernel() {
		await this.pressHotKeys('Cmd+J D', 'Select notebook kernel');
	}

	public async searchInNotebook() {
		await this.pressHotKeys('Cmd+F', 'Search in notebook');
	}

	public async triggerGhostCell() {
		await this.pressHotKeys('Cmd+Shift+G', 'Trigger ghost cell suggestion');
	}

	// --------------------
	// --- File Actions ---
	// --------------------

	public async openFile() {
		await this.pressHotKeys('Cmd+O', 'Open File');
	}

	public async save() {
		await this.pressHotKeys('Cmd+S', 'Save');
	}

	// ---------------------------
	// --- Command Palette ---
	// ---------------------------

	/**
	 * Opens the command palette using a custom keybinding.
	 * We use Cmd+J E instead of the default Ctrl+Shift+P because
	 * Ctrl+Shift+P opens private browsing in Firefox, blocking
	 * cross-browser e2e tests.
	 */
	public async openCommandPalette() {
		await this.pressHotKeys('Cmd+J E', 'Open Command Palette');
	}

	// -------------------------
	// --- Find & Navigation ---
	// -------------------------

	public async closeAllEditors() {
		await this.pressHotKeys('Cmd+K Cmd+W', 'Close all editors');
		if (this.isExternalBrowser()) {
			const dontSaveButton = this.code.driver.currentPage.getByRole('button', { name: 'Don\'t Save' });
			if (await dontSaveButton.isVisible()) {
				await dontSaveButton.click();
			}
		}
	}

	public async closeTab() {
		await this.pressHotKeys('Cmd+W', 'Close current tab');
	}

	public async find() {
		await this.pressHotKeys('Cmd+F', 'Find');
	}

	public async firstTab() {
		await this.pressHotKeys('Cmd+1', 'Switch to first tab');
	}

	public async scrollToTop() {
		const platform = process.platform;

		if (platform === 'win32' || platform === 'linux') {
			await this.code.driver.currentPage.keyboard.press('Home');
		} else {
			await this.pressHotKeys('Cmd+ArrowUp', 'Scroll to top');
		}
	}

	public async scrollToBottom() {
		const platform = process.platform;

		if (platform === 'win32' || platform === 'linux') {
			await this.code.driver.currentPage.keyboard.press('End');
		} else {
			await this.pressHotKeys('Cmd+ArrowDown', 'Scroll to bottom');
		}
	}

	public async switchTabLeft() {
		await this.pressHotKeys('Cmd+Shift+[', 'Switch tab left');
	}

	public async switchTabRight() {
		await this.pressHotKeys('Cmd+Shift+]', 'Switch tab right');
	}

	// ------------------------
	// --- Terminal Actions ---
	// ------------------------

	public async killAllTerminals() {
		await this.pressHotKeys('Cmd+J T', 'Kill all terminals');
	}

	// ------------------------
	// --- Console & Visuals ---
	// ------------------------

	public async focusConsole() {
		await this.pressHotKeys('Cmd+K F', 'Focus console');
	}

	public async visualMode() {
		await this.pressHotKeys('Cmd+Shift+F4', 'Visual mode');
	}

	public executeCodeInConsole() {
		return this.pressHotKeys('Cmd+J O', 'Execute code in console');
	}

	public async sendInterrupt() {
		await this.pressHotKeys('Cmd+C', 'Send interrupt to console');
	}

	public async focusPreviewPanel() {
		await this.pressHotKeys('Cmd+L B', 'Focus preview panel');
	}

	// ----------------------
	// --- Layout Views ---
	// ----------------------

	public async showSecondarySidebar() {
		await this.pressHotKeys('Cmd+J B', 'Show secondary sidebar');
	}

	public async closeSecondarySidebar() {
		await this.pressHotKeys('Cmd+J A', 'Hide secondary sidebar');
	}

	public async fullSizeSecondarySidebar() {
		await this.pressHotKeys('Cmd+J G', 'Full size secondary sidebar');
	}

	public async stackedLayout() {
		await this.pressHotKeys('Cmd+J H', 'Stacked layout');
	}

	public async toggleBottomPanel() {
		await this.pressHotKeys('Cmd+J C', 'Toggle bottom panel');
	}

	public async notebookLayout() {
		await this.pressHotKeys('Cmd+J N', 'Notebook layout');
	}

	public async closePrimarySidebar() {
		await this.pressHotKeys('Cmd+B C', 'Close primary sidebar');
	}

	public async minimizeBottomPanel() {
		await this.pressHotKeys('Cmd+J P', 'Minimize bottom panel');
	}

	public async restoreBottomPanel() {
		await this.pressHotKeys('Cmd+J V', 'Restore bottom panel');
	}

	// -------------------------
	// --- Workspace Actions ---
	// -------------------------

	public async closeWorkspace() {
		await this.pressHotKeys('Cmd+J W', 'Close workspace');
		await expect(this.code.driver.currentPage.locator('.explorer-folders-view')).not.toBeVisible();
	}

	public async importSettings() {
		await this.pressHotKeys('Cmd+J I', 'Import settings');
	}

	public async newFolderFromTemplate() {
		await this.pressHotKeys('Cmd+J F', 'New folder from template');
	}

	public async openUserSettingsJSON() {
		await this.pressHotKeys('Cmd+J U', 'Open user settings JSON');
	}

	public async openWorkspaceSettingsJSON() {
		await this.pressHotKeys('Cmd+J K', 'Open workspace settings JSON', true);
	}

	public async reloadWindow(waitForReady = false) {
		const page = this.code.driver.currentPage;

		// Arm the navigation listener before triggering the reload: the old DOM stays
		// visible (with no startup messaging) for a beat after the keypress, so any
		// readiness gate that polls immediately would pass against the pre-reload page.
		// The main frame navigating is the deterministic signal that the reload
		// actually happened. (Filter to the main frame: webview iframes navigate too.)
		const navigated = page.waitForEvent('framenavigated', frame => frame === page.mainFrame());
		await this.pressHotKeys('Cmd+B R', 'Reload window');
		await navigated;

		// `framenavigated` fires at the navigation-commit instant, before the new
		// document has an execution context bound, so a query issued there aims at a
		// context that is discarded moments later. DOMContentLoaded is a page-level
		// lifecycle event rather than a context-bound evaluation, so waiting for it
		// cannot park the way a locator query can. Best effort: the probe loop below
		// is the real gate, and a missed load event should not fail the reload on its
		// own.
		await page.waitForLoadState('domcontentloaded', { timeout: RELOAD_LOADSTATE_TIMEOUT })
			.catch(() => { });

		// Bound each probe and retry, rather than spending the whole budget on one
		// assertion. Playwright parks a query on the execution-context promise that
		// existed when the query started, and an Electron reload clears the context
		// more than once as the renderer is swapped -- each clear installs a fresh
		// promise and orphans the old one, so a probe that started before the last
		// clear waits forever on a promise nothing will resolve. That is the Windows
		// CI failure where the workbench is fully rendered but the assertion reports
		// "element(s) not found".
		//
		// The probe's own `timeout` does not bound that wait -- a parked probe has
		// been observed running 17.7s on a 2s budget, starving `toPass` down to three
		// attempts in 30s -- so the abandonment has to happen on wall clock. Only
		// then does the next attempt pick up the current promise. The overall budget
		// is unchanged.
		await expect(async () => {
			await withDeadline(
				expect(page.locator('.monaco-workbench')).toBeVisible({ timeout: RELOAD_PROBE_TIMEOUT }),
				RELOAD_PROBE_TIMEOUT + RELOAD_PROBE_GRACE,
				'post-reload workbench probe'
			);
		}).toPass({ timeout: RELOAD_READY_TIMEOUT, intervals: [250] });

		// Wait for the workbench lifecycle to reach Restored (the same positive signal
		// Application#checkPositronReady gates launch on). External browsers (Posit
		// Workbench, Jupyter) don't run with --enable-smoke-test-driver, so window.driver
		// is unavailable there.
		if (!this.isExternalBrowser()) {
			await this.code.whenWorkbenchRestored();
		}

		if (waitForReady) {
			// Only after the restored gate above is this asserting "startup messaging has
			// cleared" rather than trivially passing before it has rendered at all.
			await expect(page.locator(STARTUP_MESSAGING_SELECTOR)).toHaveCount(0, { timeout: STARTUP_MESSAGING_TIMEOUT });
		}
	}

	public async openWelcomeWalkthrough() {
		await this.pressHotKeys('Cmd+J L', 'Open welcome walkthrough');
	}

	public async resetWelcomeWalkthrough() {
		await this.pressHotKeys('Cmd+J X', 'Reset welcome walkthrough');
	}

	public async openFolder() {
		await this.pressHotKeys('Cmd+J Q', 'Open Folder', true);
	}

	// -----------------------
	// ---  Data Explorer  ---
	// -----------------------

	public async showDataExplorerSummaryPanel() {
		await this.pressHotKeys('Cmd+J Y', 'Show the DE Summary Panel');
	}

	public async hideDataExplorerSummaryPanel() {
		await this.pressHotKeys('Cmd+J Z', 'Hide the DE Summary Panel');
	}

	public async showDataExplorerSummaryPanelRight() {
		await this.pressHotKeys('Cmd+J M', 'Show the DE Summary Panel on Right');
	}

	// -----------------------
	// ---  Assistant Actions ---
	// -----------------------

	public configureProviders() {
		return this.pressHotKeys('Cmd+J R', 'Configure Language Model Providers');
	}

	// -----------------------
	// ---  Debug Actions  ---
	// -----------------------

	public async debugCell() {
		await this.pressHotKeys('Cmd+L A', 'Debugger: Debug Cell');
	}

	public async clearAllBreakpoints() {
		await this.pressHotKeys('Cmd+J S', 'Debugger: Clear All Breakpoints');
	}

	// -----------------------
	// ---     Plots       ---
	// -----------------------
	public clearPlots() {
		return this.pressHotKeys('Cmd+L C', 'Clear Plots');
	}

	// -----------------------
	// --- Quarto Actions  ---
	// -----------------------
	public runCurrentQuartoCell() {
		return this.pressHotKeys('Cmd+L Q', 'Quarto: Run Current Cell');
	}

	public runCurrentQuartoCode() {
		return this.pressHotKeys('Cmd+L R', 'Quarto: Run Current Code');
	}

	// -----------------------
	// ---   Formatting	   ---
	// -----------------------
	public formatDocument() {
		return this.pressHotKeys('Cmd+L F', 'Format Document');
	}

	// -----------------------
	// ---   Publishing	   ---
	// -----------------------
	public publishDocument() {
		return this.pressHotKeys('Cmd+L P', 'Publish Document');
	}

	/**
	 * Press the hotkeys.
	 * Note: Supports multiple key sequences separated by spaces.
	 * @param keyCombo the hotkeys to press (e.g. "Cmd+Shift+P").
	 */
	private async pressHotKeys(keyCombo: string, description?: string, needsFocusFirst = false): Promise<void> {
		const stepWrapper = (label: string, fn: () => Promise<void>) => {
			try {
				// Check if running in a test context
				if (test.info().title) {
					return test.step(label, fn); // Use test.step if inside a test
				}
			} catch (e) {
				// Catch errors if not in a test context
			}
			return fn(); // Run directly if not in a test
		};

		const modifierKey = this.getModifierKey();
		const stepDescription = description
			? `Shortcut: ${description}`
			: `Press hotkeys: ${keyCombo}`;

		await stepWrapper(stepDescription, async () => {
			// For external browser testing, first click on the titlebar to ensure focus
			if (this.isExternalBrowser() && needsFocusFirst) {
				const titlebarDragRegion = this.code.driver.currentPage.locator('.titlebar-drag-region');
				if (await titlebarDragRegion.isVisible()) {
					await titlebarDragRegion.click();
				}
			}

			// Replace "Cmd" with the platform-appropriate modifier key
			// and (for Windows and Ubuntu) replace "Option" with "Alt"
			const keySequences = keyCombo.split(' ').map(keys => {
				return keys
					.replace(/cmd/gi, modifierKey)
					.replace(/option/gi, process.platform !== 'darwin' ? 'Alt' : 'Option');
			});

			// Hacky solution to get shortcut to show up as an action in the trace
			if (!this.code.driver.currentPage.isClosed()) {
				try {
					await this.code.driver.currentPage.evaluate(msg => {
					}, `Shortcut: ${description}`);
				} catch (e) {
					// Ignore - context may not be ready after navigation
				}
			}

			for (const key of keySequences) {
				await this.code.driver.currentPage.keyboard.press(key);
			}
		});
	}
}
