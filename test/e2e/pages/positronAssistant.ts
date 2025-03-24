/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { expect, test } from '@playwright/test';
import { Code } from '../infra/code';

const CHATBUTTON = '.action-label.codicon-comment-discussion[aria-label="Chat (Ctrl+Alt+I)"]';
const ADD_MODEL_LINK = 'a[data-href="command:positron-assistant.addModelConfiguration"]';
const APIKEY_INPUT = 'input.text-input[type="password"]';
const DONE_BUTTON = 'button.positron-button.action-bar-button.default';
const SIGN_IN_BUTTON = 'button.positron-button.language-model.button.sign-in:has-text("Sign in")';
const SIGN_OUT_BUTTON = 'button.positron-button.language-model.button.sign-in:has-text("Sign out")';
const ANTHROPIC_BUTTON = 'button.positron-button.language-model.button:has(svg path[fill="#D97757"])';
const AWS_BEDROCK_BUTTON = 'button.positron-button.language-model.button:has(svg[id*="bedrock"])';
const ECHO_MODEL_BUTTON = 'button.positron-button.language-model.button:has(.codicon-info)';
const ERROR_MODEL_BUTTON = 'button.positron-button.language-model.button:has(.codicon-error)';
const GEMINI_BUTTON = 'button.positron-button.language-model.button:has(svg path[fill="url(#gemini-color_svg__a)"])';

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
			try {
				await this.verifyAddModelLinkVisible();
			}
			catch (e) {
				await this.code.driver.page.locator(CHATBUTTON).click();
			}
		});
	}

	async clickAddModelLink() {
		await this.code.driver.page.locator(ADD_MODEL_LINK).click();
	}

	async verifyAddModelLinkVisible() {
		await expect(this.code.driver.page.locator(ADD_MODEL_LINK)).toBeVisible();
		await expect(this.code.driver.page.locator(ADD_MODEL_LINK)).toHaveText('Add a Language Model.');
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
			default:
				throw new Error(`Unsupported model provider: ${provider}`);
		}
	}

	async enterApiKey(apiKey: string) {
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
}
