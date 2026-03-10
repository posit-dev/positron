"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthPage = void 0;
class AuthPage {
    code;
    get username() { return this.code.driver.currentPage.getByRole('textbox', { name: 'username' }); }
    get password() { return this.code.driver.currentPage.getByRole('textbox', { name: 'password' }); }
    get signInButton() { return this.code.driver.currentPage.getByRole('button', { name: 'Sign In' }); }
    constructor(code) {
        this.code = code;
    }
    async goTo() {
        await this.code.driver.currentPage.goto('http://localhost:8787/auth-sign-in');
    }
    async signIn(username = 'user1', password = process.env.POSIT_WORKBENCH_PASSWORD || '') {
        await this.username.clear();
        await this.username.fill(username);
        await this.password.clear();
        await this.password.fill(password);
        await this.signInButton.click();
    }
}
exports.AuthPage = AuthPage;
//# sourceMappingURL=auth.page.js.map