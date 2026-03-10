"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.Connections = void 0;
const test_1 = __importStar(require("@playwright/test"));
const CONNECTIONS_CONTAINER = '.connections-items-container';
const CONNECTIONS_ITEM = '.connections-item';
/*
 *  Reuseable Positron connections tab functionality for tests to leverage
 */
class Connections {
    code;
    quickaccess;
    deleteConnectionButton;
    disconnectButton;
    connectIcon;
    connectionItems;
    resumeConnectionButton;
    currentConnectionName;
    constructor(code, quickaccess) {
        this.code = code;
        this.quickaccess = quickaccess;
        this.deleteConnectionButton = code.driver.currentPage.getByLabel('Delete Connection');
        this.disconnectButton = code.driver.currentPage.getByLabel('Disconnect');
        this.connectIcon = code.driver.currentPage.locator('.codicon-arrow-circle-right');
        this.connectionItems = code.driver.currentPage.locator('.connections-list-item');
        this.resumeConnectionButton = code.driver.currentPage.locator('.positron-modal-dialog-box').getByRole('button', { name: 'Resume Connection' });
        this.currentConnectionName = code.driver.currentPage.locator('.connections-instance-details .connection-name');
    }
    async openConnectionsNodes(nodes) {
        for (const node of nodes) {
            await this.code.driver.currentPage.locator(CONNECTIONS_ITEM).filter({ hasText: node }).locator('.codicon-chevron-right').click();
            await (0, test_1.expect)(this.code.driver.currentPage.locator(CONNECTIONS_ITEM).filter({ hasText: node }).locator('.codicon-chevron-down')).toBeVisible();
        }
    }
    async assertConnectionNodes(nodes) {
        const waits = nodes.map(async (node) => {
            await (0, test_1.expect)(this.code.driver.currentPage.locator(CONNECTIONS_CONTAINER).getByText(node)).toBeVisible();
        });
        await Promise.all(waits);
    }
    async openConnectionPane() {
        await this.quickaccess.runCommand('connections.focus');
    }
    async viewConnection(name) {
        // Check if we're already viewing this connection (wait up to 1s for UI to settle)
        let isAlreadyViewing = false;
        try {
            await this.currentConnectionName.filter({ hasText: name }).waitFor({ state: 'visible', timeout: 5000 });
            isAlreadyViewing = true;
        }
        catch {
            // Not already viewing this connection
        }
        if (!isAlreadyViewing) {
            await this.connectionItems.filter({ hasText: name }).locator(this.connectIcon).click();
        }
    }
    async openTree() {
        await this.quickaccess.runCommand('positron.connections.expandAll');
    }
    async deleteConnection() {
        await (0, test_1.expect)(this.code.driver.currentPage.getByLabel('Delete Connection')).toBeVisible();
        this.deleteConnectionButton.click();
    }
    async initiateConnection(language, driver) {
        await test_1.default.step(`Initiating a ${language} connection to ${driver}`, async () => {
            await this.code.driver.currentPage.getByRole('button', { name: 'New Connection' }).click();
            await this.code.driver.currentPage.locator('.connections-new-connection-modal .codicon-chevron-down').click();
            await this.code.driver.currentPage.locator('.positron-modal-popup-children').getByRole('button', { name: language }).click();
            await this.code.driver.currentPage.locator('.driver-name', { hasText: driver }).click();
        });
    }
    async fillConnectionsInputs(fields) {
        await test_1.default.step('Filling connection inputs', async () => {
            for (const [labelText, value] of Object.entries(fields)) {
                const label = this.code.driver.currentPage.locator('span.label-text', { hasText: labelText });
                const input = label.locator('+ input.text-input');
                await input.fill(value);
            }
        });
    }
    async connect() {
        await test_1.default.step('Click connect button when ready', async () => {
            await this.code.driver.currentPage.locator('.button', { hasText: 'Connect' }).click();
        });
    }
    async expandConnectionDetails(name) {
        const item = this.code.driver.currentPage.locator('.connections-details', { hasText: name });
        await item.locator('..').locator('.expand-collapse-area .codicon-chevron-right').click();
    }
}
exports.Connections = Connections;
//# sourceMappingURL=connections.js.map