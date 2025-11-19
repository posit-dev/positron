/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Code } from '../../infra/code.js';

export class AuthPage {
	get username() { return this.code.driver.page.getByRole('textbox', { name: 'username' }); }
	get password() { return this.code.driver.page.getByRole('textbox', { name: 'password' }); }
	get signInButton() { return this.code.driver.page.getByRole('button', { name: 'Sign In' }); }

	constructor(private code: Code) { }

	async goTo(): Promise<void> {
		await this.code.driver.page.goto('http://localhost:8787/auth-sign-in');
	}

	async signIn(username = 'user1', password = process.env.POSIT_WORKBENCH_PASSWORD || ''): Promise<void> {
		await this.username.clear();
		await this.username.fill(username);
		await this.password.clear();
		await this.password.fill(password);
		await this.signInButton.click();
	}
}
