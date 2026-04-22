/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Code } from '../../infra/code';

/**
 * Jupyter authentication page
 */
export class JupyterAuthPage {

	constructor(private code: Code) { }

	/**
	 * Sign in to JupyterHub
	 */
	async signIn(): Promise<void> {
		const page = this.code.driver.page;

		// Wait for login form to be visible
		await page.waitForSelector('#username_input', { timeout: 30000 });

		// Get password from environment
		const password = process.env.POSIT_WORKBENCH_PASSWORD;
		if (!password) {
			throw new Error('POSIT_WORKBENCH_PASSWORD environment variable is not set');
		}

		// Fill in credentials
		await page.fill('#username_input', 'admin');
		await page.fill('#password_input', password);

		// Submit login form
		await page.click('#login_submit');

		// Wait for navigation to complete
		await page.waitForLoadState('networkidle');
	}
}
