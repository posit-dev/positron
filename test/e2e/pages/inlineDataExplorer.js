"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
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
exports.InlineDataExplorer = void 0;
const test_1 = __importStar(require("@playwright/test"));
const DEFAULT_TIMEOUT = 10000;
class InlineDataExplorer {
    page;
    // Main container
    container;
    // Header elements
    header;
    shape;
    openButton;
    // Content area
    content;
    dataGrid;
    // State indicators
    disconnectedState;
    errorState;
    // Data grid elements
    columnHeaders;
    cells;
    constructor(page) {
        this.page = page;
        this.container = this.page.locator('.inline-data-explorer-container');
        this.header = this.container.locator('.inline-data-explorer-header');
        this.shape = this.container.locator('.inline-data-explorer-shape');
        this.openButton = this.container.locator('.inline-data-explorer-open-button');
        this.content = this.container.locator('.inline-data-explorer-content');
        this.dataGrid = this.container.locator('.data-grid');
        this.disconnectedState = this.container.locator('.inline-data-explorer-disconnected');
        this.errorState = this.container.locator('.inline-data-explorer-error');
        this.columnHeaders = this.container.locator('.data-grid-column-header');
        this.cells = this.container.locator('.data-grid-row-cell');
    }
    // --- Actions ---
    async openFullDataExplorer() {
        await test_1.default.step('Open full Data Explorer from inline view', async () => {
            await this.openButton.click();
        });
    }
    async sortColumn(columnName, direction) {
        await test_1.default.step(`Sort column "${columnName}" ${direction}`, async () => {
            const columnHeader = this.columnHeaders.filter({ hasText: columnName });
            const menuLabel = direction === 'ascending' ? 'Sort Ascending' : 'Sort Descending';
            // Click the dropdown button inside the column header to open the
            // positron modal popup menu (not a native OS context menu).
            await columnHeader.locator('.positron-button').click();
            await this.page.getByRole('button', { name: menuLabel }).click();
        });
    }
    async scrollWithinGrid(deltaY) {
        const box = await this.content.boundingBox();
        if (box) {
            await this.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            await this.page.mouse.wheel(0, deltaY);
        }
    }
    // --- Verifications ---
    async expectToBeVisible(timeout = DEFAULT_TIMEOUT) {
        await test_1.default.step('Verify inline data explorer is visible', async () => {
            await (0, test_1.expect)(this.container).toBeVisible({ timeout });
        });
    }
    async expectGridToBeReady(timeout = DEFAULT_TIMEOUT) {
        await test_1.default.step('Verify data grid is ready with content', async () => {
            await (0, test_1.expect)(this.dataGrid).toBeVisible({ timeout });
            await (0, test_1.expect)(this.columnHeaders.first()).toBeVisible({ timeout });
        });
    }
    async expectShapeToContain(rows, columns) {
        await test_1.default.step(`Verify shape contains: ${rows} rows${columns ? `, ${columns} columns` : ''}`, async () => {
            await (0, test_1.expect)(this.shape).toContainText(String(rows));
            await (0, test_1.expect)(this.shape).toContainText('rows');
            if (columns !== undefined) {
                await (0, test_1.expect)(this.shape).toContainText(String(columns));
                await (0, test_1.expect)(this.shape).toContainText('columns');
            }
        });
    }
    async expectColumnHeaderToBeVisible(headerText) {
        await test_1.default.step(`Verify column header "${headerText}" is visible`, async () => {
            const headerTitle = this.columnHeaders.locator('.title').filter({ hasText: headerText });
            await (0, test_1.expect)(headerTitle.first()).toBeVisible();
        });
    }
    async expectCellToBeVisible(text) {
        await test_1.default.step(`Verify cell with text "${text}" is visible`, async () => {
            await (0, test_1.expect)(this.container.getByText(text)).toBeVisible();
        });
    }
    async expectOpenButtonToBeVisible() {
        await test_1.default.step('Verify Open button is visible', async () => {
            await (0, test_1.expect)(this.openButton).toBeVisible();
        });
    }
    async expectNoError() {
        await test_1.default.step('Verify no error state', async () => {
            await (0, test_1.expect)(this.errorState).not.toBeVisible();
        });
    }
    async expectColumnToBeSorted(columnName, expectedFirstValues, timeout = DEFAULT_TIMEOUT) {
        await test_1.default.step(`Verify column "${columnName}" is sorted`, async () => {
            await (0, test_1.expect)(async () => {
                const headers = await this.columnHeaders.locator('.title').allInnerTexts();
                const columnIndex = headers.indexOf(columnName);
                (0, test_1.expect)(columnIndex).toBeGreaterThanOrEqual(0);
                for (let i = 0; i < expectedFirstValues.length; i++) {
                    const cell = this.container.locator(`#data-grid-row-cell-content-${columnIndex}-${i}`);
                    await (0, test_1.expect)(cell).toContainText(String(expectedFirstValues[i]));
                }
            }).toPass({ timeout });
        });
    }
}
exports.InlineDataExplorer = InlineDataExplorer;
//# sourceMappingURL=inlineDataExplorer.js.map