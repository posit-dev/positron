/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { Code } from '../../infra/code.js';
import { generateTOTP } from '../../utils/totp.js';
import { isOktaLockedOut, otpRetryDelayMs } from '../../utils/otpRetry.js';

export class AuthPage {
	get username() { return this.code.driver.currentPage.getByRole('textbox', { name: 'username' }); }
	get password() { return this.code.driver.currentPage.getByRole('textbox', { name: 'password' }); }
	get signInButton() { return this.code.driver.currentPage.getByRole('button', { name: 'Sign In' }); }

	constructor(private code: Code) { }

	async goTo(): Promise<void> {
		await this.code.driver.currentPage.goto('http://localhost:8787/auth-sign-in');
	}

	async signIn(username = 'user1', password = process.env.POSIT_WORKBENCH_PASSWORD || ''): Promise<void> {
		await this.username.clear();
		await this.username.fill(username);
		await this.password.clear();
		await this.password.fill(password);
		await this.signInButton.click();
	}

	/**
	 * Sign in via Azure OIDC. Requires Workbench to be configured with auth-openid=1 against the
	 * Azure AD tenant. Clicks the OIDC Sign In button, navigates the Microsoft -> Okta -> OTP flow
	 * using the service account credentials, then handles the "Stay signed in?" prompt and lands
	 * back on the PWB homepage.
	 *
	 * Env vars (loaded by the workflow via 1Password):
	 * - IDE_SERVICE_ACCOUNT_EMAIL  (the rstudio-ide-test service account UPN)
	 * - IDE_SERVICE_ACCOUNT_PASSWORD
	 * - IDE_SERVICE_ACCOUNT_OTP_SECRET (base32 TOTP seed)
	 */
	async signInWithAzure(): Promise<void> {
		const page = this.code.driver.currentPage;
		const serviceAccountEmail = process.env.IDE_SERVICE_ACCOUNT_EMAIL;
		const serviceAccountPassword = process.env.IDE_SERVICE_ACCOUNT_PASSWORD;
		const otpSecret = process.env.IDE_SERVICE_ACCOUNT_OTP_SECRET;
		if (!serviceAccountEmail || !serviceAccountPassword || !otpSecret) {
			throw new Error(
				'signInWithAzure requires IDE_SERVICE_ACCOUNT_EMAIL, IDE_SERVICE_ACCOUNT_PASSWORD, and IDE_SERVICE_ACCOUNT_OTP_SECRET env vars to be set'
			);
		}

		// 1. Click the OIDC Sign In button on the PWB landing page (redirects to Microsoft).
		await expect(this.signInButton).toBeVisible({ timeout: 15000 });
		await this.signInButton.click();

		// 2. Microsoft sign-in page: enter the service account UPN and click Next.
		const msUsername = page.locator('input[type="email"], input[name="loginfmt"]').first();
		await this.typeIntoField(msUsername, serviceAccountEmail);
		await page.getByRole('button', { name: /^Next$/ }).click();

		// 3. Microsoft federates to posit.okta.com for password.
		//    Wait for the Okta page to settle so Angular has bound the form before we type.
		await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => { /* not all browsers honor networkidle, fall through */ });
		const oktaPassword = page.locator('input[type="password"]').first();
		await this.typeIntoField(oktaPassword, serviceAccountPassword);
		await page.getByRole('button', { name: /^Verify$/ }).click();

		// 4. OTP prompt. The TOTP secret is shared across parallel shards, so a code can be
		//    rejected (reused by another shard) or the account can be locked out ("too many
		//    attempts"). Retry up to 3 times, backing off with jitter between attempts so we
		//    fall into a different TOTP window than the competing shard. See otpRetry.ts.
		const otpField = page.locator('input[autocomplete="one-time-code"], input[type="tel"], input[type="text"]').first();
		const verifyOtpButton = page.getByRole('button', { name: /^Verify$/ });
		const staySignedInYes = page.getByRole('button', { name: /^Yes$/ });

		const maxAttempts = 3;
		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			await this.typeIntoField(otpField, generateTOTP(otpSecret));
			await verifyOtpButton.click();

			// Success when the "Stay signed in?" prompt appears.
			try {
				await expect(staySignedInYes).toBeVisible({ timeout: 10000 });
				break;
			} catch (err) {
				if (attempt === maxAttempts) {
					throw new Error(`OTP authentication failed after ${maxAttempts} attempts`);
				}
				const lockedOut = await isOktaLockedOut(page);
				const delay = otpRetryDelayMs(lockedOut);
				this.code.logger.log(`Azure OTP not accepted (attempt ${attempt}/${maxAttempts}, lockedOut=${lockedOut}); backing off ${delay}ms before retry`);
				await page.waitForTimeout(delay);
			}
		}

		// 5. "Stay signed in?" -> Yes. Lands back on the PWB homepage.
		await staySignedInYes.click();
	}

	/**
	 * Robust text entry for Okta/Angular forms: wait for the field to be editable, focus it,
	 * clear any stale value, type one keystroke at a time so the framework's input bindings fire,
	 * then assert the value committed before the caller submits.
	 */
	private async typeIntoField(
		locator: ReturnType<typeof this.code.driver.currentPage.locator>,
		value: string
	): Promise<void> {
		await expect(locator).toBeEditable({ timeout: 30000 });
		await locator.click();
		await locator.fill('');
		await locator.pressSequentially(value, { delay: 30 });
		await expect(locator).toHaveValue(value, { timeout: 5000 });
	}
}
