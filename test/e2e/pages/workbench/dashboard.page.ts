/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, BrowserContext } from '@playwright/test';
import { Code } from '../../infra/code.js';
import { QuickInput } from '../quickInput.js';
import { generateTOTP } from '../../utils/totp.js';

export class DashboardPage {
	get title() { return this.code.driver.currentPage.getByRole('link', { name: 'Workbench projects' }); }
	get launchButton() { return this.code.driver.currentPage.getByRole('button', { name: 'Launch' }); }
	get quitButton() { return this.code.driver.currentPage.getByRole('button', { name: 'Quit' }); }
	get newSessionButton() { return this.code.driver.currentPage.getByRole('button', { name: 'New Session', exact: true }).first(); }
	get positronProButton() { return this.code.driver.currentPage.getByRole('tab', { name: 'Positron Pro' }); }
	get sessionNameInput() { return this.code.driver.currentPage.getByRole('textbox', { name: 'Session Name' }); }
	project = (projectName: string) => this.code.driver.currentPage.getByRole('link', { name: projectName });
	projectNewSessionButton = (projectName: string) => this.project(projectName).locator('..').locator('..').locator('..').getByRole('button', { name: 'Create new session' });
	projectCheckbox = (projectName: string) => this.code.driver.currentPage.getByRole('checkbox', { name: `select ${projectName}` });

	constructor(private code: Code, private quickInput: QuickInput) { }

	// #region Actions

	async goTo(): Promise<void> {
		await this.code.driver.currentPage.goto('http://localhost:8787');
		await this.expectHeaderToBeVisible();
	}

	/**
	 * Ensures a project exists, creating it if necessary
	 * @param folderToOpen The folder name to create/check for
	 * @param context Optional BrowserContext for setting up managed credentials via OAuth
	 * @returns true if a new session was created, false if project already existed
	 */
	async ensureProjectExists(folderToOpen = 'qa-example-content', context?: BrowserContext): Promise<boolean> {
		const existingProject = this.project(folderToOpen);

		try {
			await expect(existingProject).toBeVisible({ timeout: 3000 });
			return false; // Project already exists
		} catch {
			// Project doesn't exist, create it
			await this.createNewProject(folderToOpen, context);
			return true; // New project was created
		}
	}

	/**
	 * Creates a new project/session with the specified folder
	 * @param folderToOpen The folder name for the new project
	 * @param context Optional BrowserContext for setting up managed credentials via OAuth
	 */
	private async createNewProject(folderToOpen: string, context?: BrowserContext): Promise<void> {
		await this.newSessionButton.click();
		await this.positronProButton.click();

		// Setup managed credentials if context is provided and credentials section is visible
		if (context) {
			await this.setupManagedCredentialsIfNeeded(context);
		}

		await this.sessionNameInput.fill(folderToOpen);
		await this.launchButton.click();
		await this.code.driver.currentPage.getByRole('button', { name: 'Open Folder', exact: true }).click();
		await this.quickInput.waitForQuickInputOpened();
		await this.quickInput.selectQuickInputElementContaining(folderToOpen);
		await this.quickInput.clickOkButton();
	}

	/**
	 * Opens a session for the specified project, creating it if necessary
	 * @param projectName The project name to open
	 * @param context Optional BrowserContext for setting up managed credentials via OAuth
	 */
	async openSession(projectName = 'qa-example-content', context?: BrowserContext): Promise<void> {
		// Ensure the project exists before trying to open it
		// If a new project is created, it will auto-launch and set up managed credentials
		const newProjectCreated = await this.ensureProjectExists(projectName, context);

		if (!newProjectCreated) {
			// Project already existed, so we need to launch it
			const startNewSessionButton = this.projectNewSessionButton(projectName);

			try {
				await expect(startNewSessionButton).toBeVisible({ timeout: 3000 });
			} catch {
				// Clean up existing sessions if new session button is not available
				await this.quitSession(projectName);
				await expect(startNewSessionButton).toBeVisible();
			}

			await startNewSessionButton.click();
			await this.launchButton.click();
		}
	}

	/**
	 * Sets up managed credentials if credentials aren't already configured
	 * Note: Called from createNewProject when the New Session dialog is already open
	 * @param context BrowserContext for handling OAuth flows in new tabs
	 */
	private async setupManagedCredentialsIfNeeded(context: BrowserContext): Promise<void> {
		const page = this.code.driver.currentPage;

		// Wait for Session Credentials section to appear
		const credentialsSection = page.getByText('Session Credentials');
		try {
			await expect(credentialsSection).toBeVisible({ timeout: 5000 });
		} catch {
			// No credentials section - managed credentials not configured on this workbench instance
			return;
		}

		// Setup Databricks (will skip if already enabled)
		await this.setupDatabricksOAuth(context);

		// Setup Snowflake (will skip if already enabled)
		await this.setupSnowflakeOAuth(context);
	}

	/**
	 * Sets up Databricks managed credential via OAuth flow
	 * @param context BrowserContext for handling OAuth in new tab
	 */
	private async setupDatabricksOAuth(context: BrowserContext): Promise<void> {
		const page = this.code.driver.currentPage;

		// Check if already enabled
		const enabledWidget = page.locator('[aria-label*="Databricks"][aria-label*="Enabled"]');
		const isEnabled = await enabledWidget.isVisible().catch(() => false);
		if (isEnabled) {
			console.log('Databricks credential already configured, skipping setup');
			return;
		}

		console.log('Setting up Databricks OAuth...');

		const serviceAccountEmail = process.env.DATABRICKS_SERVICE_ACCOUNT_EMAIL!;
		const serviceAccountPassword = process.env.DATABRICKS_SERVICE_ACCOUNT_PASSWORD!;
		const otpSecret = process.env.DATABRICKS_SERVICE_ACCOUNT_OTP_SECRET!;

		// Click Databricks sign in - opens OAuth in new tab
		const [oauthPage] = await Promise.all([
			context.waitForEvent('page'),
			page.locator('[aria-label*="Databricks"]').first().click(),
		]);

		console.log('OAuth page opened:', oauthPage.url());

		// Navigate to Okta SSO via Databricks
		await oauthPage.waitForURL(/cloud\.databricks\.com\/login\.html/, { timeout: 15000 });
		const ssoButton = oauthPage.locator('a:has-text("Continue with SSO")');
		await expect(ssoButton).toBeVisible({ timeout: 10000 });
		await ssoButton.click();
		await oauthPage.waitForURL(/okta\.com/, { timeout: 15000 });

		// Enter Okta credentials
		const usernameField = oauthPage.locator('#input28');
		const passwordField = oauthPage.locator('input[type="password"]');
		const nextButton = oauthPage.locator('input[value="Next"]');
		const verifyButton = oauthPage.locator('input[value="Verify"]');

		await expect(usernameField).toBeVisible({ timeout: 10000 });
		await usernameField.fill(serviceAccountEmail);
		await expect(nextButton).toBeVisible({ timeout: 10000 });
		await nextButton.click();
		await expect(passwordField).toBeVisible({ timeout: 5000 });
		await passwordField.fill(serviceAccountPassword);
		await expect(verifyButton).toBeVisible({ timeout: 10000 });
		await verifyButton.click();

		// Complete 2FA authentication
		await oauthPage.waitForLoadState('networkidle', { timeout: 10000 });
		const otpField = oauthPage.locator('input[type="text"], input[type="tel"], input[autocomplete="one-time-code"]').first();
		await expect(otpField).toBeVisible({ timeout: 15000 });

		const totpCode = generateTOTP(otpSecret);
		console.log('Generated TOTP code for Databricks');
		await otpField.fill(totpCode);

		const verifyOtpButton = oauthPage.locator('button:has-text("Verify"), input[value="Verify"]');
		await expect(verifyOtpButton).toBeVisible({ timeout: 10000 });
		await verifyOtpButton.click();

		// Wait for OAuth redirect to Workbench
		try {
			await oauthPage.waitForURL(/oauth_redirect_callback|localhost:8787/, { timeout: 15000 });
			await oauthPage.waitForTimeout(2000);
			await oauthPage.close();
		} catch {
			console.log('OAuth page closed or timed out (may be expected)');
		}

		// Verify credentials are enabled
		await expect(enabledWidget).toBeVisible({ timeout: 30000 });
		console.log('Databricks OAuth setup complete');
	}

	/**
	 * Sets up Snowflake managed credential via OAuth flow
	 * @param context BrowserContext for handling OAuth in new tab
	 */
	private async setupSnowflakeOAuth(context: BrowserContext): Promise<void> {
		const page = this.code.driver.currentPage;

		// Check if already enabled
		const enabledWidget = page.locator('[aria-label*="Snowflake"][aria-label*="Enabled"]');
		const isEnabled = await enabledWidget.isVisible().catch(() => false);
		if (isEnabled) {
			console.log('Snowflake credential already configured, skipping setup');
			return;
		}

		console.log('Setting up Snowflake OAuth...');

		const snowflakeUsername = process.env.SNOWFLAKE_USERNAME!;
		const snowflakePassword = process.env.SNOWFLAKE_PASSWORD!;

		// Click Snowflake sign in - opens OAuth in new tab
		const snowflakeWidget = page.locator('[aria-label*="Snowflake"]').first();
		const [oauthPage] = await Promise.all([
			context.waitForEvent('page'),
			snowflakeWidget.click(),
		]);

		console.log('Snowflake OAuth page opened:', oauthPage.url());

		// Wait for Snowflake login page to load
		await oauthPage.waitForLoadState('networkidle');

		// Enter Snowflake credentials
		await oauthPage.fill('[autocomplete="username"]', snowflakeUsername);
		await oauthPage.fill('[autocomplete="current-password"]', snowflakePassword);

		// Click sign in button
		const signInButton = oauthPage.getByRole('button', { name: 'Sign In' }).nth(1);
		await expect(signInButton).toBeVisible({ timeout: 10000 });
		await signInButton.click();

		// Check for "Allow" authorization button (may appear on first OAuth flow)
		const allowButton = oauthPage.getByRole('button', { name: 'Allow' });
		try {
			await allowButton.waitFor({ timeout: 5000 });
			await allowButton.click();
			console.log('Clicked "Allow" authorization button');
		} catch {
			console.log('No "Allow" button found, proceeding...');
		}

		// Wait for OAuth to complete
		await page.waitForTimeout(2000);

		// Enable the credential widget if it's in disabled state
		const disabledWidget = page.locator('[aria-label*="Snowflake"][aria-label*="Disabled"]');
		const isDisabled = await disabledWidget.isVisible().catch(() => false);
		if (isDisabled) {
			await disabledWidget.click();
		}

		// Verify credentials are enabled
		await expect(enabledWidget).toBeVisible({ timeout: 10000 });
		console.log('Snowflake OAuth setup complete');
	}

	/**
	 * Quits the specified project session
	 * @param projectName The project name to quit
	 */
	async quitSession(projectName = 'qa-example-content'): Promise<void> {
		await this.projectCheckbox(projectName).check();
		await this.quitButton.click();
	}

	// #endregion

	// #region Verifications

	async expectHeaderToBeVisible() {
		await expect(this.title).toBeVisible();
	}

	// #endregion
}
