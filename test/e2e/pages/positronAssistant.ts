/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { expect, test } from '@playwright/test';
import { Code } from '../infra/code';

const CHATBUTTON = '.action-label.codicon-positron-assistant[aria-label^="Chat"]';
const ADD_MODEL_LINK = 'a[data-href="command:positron-assistant.addModelConfiguration"]';
const ADD_MODEL_BUTTON = '[id="workbench.panel.chat"] button[aria-label="Add Model Provider..."]';
const APIKEY_INPUT = '#api-key-input input.text-input[type="password"]';
const DONE_BUTTON = 'button.positron-button.action-bar-button.default';
const SIGN_IN_BUTTON = 'button.positron-button.language-model.button.sign-in:has-text("Sign in")';
const SIGN_OUT_BUTTON = 'button.positron-button.language-model.button.sign-in:has-text("Sign out")';
const ANTHROPIC_BUTTON = 'button.positron-button.language-model.button:has(#anthropic-provider-button)';
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
const SEND_MESSAGE_BUTTON = '.action-container .action-label.codicon-send[aria-label="Send and Dispatch (Enter)"]';
const NEW_CHAT_BUTTON = '.composite.title .actions-container[aria-label="Chat actions"] .action-item .action-label.codicon-plus[aria-label^="New Chat"]';
const INLINE_CHAT_TOOLBAR = '.interactive-input-part.compact .chat-input-toolbars';
/*
 *  Reuseable Positron Assistant functionality for tests to leverage.
 */
export class Assistant {

	constructor(private code: Code) { }

	async verifyChatButtonVisible() {
		await expect(this.code.driver.page.locator(CHATBUTTON)).toBeVisible();
	}

	async openPositronAssistantChat() {
		await test.step('Verify Assistant is enabled and Open it.', async () => {
			await this.verifyChatButtonVisible();
			const addModelLinkIsVisible = await this.code.driver.page.locator(CHAT_PANEL).isVisible();
			if (!addModelLinkIsVisible) {
				await this.code.driver.page.locator(CHATBUTTON).click();
			}
		});
	}

	async closeInlineChat() {
		await test.step('Close Inline Chat', async () => {
			this.code.driver.page.getByRole('button', { name: 'Close (Escape)' }).click();
		});
	}

	async clickAddModelLink() {
		await this.code.driver.page.locator(ADD_MODEL_LINK).click();
	}

	async clickAddModelButton() {
		await this.code.driver.page.locator(ADD_MODEL_BUTTON).click();
	}

	async verifyAddModelLinkVisible() {
		await expect(this.code.driver.page.locator(ADD_MODEL_LINK)).toBeVisible();
		await expect(this.code.driver.page.locator(ADD_MODEL_LINK)).toHaveText('Add a Language Model.');
	}

	async verifyAddModelButtonVisible() {
		await expect(this.code.driver.page.locator(ADD_MODEL_BUTTON)).toBeVisible();
		await expect(this.code.driver.page.locator(ADD_MODEL_BUTTON)).toHaveText('Add Model Provider...');
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

	async selectModelProvider(provider: string) {
		switch (provider.toLowerCase()) {
			case 'anthropic':
				await this.code.driver.page.locator(ANTHROPIC_BUTTON).click();
				break;
			case 'aws':
			case 'bedrock':
			case 'aws bedrock':
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

	async clickDoneButton() {
		await this.code.driver.page.locator(DONE_BUTTON).click();
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

	async enterChatMessage(message: string) {
		const chatInput = this.code.driver.page.locator(CHAT_INPUT);
		await chatInput.waitFor({ state: 'visible' });
		await chatInput.fill(message);
		await this.code.driver.page.locator(SEND_MESSAGE_BUTTON).click();
	}

	async clickChatCodeRunButton(codeblock: string) {
		await this.code.driver.page.locator(`span`).filter({ hasText: codeblock }).locator('span').first().dblclick();
		await this.code.driver.page.locator(RUN_BUTTON).click();
	}

	async clickNewChatButton() {
		await this.code.driver.page.locator(NEW_CHAT_BUTTON).click();
		await expect(this.code.driver.page.locator(CHAT_INPUT)).toBeVisible();
	}


}
