/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, FrameLocator, Page } from '@playwright/test';
import { promisify } from 'util';
import { exec } from 'child_process';
import { QuickInput } from './quickInput.js';

const execP = promisify(exec);

export class Publisher {

	constructor(
		private quickInput: QuickInput
	) { }

	/**
	 * Get the outer and inner webview frames for the publisher UI
	 */
	getPublisherFrames(page: Page): { outerFrame: FrameLocator; innerFrame: FrameLocator } {
		const outerFrame = page.frameLocator('iframe.webview.ready');
		const innerFrame = outerFrame.frameLocator('iframe#active-frame');
		return { outerFrame, innerFrame };
	}

	/**
	 * When publishing a Quarto document, the first-run wizard may ask whether to
	 * publish the source code or the rendered document. This prompt appears on
	 * macOS / some Publisher versions and is absent on others (e.g. the Linux
	 * Workbench run), so it is handled optionally: select "Publish document with
	 * source code" when the prompt shows within the timeout, otherwise no-op.
	 */
	async selectSourceCodeDeployment(): Promise<void> {
		const sourceOption = this.quickInput.quickInputList.getByText('Publish document with source code', { exact: false });
		try {
			await sourceOption.waitFor({ state: 'visible', timeout: 5000 });
			await sourceOption.click();
		} catch {
			// Deployment-type prompt not shown in this environment; continue.
		}
	}

	/**
	 * Enter Connect server URL and API key to authenticate
	 * @param page Playwright page
	 * @param connectServer Connect server URL
	 * @param apiKey Connect API key
	 */
	async enterConnectCredentials(page: Page, connectServer: string, apiKey: string): Promise<void> {
		await this.quickInput.selectQuickInputElement(1, true);
		await expect(page.getByText('Please provide the Posit Connect server\'s URL')).toBeVisible({ timeout: 10000 });
		await this.quickInput.type(connectServer);
		await page.keyboard.press('Enter');

		// Enter API key
		await this.quickInput.selectQuickInputElement(1, true);
		const apiKeyInputLocator = page.locator('div.monaco-inputbox input[type="password"]');
		await expect(apiKeyInputLocator).toBeVisible({ timeout: 30000 });
		await this.quickInput.type(apiKey);
		await page.keyboard.press('Enter');
	}

	/**
	 * Provide a unique name for the credential
	 * @param page Playwright page
	 * @param credentialName Name for the credential
	 * @param connectServer Connect server URL for verification
	 */
	async saveCredentialName(page: Page, credentialName: string, connectServer: string): Promise<void> {
		await expect(page.getByText(`Successfully connected to ${connectServer}`)).toBeVisible({ timeout: 10000 });
		await this.quickInput.type(credentialName);
		await page.keyboard.press('Enter');
	}

	/**
	 * Select additional files to include in deployment
	 * @param innerFrame Inner iframe locator
	 * @param filenames Array of file names to select
	 */
	async selectDeploymentFiles(innerFrame: FrameLocator, filenames: string[]): Promise<void> {
		for (const filename of filenames) {
			await innerFrame.locator('.tree-item-container')
				.filter({ hasText: filename })
				.locator('.tree-item-checkbox .checkbox-control')
				.click();
		}
	}

	/**
	 * Get the deploy button from the publisher webview
	 * @param innerFrame Inner iframe locator
	 */
	getDeployButton(innerFrame: FrameLocator) {
		return innerFrame.locator('vscode-button[data-automation="deploy-button"] >>> button');
	}

	/**
	 * Deploy the project and wait for completion
	 * @param innerFrame Inner iframe locator
	 * @param page Playwright page
	 * @param timeoutMs Timeout in milliseconds (default: 200000)
	 * @returns appGuid of the deployed content
	 */
	async deployAndWaitForCompletion(innerFrame: FrameLocator, page: Page, timeoutMs: number = 200000): Promise<string | null> {
		const deployButton = this.getDeployButton(innerFrame);
		await deployButton.click({ timeout: 5000 });

		await expect(page.locator('text=Deployment was successful').first()).toBeVisible({ timeout: timeoutMs });

		// Extract appGuid from deployment message
		await page.locator('.monaco-action-bar .action-label', { hasText: 'Publisher' }).click({ timeout: 60000 });

		const deployedLocator = page.locator('.monaco-tl-row .monaco-highlighted-label', { hasText: 'Successfully deployed at' });
		const deploymentText = await deployedLocator.textContent();

		return this.extractGuid(deploymentText || '');
	}

	/**
	 * Extract GUID from deployment message
	 */
	extractGuid(line: string): string | null {
		const m = line.match(
			/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?!.*[0-9a-f-])/i
		);
		return m ? m[1] : null;
	}

	/**
	 * Check if a saved credential exists
	 * @param page Playwright page
	 * @param credentialName Name of the credential to check
	 * @returns true if credential exists, false otherwise
	 */
	async hasSavedCredential(page: Page, credentialName: string): Promise<boolean> {
		const existing = this.quickInput.quickInputList.getByText(credentialName);
		try {
			await existing.textContent({ timeout: 3000 });
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Use a saved credential (select first item in quick input)
	 */
	async useSavedCredential(): Promise<void> {
		await this.quickInput.selectQuickInputElement(0, false);
	}

	/**
	 * Best-effort removal of the Posit Publisher credentials the extension keeps
	 * in the OS secret store, so the next publish flow re-enters a fresh key.
	 *
	 * This self-heals the local-only footgun where the connect-data volume was
	 * wiped (a new bootstrap key is minted) but a saved `connect-container`
	 * credential still holds the previous, now-stale key. Only implemented for
	 * macOS (the supported local-dev host); a no-op with a log elsewhere.
	 */
	async clearSavedCredentials(): Promise<void> {
		if (process.platform !== 'darwin') {
			console.log(`clearSavedCredentials: no-op on ${process.platform}; remove "Posit Publisher Safe Storage" from the OS secret store manually if the saved credential is stale.`);
			return;
		}
		try {
			// Delete every "Posit Publisher Safe Storage" login-keychain entry.
			// `security` deletes one match per call, so loop until none remain.
			for (let i = 0; i < 10; i++) {
				await execP('security delete-generic-password -s "Posit Publisher Safe Storage"');
			}
		} catch {
			// Non-zero exit once no matching entry remains (or none existed): done.
		}
	}
}
