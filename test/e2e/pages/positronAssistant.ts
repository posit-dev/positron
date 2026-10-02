/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { expect, test } from '@playwright/test';
import { Code } from '../infra/code';
import { QuickAccess } from './quickaccess';
import { Toasts } from './dialog-toasts';


const CHAT_BUTTON = '.action-label.codicon-positron-assistant[aria-label^="Chat"]';
const CHAT_PANEL = '#workbench\\.panel\\.chat';
const RUN_BUTTON = 'a.action-label.codicon.codicon-play[role="button"][aria-label="Run in Console"]';
const APPLY_IN_EDITOR_BUTTON = 'a.action-label.codicon.codicon-git-pull-request-go-to-changes[role="button"][aria-label="Apply in Editor"]';
const INSERT_AT_CURSOR_BUTTON = 'a.action-label.codicon.codicon-insert[role="button"][aria-label^="Insert At Cursor"]';
const COPY_BUTTON = 'a.action-label.codicon.codicon-copy[role="button"][aria-label="Copy"]';
const INSERT_NEW_FILE_BUTTON = 'a.action-label.codicon.codicon-new-file[role="button"][aria-label="Insert into New File"]';
const KEEP_BUTTON = 'a.action-label[role="button"][aria-label^="Keep Chat Edits"]';
const CHAT_INPUT = '.chat-editor-container .interactive-input-editor .native-edit-context';
const SEND_MESSAGE_BUTTON = '.actions-container .action-label.codicon-arrow-up[aria-label^="Send"]';
const NEW_CHAT_BUTTON = '.composite.title .actions-container[aria-label="Chat actions"] .action-item .action-label.codicon-plus[aria-label^="New Chat"]';
const INLINE_CHAT_TOOLBAR = '.interactive-input-part.compact .chat-input-toolbars';
const MODE_DROPDOWN = '.chat-input-toolbars a.action-label[aria-label^="Set Agent"]';
const MODE_DROPDOWN_ITEM = '.monaco-list-row[role="menuitemcheckbox"]';
// const MODEL_PICKER_DROPDOWN = '.action-item.chat-input-picker-item a.action-label[aria-label^="Pick Model"] .codicon.codicon-chevron-down';
const MODEL_DROPDOWN_ITEM = '.monaco-list-row[role="menuitemcheckbox"]';
const MANAGE_MODELS_ITEM = '.action-widget .monaco-list-row span.title:has-text("Manage Models...")';

/**
 * Result of sending a chat message.
 */
export interface EnterChatMessageResult {
	/** Time from clicking send to response complete (excluding button interaction time) */
	llmResponseMs: number;
	/** Total wall-clock time from send to complete */
	totalMs: number;
	/** Number of Keep button clicks */
	keepClicks: number;
	/** Number of Allow button clicks */
	allowClicks: number;
}

/*
 *  Reuseable Positron Assistant functionality for tests to leverage.
 */
export class Assistant {

	constructor(private code: Code, private quickaccess: QuickAccess, private toasts: Toasts) { }

	async verifyChatButtonVisible() {
		await expect(this.code.driver.currentPage.locator(CHAT_BUTTON)).toBeVisible();
	}

	async openPositronAssistantChat() {
		await test.step('Open Positron Assistant Chat.', async () => {
			const chatPanelIsVisible = await this.code.driver.currentPage.locator(CHAT_PANEL).isVisible();
			if (!chatPanelIsVisible) {
				await this.quickaccess.runCommand('workbench.action.chat.open');
			}
		});
	}

	async closeInlineChat() {
		await test.step('Close Inline Chat', async () => {
			this.code.driver.currentPage.getByRole('button', { name: 'Close (Escape)' }).click();
		});
	}

	async openModelPickerDropdown() {
		const chatInput = this.code.driver.currentPage.locator(CHAT_INPUT);
		await chatInput.waitFor({ state: 'visible' });
		await chatInput.click({ force: true });
		const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
		await this.code.driver.currentPage.keyboard.press(`${modifier}+Alt+Period`);
	}

	async verifyInlineChatInputsVisible() {
		await expect(this.code.driver.currentPage.locator(INLINE_CHAT_TOOLBAR)).toBeVisible();
		await expect(this.code.driver.currentPage.locator(INLINE_CHAT_TOOLBAR)).toBeInViewport({ ratio: 1 });
	}

	async verifyCodeBlockActions() {
		await expect(this.code.driver.currentPage.locator(RUN_BUTTON)).toHaveCount(1);
		// PR #10784: "Apply in Editor" button may be disabled depending on model chosen and user settings
		await expect(await this.code.driver.currentPage.locator(APPLY_IN_EDITOR_BUTTON).count()).toBeLessThanOrEqual(1);
		await expect(this.code.driver.currentPage.locator(INSERT_AT_CURSOR_BUTTON)).toHaveCount(1);
		await expect(this.code.driver.currentPage.locator(COPY_BUTTON)).toHaveCount(1);
		await expect(this.code.driver.currentPage.locator(INSERT_NEW_FILE_BUTTON)).toHaveCount(1);
	}

	async pickModel() {
		await this.openModelPickerDropdown();
	}

	async expectManageModelsVisible() {
		await expect(this.code.driver.currentPage.locator(MANAGE_MODELS_ITEM)).toBeVisible({ timeout: 3000 });
	}

	/**
	 * Enters a chat message and optionally waits for the response to complete.
	 * This is a simple method that does NOT handle Keep/Allow buttons.
	 * Use sendChatMessageAndWait() for scenarios that may require button interaction.
	 *
	 * @param message The message to send
	 */
	async enterChatMessage(message: string) {
		const chatInput = this.code.driver.currentPage.locator(CHAT_INPUT);
		await chatInput.waitFor({ state: 'visible' });
		await chatInput.pressSequentially(message);
		await this.code.driver.currentPage.locator(SEND_MESSAGE_BUTTON).click();
		// It can take a moment for the loading locator to become visible.
		await this.code.driver.currentPage.locator('.chat-most-recent-response.chat-response-loading').waitFor({ state: 'visible' });
	}

	/**
	 * Sends a chat message and waits for the response to complete, automatically
	 * handling any Keep/Allow buttons that appear. Returns timing information
	 * that excludes button interaction time for accurate LLM response measurement.
	 *
	 * Use this for eval tests or scenarios where Keep/Allow buttons may appear.
	 *
	 * @param message The message to send
	 * @param options Optional configuration (timeout, etc.)
	 * @returns Result containing timing information
	 */
	async sendChatMessageAndWait(message: string, options: { timeout?: number } = {}): Promise<EnterChatMessageResult> {
		const { timeout = 60000 } = options;
		const page = this.code.driver.currentPage;

		// Locators for completion states
		const loadingResponse = page.locator('.chat-most-recent-response.chat-response-loading');
		const keepButton = page.locator(KEEP_BUTTON);
		const allowButton = page.getByRole('button', { name: 'Allow' });

		// Send the message
		const chatInput = page.locator(CHAT_INPUT);
		await chatInput.waitFor({ state: 'visible' });
		await chatInput.pressSequentially(message);

		const sendTime = Date.now();
		await page.locator(SEND_MESSAGE_BUTTON).click();

		// Wait for loading to start
		await loadingResponse.waitFor({ state: 'visible' });

		// Button configs for Keep/Allow handling
		const buttons = [
			{ locator: keepButton, name: 'keep' as const },
			{ locator: allowButton, name: 'allow' as const },
		];
		const clicks = { keep: 0, allow: 0 };
		let buttonInteractionMs = 0;
		const deadline = Date.now() + timeout;

		// Loop until response is complete, handling buttons as they appear
		while (await loadingResponse.isVisible()) {
			if (Date.now() > deadline) {
				throw new Error(`Response did not complete within ${timeout}ms`);
			}

			// Check each button - click if visible and enabled
			let buttonClicked = false;
			for (const btn of buttons) {
				const isClickable = await btn.locator.isVisible().catch(() => false) &&
					await btn.locator.isEnabled().catch(() => false);
				if (isClickable) {
					const buttonStart = Date.now();
					try {
						// Use a short timeout: button may become disabled between the isEnabled
						// check above and the actual click action (TOCTOU race condition)
						await btn.locator.click({ timeout: 2000 });
						await page.waitForTimeout(100);
						buttonInteractionMs += Date.now() - buttonStart;
						clicks[btn.name]++;
						buttonClicked = true;
					} catch {
						// Button became disabled/detached between check and click; retry on next loop iteration
					}
					break;
				}
			}
			if (buttonClicked) { continue; }

			// No clickable buttons, wait a short interval before checking again
			await page.waitForTimeout(200);
		}

		const totalMs = Date.now() - sendTime;

		return {
			llmResponseMs: totalMs - buttonInteractionMs,
			totalMs,
			keepClicks: clicks.keep,
			allowClicks: clicks.allow,
		};
	}

	/**
	 * Waits for the chat response to complete by waiting for the loading state to disappear.
	 * This can be called independently when a message has already been sent and we need to
	 * wait for the response to finish.
	 * @param timeout The maximum time to wait for the response to complete (default: 60000ms)
	 */
	async waitForResponseComplete(timeout: number = 60000) {
		await this.code.driver.currentPage.locator('.chat-most-recent-response.chat-response-loading').waitFor({ state: 'visible' });
		await this.code.driver.currentPage.locator('.chat-most-recent-response.chat-response-loading').waitFor({ state: 'hidden', timeout });
	}

	/**
	 * Asserts that the chat response is complete (not loading).
	 * Unlike waitForResponseComplete, this does not wait for loading to become visible first,
	 * making it suitable for asserting state when the response may already be complete.
	 * @param timeout The maximum time to wait for the assertion (default: 10000ms)
	 */
	async expectResponseComplete(timeout: number = 10000) {
		await expect(this.code.driver.currentPage.locator('.chat-most-recent-response.chat-response-loading')).not.toBeVisible({ timeout });
	}

	/**
	 * Verifies the chat panel is visible.
	 * @param timeout The maximum time to wait for visibility (default: 10000ms)
	 */
	async expectChatPanelVisible(timeout: number = 10000) {
		await test.step('Verify chat panel is visible', async () => {
			await expect(this.code.driver.currentPage.locator(CHAT_PANEL)).toBeVisible({ timeout });
		});
	}

	/**
	 * Verifies a chat response is visible.
	 * @param timeout The maximum time to wait for visibility (default: 10000ms)
	 */
	async expectChatResponseVisible(timeout: number = 10000) {
		await test.step('Verify chat response is visible', async () => {
			await expect(this.code.driver.currentPage.locator('.interactive-response')).toBeVisible({ timeout });
		});
	}

	async clickChatCodeRunButton(codeblock: string) {
		await this.code.driver.currentPage.locator(`span`).filter({ hasText: codeblock }).locator('span').first().dblclick();
		await this.code.driver.currentPage.locator(RUN_BUTTON).click();
	}

	async clickKeepButton(timeout: number = 10000) {
		await this.code.driver.currentPage.locator(KEEP_BUTTON).click({ timeout });
	}

	/**
	 * Clicks the "Allow" button that appears when the assistant requests permission to use a tool.
	 * @param timeout Maximum time to wait for the button to appear (default: 30000ms)
	 * @returns true if the button was clicked, false if it wasn't found within the timeout
	 */
	async clickAllowButton(timeout: number = 10000): Promise<boolean> {
		try {
			const allowButton = this.code.driver.currentPage.getByRole('button', { name: 'Allow' });
			await allowButton.waitFor({ state: 'visible', timeout });
			await allowButton.click();
			return true;
		} catch {
			return false;
		}
	}

	async clickNewChatButton() {
		await this.code.driver.currentPage.locator(NEW_CHAT_BUTTON).click();
		await expect(this.code.driver.currentPage.locator(CHAT_INPUT)).toBeVisible();
	}

	async verifyTokenUsageVisible() {
		await expect(this.code.driver.currentPage.locator('.token-usage')).toBeVisible();
		await expect(this.code.driver.currentPage.locator('.token-usage')).toHaveText(/Tokens: ↑\d+ ↓\d+/);
	}

	async verifyTokenUsageNotVisible() {
		await expect(this.code.driver.currentPage.locator('.token-usage')).not.toBeVisible();
	}

	async verifyTotalTokenUsageVisible() {
		await expect(this.code.driver.currentPage.locator('.token-usage-total')).toBeVisible();
		await expect(this.code.driver.currentPage.locator('.token-usage-total')).toHaveText(/Total tokens: ↑\d+ ↓\d+/);
	}

	async verifyNumberOfVisibleResponses(expectedCount: number, checkTokenUsage: boolean = false) {
		const responses = this.code.driver.currentPage.locator('.interactive-response');
		await expect(responses).toHaveCount(expectedCount);
		if (checkTokenUsage) {
			this.code.driver.currentPage.locator('.token-usage').nth(expectedCount - 1).waitFor({ state: 'visible' });
		}
	}

	async getTokenUsage() {
		const tokenUsageElement = this.code.driver.currentPage.locator('.token-usage');
		await expect(tokenUsageElement).toBeVisible();
		const text = await tokenUsageElement.textContent();
		expect(text).not.toBeNull();
		const inputMatch = text ? text.match(/↑(\d+)/) : null;
		const outputMatch = text ? text.match(/↓(\d+)/) : null;
		return {
			inputTokens: inputMatch ? parseInt(inputMatch[1], 10) : 0,
			outputTokens: outputMatch ? parseInt(outputMatch[1], 10) : 0
		};
	}

	async getTotalTokenUsage() {
		const totalTokenUsageElement = this.code.driver.currentPage.locator('.token-usage-total');
		await expect(totalTokenUsageElement).toBeVisible();
		const text = await totalTokenUsageElement.textContent();
		console.log('Total Token Usage Text:', text);
		expect(text).not.toBeNull();
		const totalMatch = text ? text.match(/Total tokens: ↑(\d+) ↓(\d+)/) : null;
		return {
			inputTokens: totalMatch ? parseInt(totalMatch[1], 10) : 0,
			outputTokens: totalMatch ? parseInt(totalMatch[2], 10) : 0
		};
	}

	async waitForReadyToSend(timeout: number = 25000) {
		await this.code.driver.currentPage.waitForSelector('.chat-input-toolbars .codicon-arrow-up', { timeout });
		await this.code.driver.currentPage.waitForSelector('.detail-container .detail:has-text("Working")', { state: 'hidden', timeout });
	}

	async waitForSendButtonVisible() {
		await this.code.driver.currentPage.locator(SEND_MESSAGE_BUTTON).waitFor({ state: 'visible' });
	}

	async selectChatMode(mode: string) {
		// Use retry logic to handle flaky dropdown opening
		await expect(async () => {
			// Click the mode dropdown to open it
			const dropdown = this.code.driver.currentPage.locator(MODE_DROPDOWN);
			await dropdown.waitFor({ state: 'visible', timeout: 5000 });
			await dropdown.click();

			// Wait for the dropdown menu to appear
			await this.code.driver.currentPage.locator(MODE_DROPDOWN_ITEM).first().waitFor({ state: 'visible', timeout: 5000 });
		}).toPass({ timeout: 30000 });

		// Find and click the item with the matching text
		const items = this.code.driver.currentPage.locator(MODE_DROPDOWN_ITEM);
		const count = await items.count();

		for (let i = 0; i < count; i++) {
			const item = items.nth(i);
			const titleSpan = item.locator('span.title');
			const text = await titleSpan.textContent();

			if (text?.trim() === mode) {
				// Use force: true to bypass the pointer block
				await item.click({ force: true });
				return;
			}
		}

		throw new Error(`Mode "${mode}" not found in dropdown`);
	}

	async selectChatModel(model: string) {
		// Open the model picker dropdown
		await this.openModelPickerDropdown();

		// Wait for the dropdown menu to appear
		await this.code.driver.currentPage.locator(MODEL_DROPDOWN_ITEM).first().waitFor({ state: 'visible' });

		// Expand the "Other Models" section so all models are visible
		await this._expandOtherModelsSection();

		// Find and click the item with the matching text
		const items = this.code.driver.currentPage.locator(MODEL_DROPDOWN_ITEM);
		const count = await items.count();

		for (let i = 0; i < count; i++) {
			const item = items.nth(i);
			const titleSpan = item.locator('span.title');
			const text = await titleSpan.textContent();

			if (text?.trim() === model) {
				// Use force: true to bypass the pointer block
				await item.click({ force: true });
				return;
			}
		}

		throw new Error(`Model "${model}" not found in dropdown`);
	}

	/**
	 * Expands the "Other Models" collapsible section in the model picker if it is collapsed.
	 * The dropdown must already be open before calling this method.
	 */
	private async _expandOtherModelsSection(): Promise<void> {
		const collapsedToggle = this.code.driver.currentPage.locator(
			'.monaco-list-row.action'
		).filter({ hasText: 'Other Models' }).locator('.codicon-chevron-right');
		if (await collapsedToggle.count() > 0) {
			const toggleRow = this.code.driver.currentPage.locator(
				'.monaco-list-row.action'
			).filter({ hasText: 'Other Models' });
			await toggleRow.click({ force: true });
		}
	}

	async getChatResponseText(exportFolder?: string) {
		// Export and find the chat file with retry (export may silently fail or file may not be ready)
		let chatExportFile: string | null = null;
		await expect(async () => {
			await this.quickaccess.runCommand(`positron-assistant.exportChatToFileInWorkspace`);
			await this.toasts.waitForAppear('Chat log exported to:', { timeout: 10000 });
			await this.toasts.closeWithHeader('Chat log exported to:');
			chatExportFile = await this.findChatExportFile(exportFolder);
			expect(chatExportFile).not.toBeNull();
		}).toPass({ timeout: 15000 });

		const responseText = await this.parseChatResponseFromFile(chatExportFile!);

		// Rename the file to prevent it from being found again
		await this.renameChatExportFile(chatExportFile!);

		return responseText;
	}

	/**
	 * Finds the most recent chat export JSON file matching the pattern 'positron-chat-export-*'
	 * @param exportFolder Optional folder path to search in. If not provided, searches in current working directory
	 * @returns The file path of the found chat export file, or null if not found
	 */
	async findChatExportFile(exportFolder?: string): Promise<string | null> {
		const fs = await import('fs/promises');
		const path = await import('path');
		// Use provided folder or current working directory
		const searchPath = exportFolder || process.cwd();

		try {
			const files = await fs.readdir(searchPath);
			const chatExportFiles = files
				.filter((file: string) => file.match(/^positron-chat-export-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/))
				.map((file: string) => ({
					name: file,
					path: path.join(searchPath, file),
					// Extract timestamp from filename for sorting
					timestamp: file.match(/positron-chat-export-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.json$/)?.[1]
				}))
				.filter((file: any) => file.timestamp)
				.sort((a: any, b: any) => b.timestamp.localeCompare(a.timestamp)); // Sort by timestamp descending (newest first)

			if (chatExportFiles.length > 0) {
				return chatExportFiles[0].path;
			}
		} catch (error) {
			// Directory might not exist or not accessible
			console.log(`Could not search in ${searchPath}:`, error);
		}

		return null;
	}

	/**
	 * Parses the chat response text from a chat export JSON file
	 * @param filePath Path to the chat export JSON file
	 * @returns The concatenated response text from all chat responses
	 */
	async parseChatResponseFromFile(filePath: string): Promise<string> {
		const fs = await import('fs/promises');
		try {
			const fileContent = await fs.readFile(filePath, 'utf-8');
			const chatData = JSON.parse(fileContent);

			const responses: string[] = [];
			const toolCalls: string[] = [];

			// Extract response text from all requests
			if (chatData.requests && Array.isArray(chatData.requests)) {
				for (const request of chatData.requests) {
					if (request.response && Array.isArray(request.response)) {
						for (const responseItem of request.response) {
							if (responseItem.value && typeof responseItem.value === 'string') {
								responses.push(responseItem.value);
							}
							// Check for tool calls
							if (responseItem.toolId && typeof responseItem.toolId === 'string') {
								toolCalls.push(responseItem.toolId);
							}
						}
					}
				}
			}

			let result = responses.join('\n');

			// Add tool calls information if any were found
			if (toolCalls.length > 0) {
				result += '\n\nTools called: ' + toolCalls.join(', ');
			}

			return result;
		} catch (error) {
			throw new Error(`Failed to parse chat export file ${filePath}: ${error}`);
		}
	}

	/**
	 * Parses the available tools from a chat export JSON file
	 * @param filePath Path to the chat export JSON file
	 * @returns Array of available tool names from the most recent request
	 */
	async parseAvailableToolsFromFile(filePath: string): Promise<string[]> {
		const fs = require('fs').promises;

		try {
			const fileContent = await fs.readFile(filePath, 'utf-8');
			const chatData = JSON.parse(fileContent);

			// Get the available tools from the most recent request
			if (chatData.requests && Array.isArray(chatData.requests) && chatData.requests.length > 0) {
				const lastRequest = chatData.requests[chatData.requests.length - 1];
				if (lastRequest.result?.metadata?.availableTools) {
					return lastRequest.result.metadata.availableTools;
				}
			}

			return [];
		} catch (error) {
			throw new Error(`Failed to parse available tools from chat export file ${filePath}: ${error}`);
		}
	}

	/**
	 * Gets the available tools from the most recent chat response.
	 * Exports the chat to a file and parses the availableTools array from the metadata.
	 * @param exportFolder Optional folder path to export the chat to
	 * @returns Array of available tool names
	 */
	async getAvailableTools(exportFolder?: string): Promise<string[]> {
		// Export the chat to a file first
		await this.quickaccess.runCommand(`positron-assistant.exportChatToFileInWorkspace`);
		await this.toasts.waitForAppear('Chat log exported to:');
		await this.toasts.closeAll();

		// Find and parse the chat export file
		const chatExportFile = await this.findChatExportFile(exportFolder);
		if (!chatExportFile) {
			throw new Error('No chat export file found');
		}

		const availableTools = await this.parseAvailableToolsFromFile(chatExportFile);

		// Rename the file to prevent it from being found again
		await this.renameChatExportFile(chatExportFile);

		return availableTools;
	}

	/**
	 * Renames a chat export file to mark it as processed
	 * @param filePath Path to the chat export JSON file to rename
	 */
	async renameChatExportFile(filePath: string): Promise<void> {
		const fs = await import('fs/promises');
		const path = await import('path');
		try {
			const dir = path.dirname(filePath);
			const filename = path.basename(filePath);

			// Add ".processed" before the file extension
			const newFilename = filename.replace('.json', '.processed.json');
			const newFilePath = path.join(dir, newFilename);

			await fs.rename(filePath, newFilePath);
		} catch (error) {
			console.log(`Could not rename chat export file ${filePath}:`, error);
			// Don't throw error here to avoid breaking the main flow
		}
	}

}
