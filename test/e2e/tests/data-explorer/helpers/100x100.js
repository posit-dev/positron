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
exports.parquetFilePath = exports.testDataExplorer = void 0;
const path_1 = require("path");
const fs = __importStar(require("fs"));
const test_1 = require("@playwright/test");
const testDataExplorer = async (app, language, commands, dataFrameName, tsvFilePath) => {
    // Execute commands.
    for (let i = 0; i < commands.length; i++) {
        await app.workbench.console.executeCode(language, commands[i]);
    }
    // Open the data frame.
    await app.workbench.variables.doubleClickVariableRow(dataFrameName);
    await app.workbench.editors.verifyTab(dataFrameName, { isVisible: true });
    // Maximize the data explorer.
    await app.workbench.dataExplorer.maximize();
    // Drive focus into the data explorer.
    await app.workbench.dataExplorer.grid.clickUpperLeftCorner();
    // Load the TSV file that is used to verify the data and split it into lines.
    const tsvFile = fs.readFileSync(tsvFilePath, { encoding: 'utf8' });
    let lines;
    if (process.platform === 'win32') {
        lines = tsvFile.split('\r\n');
    }
    else {
        lines = tsvFile.split('\n');
    }
    // Get the TSV values.
    const tsvValues = [];
    for (let rowIndex = 0; rowIndex < lines.length; rowIndex++) {
        tsvValues.push(lines[rowIndex].split('\t'));
    }
    /**
     * Tests the row at the specified row index.
     * @param rowIndex The row index of the row under test.
     */
    const testRow = async (rowIndex) => {
        const keyboard = app.code.driver.currentPage.keyboard;
        // Scroll to home and put the cursor there.
        await app.workbench.dataExplorer.grid.jumpToStart();
        // Navigate to the row under test.
        for (let i = 0; i < rowIndex; i++) {
            await keyboard.press('ArrowDown');
        }
        // Test each cell in the row under test.
        const row = tsvValues[rowIndex];
        for (let columnIndex = 0; columnIndex < row.length; columnIndex++) {
            // Get the cell.
            const cellLocator = app.code.driver.currentPage.locator(`#data-grid-row-cell-content-${columnIndex}-${rowIndex} .text-container .text-value`);
            await (0, test_1.expect)(cellLocator).toBeVisible();
            // Get the cell value and test value.
            const secsRemover = (value) => value.replace(/^(.*)( secs)$/, '$1');
            const cellValue = secsRemover((await cellLocator.textContent()) || '');
            const testValue = secsRemover(row[columnIndex]);
            // If the test value is a number, perform a numerical "close enough" comparison;
            // otherwise, perform a strict equal comparison.
            if (testValue.match(/^-?\d*\.?\d*$/)) {
                (0, test_1.expect)(Math.abs(Number.parseFloat(cellValue) - Number.parseFloat(testValue))).toBeLessThan(0.05);
            }
            else {
                (0, test_1.expect)(await cellLocator.textContent(), `${rowIndex},${columnIndex}`).toStrictEqual(row[columnIndex]);
            }
            // Move to the next cell.
            await keyboard.press('ArrowRight');
        }
    };
    // Check the first row, the middle row, and the last row.
    await testRow(0);
    await testRow(Math.trunc(tsvValues.length / 2));
    await testRow(tsvValues.length - 1);
    // Return to Stacked layout
    await app.workbench.layouts.enterLayout('stacked');
    // Check that "open as plaintext" button is not available
    await (0, test_1.expect)(app.code.driver.currentPage.getByLabel('Open as Plain Text File')).not.toBeVisible();
};
exports.testDataExplorer = testDataExplorer;
const parquetFilePath = (app) => {
    // Set the path to the Parquet file.
    let parquetFilePath = (0, path_1.join)(app.workspacePathOrFolder, 'data-files', '100x100', '100x100.parquet');
    // On Windows, double escape the path.
    if (process.platform === 'win32') {
        parquetFilePath = parquetFilePath.replaceAll('\\', '\\\\');
    }
    // Return the path to the Parquet file.
    return parquetFilePath;
};
exports.parquetFilePath = parquetFilePath;
//# sourceMappingURL=100x100.js.map