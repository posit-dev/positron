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
exports.Problems = void 0;
const test_1 = __importStar(require("@playwright/test"));
const TIMEOUT_STANDARD = 30000;
class Problems {
    code;
    quickaccess;
    get problemsTab() { return this.code.driver.currentPage.getByRole('tab', { name: 'Problems' }); }
    get problemsView() { return this.code.driver.currentPage.locator('.panel .markers-panel'); }
    get problemsViewWarning() { return this.problemsView.locator('.marker-icon .codicon-warning'); }
    get problemsViewError() { return this.problemsView.locator('.marker-icon .codicon-error'); }
    get problemsCount() { return this.problemsTab.locator('.badge-content'); }
    get problemsRow() { return this.problemsView.locator('.monaco-tl-row'); }
    get warningSquiggly() { return this.code.driver.currentPage.locator('.view-overlays .cdr.squiggly-warning'); }
    get errorSquiggly() { return this.code.driver.currentPage.locator('.view-overlays .cdr.squiggly-error'); }
    constructor(code, quickaccess) {
        this.code = code;
        this.quickaccess = quickaccess;
    }
    // -- Actions --
    /**
     * Action: Show the Problems view
     */
    async showProblemsView() {
        await this.quickaccess.runCommand('workbench.panel.markers.view.focus');
        await (0, test_1.expect)(this.problemsView).toBeVisible({ timeout: TIMEOUT_STANDARD });
    }
    // -- Verifications --
    /**
     * Verify: Expect the number of squigglies to be as specified
     * @param severity 'warning' | 'error'
     * @param count number of squigglies to expect
     */
    async expectSquigglyCountToBe(severity, count) {
        await test_1.default.step(`Expect ${severity} squiggly count: ${count}`, async () => {
            const squiggly = severity === 'warning' ? this.warningSquiggly : this.errorSquiggly;
            await (0, test_1.expect)(squiggly).toHaveCount(count, { timeout: TIMEOUT_STANDARD });
        });
    }
    /**
     * Verify: Expect the number of problems, errors, and warnings to be as specified
     * @param badgeCount - The expected problem count shown in the Problems tab badge (total)
     * @param errorCount - The expected error count shown in the Problems view
     * @param warningCount - The expected warning count shown in the Problems view
     */
    async expectDiagnosticsToBe({ badgeCount, errorCount, warningCount }) {
        await test_1.default.step(`Expect diagnostics - Problems: ${badgeCount ?? 'N/A'}, Errors: ${errorCount ?? 'N/A'}, Warnings: ${warningCount ?? 'N/A'}`, async () => {
            // Waiting for debounce to complete, ensuring counts reflect the final state
            await this.code.driver.currentPage.waitForTimeout(1500);
            await this.showProblemsView();
            if (badgeCount !== undefined) {
                badgeCount === 0
                    ? await (0, test_1.expect)(this.problemsCount).not.toBeVisible()
                    : await (0, test_1.expect)(this.problemsCount).toHaveText(badgeCount.toString(), { timeout: TIMEOUT_STANDARD });
            }
            if (errorCount !== undefined) {
                await (0, test_1.expect)(this.problemsViewError).toHaveCount(errorCount, { timeout: TIMEOUT_STANDARD });
            }
            if (warningCount !== undefined) {
                await (0, test_1.expect)(this.problemsViewWarning).toHaveCount(warningCount, { timeout: TIMEOUT_STANDARD });
            }
        });
    }
    /**
     * Verify: Expect the warning text to be present in the Problems view
     * @param text The warning text that should be visible
     */
    async expectWarningText(text) {
        await test_1.default.step(`Expect warning text: ${text}`, async () => {
            await this.showProblemsView();
            await (0, test_1.expect)(this.problemsRow.filter({ hasText: text })).toBeVisible({ timeout: TIMEOUT_STANDARD });
        });
    }
}
exports.Problems = Problems;
//# sourceMappingURL=problems.js.map