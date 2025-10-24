/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { expect, test } from '@playwright/test';
import { Code } from '../infra/code';
import { QuickAccess } from './quickaccess';
import { Toasts } from './dialog-toasts';

const CHAT_BUTTON = '.action-label.codicon-positron-assistant[aria-label^="Chat"]';
const CONFIGURE_MODELS_LINK = 'a[data-href="command:positron-assistant.configureModels"]';
const ADD_MODEL_BUTTON = '[id="workbench.panel.chat"] button[aria-label="Configure Model Providers..."]';
const APIKEY_INPUT = '#api-key-input input.text-input[type="password"]';
const CLOSE_BUTTON = 'button.positron-button.action-bar-button.default:has-text("Close")';
const SIGN_IN_BUTTON = 'button.positron-button.language-model.button.sign-in:has-text("Sign in")';
const SIGN_OUT_BUTTON = 'button.positron-button.language-model.button.sign-in:has-text("Sign out")';
const ANTHROPIC_BUTTON = 'button.positron-button.language-model.button:has(#anthropic-api-provider-button)';
const AWS_BEDROCK_BUTTON = 'button.positron-button.language-model.button:has(#bedrock-provider-button)';
const ECHO_MODEL_BUTTON = 'button.positron-button.language-model.button:has(div.codicon-info)';
const ERROR_MODEL_BUTTON = 'button.positron-button.language-model.button:has(div.codicon-error)';
const GEMINI_BUTTON = 'button.positron-button.language-model.button:has(#google-provider-button)';
const COPILOT_BUTTON = 'button.positron-button.language-model.button:has(#copilot-provider-button)';
const CHAT_PANEL = '#workbench\\.panel\\.chat';
const RUN_BUTTON = 'a.action-label.codicon.codicon-play[role="button"][aria-label="Run in Console"]';
const APPLY_IN_EDITOR_BUTTON = 'a.action-label.codicon.codicon-git-pull-request-go-to-changes[role="button"][aria-label="Apply in Editor"]';
const INSERT_AT_CURSOR_BUTTON = 'a.action-label.codicon.codicon-insert[role="button"][aria-label^="Insert At Cursor"]';
const COPY_BUTTON = 'a.action-label.codicon.codicon-copy[role="button"][aria-label="Copy"]';
const INSERT_NEW_FILE_BUTTON = 'a.action-label.codicon.codicon-new-file[role="button"][aria-label="Insert into New File"]';
const OAUTH_RADIO = '.language-model-authentication-method-container input#oauth[type="radio"]';
const APIKEY_RADIO = '.language-model-authentication-method-container input#apiKey[type="radio"]';
const CHAT_INPUT = '.chat-editor-container .interactive-input-editor textarea.inputarea';
const SEND_MESSAGE_BUTTON = '.action-container .action-label.codicon-send[aria-label^="Send"]';
const NEW_CHAT_BUTTON = '.composite.title .actions-container[aria-label="Chat actions"] .action-item .action-label.codicon-plus[aria-label^="New Chat"]';
const INLINE_CHAT_TOOLBAR = '.interactive-input-part.compact .chat-input-toolbars';
const MODE_DROPDOWN = 'a.action-label[aria-label^="Set Mode"]';
const MODE_DROPDOWN_ITEM = '.monaco-list-row[role="menuitemcheckbox"]';
const MODEL_PICKER_DROPDOWN = '.action-item.chat-modelPicker-item .monaco-dropdown .dropdown-label a.action-label[aria-label*="Pick Model"]';
const MODEL_DROPDOWN_ITEM = '.monaco-list-row[role="menuitemcheckbox"]';
const MANAGE_MODELS_ITEM = '.action-widget a.action-label[aria-label="Manage language models"]';
/*
 *  Reuseable Positron Assistant functionality for tests to leverage.
 */
export class Assistant {

	constructor(private code: Code, private quickaccess: QuickAccess, private toasts: Toasts) { }

	async verifyChatButtonVisible() {
		await expect(this.code.driver.page.locator(CHAT_BUTTON)).toBeVisible();
	}

	async openPositronAssistantChat() {
		await test.step('Verify Assistant is enabled and Open it.', async () => {
			await this.verifyChatButtonVisible();
			const addModelLinkIsVisible = await this.code.driver.page.locator(CHAT_PANEL).isVisible();
			if (!addModelLinkIsVisible) {
				await this.code.driver.page.locator(CHAT_BUTTON).click();
			}
		});
	}

	async closeInlineChat() {
		await test.step('Close Inline Chat', async () => {
			this.code.driver.page.getByRole('button', { name: 'Close (Escape)' }).click();
		});
	}

	async clickAddModelLink() {
		await this.code.driver.page.locator(CONFIGURE_MODELS_LINK).click();
	}

	async clickAddModelButton() {
		await this.code.driver.page.locator(ADD_MODEL_BUTTON).click();
	}

	async verifyAddModelLinkVisible() {
		await expect(this.code.driver.page.locator(CONFIGURE_MODELS_LINK)).toBeVisible();
		await expect(this.code.driver.page.locator(CONFIGURE_MODELS_LINK)).toHaveText('Add a Language Model.');
	}

	async verifyAddModelButtonVisible() {
		await expect(this.code.driver.page.locator(ADD_MODEL_BUTTON)).toBeVisible();
		await expect(this.code.driver.page.locator(ADD_MODEL_BUTTON)).toHaveText('Configure Model Providers...');
	}

	async verifyInlineChatInputsVisible() {
		await expect(this.code.driver.page.locator(INLINE_CHAT_TOOLBAR)).toBeVisible();
		await expect(this.code.driver.page.locator(INLINE_CHAT_TOOLBAR)).toBeInViewport({ ratio: 1 });
	}

	async verifyCodeBlockActions() {
		await expect(this.code.driver.page.locator(RUN_BUTTON)).toHaveCount(1);
		await expect(this.code.driver.page.locator(APPLY_IN_EDITOR_BUTTON)).toHaveCount(1);
		await expect(this.code.driver.page.locator(INSERT_AT_CURSOR_BUTTON)).toHaveCount(1);
		await expect(this.code.driver.page.locator(COPY_BUTTON)).toHaveCount(1);
		await expect(this.code.driver.page.locator(INSERT_NEW_FILE_BUTTON)).toHaveCount(1);
	}

	async verifyManageModelsOptionVisible() {
		await this.code.driver.page.locator(MODEL_PICKER_DROPDOWN).click();
		await expect(this.code.driver.page.locator(MANAGE_MODELS_ITEM)).toBeVisible();
	}

	async selectModelProvider(provider: string) {
		switch (provider.toLowerCase()) {
			case 'anthropic-api':
				await this.code.driver.page.locator(ANTHROPIC_BUTTON).click();
				break;
			case 'aws':
			case 'bedrock':
			case 'aws bedrock':
			case 'amazon bedrock':
				await this.code.driver.page.locator(AWS_BEDROCK_BUTTON).click();
				break;
			case 'echo':
				await this.code.driver.page.locator(ECHO_MODEL_BUTTON).click();
				break;
			case 'error':
				await this.code.driver.page.locator(ERROR_MODEL_BUTTON).click();
				break;
			case 'gemini':
				await this.code.driver.page.locator(GEMINI_BUTTON).click();
				break;
			case 'copilot':
				await this.code.driver.page.locator(COPILOT_BUTTON).click();
				break;
			default:
				throw new Error(`Unsupported model provider: ${provider}`);
		}
	}

	async enterApiKey(apiKey: string) {
		await this.code.driver.page.locator(APIKEY_RADIO).check();
		const apiKeyInput = this.code.driver.page.locator(APIKEY_INPUT);
		await apiKeyInput.fill(apiKey);
	}

	async clickSignInButton() {
		await this.code.driver.page.locator(SIGN_IN_BUTTON).click();
	}

	async clickCloseButton() {
		await this.code.driver.page.locator(CLOSE_BUTTON).click();
	}

	async clickSignOutButton() {
		await this.code.driver.page.locator(SIGN_OUT_BUTTON).click();
	}

	async verifySignOutButtonVisible(timeout: number = 15000) {
		await expect(this.code.driver.page.locator(SIGN_OUT_BUTTON)).toBeVisible({ timeout });
		await expect(this.code.driver.page.locator(SIGN_OUT_BUTTON)).toHaveText('Sign out', { timeout });
	}

	async verifySignInButtonVisible(timeout: number = 15000) {
		await expect(this.code.driver.page.locator(SIGN_IN_BUTTON)).toBeVisible({ timeout });
		await expect(this.code.driver.page.locator(SIGN_IN_BUTTON)).toHaveText('Sign in', { timeout });
	}

	async verifyAuthMethod(type: 'oauth' | 'apiKey') {
		switch (type) {
			case 'oauth':
				await expect(this.code.driver.page.locator(OAUTH_RADIO)).toBeChecked();
				await expect(this.code.driver.page.locator(APIKEY_RADIO)).toBeDisabled();
				break;
			case 'apiKey':
				await expect(this.code.driver.page.locator(APIKEY_RADIO)).toBeChecked();
				await expect(this.code.driver.page.locator(OAUTH_RADIO)).toBeDisabled();
				break;
			default:
				throw new Error(`Unsupported auth method: ${type}`);
		}
	}

	async enterChatMessage(message: string, waitForResponse: boolean = true) {
		const chatInput = this.code.driver.page.locator(CHAT_INPUT);
		await chatInput.waitFor({ state: 'visible' });
		await chatInput.fill(message);
		await this.code.driver.page.locator(SEND_MESSAGE_BUTTON).click();
		// Optionally wait for any loading state on the most recent response to finish
		if (waitForResponse) {
			await this.code.driver.page.locator('.chat-most-recent-response.chat-response-loading').waitFor({ state: 'hidden' });
		}
	}

	async clickChatCodeRunButton(codeblock: string) {
		await this.code.driver.page.locator(`span`).filter({ hasText: codeblock }).locator('span').first().dblclick();
		await this.code.driver.page.locator(RUN_BUTTON).click();
	}

	async clickNewChatButton() {
		await this.code.driver.page.locator(NEW_CHAT_BUTTON).click();
		await expect(this.code.driver.page.locator(CHAT_INPUT)).toBeVisible();
	}

	async verifyTokenUsageVisible() {
		await expect(this.code.driver.page.locator('.token-usage')).toBeVisible();
		await expect(this.code.driver.page.locator('.token-usage')).toHaveText(/Tokens: ↑\d+ ↓\d+/);
	}

	async verifyTokenUsageNotVisible() {
		await expect(this.code.driver.page.locator('.token-usage')).not.toBeVisible();
	}

	async verifyTotalTokenUsageVisible() {
		await expect(this.code.driver.page.locator('.token-usage-total')).toBeVisible();
		await expect(this.code.driver.page.locator('.token-usage-total')).toHaveText(/Total tokens: ↑\d+ ↓\d+/);
	}

	async verifyNumberOfVisibleResponses(expectedCount: number, checkTokenUsage: boolean = false) {
		const responses = this.code.driver.page.locator('.interactive-response');
		await expect(responses).toHaveCount(expectedCount);
		if (checkTokenUsage) {
			this.code.driver.page.locator('.token-usage').nth(expectedCount - 1).waitFor({ state: 'visible' });
		}
	}

	async getTokenUsage() {
		const tokenUsageElement = this.code.driver.page.locator('.token-usage');
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
		const totalTokenUsageElement = this.code.driver.page.locator('.token-usage-total');
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
		await this.code.driver.page.waitForSelector('.chat-input-toolbars .codicon-send', { timeout });
		await this.code.driver.page.waitForSelector('.detail-container .detail:has-text("Working")', { state: 'hidden', timeout });
	}

	async waitForSendButtonVisible() {
		await this.code.driver.page.locator(SEND_MESSAGE_BUTTON).waitFor({ state: 'visible' });
	}

	async selectChatMode(mode: string) {
		// Click the mode dropdown to open it
		await this.code.driver.page.locator(MODE_DROPDOWN).click();

		// Wait for the dropdown menu to appear
		await this.code.driver.page.locator(MODE_DROPDOWN_ITEM).first().waitFor({ state: 'visible' });

		// Find and click the item with the matching text
		const items = this.code.driver.page.locator(MODE_DROPDOWN_ITEM);
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
		// Click the model picker dropdown to open it
		await this.code.driver.page.locator(MODEL_PICKER_DROPDOWN).click();

		// Wait for the dropdown menu to appear
		await this.code.driver.page.locator(MODEL_DROPDOWN_ITEM).first().waitFor({ state: 'visible' });

		// Find and click the item with the matching text
		const items = this.code.driver.page.locator(MODEL_DROPDOWN_ITEM);
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

	async getChatResponseText(exportFolder?: string) {
		// Export the chat to a file first
		await this.quickaccess.runCommand(`positron-assistant.exportChatToFileInWorkspace`);
		await this.toasts.waitForAppear();
		await this.toasts.closeAll();

		// Find and parse the chat export file
		const chatExportFile = await this.findChatExportFile(exportFolder);
		if (!chatExportFile) {
			throw new Error('No chat export file found');
		}

		const responseText = await this.parseChatResponseFromFile(chatExportFile);

		// Rename the file to prevent it from being found again
		await this.renameChatExportFile(chatExportFile);

		return responseText;
	}

	/**
	 * Finds the most recent chat export JSON file matching the pattern 'positron-chat-export-*'
	 * @param exportFolder Optional folder path to search in. If not provided, searches in current working directory
	 * @returns The file path of the found chat export file, or null if not found
	 */
	async findChatExportFile(exportFolder?: string): Promise<string | null> {
		const fs = require('fs').promises;
		const path = require('path');

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
		const fs = require('fs').promises;

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
	 * Renames a chat export file to mark it as processed
	 * @param filePath Path to the chat export JSON file to rename
	 */
	async renameChatExportFile(filePath: string): Promise<void> {
		const fs = require('fs').promises;
		const path = require('path');

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
