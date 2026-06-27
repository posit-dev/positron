/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, BrowserContext } from '@playwright/test';
import { Code } from '../../infra/code.js';
import { QuickInput } from '../quickInput.js';
import { generateTOTP } from '../../utils/totp.js';
import { isOktaLockedOut, otpRetryDelayMs } from '../../utils/otpRetry.js';

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
	 * @param managedCredentials Optional credential filter: 'snowflake', 'databricks', or undefined for both
	 * @returns true if a new session was created, false if project already existed
	 */
	async ensureProjectExists(folderToOpen = 'qa-example-content', context?: BrowserContext, managedCredentials?: 'snowflake' | 'databricks' | 'azure'): Promise<boolean> {
		const existingProject = this.project(folderToOpen);

		try {
			await expect(existingProject).toBeVisible({ timeout: 3000 });
			return false; // Project already exists
		} catch {
			// Project doesn't exist, create it
			await this.createNewProject(folderToOpen, context, managedCredentials);
			return true; // New project was created
		}
	}

	/**
	 * Creates a new project/session with the specified folder
	 * @param folderToOpen The folder name for the new project
	 * @param context Optional BrowserContext for setting up managed credentials via OAuth
	 * @param managedCredentials Optional credential filter: 'snowflake', 'databricks', or undefined for both
	 */
	private async createNewProject(folderToOpen: string, context?: BrowserContext, managedCredentials?: 'snowflake' | 'databricks' | 'azure'): Promise<void> {
		await this.newSessionButton.click();
		await this.positronProButton.click();

		// Setup managed credentials if context is provided and credentials section is visible
		if (context) {
			await this.setupManagedCredentialsIfNeeded(context, managedCredentials);
		}

		await this.sessionNameInput.fill(folderToOpen);
		await this.launchButton.click();

		// Azure JIT-provisioned users (rstudio-ide-test) don't have qa-example-content in their
		// home directory at launch time. The fixture handles copying the workspace into the JIT
		// user's home and calling openWorkspaceFolder() once Positron is up.
		if (managedCredentials === 'azure') {
			return;
		}

		await this.openWorkspaceFolder(folderToOpen);
	}

	/**
	 * Opens the given folder via Positron's welcome view "Open Folder" button + quick input.
	 * Used both from the dashboard flow (after Launch) and externally by the Azure fixture once
	 * the JIT user's workspace has been copied into place.
	 */
	async openWorkspaceFolder(folderToOpen: string): Promise<void> {
		await this.code.driver.currentPage.getByRole('button', { name: 'Open Folder', exact: true }).click();
		await this.quickInput.waitForQuickInputOpened();

		// When the picker opens already pointed at the target folder, its path is prefilled
		// in the input box and the list shows the folder's *contents* (no row matches the
		// folder name), so selectQuickInputElementContaining would fail. In that case just
		// confirm with OK; otherwise navigate to the folder first.
		const input = this.code.driver.currentPage.locator('.quick-input-widget .quick-input-box input');
		const currentPath = (await input.inputValue().catch(() => '')).replace(/\/$/, '');
		if (!currentPath.endsWith(`/${folderToOpen}`)) {
			await this.quickInput.selectQuickInputElementContaining(folderToOpen);
		}
		await this.quickInput.clickOkButton();
	}

	/**
	 * Opens a session for the specified project, creating it if necessary
	 * @param projectName The project name to open
	 * @param context Optional BrowserContext for setting up managed credentials via OAuth
	 * @param managedCredentials Optional credential filter: 'snowflake', 'databricks', or undefined for both
	 */
	async openSession(projectName = 'qa-example-content', context?: BrowserContext, managedCredentials?: 'snowflake' | 'databricks' | 'azure'): Promise<void> {
		// Ensure the project exists before trying to open it
		// If a new project is created, it will auto-launch and set up managed credentials
		const newProjectCreated = await this.ensureProjectExists(projectName, context, managedCredentials);

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
	 * @param managedCredentials Credential to set up: 'snowflake' sets up only Snowflake, 'databricks'
	 *                           sets up only Databricks. If undefined, no credentials are configured.
	 */
	private async setupManagedCredentialsIfNeeded(context: BrowserContext, managedCredentials?: 'snowflake' | 'databricks' | 'azure'): Promise<void> {
		if (managedCredentials === undefined) {
			return;
		}

		const page = this.code.driver.currentPage;

		// Wait for Session Credentials section to appear
		const credentialsSection = page.getByText('Session Credentials');
		try {
			await expect(credentialsSection).toBeVisible({ timeout: 5000 });
		} catch {
			// No credentials section - managed credentials not configured on this workbench instance
			this.code.logger.log('Session Credentials section not found - managed credentials are not configured on this Workbench instance');
			return;
		}

		if (managedCredentials === 'snowflake') {
			await this.setupSnowflakeOAuth(context);
		} else if (managedCredentials === 'databricks') {
			await this.setupDatabricksOAuth(context);
		}
	}

	/**
	 * Sets up Databricks managed credential via OAuth flow
	 * @param context BrowserContext for handling OAuth in new tab
	 */
	private async setupDatabricksOAuth(context: BrowserContext): Promise<void> {
		const page = this.code.driver.currentPage;

		// Check if already enabled - wait 3 seconds for state to stabilize
		const enabledWidget = page.locator('[aria-label*="Databricks"][aria-label*="Enabled"]');
		try {
			await expect(enabledWidget).toBeVisible({ timeout: 3000 });
			this.code.logger.log('Databricks credential already configured, skipping setup');
			return;
		} catch {
			// Not enabled yet, proceed with setup
		}

		this.code.logger.log('Setting up Databricks OAuth...');

		const serviceAccountEmail = process.env.IDE_SERVICE_ACCOUNT_EMAIL!;
		const serviceAccountPassword = process.env.IDE_SERVICE_ACCOUNT_PASSWORD!;
		const otpSecret = process.env.IDE_SERVICE_ACCOUNT_OTP_SECRET!;

		// Click Databricks sign in - opens OAuth in new tab
		const [oauthPage] = await Promise.all([
			context.waitForEvent('page'),
			page.locator('[aria-label*="Databricks"]').first().click(),
		]);

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

		// Complete 2FA authentication. TOTPs roll every 30s and Okta rejects reused codes, so a
		// parallel shard (e.g. Azure) consuming the same code seconds earlier can knock us out, or
		// rapid duplicate submissions can lock the account ("too many attempts"). Retry up to 3
		// times, backing off with jitter between attempts so we de-align from the competing shard
		// and land in a different TOTP window (and back off longer on lockout). See otpRetry.ts.
		await oauthPage.waitForLoadState('networkidle', { timeout: 10000 });
		const otpField = oauthPage.locator('input[type="text"], input[type="tel"], input[autocomplete="one-time-code"]').first();
		const verifyOtpButton = oauthPage.locator('button:has-text("Verify"), input[value="Verify"]');

		const maxOtpAttempts = 3;
		let otpAccepted = false;
		for (let attempt = 1; attempt <= maxOtpAttempts; attempt++) {
			await expect(otpField).toBeVisible({ timeout: 15000 });
			await otpField.fill('');
			await otpField.fill(generateTOTP(otpSecret));
			this.code.logger.log(`Submitted TOTP code for Databricks (attempt ${attempt}/${maxOtpAttempts})`);
			await expect(verifyOtpButton).toBeVisible({ timeout: 10000 });
			await verifyOtpButton.click();

			try {
				await oauthPage.waitForURL(/oauth_redirect_callback|localhost:8787/, { timeout: 15000 });
				otpAccepted = true;
				break;
			} catch {
				// The OAuth tab sometimes closes itself on success (or on certain Okta errors).
				// A closed tab here is more likely "OAuth completed" than "OTP rejected" — bail
				// out of the retry loop and let the enabledWidget check below decide success.
				if (oauthPage.isClosed()) {
					this.code.logger.log('OAuth page closed before URL match; treating as completed and deferring to widget check');
					break;
				}
				if (attempt === maxOtpAttempts) {
					this.code.logger.log(`OTP not accepted after ${maxOtpAttempts} attempts; falling through to widget-state check`);
					break;
				}
				const lockedOut = await isOktaLockedOut(oauthPage);
				const delay = otpRetryDelayMs(lockedOut);
				this.code.logger.log(`Databricks OTP not accepted (attempt ${attempt}/${maxOtpAttempts}, lockedOut=${lockedOut}); backing off ${delay}ms before retry`);
				await oauthPage.waitForTimeout(delay);
			}
		}

		try {
			if (otpAccepted) {
				await oauthPage.waitForTimeout(2000);
			}
			if (!oauthPage.isClosed()) {
				await oauthPage.close();
			}
		} catch {
			this.code.logger.log('OAuth page closed or timed out (may be expected)');
		}

		// Verify credentials are enabled
		await expect(enabledWidget).toBeVisible({ timeout: 30000 });
		this.code.logger.log('Databricks OAuth setup complete');
	}

	/**
	 * Sets up Snowflake managed credential via OAuth flow
	 * @param context BrowserContext for handling OAuth in new tab
	 */
	private async setupSnowflakeOAuth(context: BrowserContext): Promise<void> {
		const page = this.code.driver.currentPage;

		// Check if already enabled - wait 3 seconds for state to stabilize
		const enabledWidget = page.locator('[aria-label*="Snowflake"][aria-label*="Enabled"]');
		try {
			await expect(enabledWidget).toBeVisible({ timeout: 3000 });
			this.code.logger.log('Snowflake credential already configured, skipping setup');
			return;
		} catch {
			// Not enabled yet, proceed with setup
		}

		this.code.logger.log('Setting up Snowflake OAuth...');

		const snowflakeUsername = process.env.SNOWFLAKE_USERNAME!;
		const snowflakePassword = process.env.SNOWFLAKE_PASSWORD!;

		// Click Snowflake sign in - opens OAuth in new tab
		const snowflakeWidget = page.locator('[aria-label*="Snowflake"]').first();
		const [oauthPage] = await Promise.all([
			context.waitForEvent('page'),
			snowflakeWidget.click(),
		]);

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
			this.code.logger.log('Clicked "Allow" authorization button');
		} catch {
			this.code.logger.log('No "Allow" button found, proceeding...');
		}

		// Wait for OAuth to complete and widget to reach its final state
		// Use expect.toPass to handle the race between widget state updates
		await expect(async () => {
			// Check if already enabled - if so, we're done
			const isEnabled = await enabledWidget.isVisible().catch(() => false);
			if (isEnabled) {
				this.code.logger.log('Snowflake credential already enabled after OAuth');
				return;
			}

			// Otherwise, look for disabled widget and click to enable
			const disabledWidget = page.locator('[aria-label*="Snowflake"][aria-label*="Disabled"]');
			const isDisabled = await disabledWidget.isVisible().catch(() => false);
			if (isDisabled) {
				await disabledWidget.click();
				this.code.logger.log('Clicked disabled widget to enable Snowflake credential');
			}

			// Verify it's now enabled
			await expect(enabledWidget).toBeVisible({ timeout: 2000 });
		}).toPass({ timeout: 15000 });

		this.code.logger.log('Snowflake OAuth setup complete');
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
