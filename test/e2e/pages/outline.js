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
exports.Outline = void 0;
const assert_1 = require("assert");
const test_1 = __importStar(require("@playwright/test"));
const HORIZONTAL_SASH = '.explorer-viewlet .monaco-sash.horizontal';
const FOCUS_OUTLINE_COMMAND = 'outline.focus';
const OUTLINE_TREE = '.outline-tree';
const OUTLINE_ELEMENT = '.outline-element';
/*
 *  Reuseable Positron outline functionality for tests to leverage.
 */
class Outline {
    code;
    quickaccess;
    get outlineElement() { return this.code.driver.currentPage.locator(OUTLINE_TREE).locator(OUTLINE_ELEMENT); }
    constructor(code, quickaccess) {
        this.code = code;
        this.quickaccess = quickaccess;
    }
    async focus() {
        await this.quickaccess.runCommand(FOCUS_OUTLINE_COMMAND);
    }
    async getOutlineData() {
        await this.focus();
        const sashLocator = this.code.driver.currentPage.locator(HORIZONTAL_SASH).nth(1);
        const sashBoundingBox = await sashLocator.boundingBox();
        if (sashBoundingBox) {
            await this.code.driver.clickAndDrag({
                from: {
                    x: sashBoundingBox.x + 10,
                    y: sashBoundingBox.y
                },
                to: {
                    x: sashBoundingBox.x + 10,
                    y: sashBoundingBox.y - 150
                }
            });
        }
        else {
            (0, assert_1.fail)('Bounding box not found');
        }
        const outllineElements = await this.code.driver.currentPage.locator(OUTLINE_ELEMENT).all();
        const outlineData = [];
        for (const element of outllineElements) {
            // Extract only the symbol name from `.label-name`. We use to extract
            // metadata associated to the symbol, but this is too fragile and
            // dependent on upstream changes. For instance the number of
            // diagnostics/problems may be included there, and other details generated
            // by the LSP backend.
            const labelName = await element.locator('.label-name').textContent();
            if (labelName !== null) {
                outlineData.push(labelName.trim());
            }
        }
        return outlineData;
    }
    async expectOutlineElementToBeVisible(text, visible = true) {
        await test_1.default.step(`Expect outline element to be ${visible ? 'visible' : 'not visible'}: ${text}`, async () => {
            visible
                ? await (0, test_1.expect)(this.outlineElement.filter({ hasText: text })).toBeVisible()
                : await (0, test_1.expect)(this.outlineElement.filter({ hasText: text })).not.toBeVisible();
        });
    }
    async expectOutlineToBeEmpty() {
        await test_1.default.step('Expect outline to be empty', async () => {
            await (0, test_1.expect)(this.code.driver.currentPage.getByText(/^No symbols found in document/)).toBeVisible();
        });
    }
    async expectOutlineElementCountToBe(count) {
        await test_1.default.step(`Expect outline element count to be ${count}`, async () => {
            if (count === 0) {
                await (0, test_1.expect)(this.outlineElement).not.toBeVisible();
            }
            await (0, test_1.expect)(this.outlineElement).toHaveCount(count);
        });
    }
    async expectOutlineToContain(expected) {
        await (0, test_1.expect)(async () => {
            const outlineData = await this.getOutlineData();
            const missingFromUI = expected.filter(item => !outlineData.includes(item));
            (0, test_1.expect)(missingFromUI, `Missing from UI: ${missingFromUI}`).toHaveLength(0);
        }).toPass({ timeout: 10000 });
    }
}
exports.Outline = Outline;
//# sourceMappingURL=outline.js.map