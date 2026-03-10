"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.PositConnect = void 0;
const test_1 = require("@playwright/test");
const apiServer = 'http://localhost:3939/__api__/v1/';
class PositConnect {
    code;
    headers;
    connectApiKey;
    constructor(code) {
        this.code = code;
        this.code = code;
        this.headers = {};
        this.connectApiKey = '';
    }
    setConnectApiKey(key) {
        this.connectApiKey = key;
        this.headers['Authorization'] = `Key ${this.connectApiKey}`;
    }
    getConnectApiKey() {
        return this.connectApiKey;
    }
    // Create a new user and return the user guid
    // Note: This function does not check for existing users with the same username/email
    // It is the caller's responsibility to ensure uniqueness if needed
    async createUser() {
        const body = {
            email: 'john_doe@posit.co',
            first_name: 'John',
            last_name: 'Doe',
            password: process.env.POSIT_WORKBENCH_PASSWORD || 'dummy',
            user_role: 'viewer',
            username: 'user1',
        };
        const res = await fetch(`${apiServer}users`, {
            method: 'POST',
            headers: this.headers,
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`Request failed: ${res.status} ${res.statusText}\n${text}`);
        }
        // If the server returns JSON, this will parse it.
        const data = (await res.json());
        // Return the guid
        return data.guid;
    }
    async getPythonVersions() {
        const res = await fetch(`${apiServer}server_settings/python`, {
            headers: this.headers
        });
        if (!res.ok) {
            throw new Error(`HTTP ${res.status} ${res.statusText}`);
        }
        const data = (await res.json());
        return Array.from(new Set((data.installations ?? []).map(i => i.version).filter((v) => !!v)));
    }
    async getUserId(username) {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 10_000);
        try {
            const res = await fetch(`${apiServer}users`, {
                method: 'GET',
                headers: this.headers,
                redirect: 'error', // mirrors --max-redirs 0 + --fail behavior
                signal: controller.signal,
            });
            if (!res.ok) {
                const text = await res.text().catch(() => '');
                throw new Error(`GET /users failed: ${res.status} ${res.statusText}${text ? ` — ${text}` : ''}`);
            }
            const data = (await res.json());
            const user1 = data.results.find(u => u.username === username);
            return user1?.guid; // undefined if not found
        }
        finally {
            clearTimeout(t);
        }
    }
    async setPythonVersion(version) {
        const editorContainer = this.code.driver.currentPage.locator('[id="workbench.parts.editor"]');
        const dynamicTomlLineRegex = '[python]';
        const targetLine = editorContainer.locator('.view-line').filter({ hasText: dynamicTomlLineRegex });
        await (0, test_1.expect)(targetLine).toBeVisible({ timeout: 10000 });
        await targetLine.click();
        await this.code.driver.currentPage.keyboard.press('End');
        await this.code.driver.currentPage.keyboard.press('Enter');
        await this.code.driver.currentPage.keyboard.type(`version = '${version}'`, { delay: 50 });
    }
    async setContentPermission(contentGuid, payload) {
        const url = `${apiServer}content/${contentGuid}/permissions`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15_000);
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: this.headers,
                body: JSON.stringify(payload),
                redirect: 'follow',
                signal: controller.signal,
            });
            if (!res.ok) {
                const text = await res.text().catch(() => '');
                throw new Error(`HTTP ${res.status} ${res.statusText} — ${text}`);
            }
            // If the API returns JSON, parse it; otherwise return empty object
            const contentType = res.headers.get('content-type') || '';
            return contentType.includes('application/json')
                ? (await res.json())
                : {};
        }
        finally {
            clearTimeout(timeout);
        }
    }
}
exports.PositConnect = PositConnect;
//# sourceMappingURL=connect.js.map