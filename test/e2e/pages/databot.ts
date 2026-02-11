/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, FrameLocator } from '@playwright/test';
import { Code } from '../infra/code';
import { QuickAccess } from './quickaccess';

// Webview frame selectors (Databot renders inside a VS Code webview)
const OUTER_FRAME = '.webview';
const INNER_FRAME = '#active-frame';

// Tab selector (lives on the main page, not inside the webview)
const DATABOT_TAB = 'div.tab[aria-label^="Databot"]';

// Sidebar action buttons (left side)
const SIDEBAR_NEW_CHAT_BUTTON = '[data-sidebar="menu-button"]:has-text("New Conversation")';
const SIDEBAR_SESSIONS_BUTTON = 'TODO_SIDEBAR_SESSIONS_BUTTON';
const SIDEBAR_VARIABLES_BUTTON = 'TODO_SIDEBAR_VARIABLES_BUTTON';
const SIDEBAR_HISTORY_BUTTON = 'TODO_SIDEBAR_HISTORY_BUTTON';
const SIDEBAR_DOWNLOAD_BUTTON = '[data-sidebar="menu-button"]:has-text("Import/Export Conversation")';
const SIDEBAR_SETTINGS_BUTTON = 'TODO_SIDEBAR_SETTINGS_BUTTON';

// Welcome/landing page elements
const WELCOME_MESSAGE = 'TODO_WELCOME_MESSAGE';

// Suggested question links
const SUGGESTED_QUESTION_LINK = 'TODO_SUGGESTED_QUESTION_LINK';

// Chat input area
const CHAT_INPUT = 'textarea[placeholder="Ask Databot... Type / to see commands"]';
const SEND_BUTTON = 'button:has(svg.lucide-arrow-up)';
const STOP_BUTTON = 'button:has(svg.lucide-square)';

// Bottom status bar
const RUNTIME_INDICATOR = 'span[data-slot="tooltip-trigger"]';
const MODEL_SELECTOR = '[data-slot="dropdown-menu-trigger"]:has(.flex)';

// Chat message elements
const CHAT_MESSAGE_USER = '.chat-message-user';
const CHAT_MESSAGE_ASSISTANT = '.chat-message-assistant';
const CHAT_MESSAGE_CONTENT = '.message-content';

// Inline plot image
const INLINE_PLOT = '.chat-messages img[alt^="Plot"]';

// Code block elements
const CODE_BLOCK = '.monaco-editor[role="code"]';
const CODE_BLOCK_COPY_BUTTON = 'button[aria-label="Copy"]';
const CODE_BLOCK_INSERT_CURSOR_BUTTON = 'button[aria-label="Insert At Cursor"]';
const CODE_BLOCK_INSERT_FILE_BUTTON = 'button[aria-label="Insert into New File"]';
const TOOL_CONFIRM_TITLE = 'h4.font-semibold';
const TOOL_ALLOW_SESSION_BUTTON = 'button:has-text("Allow for session")';
const TOOL_ALLOW_ONCE_BUTTON = 'button:has-text("Allow once")';
const TOOL_DECLINE_BUTTON = 'button:has-text("Decline")';

/**
 * Page object for the Databot extension.
 * Databot is a chatbot assistant that renders inside a VS Code webview,
 * so most element access requires navigating through nested iframes.
 */
export class Databot {

	constructor(private code: Code, private quickaccess: QuickAccess) { }

	/**
	 * Gets the frame locator for the Databot webview content.
	 * All Databot UI elements live inside this nested iframe.
	 */
	get frame(): FrameLocator {
		return this.code.driver.page.frameLocator(OUTER_FRAME).frameLocator(INNER_FRAME);
	}

	/**
	 * Opens Databot in the editor panel via command palette.
	 */
	async open(): Promise<void> {
		await this.quickaccess.runCommand('Open Databot in Editor Panel');
		await expect(this.code.driver.page.getByRole('tab', { name: 'Databot' })).toBeVisible();
	}

	/**
	 * Waits for Databot to be ready by verifying the chat input is visible.
	 * Works on both the landing page and a resumed chat session.
	 * @param timeout Maximum time to wait in milliseconds (default: 30000)
	 */
	async waitForReady(timeout: number = 30000): Promise<void> {
		await expect(this.frame.locator(CHAT_INPUT)).toBeVisible({ timeout });
	}

	/**
	 * Verifies that the Databot tab is visible (tab is on the main page, not in the webview).
	 */
	async expectTabVisible(): Promise<void> {
		await expect(this.code.driver.page.locator(DATABOT_TAB)).toBeVisible();
	}

	/**
	 * Verifies that the welcome message is displayed.
	 * TODO: WELCOME_MESSAGE locator needs to be set from the actual DOM.
	 */
	async expectWelcomeVisible(): Promise<void> {
		await expect(this.frame.locator(WELCOME_MESSAGE)).toBeVisible();
	}

	/**
	 * Clicks a suggested question link by its text.
	 * TODO: SUGGESTED_QUESTION_LINK locator needs to be set from the actual DOM.
	 * @param questionText The text of the suggested question to click
	 */
	async clickSuggestedQuestion(questionText: string): Promise<void> {
		await this.frame.locator(SUGGESTED_QUESTION_LINK).filter({ hasText: questionText }).click();
	}

	// Chat input

	/**
	 * Enters a message in the chat input.
	 * @param message The message to enter
	 */
	async enterMessage(message: string): Promise<void> {
		const chatInput = this.frame.locator(CHAT_INPUT);
		await chatInput.waitFor({ state: 'visible' });
		await chatInput.fill(message);
	}

	/**
	 * Clicks the send button to submit the current message.
	 */
	async clickSend(): Promise<void> {
		await this.frame.locator(SEND_BUTTON).click();
	}

	/**
	 * Clicks the stop button to cancel a running response.
	 * The send button changes to a red square while Databot is responding.
	 */
	async clickStop(): Promise<void> {
		await this.frame.locator(STOP_BUTTON).click();
	}

	/**
	 * Sends a chat message with options.
	 * @param message The message to send
	 * @param waitForResponse Whether to wait for the response to complete (default: true)
	 * @param options.newConversation Whether to start a new conversation first (default: true).
	 *   If the button is disabled (already on landing page), this is a no-op.
	 */
	async sendMessage(message: string, waitForResponse: boolean = true, options: { newConversation?: boolean } = {}): Promise<void> {
		const { newConversation = true } = options;
		if (newConversation) {
			await this.startNewConversation();
		}
		await this.enterMessage(message);
		await this.clickSend();
		if (waitForResponse) {
			await this.waitForResponseComplete();
		}
	}

	/**
	 * Waits for the chat response to complete by waiting for the stop button
	 * to appear (busy) and then disappear (done).
	 * @param timeout Maximum time to wait in milliseconds (default: 60000)
	 */
	async waitForResponseComplete(timeout: number = 60000): Promise<void> {
		await this.frame.locator(STOP_BUTTON).waitFor({ state: 'visible' });
		await this.frame.locator(STOP_BUTTON).waitFor({ state: 'hidden', timeout });
	}

	// Chat messages

	/**
	 * Verifies that an assistant response is visible.
	 */
	async expectResponseVisible(): Promise<void> {
		await expect(this.frame.locator(CHAT_MESSAGE_ASSISTANT)).toBeVisible();
	}

	/**
	 * Gets the text content of the most recent assistant response.
	 */
	async getLastResponseText(): Promise<string> {
		const response = this.frame.locator(`${CHAT_MESSAGE_ASSISTANT} ${CHAT_MESSAGE_CONTENT}`).last();
		return await response.textContent() ?? '';
	}

	/**
	 * Verifies a user message is visible.
	 */
	async expectUserMessageVisible(): Promise<void> {
		await expect(this.frame.locator(CHAT_MESSAGE_USER)).toBeVisible();
	}

	// Inline plots

	/**
	 * Verifies that an inline plot image is visible in the chat.
	 * @param timeout Maximum time to wait in milliseconds (default: 30000)
	 */
	async expectInlinePlotVisible(timeout: number = 30000): Promise<void> {
		await expect(this.frame.locator(INLINE_PLOT).first()).toBeVisible({ timeout });
	}

	// Code block actions

	/**
	 * Clicks the copy button on a code block.
	 * @param index The index of the code block (0-based)
	 */
	async copyCodeBlock(index: number = 0): Promise<void> {
		await this.frame.locator(CODE_BLOCK).nth(index).hover();
		await this.frame.locator(CODE_BLOCK_COPY_BUTTON).nth(index).click();
	}

	/**
	 * Clicks the "Insert At Cursor" button on a code block.
	 * @param index The index of the code block (0-based)
	 */
	async insertCodeBlockAtCursor(index: number = 0): Promise<void> {
		await this.frame.locator(CODE_BLOCK).nth(index).hover();
		await this.frame.locator(CODE_BLOCK_INSERT_CURSOR_BUTTON).nth(index).click();
	}

	/**
	 * Clicks the "Insert into New File" button on a code block.
	 * @param index The index of the code block (0-based)
	 */
	async insertCodeBlockIntoNewFile(index: number = 0): Promise<void> {
		await this.frame.locator(CODE_BLOCK).nth(index).hover();
		await this.frame.locator(CODE_BLOCK_INSERT_FILE_BUTTON).nth(index).click();
	}

	// Tool confirmation

	/**
	 * Verifies the tool confirmation dialog is visible.
	 */
	async expectToolConfirmVisible(): Promise<void> {
		await expect(this.frame.locator(TOOL_CONFIRM_TITLE)).toBeVisible();
	}

	/**
	 * Clicks "Allow for session" on the tool confirmation dialog.
	 */
	async allowToolForSession(): Promise<void> {
		await this.frame.locator(TOOL_ALLOW_SESSION_BUTTON).click();
	}

	/**
	 * Clicks "Allow once" on the tool confirmation dialog.
	 */
	async allowToolOnce(): Promise<void> {
		await this.frame.locator(TOOL_ALLOW_ONCE_BUTTON).click();
	}

	/**
	 * Clicks "Decline" on the tool confirmation dialog.
	 */
	async declineTool(): Promise<void> {
		await this.frame.locator(TOOL_DECLINE_BUTTON).click();
	}

	// Sidebar actions

	/**
	 * Starts a new conversation if possible.
	 * If the "New Conversation" button is disabled (already on landing page), this is a no-op.
	 */
	async startNewConversation(): Promise<void> {
		const button = this.frame.locator(SIDEBAR_NEW_CHAT_BUTTON);
		if (await button.isDisabled()) {
			return;
		}
		await button.click();
		await expect(this.frame.locator(CHAT_INPUT)).toBeVisible();
	}

	/**
	 * Clicks the sessions button in the sidebar.
	 * TODO: SIDEBAR_SESSIONS_BUTTON locator needs to be set from the actual DOM.
	 */
	async clickSessions(): Promise<void> {
		await this.frame.locator(SIDEBAR_SESSIONS_BUTTON).click();
	}

	/**
	 * Clicks the variables button in the sidebar.
	 * TODO: SIDEBAR_VARIABLES_BUTTON locator needs to be set from the actual DOM.
	 */
	async clickVariables(): Promise<void> {
		await this.frame.locator(SIDEBAR_VARIABLES_BUTTON).click();
	}

	/**
	 * Clicks the history button in the sidebar.
	 * TODO: SIDEBAR_HISTORY_BUTTON locator needs to be set from the actual DOM.
	 */
	async clickHistory(): Promise<void> {
		await this.frame.locator(SIDEBAR_HISTORY_BUTTON).click();
	}

	/**
	 * Clicks the settings button in the sidebar.
	 * TODO: SIDEBAR_SETTINGS_BUTTON locator needs to be set from the actual DOM.
	 */
	async clickSettings(): Promise<void> {
		await this.frame.locator(SIDEBAR_SETTINGS_BUTTON).click();
	}

	/**
	 * Clicks the import/export button in the sidebar.
	 */
	async clickDownload(): Promise<void> {
		await this.frame.locator(SIDEBAR_DOWNLOAD_BUTTON).click();
	}

	// Status bar

	/**
	 * Gets the current model name from the model selector.
	 */
	async getModelName(): Promise<string> {
		const model = this.frame.locator(MODEL_SELECTOR);
		return await model.textContent() ?? '';
	}

	/**
	 * Gets the current runtime from the status bar.
	 */
	async getRuntimeName(): Promise<string> {
		const runtime = this.frame.locator(RUNTIME_INDICATOR);
		return await runtime.textContent() ?? '';
	}

	/**
	 * Verifies the model selector shows the expected model.
	 * @param modelName The expected model name
	 */
	async expectModel(modelName: string): Promise<void> {
		await expect(this.frame.locator(MODEL_SELECTOR)).toContainText(modelName);
	}

	/**
	 * Verifies the runtime indicator shows the expected runtime.
	 * @param runtimeName The expected runtime (e.g., "R 4.5.1" or "Python 3.12")
	 */
	async expectRuntime(runtimeName: string): Promise<void> {
		await expect(this.frame.locator(RUNTIME_INDICATOR)).toContainText(runtimeName);
	}

	/**
	 * Closes the Databot tab (tab is on the main page, not in the webview).
	 */
	async close(): Promise<void> {
		await this.code.driver.page.locator(`${DATABOT_TAB} .codicon-close`).click();
	}

}
